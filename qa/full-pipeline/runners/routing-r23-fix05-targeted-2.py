#!/usr/bin/env python3
"""10 real initial turns through current locally instrumented PRIMA Worker. No mock decisions.
--live-db explicitly permits 2 NEW synthetic conversations in real configured Supabase; NO cleanup.
No Hugo/browser/deploy. Excludes response content grading and Search V3 execution.
"""
import argparse,collections,datetime as dt,importlib.util,json,os,queue,signal,socket,subprocess,sys,threading,time,uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'qa/full-pipeline'
REPORTS=QA/'reports'
RUNNER=QA/'runners/run-function-trace-batch.py'
BUILD=QA/'instrumentation/build-live-function-trace.cjs'
FINGER=QA/'runners/source-fingerprint.py'
CONFIG=ROOT/'wrangler.function-trace.local.jsonc'
WRANGLER=ROOT/'node_modules/.bin/wrangler'
SCENARIOS=QA/'scenarios/routing-r23-fix05-targeted-2.json'


def sha():
    p=subprocess.run([sys.executable,str(FINGER)],cwd=ROOT,text=True,capture_output=True,check=True)
    return json.loads(p.stdout)['source_sha256']


def load_runner():
    spec=importlib.util.spec_from_file_location('prima_existing_runner',RUNNER)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for key in ('post','event_parse','summarize_turn','collect_async_trace_logs'):
        if not callable(getattr(mod,key,None)):raise RuntimeError('CURRENT_QA_RUNNER_MISSING_'+key)
    return mod


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]


