#!/usr/bin/env python3
"""R2.24.18: real current-source local Worker, bounded scenarios, truthful coverage.
No source copies, no mock replies, no automatic deployment or lead creation.
"""
from pathlib import Path
import argparse, datetime, json, os, queue, signal, socket, subprocess, sys, threading, time, urllib.error, urllib.request, uuid

ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'qa/full-pipeline'
WRANGLER=ROOT/'node_modules/.bin/wrangler'
CONFIG=ROOT/'wrangler.function-trace.local.jsonc'
FINGER=QA/'runners/source-fingerprint.py'
SCENARIOS=QA/'scenarios/routing-core-v1.json'
REPORTS=QA/'reports'


def fingerprint():
    p=subprocess.run([sys.executable,str(FINGER)],cwd=ROOT,capture_output=True,text=True,check=True)
    return json.loads(p.stdout)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0))
        return s.getsockname()[1]


def post(base,path,payload,token=None,timeout=115):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(base+path,json.dumps(payload).encode(),headers=headers,method='POST')
    try:
        with urllib.request.urlopen(request,timeout=timeout) as result:
            return result.status,json.loads(result.read())
    except urllib.error.HTTPError as err:
        raw=err.read()
        try: body=json.loads(raw)
        except Exception: body={'error':'non_json_http_error','http_status':err.code}
        return err.code,body


def event_parse(line):
    if 'PRIMA_QA_FN_TRACE ' in line:
        tail=line.split('PRIMA_QA_FN_TRACE ',1)[1].strip()
        try:
            obj=json.loads(tail)
            obj['stage']='function_'+str(obj.get('event','unknown'))
            obj['module']=str(obj.get('id') or '').split(':',1)[0]
            obj['fn']=obj.get('id')
            return obj
        except ValueError:return None
    if 'PRIMA_QA_TRACE ' not in line: return None
    tail=line.split('PRIMA_QA_TRACE ',1)[1].strip()
    try: return json.loads(tail)
    except ValueError: return None


