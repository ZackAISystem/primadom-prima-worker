#!/usr/bin/env python3
"""PRIMA R2.24.25 — Worker initial -> continuation trace; NO browser/Hugo/search reimplementation.

The default SearchContextV1 is a labeled synthetic EMPTY fixture. It proves Worker
continuation transport, NOT Search V3 execution or correctness of search results.
Supply --search-context-file from a real bridge capture to exercise a real payload.
Requires --live-db; writes ONE synthetic QA conversation to the configured REAL Supabase.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'qa/full-pipeline'
REPORTS=QA/'reports'
WRANGLER=ROOT/'node_modules/.bin/wrangler'
CONFIG=ROOT/'wrangler.function-trace.local.jsonc'
FINGER=QA/'runners/source-fingerprint.py'
RUNNER=QA/'runners/run-function-trace-batch.py'
BUILD=QA/'instrumentation/build-live-function-trace.cjs'


def source_sha():
    r=subprocess.run([sys.executable,str(FINGER)],cwd=ROOT,capture_output=True,text=True,check=True)
    return json.loads(r.stdout)['source_sha256']


def http_json(url,body=None,token=None,timeout=115):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,json.dumps(body).encode() if body is not None else None,
                              headers=headers,method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as res:
            return res.status,json.loads(res.read())
    except urllib.error.HTTPError as exc:
        try: payload=json.loads(exc.read())
        except Exception:payload={'error':'non_json_http_error'}
        return exc.code,payload


def port_free():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));return s.getsockname()[1]


def load_runner():
    spec=importlib.util.spec_from_file_location('prima_function_batch',RUNNER)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    if not hasattr(m,'collect_async_trace_logs'):
        raise RuntimeError('R2.24.23 async collector missing: reinstall R2.24.23')
    return m


def safe_preview(s,limit=800):
    return str(s or '')[:limit]


def wire_identity(body, response, status):
    """QA-only transport evidence. Never persist conversation_access_token or raw payload."""
    import hashlib
    def digest(value):
        if not isinstance(value,str): return None
        return hashlib.sha256(value.encode('utf-8')).hexdigest()
    req_turn=body.get('turn') if isinstance(body.get('turn'),dict) else {}
    resp_turn=(response.get('turn') or {}) if isinstance(response,dict) else {}
    if not isinstance(resp_turn,dict):resp_turn={}
    search=body.get('search_context') if isinstance(body.get('search_context'),dict) else None
    return {
        'request':{
            'phase':req_turn.get('phase'), 'turn_id':req_turn.get('turn_id'),
            'turn_seq':req_turn.get('turn_seq'),
            'message_sha256':digest((body.get('user') or {}).get('message')),
            'search_context':{
                'version':search.get('version'), 'state':search.get('state'),
                'entity_type':search.get('entity_type'), 'language':search.get('language'),
                'result_count':search.get('result_count'),
                'query_sha256':digest(search.get('query')),
            } if search is not None else None,
        },
        'response':{
            'http_status':status,
            'turn_id':resp_turn.get('turn_id'), 'phase':resp_turn.get('phase'),
            'version':response.get('version') if isinstance(response,dict) else None,
            'response_type':response.get('response_type') if isinstance(response,dict) else None,
            'tool':response.get('tool') if isinstance(response,dict) else None,
            'answer_sha256':digest(response.get('answer')) if isinstance(response,dict) else None,
            'query_sha256':digest(response.get('query')) if isinstance(response,dict) else None,
        },
        'response_identity_observed':bool(resp_turn.get('turn_id')),
    }


def provenance_and_lineage(report):
    turns=report.get('turns') or []
    wires=[t.get('wire_evidence') or {} for t in turns]
    requests=[w.get('request') or {} for w in wires]
    response_ids=[(w.get('response') or {}).get('turn_id') for w in wires]
    if len(requests)!=2:
        ids={'status':'NOT_VERIFIED', 'reason':'two_wire_requests_not_recorded'}
    elif not all(req.get('turn_id') for req in requests):
        ids={'status':'FAIL', 'reason':'missing_request_turn_id'}
    elif requests[0]['turn_id']!=requests[1]['turn_id']:
        ids={'status':'FAIL', 'reason':'request_turn_id_mismatch'}
    elif not all(response_ids):
        ids={'status':'REQUESTS_VERIFIED_RESPONSES_NOT_OBSERVED',
             'reason':'Both request turn IDs equal; Worker response did not expose independent turn IDs'}
    else:
        ids={'status':'PASS' if response_ids==[requests[0]['turn_id']]*2 else 'FAIL',
             'reason':'request_response_turn_id_equality'}
    report['wire_identity_check']=ids
    origin=report.get('context_origin')
    report['search_provenance']={
       'status':'NOT_VERIFIED',
       'origin':origin,
       'reason':'QA-only synthetic/external context is not proof of real Search V3 execution; real bridge runtime evidence required'
    }
    report['lineage_evidence']={
      'incoming_message_preserved':len(requests)==2 and bool(requests[0].get('message_sha256')) and requests[0].get('message_sha256')==requests[1].get('message_sha256'),
      'phase_order':[r.get('phase') for r in requests],
      'tool_request_version':(report.get('tool_request') or {}).get('version'),
      'continuation_context':requests[1].get('search_context') if len(requests)>1 else None,
      'cross_module_args_returns':'NOT_CAPTURED',
    }
    ledger=[]
    for turn in turns:
        phase=turn.get('phase')
        for e in turn.get('events') or []:
            if e.get('stage') in ('luna_result','answer_model') or e.get('usage'):
                usage=e.get('usage') or {}
                it=e.get('input_tokens',usage.get('input_tokens',usage.get('prompt_tokens')))
                ot=e.get('output_tokens',usage.get('output_tokens',usage.get('completion_tokens')))
                ledger.append({'phase':phase,'stage':e.get('stage'),
                               'id':e.get('id'),'model':e.get('model'),
                               'input_tokens':it,'output_tokens':ot,
                               'duration_ms':e.get('duration_ms'),
                               'usage_complete':isinstance(it,(int,float)) and isinstance(ot,(int,float))})
    report['llm_event_ledger']=ledger
    report['llm_provider_reconciliation']={
        'status':'NOT_VERIFIED',
        'recorded_llm_related_events':len(ledger),
        'events_missing_complete_usage':sum(not r['usage_complete'] for r in ledger),
        'reason':'No independent ledger of all actual provider calls; presence of some token events cannot prove full accounting',
    }
    report['observability_coverage']={
        'status':'NOT_VERIFIED',
        'span_closure':'MEASURABLE_SEPARATELY',
        'executed_path_denominator':'NOT_INDEPENDENTLY_ESTABLISHED',
        'reason':'Do not divide matched spans by all AST functions or by recorded spans as a 90-95 percent coverage claim'
    }


def summarize_provider_and_boundaries_r22430(report):
    """Evidence from captured QA events only; no guessed calls or token values."""
    phases=[]
    all_provider=[]
    for turn in report.get('turns') or []:
        phase=turn.get('phase')
        events=turn.get('events') or []
        starts={}
        terminals={}
        boundary_in=[]
        boundary_out=[]
        for e in events:
            if not isinstance(e,dict):continue
            event=e.get('event')
            if event=='llm_http_start':
                ident=e.get('call_id')
                if ident:starts.setdefault(ident,[]).append(e)
            elif event in ('llm_http_end','llm_http_error'):
                ident=e.get('call_id')
                if ident:terminals.setdefault(ident,[]).append(e)
            elif event=='boundary_input':boundary_in.append(e)
            elif event=='boundary_output':boundary_out.append(e)
        calls=[]
        for ident in sorted(set(starts)|set(terminals)):
            ss=starts.get(ident,[]);ts=terminals.get(ident,[])
            last=ts[-1] if ts else {}
            usage=last.get('usage') if isinstance(last.get('usage'),dict) else None
            calls.append({
                'call_id':ident,
                'provider':(ss[0] if ss else last).get('provider'),
                'http_status':last.get('http_status'),
                'model':last.get('model'),
                'duration_ms':last.get('duration_ms'),
                'usage':usage,
                'accounting':last.get('accounting') or 'NOT_CAPTURED',
                'started_events':len(ss), 'terminal_events':len(ts),
                'outcome':'PAIRED' if len(ss)==1 and len(ts)==1 else 'INCOMPLETE_OR_DUPLICATE'
            })
        function_ids_in={e.get('id') for e in boundary_in if e.get('id')}
        function_ids_out={e.get('id') for e in boundary_out if e.get('id')}
        modules=sorted({str(x).split(':')[0] for x in (function_ids_in|function_ids_out)})
        canonical={'input_tokens':'input_tokens','output_tokens':'output_tokens','total_tokens':'total_tokens'}
        totals={key:sum(c['usage'][key] for c in calls if c['usage'] and isinstance(c['usage'].get(key),int)) for key in canonical}
        missing_usage=sum(not isinstance(c['usage'],dict) or not c['usage'] for c in calls)
        status=('NOT_VERIFIED_NO_PROVIDER_EVENTS' if not calls else
                'NOT_VERIFIED_PROVIDER_CALL_PAIRING' if any(c['outcome']!='PAIRED' for c in calls) else
                'CAPTURED_CALLS_USAGE_RECORDED' if not missing_usage else 'PARTIAL_USAGE')
        phase_report={
            'phase':phase,'provider_calls':calls,'provider_count':len(calls),
            'provider_status':status,'provider_usage_totals':totals,
            'provider_calls_missing_usage':missing_usage,
            'boundary_input_events':len(boundary_in),'boundary_output_events':len(boundary_out),
            'boundary_module_count':len(modules),'boundary_modules':modules,
            'boundary_function_ids_with_input':len(function_ids_in),
            'boundary_function_ids_with_output':len(function_ids_out),
            'boundary_function_ids_both':len(function_ids_in & function_ids_out),
            'boundary_status':'OBSERVED_STRUCTURAL_ONLY' if boundary_in or boundary_out else 'NOT_OBSERVED',
        }
        phases.append(phase_report)
        all_provider.extend(calls)
        print('R2.24.30',phase.upper(),'PROVIDER:',len(calls),'calls',status,
              '| USAGE:',totals if calls else 'NOT_OBSERVED',
              '| BOUNDARIES:',len(boundary_in),'in /',len(boundary_out),'out',
              '| MODULES:',len(modules))
    report['r22430_evidence']={
        'phases':phases,
        'total_captured_provider_calls':len(all_provider),
        'all_provider_call_inventory':'NOT_VERIFIED_INDEPENDENTLY',
        'full_data_lineage':'NOT_VERIFIED_STRUCTURAL_ONLY',
        'search_v3_execution':'NOT_TESTED_WITH_SYNTHETIC_CONTEXT' if
            report.get('context_origin')=='SYNTHETIC_EMPTY_FIXTURE_NOT_SEARCH_V3' else 'NOT_VERIFIED_EXTERNAL_ORIGIN',
        'executed_path_90_95_coverage':'NOT_MEASURED_TRANSITION_DENOMINATOR_REQUIRED',
        'note':'Provider events and structural boundaries are evidence for executed Worker phases, not proof of all models or full data values.'
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live-db',action='store_true',help='Explicitly allow one synthetic QA conversation in real Supabase')
    p.add_argument('--message',default='Show me apartment projects in Dubai Hills under AED 5 million.')
    p.add_argument('--search-context-file',type=Path,help='Use captured real SearchContextV1 JSON; no browser needed')
    args=p.parse_args()
    if not args.live_db:
        print('BLOCKED: requires explicit --live-db (one synthetic QA conversation), no requests sent');return 2
    for file in [WRANGLER,CONFIG,FINGER,RUNNER,BUILD,ROOT/'src/index.js']:
        if not file.is_file():print('BLOCKED: missing',file);return 2
    if args.search_context_file and not args.search_context_file.is_file():
        print('BLOCKED: specified SearchContextV1 file not found');return 2
    if args.search_context_file:
        ctx=json.loads(args.search_context_file.read_text())
        if not isinstance(ctx,dict) or ctx.get('version')!='SearchContextV1' or ctx.get('language')!='en' or ctx.get('entity_type')!='project':
            print('BLOCKED: invalid external SearchContextV1 header');return 2
        context_origin='CAPTURED_EXTERNAL_FILE_UNVERIFIED_ORIGIN'
    else:
        ctx=None
        context_origin='SYNTHETIC_EMPTY_FIXTURE_NOT_SEARCH_V3'
    m=load_runner()
    # R2.24.20 recompiles from the LIVE SOURCE at every run.
    subprocess.run(['node',str(BUILD)],cwd=ROOT,check=True)
    before=source_sha()
    port=port_free();base=f'http://127.0.0.1:{port}'
    cmd=[str(WRANGLER),'dev','--config',str(CONFIG),'--local','--ip','127.0.0.1','--port',str(port),
         '--var','PRIMA_QA_RUNTIME_TRACE:1','--var','PRIMA_QA_FUNCTION_TRACE:1',
         '--var','PRIMA_TURN_TRACE:1','--var','PRIMA_PERSONA_GENERATIVE_A1:1','--var','PRIMA_SEARCH_PRODUCTION:1']
    process=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                             text=True,bufsize=1,start_new_session=True)
    q=queue.Queue()
    watcher=threading.Thread(target=lambda:[q.put(line.rstrip('\n')) for line in process.stdout],daemon=True)
    watcher.start()
    report={'contract':'PRIMA_WORKER_SEARCH_CONTINUATION_TRACE_R22425',
            'created_at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'source_sha256_before':before,'context_origin':context_origin,
            'search_v3_executed':'NOT_TESTED','answer_quality':'NOT_EVALUATED',
            'status':'NOT_VERIFIED','turns':[]}
    rc=1
    try:
        ready=False
        for _ in range(80):
            if process.poll() is not None:raise RuntimeError('WRANGLER_EXITED_PREMATURELY')
            try:
                status,data=http_json(base+'/api/prima/health',timeout=.8)
                if status==200 and data.get('ok') and data.get('supabase_configured'):
                    ready=True;break
            except Exception:time.sleep(.35)
        if not ready:raise RuntimeError('LOCAL_WORKER_NOT_READY')
        page={'language_code':'en','url_path':'/en/__qa__/full-pipeline/',
              'canonical_url_path':'/en/__qa__/full-pipeline/'}
        status,started=http_json(base+'/api/prima/conversation/start',
               {'initiator':'user','visitor_id':None,'session_id':None,'page':page})
        conv=started.get('conversation') or {}
        cid=conv.get('conversation_id');token=started.get('conversation_access_token')
        if status not in (200,201) or not cid or not token:
            raise RuntimeError('CONVERSATION_START_FAILED_HTTP_'+str(status))
        report['qa_conversation_id']=cid
        while not q.empty():q.get_nowait()
        turn_id=str(uuid.uuid4())
        report['turn_id']=turn_id
        def step(phase,context=None):
            if source_sha()!=before:raise RuntimeError('SOURCE_CHANGED_DURING_TEST')
            body={'conversation_id':cid,'user':{'message':args.message},'page':page,
                  'turn':{'version':'ConversationTurnV1','turn_id':turn_id,'turn_seq':1,'phase':phase}}
            if context is not None:body['search_context']=context
            status,data=http_json(base+'/api/prima/message',body,token)
            lines,async_info=m.collect_async_trace_logs(q)
            events=[m.event_parse(line) for line in lines]
            events=[e for e in events if e is not None]
            summary=m.summarize_turn(args.message,status,data,events)
            summary.update({'phase':phase,'async_trace_collection':async_info,
                            'wire_evidence':wire_identity(body,data,status)})
            # Report contains only user input, PRIMA answer and diagnostic data.
            # Keep API access token OUT of report.
            report['turns'].append(summary)
            luna=summary.get('luna') or {}
            ft=summary.get('function_trace') or {}
            print(f'{phase.upper()}: HTTP {status} | route={summary.get("route")} | action={summary.get("action")}')
            print('  INCOMING:',safe_preview(args.message,250))
            print('  OUTGOING:',safe_preview(data.get('answer') if isinstance(data,dict) else None,350))
            print('  LUNA:',luna.get('input_tokens'),'input /',luna.get('output_tokens'),'output tokens',
                  '| latency',luna.get('duration_ms'),'ms')
            print('  SPANS:',ft.get('entry_events'),'enter /',ft.get('exit_events'),'exit',
                  '| ASYNC:',async_info.get('status'))
            if status!=200 or async_info.get('status')!='COMPLETE':
                raise RuntimeError(phase+'_TECHNICAL_NOT_VERIFIED')
            return data
        initial=step('initial')
        if not isinstance(initial,dict) or initial.get('version')!='PrimaToolRequestV1' or initial.get('tool')!='prima_search':
            report['status']='NOT_VERIFIED_NO_TOOL_REQUEST'
            report['initial_response_keys']=sorted(initial) if isinstance(initial,dict) else []
            raise RuntimeError('Worker did not request PrimaToolRequestV1; actual route is not SEARCH')
        if initial.get('entity_type')!='project' or initial.get('language')!='en':
            raise RuntimeError('TOOL_REQUEST_NOT_EN_PROJECT_SEARCH')
        query=initial.get('query')
        if not isinstance(query,str) or not query.strip():raise RuntimeError('TOOL_REQUEST_MISSING_QUERY')
        report['tool_request']={k:initial.get(k) for k in ('version','tool','action','language','entity_type','query','max_results')}
        if ctx is None:
            ctx={'version':'SearchContextV1','source':'PRIMA_QA_SYNTHETIC_EMPTY_NOT_REAL_SEARCH',
                 'language':'en','entity_type':'project','query':query,
                 'state':'empty','filters':{},'result_count':0,'results':[]}
        elif ctx.get('query')!=query:
            raise RuntimeError('CAPTURED_SEARCH_CONTEXT_QUERY_MISMATCH_TO_LIVE_TOOL_REQUEST')
        print('BRIDGE INPUT:',context_origin,'| query:',query)
        continuation=step('tool_continuation',ctx)
        if not isinstance(continuation,dict):raise RuntimeError('CONTINUATION_NON_JSON')
        if continuation.get('version')=='PrimaToolRequestV1' or continuation.get('response_type')=='tool_request':
            raise RuntimeError('TOOL_CONTINUATION_LOOP')
        report['status']='WORKER_CONTINUATION_TECHNICAL_RECORDED'
        provenance_and_lineage(report)
        summarize_provider_and_boundaries_r22430(report)
        print('WIRE REQUEST IDENTITY:',report['wire_identity_check']['status'])
        print('LLM PROVIDER RECONCILIATION:',report['llm_provider_reconciliation']['status'])
        print('SEARCH V3 PROVENANCE:',report['search_provenance']['status'])
        print('RESULT:',report['status'])
        print('SEARCH V3 EXECUTION: NOT_TESTED; ANSWER QUALITY: NOT_EVALUATED')
        rc=0
    except Exception as exc:
        report['error']=type(exc).__name__+': '+str(exc)[:300]
        if report['status']=='NOT_VERIFIED':report['status']='NOT_VERIFIED_OR_FAILED'
        print('RESULT:',report['status'],'|',report['error'])
    finally:
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=6)
        watcher.join(timeout=1)
        report['source_sha256_after']=source_sha()
        if report.get('turns') and 'wire_identity_check' not in report:
            provenance_and_lineage(report)
        if report.get('turns') and 'r22430_evidence' not in report:
            summarize_provider_and_boundaries_r22430(report)
        if report['source_sha256_before']!=report['source_sha256_after']:
            report['status']='INVALIDATED_SOURCE_CHANGED';rc=1
        REPORTS.mkdir(parents=True,exist_ok=True)
        dst=REPORTS/'search-continuation-trace-latest.json'
        dst.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('REPORT:',dst.relative_to(ROOT))
    return rc

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('BLOCKED:',type(exc).__name__,str(exc)[:250],file=sys.stderr)
        sys.exit(2)