def verdict(case,info,resp):
    luna=info.get('luna') or {}
    pol=info.get('policy') or {}
    action=pol.get('final_action') or info.get('action') or (resp.get('next_action') if isinstance(resp,dict) else None)
    route=luna.get('primary_route') or info.get('route')
    status=info.get('http_status')
    checks={}
    def add(name,actual,allowed):
        checks[name]={'expected':allowed,'actual':actual,'status':'NOT_VERIFIED' if actual is None else 'PASS' if actual in allowed else 'FAIL'}
    if case.get('expected_actions'):add('approved_action',action,case['expected_actions'])
    if case.get('expected_routes'):
        add('recognized_route', route, case['expected_routes'])
        # Luna's preliminary semantic route is diagnostic, not necessarily the
        # final approved policy route. Keep mismatch visible as REVIEW when
        # the approved action is allowed; never turn it into a false PASS.
        route_check = checks['recognized_route']
        if route_check['status'] == 'FAIL' and action in case.get('expected_actions', []):
            route_check['status'] = 'REVIEW'
            route_check['note'] = ('Luna intermediate route differs from the scenario route set; '
                                  'approved final action is allowed. Review semantic classification.')
            route_check['policy_route_before'] = pol.get('route_before')

    if case.get('must_not_actions'):
        checks['forbidden_action']={'forbidden':case['must_not_actions'],'actual':action,
            'status':'NOT_VERIFIED' if action is None else 'FAIL' if action in case['must_not_actions'] else 'PASS'}
    if case.get('min_luna_tasks') is not None:
        count=luna.get('tasks_count')
        checks['compound_tasks']={'minimum':case['min_luna_tasks'],'actual':count,
            'status':'NOT_VERIFIED' if count is None else 'PASS' if count>=case['min_luna_tasks'] else 'FAIL'}
    # Distinguish semantic owner, approved policy and actual tool dispatch; do not infer missing checkpoints.
    luna_action=luna.get('next_action')
    policy_action=pol.get('final_action')
    reason=pol.get('reason')
    if luna_action is not None and policy_action is not None:
        drift=(luna_action!=policy_action)
        checks['luna_to_policy']={'luna':luna_action,'policy':policy_action,'reason':reason,
            'status':'REVIEW' if drift else 'PASS'}
    else:checks['luna_to_policy']={'status':'NOT_VERIFIED','luna':luna_action,'policy':policy_action}
    events=info.get('events') or []
    dispatch=[x for x in events if x.get('stage')=='search_dispatch']
    tool= isinstance(resp,dict) and (resp.get('version')=='PrimaToolRequestV1' or resp.get('response_type')=='tool_request')
    if 'SEARCH' in case.get('must_not_actions',[]) and (dispatch or tool):
        checks['post_policy_search_dispatch']={'status':'FAIL','approved_action':action,'dispatch_events':len(dispatch),'tool_response':tool,
            'note':'Scenario explicitly forbids search dispatch'}
    elif action not in ('SEARCH',) and (dispatch or tool):
        checks['post_policy_search_dispatch']={'status':'REVIEW','approved_action':action,'dispatch_events':len(dispatch),'tool_response':tool,
            'note':'Review D4/D5/legacy advisory authorized exception against current policy'}
    else:
        checks['post_policy_search_dispatch']={'status':'NOT_VERIFIED' if action is None else 'PASS','approved_action':action,'dispatch_events':len(dispatch),'tool_response':tool}
    async_status=(info.get('async_trace_collection') or {}).get('status')
    checks['technical_transport']={'status':'PASS' if status==200 and async_status=='COMPLETE' else 'FAIL','http_status':status,'async_status':async_status}
    outcomes=[x['status'] for x in checks.values()]
    outcome='FAIL' if 'FAIL' in outcomes else 'REVIEW' if 'REVIEW' in outcomes else 'NOT_VERIFIED' if 'NOT_VERIFIED' in outcomes else 'PASS'
    return {'status':outcome,'recognized_route':route,'approved_action':action,'luna_action':luna_action,'policy_action':policy_action,'checks':checks}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live-db',action='store_true',help='Explicitly permit 2 new QA conversations in real Supabase; no cleanup')
    args=parser.parse_args()
    cases=json.loads(SCENARIOS.read_text(encoding='utf8'))['scenarios']
    if len(cases)!=2 or len({c['id'] for c in cases})!=2 or any(not c.get('message') for c in cases):
        raise RuntimeError('BATCH_EXPECTS_EXACTLY_TWO_INDEPENDENT_SCENARIOS')
    if not args.live_db:
        print('SAFE STOP: run with --live-db only if 2 synthetic Supabase conversations are acceptable.')
        print('NO API REQUESTS SENT; NO DB WRITES.')
        return 2
    for p in [RUNNER,BUILD,FINGER,CONFIG,WRANGLER,ROOT/'src/index.js']:
        if not p.is_file():raise RuntimeError('REQUIRED_FILE_MISSING '+str(p))
    mod=load_runner()
    before=sha()
    subprocess.run(['node',str(BUILD)],cwd=ROOT,check=True)
    port=free_port()
    base=f'http://127.0.0.1:{port}'
    command=[str(WRANGLER),'dev','--config',str(CONFIG),'--local','--ip','127.0.0.1','--port',str(port),
        '--var','PRIMA_QA_RUNTIME_TRACE:1','--var','PRIMA_QA_FUNCTION_TRACE:1','--var','PRIMA_TURN_TRACE:1',
        '--var','PRIMA_PERSONA_GENERATIVE_A1:1','--var','PRIMA_SEARCH_PRODUCTION:1']
    proc=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,start_new_session=True)
    q=queue.Queue()
    th=threading.Thread(target=lambda:[q.put(line.rstrip('\n')) for line in proc.stdout],daemon=True)
    th.start()
    run={'contract':'PRIMA_ROUTING_SINGLE_TURN_BATCH_01','created_at':dt.datetime.now(dt.timezone.utc).isoformat(),
        'source_sha256_before':before,'status':'IN_PROGRESS','scope':'TWO_FRESH_CONVERSATIONS_INITIAL_ONLY',
        'search_v3_execution':'NOT_TESTED','answer_quality':'NOT_EVALUATED','live_db_writes':'TWO_SYNTHETIC_CONVERSATIONS_NO_CLEANUP',
        'scenarios':[]}
    err=None
    try:
        for _ in range(80):
            if proc.poll() is not None:raise RuntimeError('WRANGLER_PROCESS_EXITED')
            try:
                import urllib.request
                with urllib.request.urlopen(base+'/api/prima/health',timeout=.75) as f: health=json.loads(f.read())
                if health.get('ok') and health.get('supabase_configured'):break
            except Exception:time.sleep(.35)
        else:raise RuntimeError('WORKER_NOT_READY')
        page={'language_code':'en','url_path':'/en/__qa__/routing-single-turn/','canonical_url_path':'/en/__qa__/routing-single-turn/'}
        for idx,case in enumerate(cases,1):
            if sha()!=before:raise RuntimeError('SOURCE_CHANGED_DURING_BATCH')
            print(f'[{idx:02}/2] {case["id"]} {case["category"]}: {case["message"]}',flush=True)
            st,started=mod.post(base,'/api/prima/conversation/start',{'initiator':'user','visitor_id':None,'session_id':None,'page':page})
            conv=(started.get('conversation') or {}) if isinstance(started,dict) else {}
            cid=conv.get('conversation_id'); token=started.get('conversation_access_token') if isinstance(started,dict) else None
            item={'id':case['id'],'category':case['category'],'message':case['message'],'expected':case,
                  'conversation_id':cid,'status':'NOT_VERIFIED'}
            if st not in (200,201) or not cid or not token:
                item['status']='FAIL';item['error']='CONVERSATION_START_HTTP_'+str(st)
                run['scenarios'].append(item)
                print('  FAIL: conversation start',st,flush=True)
                continue
            # Clear startup logs and old-turn lines. Only one outgoing message per fresh conversation.
            while not q.empty():q.get_nowait()
            turn_id=str(uuid.uuid4());item['turn_id']=turn_id
            st,response=mod.post(base,'/api/prima/message',{'conversation_id':cid,'user':{'message':case['message']},
                'page':page,'turn':{'version':'ConversationTurnV1','turn_id':turn_id,'turn_seq':1,'phase':'initial'}},token)
            logs,async_info=mod.collect_async_trace_logs(q)
            events=[mod.event_parse(line) for line in logs]
            events=[ev for ev in events if isinstance(ev,dict)]
            info=mod.summarize_turn(case['message'],st,response,events)
            info['async_trace_collection']=async_info
            item['actual']=info
            item['response_contract']={k:response.get(k) for k in ['version','response_type','tool','action','next_action','route','query'] if isinstance(response,dict) and k in response}
            item['verdict']=verdict(case,info,response)
            item['status']=item['verdict']['status']
            run['scenarios'].append(item)
            print('  '+item['status']+' | route='+str(item['verdict']['recognized_route'])+
                  ' | Luna='+str(item['verdict']['luna_action'])+' | policy='+str(item['verdict']['policy_action'])+
                  ' | action='+str(item['verdict']['approved_action'])+' | events='+str(len(events))+ 
                  ' | async='+str(async_info.get('status')),flush=True)
    except Exception as exc:
        err=type(exc).__name__+': '+str(exc)[:350]
        print('BATCH ERROR:',err,file=sys.stderr)
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=6)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=6)
        th.join(timeout=1)
        after=sha();run['source_sha256_after']=after
        run['source_unchanged']=before==after
        counts=dict(collections.Counter(r['status'] for r in run['scenarios']))
        anomalies=[]
        for item in run['scenarios']:
            for name,ch in ((item.get('verdict') or {}).get('checks') or {}).items():
                if ch['status'] in ('FAIL','REVIEW','NOT_VERIFIED'):
                    anomalies.append({'case':item['id'],'check':name,'status':ch['status'],
                                      'actual':ch.get('actual'),'expected':ch.get('expected')})
        repeats=collections.defaultdict(list)
        for x in anomalies:repeats[x['check']+':'+x['status']].append(x['case'])
        run['repeated_anomalies']=[{'signature':k,'count':len(v),'cases':v} for k,v in sorted(repeats.items()) if len(v)>=2]
        run['anomalies']=anomalies
        run['counts']=counts
        run['status']='ERROR' if err or before!=after or len(run['scenarios'])!=2 else 'RECORDED_WITH_FINDINGS'
        if err:run['error']=err
        REPORTS.mkdir(parents=True,exist_ok=True)
        path=REPORTS/'routing-r23-fix05-targeted-2.json'
        path.write_text(json.dumps(run,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        print('\n===== PRIMA SINGLE-TURN ROUTING B01 =====')
        print('EXECUTED:',len(run['scenarios']),'OF 2 | COUNTS:',counts)
        print('REPEATED ANOMALIES:',len(run['repeated_anomalies']))
        for r in run['repeated_anomalies']:print('  ',r['signature'],'x'+str(r['count']),','.join(r['cases']))
        print('SOURCE UNCHANGED:',before==after)
        print('REPORT:',path.relative_to(ROOT))
        print('RESULT:',run['status'])
    return 2 if run['status']=='ERROR' else 1 if counts.get('FAIL',0) else 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('BLOCKED:',type(exc).__name__,str(exc)[:350],file=sys.stderr)
        sys.exit(2)
