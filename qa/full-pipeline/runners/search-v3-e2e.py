#!/usr/bin/env python3
"""PRIMA R2.24.24: real LOCAL Worker -> browser Search V3 -> tool_continuation.
Requires explicit --live-db; does not deploy, mock search, create leads, or copy source.
"""
from pathlib import Path
import argparse, datetime, hashlib, importlib.util, json, os, queue, signal, socket, subprocess, sys, threading, time, urllib.request, urllib.error, uuid
ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'qa/full-pipeline'
REPORTS=QA/'reports'
BATCH=QA/'runners/run-function-trace-batch.py'
FINGER=QA/'runners/source-fingerprint.py'
CONFIG=ROOT/'wrangler.function-trace.local.jsonc'
WRANGLER=ROOT/'node_modules/.bin/wrangler'
PROBE=QA/'runners/search-v3-bridge-probe.cjs'

def runfinger():
    v=subprocess.run([sys.executable,str(FINGER)],capture_output=True,text=True,cwd=ROOT,check=True)
    return json.loads(v.stdout)['source_sha256']

def portfree():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def request(url,payload=None,token=None,timeout=115):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,json.dumps(payload).encode() if payload is not None else None,headers=headers,method='POST' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as f:return f.status,json.loads(f.read())
    except urllib.error.HTTPError as e:
        try:return e.code,json.loads(e.read())
        except Exception:return e.code,{'error':'http_non_json'}

def src_search_file():
    candidates=[ROOT.parent/'client-primadom-new/layouts/partials/home/search_engine.html',
                ROOT.parent/'client-primadom-new/layouts/partials/search_engine.html',
                Path.home()/'zack-ai/zack-factory/client-primadom-new/layouts/partials/home/search_engine.html']
    for p in candidates:
        if p.is_file():return p
    return None