def summarize_turn(message, http_status, response, events):
    # Module attribution means a checkpoint was emitted, NOT that every function ran.
    checkpoint_stages=['turn_begin','router','fast_gate','luna_result','interpreter',
        'conversation_move','decision_policy','executor_route','knowledge_plan',
        'evidence','answer_model','answer_selection','search_dispatch','final_response']
    names={e.get('stage') for e in events}
    modules=sorted({e.get('module') for e in events if e.get('module')})
    policy=next((e for e in events if e.get('stage')=='decision_policy'),{})
    luna=next((e for e in events if e.get('stage')=='luna_result'),{})
    response=response if isinstance(response,dict) else {}
    meta=response.get('meta') or {}
    tool_request=(response.get('response_type')=='tool_request' or
                  (str(response.get('next_action') or meta.get('next_action') or '')=='SEARCH' and
                   response.get('response_type') not in ('answer','clarification','search_results')))
    failures=[{'stage':e.get('stage'),'module':e.get('module'),'fn':e.get('fn'),
               'operation':e.get('operation'),'status':e.get('status')}
        for e in events if e.get('stage')=='db_blocked' or e.get('status')=='network_error' or
            isinstance(e.get('status'),int) and e['status']>=400]
    # PT09 QA-only: MEM07 has a legitimate deterministic return before the
    # general final_response checkpoint. Require proof of root completion,
    # successful assistant/user persistence and at least one durable fact.
    # HTTP 200 alone, a text answer alone, or an unrelated fast-path is NOT enough.
    db_ops=[e for e in events if e.get('stage')=='supabase_http']
    def stored(operation, method, status):
        return sum(1 for e in db_ops if e.get('operation')==operation and
                   e.get('method')==method and e.get('status')==status)
    fn_errors=[e for e in events if e.get('stage')=='function_function_error']
    fn_entries=sum(e.get('stage')=='function_function_enter' for e in events)
    fn_exits=sum(e.get('stage')=='function_function_exit' for e in events)
    mem07_complete=(
        http_status==200 and response.get('response_type')=='answer' and
        bool(str(response.get('answer') or '').strip()) and
        meta.get('next_action')=='PROFILE_UPDATE' and
        meta.get('next_action_reason')=='mem07_explicit_pure_profile_update' and
        any(e.get('event')=='request_end' and e.get('id')=='src/index.js:fetch'
            for e in events) and
        any(str(e.get('id') or '').endswith(':persistDeterministicProfileTurnV1') and
            e.get('event')=='function_exit' for e in events) and
        fn_entries>0 and fn_entries==fn_exits and not fn_errors and
        not failures and not response.get('lead_action') and
        stored('conversations','PATCH',200)>=1 and
        stored('messages','POST',201)>=2 and
        stored('persist_memory_fact_v2','POST',200)>=1
    )
    if http_status >= 400 or response.get('ok') is False or response.get('error'):
        outcome='HTTP_ERROR'
    elif tool_request:
        outcome='SEARCH_BRIDGE_REQUIRED'
    elif 'final_response' in names or mem07_complete:
        outcome='TRACE_RECORDED'
    else:
        outcome='TRACE_PARTIAL'
    function_entries=[e for e in events if e.get('stage')=='function_function_enter']
    function_exits=[e for e in events if e.get('stage')=='function_function_exit']
    function_errors=[e for e in events if e.get('stage')=='function_function_error']
    unique_functions=sorted({e.get('id') for e in function_entries if e.get('id')})
    return {
        'function_trace':{'entry_events':len(function_entries),
            'exit_events':len(function_exits),'error_events':len(function_errors),
            'unique_functions':unique_functions,
            'span_pairs_verified':len(function_entries)==len(function_exits)+len(function_errors)},
        'input':message, 'http_status':http_status, 'response_type':response.get('response_type'),
        'route':response.get('route'), 'action':meta.get('next_action'),
        'answer':str(response.get('answer') or '')[:2500],
        'luna':{k:luna.get(k) for k in ('decision','primary_route','next_action','tasks_count','confidence','duration_ms','input_tokens','output_tokens','error_code')},
        'policy':{k:policy.get(k) for k in ('route_before','candidate','final_action','reason')},
        'execution_status':outcome,
        'fastpath_completion_verified':bool(mem07_complete),
        'completion_evidence':'mem07_db_persisted_and_root_closed' if mem07_complete else None,
        'checkpoint_coverage':{stage:stage in names for stage in checkpoint_stages},
        'modules_observed':modules,
        'first_observed_error':failures[0] if failures else None,
        'db_operations':[{'operation':e.get('operation'),'method':e.get('method'),
                         'status':e.get('status'),'duration_ms':e.get('duration_ms')}
                         for e in events if e.get('stage')=='supabase_http'],
        'events':events,
        'answer_quality':'NOT_ASSERTED',
        'function_level_coverage':'RUNTIME_SPANS',
        'search_v3_browser_execution':'NOT_TESTED' if tool_request else 'NOT_REQUIRED_OR_NOT_OBSERVED'
    }


def compare(scenario,turns):
    expected=scenario.get('expected') or {}
    result={}
    if not turns:
        return {'routing':'NOT_TESTED','execution':'NOT_TESTED','answer':'NOT_TESTED','checks':result}
    first=turns[0]
    if 'next_action' in expected:
        got=first.get('policy',{}).get('final_action') or first.get('action')
        result['next_action']={'expected':expected['next_action'],'actual':got,
            'status':'PASS' if got==expected['next_action'] else 'FAIL' if got else 'NOT_TESTED'}
    if expected.get('search_not_authorized'):
        disallowed='search_dispatch' in {e.get('stage') for e in first['events']}
        result['search_not_authorized']={'status':'FAIL' if disallowed else 'PASS'}
    if 'second_turn_action' in expected:
        if len(turns)<2:
            result['second_turn_action']={'status':'NOT_TESTED','reason':'search_bridge_or_prior_turn_incomplete'}
        else:
            got=turns[1].get('policy',{}).get('final_action') or turns[1].get('action')
            result['second_turn_action']={'status':'PASS' if got==expected['second_turn_action'] else 'FAIL' if got else 'NOT_TESTED',
                'expected':expected['second_turn_action'],'actual':got}
    for key in ('preserve_location','preserve_bedrooms'):
        if expected.get(key):
            result[key]={'status':'NOT_TESTED','reason':'durable_state_not_yet_verified'}
    statuses=[x['status'] for x in result.values()]
    routing='FAIL' if 'FAIL' in statuses else 'PASS' if statuses and all(x=='PASS' for x in statuses) else 'PARTIAL' if 'PASS' in statuses else 'NOT_TESTED'
    execution='PARTIAL' if any(t['execution_status']=='SEARCH_BRIDGE_REQUIRED' for t in turns) else 'RECORDED' if all(t['execution_status']=='TRACE_RECORDED' for t in turns) else 'INCOMPLETE'
    return {'routing':routing,'execution':execution,'answer':'NOT_TESTED','checks':result}


