#!/usr/bin/env python3
"""PRIMA R2.24.17 local live-source HTTP runner, scoped synthetic EN case."""
from pathlib import Path
import argparse, datetime, json, os, queue, signal, socket, subprocess, sys, threading, time, urllib.request, urllib.error, uuid
ROOT=Path(__file__).resolve().parents[3]
REPORT=ROOT/'qa/full-pipeline/reports'
WRANGLER=ROOT/'node_modules/.bin/wrangler'
CONFIG=ROOT/'wrangler.qa.jsonc'
FINGER=ROOT/'qa/full-pipeline/runners/source-fingerprint.py'
SCENARIOS=ROOT/'qa/full-pipeline/scenarios/routing-core-v1.json'
CASES={'R04','R05','R06','R07'}  # no contact, no Search bridge until implemented

def fingerprint():
    p=subprocess.run([sys.executable,str(FINGER)],cwd=ROOT,capture_output=True,text=True,check=True)
    return json.loads(p.stdout)
def open_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));return s.getsockname()[1]
def post(base,endpoint,data,token=None,timeout=90):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base+endpoint,data=json.dumps(data).encode(),headers=headers,method='POST')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            return response.status,json.loads(response.read())
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read())

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--live-db',action='store_true',help='Explicitly allow synthetic QA conversation/message writes to connected Supabase')
    ap.add_argument('--case',default='R04',choices=sorted(CASES))
    args=ap.parse_args()
    for p in (WRANGLER,CONFIG,FINGER,SCENARIOS,ROOT/'src/index.js'):
        if not p.is_file():raise RuntimeError('MISSING '+str(p))
    if 'PRIMA_QA_RUNTIME_TRACE_R22417' not in (ROOT/'src/index.js').read_text():
        raise RuntimeError('RUNTIME_INSTRUMENTATION_NOT_INSTALLED')
    before=fingerprint()
    print('SOURCE SHA256:', before['source_sha256'])
    print('CASE:',args.case,'CURRENT WORKTREE, NOT ZIP')
    if not args.live_db:
        print('BLOCKED BY DEFAULT: no Supabase writes permitted. Re-run with --live-db for one synthetic EN test conversation.')
        print('SOURCE CHECK: PASS; LIVE HTTP: NOT_TESTED')
        return 0
    print('LIVE MODE: 1 synthetic conversation; real OpenAI + existing Supabase; no leads')
    cases={s['id']:s for s in json.loads(SCENARIOS.read_text())['scenarios']}
    scenario=cases[args.case]
    messages=scenario['turns']
    if len(messages)!=1:raise RuntimeError('MULTI_TURN_BRIDGE_NOT_IMPLEMENTED')
    p=subprocess.Popen([str(WRANGLER),'dev','--config',str(CONFIG),'--local',
        '--ip','127.0.0.1','--port',str(open_port()),
        '--var','PRIMA_QA_RUNTIME_TRACE:1','--var','PRIMA_TURN_TRACE:1',
        '--var','PRIMA_PERSONA_GENERATIVE_A1:1',
        '--var','PRIMA_SEARCH_PRODUCTION:1'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
        text=True,bufsize=1,start_new_session=True)
    # Port extracted from command args, never use an existing server.
    port=p.args[p.args.index('--port')+1]
    base='http://127.0.0.1:'+port
    lines=queue.Queue()
    thread=threading.Thread(target=lambda: [lines.put(x.rstrip('\n')) for x in p.stdout],daemon=True)
    thread.start()
    events=[]; response=None; start_status=None; status=None; error=None
    try:
        ready=False
        for _ in range(75):
            if p.poll() is not None:raise RuntimeError('WRANGLER_EXITED_'+str(p.returncode))
            try:
                with urllib.request.urlopen(base+'/api/prima/health',timeout=0.6) as h:
                    status_obj=json.loads(h.read())
                    if status_obj.get('ok') and status_obj.get('supabase_configured'):
                        ready=True;break
            except Exception:time.sleep(0.35)
        if not ready:raise RuntimeError('LOCAL_WORKER_NOT_READY_OR_SUPABASE_MISSING')
        start_status,started=post(base,'/api/prima/conversation/start',{
            'initiator':'user','visitor_id':None,'session_id':None,
            'page':{'language_code':'en','url_path':'/en/__qa__/full-pipeline/',
                    'canonical_url_path':'/en/__qa__/full-pipeline/'}}
        )
        conv=started.get('conversation',{})
        cid=conv.get('conversation_id') if isinstance(conv,dict) else None
        token=started.get('conversation_access_token')
        if start_status not in (200,201) or not cid or not token:
            raise RuntimeError('CONVERSATION_START_FAILED_HTTP_'+str(start_status))
        message=messages[0]
        turn_id=str(uuid.uuid4())
        status,response=post(base,'/api/prima/message',{
            'conversation_id':cid,'user':{'message':message},
            'page':{'language_code':'en','url_path':'/en/__qa__/full-pipeline/',
                    'canonical_url_path':'/en/__qa__/full-pipeline/'},
            'turn':{'version':'ConversationTurnV1','turn_id':turn_id,'turn_seq':1,'phase':'initial'}
        },token,timeout=110)
        time.sleep(2)
        report={
            'contract':'PRIMA_RUNTIME_TRACE_R22417',
            'source_sha256':before['source_sha256'],
            'case':args.case,'message':message,
            'conversation_id':cid, # synthetic QA ID only
            'http_status':status,
            'response_type':response.get('response_type'),
            'route':response.get('route'),
            'next_action':response.get('meta',{}).get('next_action') if isinstance(response.get('meta'),dict) else None,
            'answer':str(response.get('answer') or '')[:2500],
            'answer_quality':'NOT_ASSERTED',
            'frontend_search_bridge':'NOT_TESTED',
            'contact_persistence':'BLOCKED',
            'real_worker':True,
            'worker_source_mode':'CURRENT_WORKTREE',
            'status':'RECORDED' if status==200 and response.get('ok') is not False and not response.get('error') else 'HTTP_ERROR'
        }
    except Exception as e:
        error=type(e).__name__+': '+str(e)[:200]
        report={'contract':'PRIMA_RUNTIME_TRACE_R22417','case':args.case,
                'source_sha256':before['source_sha256'],'error':error,'status':'FAIL'}
    finally:
        if p.poll() is None:
            os.killpg(p.pid,signal.SIGTERM)
            try:p.wait(timeout=6)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=6)
        thread.join(timeout=1)
        while not lines.empty():
            line=lines.get_nowait()
            if 'PRIMA_QA_TRACE ' in line:
                tail=line.split('PRIMA_QA_TRACE ',1)[1].strip()
                # Wrangler may suffix output; only accept complete JSON.
                try:events.append(json.loads(tail))
                except json.JSONDecodeError:pass
    after=fingerprint()
    report['source_unchanged']=before['source_sha256']==after['source_sha256']
    report['events']=events
    report['stages_recorded']=[e.get('stage') for e in events]
    first_error=next((e for e in events if e.get('stage')=='db_blocked' or
        isinstance(e.get('status'),int) and e['status']>=400 or
        e.get('status')=='network_error'), None)
    if first_error:report['first_observed_failure']={
        'stage':first_error.get('stage'),'module':first_error.get('module'),
        'function':first_error.get('fn'),'operation':first_error.get('operation'),
        'http_status':first_error.get('status')}
    if not report['source_unchanged']:report['status']='INVALIDATED_SOURCE_CHANGED'
    if report['status']=='RECORDED' and not any(x.get('stage')=='final_response' for x in events):
        report['trace_completeness']='PARTIAL'
    elif report['status']=='RECORDED':report['trace_completeness']='RECORDED_CHECKPOINTS'
    REPORT.mkdir(exist_ok=True,parents=True)
    dest=REPORT/f'live-trace-{args.case}-latest.json'
    dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('\n===== REAL LIVE WORKER TRACE =====')
    print('HTTP:',report.get('http_status'),'RESPONSE TYPE:',report.get('response_type'))
    print('ROUTE:',report.get('route'),'ACTION:',report.get('next_action'))
    print('ANSWER:',report.get('answer','')[:1100])
    print('STAGES:',len(events))
    for e in events:
        print('  ',e.get('stage'),e.get('module',''),
            'action='+str(e.get('final_action') or e.get('action') or e.get('next_action') or ''),
            'duration_ms='+str(e.get('duration_ms',e.get('elapsed_ms',''))))
    print('CODE UNCHANGED:',report['source_unchanged'])
    print('REPORT:',dest.relative_to(ROOT))
    print('STATUS:',report['status'])
    return 0 if report['status']=='RECORDED' else 1
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('QA RUN BLOCKED:',str(exc)[:300],file=sys.stderr)
        sys.exit(2)