def safe_turn(value):
    # Deliberately omit access tokens and other authentication secrets.
    return {k:value.get(k) for k in ('input','http_status','response_type','route','action','answer','luna','policy','execution_status','function_trace','async_trace_collection','first_observed_error','trace_id','turn_seq')}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--live-db',action='store_true',help='Explicit consent: one QA conversation and message writes in existing Supabase')
    p.add_argument('--site-url',default='http://127.0.0.1:1329/en/')
    p.add_argument('--message',default='Find 2-bedroom apartments in Dubai Hills under AED 2 million.')
    a=p.parse_args()
    if not a.live_db:
        print('BLOCKED: --live-db required; NO API REQUESTS SENT');return 2
    for need in (WRANGLER,CONFIG,BATCH,FINGER,PROBE,ROOT/'src/index.js'):
        if not need.is_file():print('BLOCKED missing',need);return 2
    allowed_sites = (
        'http://127.0.0.1:1329/en',
        'https://primadom.ai/en',
    )
    if a.site_url.rstrip('/') not in allowed_sites:
        print('BLOCKED: unapproved Search V3 site URL');return 2
    search=src_search_file()
    if not search:
        print('BLOCKED: latest LOCAL Search V3 source file not found; no stale ZIP fallback');return 2
    source=search.read_text()
    if 'PrimaSearchBridgeV1' not in source or 'PrimaProjectSearchToolV1' not in source:
        print('BLOCKED: Search V3 bridge contract missing in',search);return 2
    if a.site_url.rstrip('/') == 'http://127.0.0.1:1329/en':
        try:
            with urllib.request.urlopen(a.site_url,timeout=5) as f:
                if f.status!=200:
                    raise RuntimeError('SITE_HTTP_'+str(f.status))
        except Exception as e:
            print('BLOCKED: local Hugo preview unavailable:',str(e)[:160])
            return 2
    else:
        print('HOSTED SEARCH V3: browser probe will verify the bridge')
    spec=importlib.util.spec_from_file_location('prima_live_batch',BATCH)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    # Never use historical generated code; regenerate from current source worktree.
    subprocess.run(['node',str(QA/'instrumentation/build-live-function-trace.cjs')],cwd=ROOT,check=True)
    before=runfinger(); search_before=hashlib.sha256(search.read_bytes()).hexdigest()
    port=portfree(); base='http://127.0.0.1:'+str(port)
    cmd=[str(WRANGLER),'dev','--config',str(CONFIG),'--local','--ip','127.0.0.1','--port',str(port),
      '--var','PRIMA_QA_RUNTIME_TRACE:1','--var','PRIMA_QA_FUNCTION_TRACE:1',
      '--var','PRIMA_TURN_TRACE:1','--var','PRIMA_PERSONA_GENERATIVE_A1:1','--var','PRIMA_SEARCH_PRODUCTION:1']
    proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,start_new_session=True)
    q=queue.Queue(); watcher=threading.Thread(target=lambda:[q.put(x.rstrip('\n')) for x in proc.stdout],daemon=True);watcher.start()
    report={'contract':'PRIMA_SEARCH_V3_ACTUAL_BROWSER_BRIDGE_R22424','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'worker_source_before':before,'search_source_before':search_before,'search_source_file':str(search),'site_url':a.site_url,
        'quality_evaluation':'NOT_EVALUATED','status':'NOT_VERIFIED','turns':[]}
    try:
        ready=False
        for _ in range(80):
            if proc.poll() is not None:raise RuntimeError('WRANGLER_EXITED')
            try:
                st,h=request(base+'/api/prima/health',timeout=.8)
                if st==200 and h.get('ok') and h.get('supabase_configured'):ready=True;break
            except Exception:time.sleep(.4)
        if not ready:raise RuntimeError('WRANGLER_NOT_READY')
        st,created=request(base+'/api/prima/conversation/start',{'initiator':'user','visitor_id':None,'session_id':None,
           'page':{'language_code':'en','url_path':'/en/__qa__/full-pipeline/','canonical_url_path':'/en/__qa__/full-pipeline/'}})
        conv=created.get('conversation') or {}; cid=conv.get('conversation_id'); token=created.get('conversation_access_token')
        if st not in (200,201) or not cid or not token:raise RuntimeError('QA_CONVERSATION_START_FAILED_HTTP_'+str(st))
        report['qa_conversation_id']=cid
        while not q.empty():q.get_nowait()
        turn_id=str(uuid.uuid4())
        def step(phase,search_context=None):
            if runfinger()!=before or hashlib.sha256(search.read_bytes()).hexdigest()!=search_before:
                raise RuntimeError('LIVE_SOURCE_CHANGED_DURING_TEST')
            body={'conversation_id':cid,'user':{'message':a.message},'page':{'language_code':'en',
             'url_path':'/en/__qa__/full-pipeline/','canonical_url_path':'/en/__qa__/full-pipeline/'},
             'turn':{'version':'ConversationTurnV1','turn_id':turn_id,'turn_seq':1,'phase':phase}}
            if search_context is not None:body['search_context']=search_context
            status,data=request(base+'/api/prima/message',body,token)
            raw,async_info=mod.collect_async_trace_logs(q)
            events=[mod.event_parse(line) for line in raw]
            events=[e for e in events if e is not None]
            info=mod.summarize_turn(a.message,status,data,events)
            info['async_trace_collection']=async_info;info['phase']=phase
            info['trace_id']=async_info.get('trace_id')
            if phase == 'initial' and isinstance(data,dict):
                report['dispatch']={'version':data.get('version'),'tool':data.get('tool'),
                  'action':data.get('action'),'query':data.get('query'),
                  'entity_type':data.get('entity_type'),'language':data.get('language')}
            if phase == 'tool_continuation' and isinstance(data,dict):
                meta=data.get('meta') if isinstance(data.get('meta'),dict) else {}
                comp=meta.get('compound_comparison_v1')
                report['completion_evidence']={
                  'compound_comparison_v1':comp if isinstance(comp,dict) else None,
                  'response_type':data.get('response_type'),
                  'answer_length':len(data.get('answer') or '') if isinstance(data.get('answer'),str) else 0,
                  'cards':[{'slug':c.get('slug'),'canonical_url':c.get('canonical_url'),
                     'entity_type':c.get('entity_type')} for c in (data.get('cards') or [])[:10]
                     if isinstance(c,dict)]}
            report['turns'].append(info)
            luna=info.get('luna') or {}
            print(phase,'HTTP',status,'response_type',info.get('response_type'),'route',info.get('route'),
                'action',info.get('action'),'events',len(events),'async',async_info.get('status'))
            print('  LUNA TOKENS:',luna.get('input_tokens'),'in /',luna.get('output_tokens'),'out')
            if status!=200 or async_info['status']!='COMPLETE':raise RuntimeError(phase+'_WORKER_OR_ASYNC_NOT_VERIFIED')
            return data
        initial=step('initial')
        # Worker returns PrimaToolRequestV1 at TOP LEVEL, not nested tool_request.
        tool=initial if isinstance(initial,dict) and initial.get('version')=='PrimaToolRequestV1' else None
        if not isinstance(tool,dict) or tool.get('version')!='PrimaToolRequestV1':
            report['status']='NOT_VERIFIED_NO_TOOL_REQUEST'
            print('BLOCKED: Worker did not emit a compatible PrimaToolRequestV1; cannot invent browser request')
            print('  response keys:',sorted(initial.keys()) if isinstance(initial,dict) else [])
            return 1
        cmd=['node',str(PROBE),a.site_url]
        probe=subprocess.run(cmd,cwd=ROOT,input=json.dumps(tool),text=True,capture_output=True,timeout=80)
        try:bridge=json.loads(probe.stdout.strip().splitlines()[-1])
        except Exception:raise RuntimeError('BROWSER_PROBE_INVALID:'+probe.stderr[-300:])
        report['bridge']={k:v for k,v in bridge.items() if k!='search_context'}
        if probe.returncode!=0 or bridge.get('status')!='PASS':raise RuntimeError('SEARCH_BRIDGE_FAILED:'+str(bridge.get('reason')))
        ctx=bridge['search_context'];report['search_result']={'state':ctx.get('state'),
          'query':ctx.get('query'), 'filters':ctx.get('filters'),
          'result_count':ctx.get('result_count'),'shown':ctx.get('results_shown'),
          'sample_slugs':[r.get('slug') for r in ctx.get('results',[])[:5]]}
        print('SEARCH V3:',ctx.get('state'),'results',ctx.get('result_count'),'shown',ctx.get('results_shown'),'duration_ms',bridge.get('elapsed_ms'))
        continuation=step('tool_continuation',ctx)
        if continuation.get('response_type')=='tool_request':raise RuntimeError('TOOL_CONTINUATION_LOOP')
        report['status']='TECHNICAL_TRACE_RECORDED'
        print('FINAL ANSWER:',str(continuation.get('answer') or '')[:300])
        print('RESULT: TECHNICAL_TRACE_RECORDED (answer quality NOT_EVALUATED)')
        return 0
    except Exception as e:
        report['status']='NOT_VERIFIED_OR_FAILED';report['error']=str(e)[:400]
        print('RESULT:',report['status'],report['error'])
        return 1
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=6)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=6)
        watcher.join(timeout=1)
        report['worker_source_after']=runfinger()
        report['search_source_after']=hashlib.sha256(search.read_bytes()).hexdigest()
        if report['worker_source_before']!=report['worker_source_after'] or report['search_source_before']!=report['search_source_after']:
            report['status']='INVALIDATED_SOURCE_CHANGED'
        REPORTS.mkdir(parents=True,exist_ok=True)
        out=REPORTS/'search-v3-e2e-latest.json'
        out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
        print('REPORT:',out.relative_to(ROOT),'FINAL:',report['status'])

if __name__=='__main__':
    sys.exit(main())