# PRIMA_R22423_ASYNC_COLLECTOR_V1
# Wait for the HTTP root AND observed waitUntil-related spans to terminate.
# No synthetic events and no assumptions that HTTP 200 means all writes finished.
def collect_async_trace_logs(q, timeout_s=25.0, settle_s=0.75):
    """Incremental O(N) event collection; never infer completion from HTTP 200.

    The previous collector reparsed *all* retained lines on each new line,
    causing quadratic cost on high-volume SearchContext continuations.
    """
    deadline = time.monotonic() + timeout_s
    raw = []
    trace_id = None
    entries = set()
    terminals = set()
    ended = False
    settled_at = None
    parsed_count = 0

    while time.monotonic() < deadline:
        try:
            line = q.get(timeout=min(.10, max(.001, deadline - time.monotonic())))
        except queue.Empty:
            line = None
        if line is not None:
            raw.append(line)
            event = event_parse(line)  # Parse each line exactly once.
            parsed_count += 1
            if event:
                stage = event.get('stage')
                eid = event.get('trace_id')
                if stage == 'function_request_begin' and eid:
                    # Caller drains earlier requests before starting a new step.
                    if trace_id is None:
                        trace_id = str(eid)
                if trace_id and str(eid or '') == trace_id:
                    sid = event.get('span_id')
                    if stage == 'function_function_enter' and sid:
                        entries.add(str(sid))
                    elif stage in ('function_function_exit', 'function_function_error') and sid:
                        terminals.add(str(sid))
                    elif stage in ('function_request_end', 'function_request_error'):
                        ended = True
        if ended and entries and entries == terminals:
            if settled_at is None:
                settled_at = time.monotonic()
            elif time.monotonic() - settled_at >= settle_s:
                return raw, {'status':'COMPLETE','trace_id':trace_id,
                    'pending':0,'root_terminal_observed':True,
                    'parsed_lines':parsed_count,'waited_for_background':True}
        else:
            settled_at = None
    pending = sorted(entries - terminals)
    return raw, {'status':'INCOMPLETE_TIMEOUT' if trace_id else 'TRACE_NOT_OBSERVED',
        'trace_id':trace_id,'pending':len(pending),'pending_ids':pending[:20],
        'root_terminal_observed':ended,'parsed_lines':parsed_count,
        'terminal_without_entry':len(terminals-entries),'waited_for_background':True}

def main():
    parser=argparse.ArgumentParser(description='PRIMA live-source batch runtime trace R2.24.18')
    parser.add_argument('--cases',default='R04,R05,R06,R07',help='Comma-separated scenario IDs')
    parser.add_argument('--live-db',action='store_true',help='Explicit consent to synthetic conversations/messages in configured Supabase')
    parser.add_argument('--max-conversations',type=int,default=1,help='Hard safety cap, default 1, max 12')
    args=parser.parse_args()
    if not 1<=args.max_conversations<=12:raise ValueError('MAX_CONVERSATIONS_MUST_BE_1_TO_12')
    for path in [WRANGLER,CONFIG,FINGER,SCENARIOS,ROOT/'src/index.js',ROOT/'src/supabase.js']:
        if not path.is_file():raise RuntimeError('MISSING '+str(path))
    if any('PRIMA_QA_RUNTIME_TRACE_R22417' not in (ROOT/'src'/name).read_text()
           for name in ('index.js','supabase.js')):
        raise RuntimeError('R22417_INSTRUMENTATION_MISSING_IN_CURRENT_WORKTREE')
    scenario_data={s['id']:s for s in json.loads(SCENARIOS.read_text())['scenarios']}
    ids=[s.strip() for s in args.cases.split(',') if s.strip()]
    if not ids or len(ids)!=len(set(ids)) or any(x not in scenario_data for x in ids):
        raise ValueError('INVALID_OR_DUPLICATE_SCENARIO_IDS')
    if len(ids)>args.max_conversations:
        raise ValueError(f'SAFETY_CAP: requested {len(ids)} conversations; --max-conversations {args.max_conversations}')
    # Rebuild instrumented code from CURRENT src/ on EVERY run. No stale QA bundle.
    build=QA/'instrumentation/build-live-function-trace.cjs'
    subprocess.run(['node',str(build)],cwd=ROOT,check=True)
    build_data=json.loads((REPORTS/'function-trace-build-latest.json').read_text())
    before=fingerprint()
    print('===== PRIMA R2.24.18 CURRENT WORKTREE BATCH =====')
    print('SOURCE:',before['source_sha256'])
    print('CASES:',','.join(ids))
    if not args.live_db:
        print('BLOCKED: live DB writes require explicit --live-db. NO API REQUESTS SENT.')
        return 2
    print('EXPLICIT LIVE DB ENABLED: synthetic test conversations will be stored, no automatic cleanup')
    port=free_port()
    command=[str(WRANGLER),'dev','--config',str(CONFIG),'--local','--ip','127.0.0.1','--port',str(port),
        '--var','PRIMA_QA_RUNTIME_TRACE:1','--var','PRIMA_QA_FUNCTION_TRACE:1','--var','PRIMA_TURN_TRACE:1',
        '--var','PRIMA_PERSONA_GENERATIVE_A1:1','--var','PRIMA_SEARCH_PRODUCTION:1']
    proc=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
        text=True,bufsize=1,start_new_session=True)
    q=queue.Queue()
    watcher=threading.Thread(target=lambda: [q.put(x.rstrip('\n')) for x in proc.stdout],daemon=True)
    watcher.start()
    base='http://127.0.0.1:'+str(port)
    reports=[];bootlog=[]; error=None
    try:
        ready=False
        for _ in range(80):
            if proc.poll() is not None:raise RuntimeError('LOCAL_WRANGLER_EXITED')
            try:
                with urllib.request.urlopen(base+'/api/prima/health',timeout=0.7) as h:
                    health=json.loads(h.read())
                if health.get('ok') and health.get('supabase_configured'):
                    ready=True;break
            except Exception:time.sleep(.35)
        if not ready:raise RuntimeError('QA_WORKER_HEALTH_NOT_READY')
        for sid in ids:
            if fingerprint()['source_sha256']!=before['source_sha256']:
                raise RuntimeError('SOURCE_CHANGED_DURING_BATCH')
            scenario=scenario_data[sid]
            status,started=post(base,'/api/prima/conversation/start',{
                'initiator':'user','visitor_id':None,'session_id':None,
                'page':{'language_code':'en','url_path':'/en/__qa__/full-pipeline/',
                        'canonical_url_path':'/en/__qa__/full-pipeline/'}})
            conv=started.get('conversation') if isinstance(started,dict) else {}
            cid=conv.get('conversation_id') if isinstance(conv,dict) else None
            token=started.get('conversation_access_token') if isinstance(started,dict) else None
            if status not in (200,201) or not cid or not token:
                reports.append({'id':sid,'error':'CONVERSATION_START_FAILED','http_status':status,'turns':[]})
                print(sid,'FAIL conversation start HTTP',status)
                continue
            # Clear log queue before first turn; startup DB events belong to the conversation, not to Luna.
            while not q.empty():bootlog.append(q.get_nowait())
            turns=[]
            for seq,message in enumerate(scenario['turns'],1):
                if fingerprint()['source_sha256']!=before['source_sha256']:
                    raise RuntimeError('SOURCE_CHANGED_DURING_CONVERSATION')
                turn={'version':'ConversationTurnV1','turn_id':str(uuid.uuid4()),'turn_seq':seq,'phase':'initial'}
                http_status,response=post(base,'/api/prima/message',{
                    'conversation_id':cid,'user':{'message':message},
                    'page':{'language_code':'en','url_path':'/en/__qa__/full-pipeline/',
                        'canonical_url_path':'/en/__qa__/full-pipeline/'},'turn':turn},token)
                logs,async_collection=collect_async_trace_logs(q)
                print('  ASYNC:',async_collection['status'], 'pending=',async_collection.get('pending'))
                events=[event_parse(l) for l in logs]
                events=[e for e in events if e is not None]
                info=summarize_turn(message,http_status,response,events)
                info['turn_seq']=seq
                info['trace_id']=async_collection.get('trace_id')
                info['async_trace_collection']=async_collection
                info['db_event_correlation']='function_spans_correlated_by_trace_id; checkpoint_logs_best_effort'
                turns.append(info)
                print(sid,'turn',seq,'HTTP',http_status,info['execution_status'],
                    'route=',info.get('route'),'action=',info.get('action'),'events=',len(events))
                if info['execution_status']!='TRACE_RECORDED':
                    # Never fake browser Search continuation, or advance conversation past missing tool_result.
                    break
            reports.append({'id':sid,'category':scenario.get('category'),
                'qa_conversation_id':cid,'turns':turns,'verdict':compare(scenario,turns)})
    except Exception as exc:
        error=type(exc).__name__+': '+str(exc)[:250]
        print('BATCH ERROR:',error,file=sys.stderr)
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=6)
        watcher.join(timeout=1)
    observed=sorted({fid for r in reports for t in r.get('turns',[])
        for fid in (t.get('function_trace') or {}).get('unique_functions',[])})
    instrumented=build_data['instrumented']
    print('===== REAL FUNCTION EXECUTION COVERAGE =====')
    print('AST FUNCTIONS:',build_data['functions'],'INSTRUMENTED:',instrumented)
    print('OBSERVED UNIQUE FUNCTIONS:',len(observed))
    print('OBSERVED/INSTRUMENTED:',round(100*len(observed)/instrumented,2) if instrumented else 0,'%')
    print('NOTE: this is a scenario-set metric, not global 95% acceptance')
    after=fingerprint()
    valid=before['source_sha256']==after['source_sha256']
    result={'function_coverage':{'ast_total':build_data['functions'],'instrumented':instrumented,'observed_unique':len(observed),'observed_functions':observed,'percent_of_instrumented':round(100*len(observed)/instrumented,2) if instrumented else 0},'contract':'PRIMA_FUNCTION_RUNTIME_TRACE_R22420','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_mode':'REBUILT_FROM_CURRENT_WORKTREE','source_sha256_before':before['source_sha256'],
        'source_sha256_after':after['source_sha256'],'source_unchanged':valid,
        'executed_scenarios':len(reports),'requested_scenarios':ids,
        'browser_search_bridge':'NOT_IMPLEMENTED','function_level_770':'NOT_CLAIMED',
        'db_conversation_cleanup':'NOT_IMPLEMENTED','error':error,
        'status':'INVALIDATED_SOURCE_CHANGED' if not valid else 'ERROR' if error else 'RECORDED_PARTIAL_COVERAGE',
        'scenarios':reports}
    REPORTS.mkdir(parents=True,exist_ok=True)
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    dest=REPORTS/f'live-trace-batch-{stamp}.json'
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('===== BATCH REPORT =====')
    for item in reports:
        print(item['id'],'ROUTING',item.get('verdict',{}).get('routing','NOT_TESTED'),
            'EXECUTION',item.get('verdict',{}).get('execution','NOT_TESTED'),
            'ANSWER',item.get('verdict',{}).get('answer','NOT_TESTED'))
    print('SOURCE UNCHANGED:',valid)
    print('REPORT:',dest.relative_to(ROOT))
    print('FINAL:',result['status'])
    return 1 if not valid or error or any(x.get('verdict',{}).get('routing')=='FAIL' for x in reports) else 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('BLOCKED:',type(exc).__name__,str(exc)[:200],file=sys.stderr)
        sys.exit(2)
