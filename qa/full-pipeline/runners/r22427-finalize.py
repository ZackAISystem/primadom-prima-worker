#!/usr/bin/env python3
"""R2.24.27: read-only evidence-first Technical Trace V1 closure.

No cloud calls, browser, Hugo, DB reads/writes or source changes.
Only reads R2.24.20/R2.24.25 evidence and current source fingerprint.
Unobserved systems stay NOT_VERIFIED, never silently PASS.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'qa/full-pipeline/reports'
RUNNERS = ROOT / 'qa/full-pipeline/runners'
MARKERS = ('turn_begin','luna_result','router','fast_gate','decision_policy',
           'executor_route','search_dispatch','answer_model','final_response')

def load(path):
    try:return json.loads(path.read_text(encoding='utf-8'))
    except (OSError,ValueError) as e: raise RuntimeError(f'CANNOT_LOAD_{path.name}: {e}') from e

def latest_batch():
    choices = list(REPORTS.glob('live-trace-batch-*.json'))
    return max(choices,key=lambda x:x.stat().st_mtime) if choices else None

def assess_integrity(turn):
    src = RUNNERS/'trace-integrity.py'
    if not src.is_file():return {'status':'NOT_VERIFIED','reason':'trace-integrity.py absent'}
    spec = importlib.util.spec_from_file_location('r22427_integrity',src)
    mod = importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod.assess_turn(turn)

def check(name, status, evidence, category='critical'):
    return {'name':name,'status':status,'evidence':evidence,'category':category}

def classify(ok,observed=True):
    return 'NOT_VERIFIED' if not observed else ('PASS' if ok else 'FAIL')

def safe_nonempty(x):return isinstance(x,str) and bool(x.strip())

def is_number(x):return isinstance(x,(int,float)) and not isinstance(x,bool)

def source_sha():
    p=RUNNERS/'source-fingerprint.py'
    if not p.is_file():return None
    try:
        res=subprocess.run([sys.executable,str(p)],cwd=ROOT,check=True,capture_output=True,text=True,timeout=30)
        return json.loads(res.stdout).get('source_sha256')
    except (OSError,subprocess.CalledProcessError,ValueError,subprocess.TimeoutExpired):return None

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--batch',type=Path)
    ap.add_argument('--continuation',type=Path)
    ap.add_argument('--no-write',action='store_true',help='Print results without writing local QA JSON')
    args=ap.parse_args()
    batch_path=args.batch or latest_batch()
    continuation_path=args.continuation or REPORTS/'search-continuation-trace-latest.json'
    if not batch_path or not batch_path.is_file() or not continuation_path.is_file():
        print('BLOCKED: existing R2.24.23 batch and R2.24.25 continuation reports required')
        print('BATCH:',batch_path,'CONTINUATION:',continuation_path)
        return 2
    batch=load(batch_path); cont=load(continuation_path)
    scenarios=batch.get('scenarios') or []
    r04=next((s for s in scenarios if s.get('id')=='R04'),None)
    r04turn=((r04 or {}).get('turns') or [None])[0]
    contturns=cont.get('turns') or []
    if not isinstance(r04turn,dict) or len(contturns)!=2 or not all(isinstance(t,dict) for t in contturns):
        print('BLOCKED: R04 and both continuation phases not found');return 2
    turns=[('R04',r04turn),('INITIAL',contturns[0]),('CONTINUATION',contturns[1])]
    checks=[]
    checks.append(check('Report source unchanged (R04)',classify(batch.get('source_unchanged') is True,batch.get('source_unchanged') is not None),str(batch.get('source_unchanged'))))
    checks.append(check('Report source unchanged (continuation)',classify(bool(cont.get('source_sha256_before') and cont.get('source_sha256_after') and cont['source_sha256_before']==cont['source_sha256_after']),bool(cont.get('source_sha256_before') and cont.get('source_sha256_after'))),'before/after fingerprint comparison'))
    current=source_sha()
    report_sha=cont.get('source_sha256_after')
    checks.append(check('Evidence matches CURRENT worktree',classify(current==report_sha,bool(current and report_sha)),f'current={str(current)[:16]} report={str(report_sha)[:16]}', 'freshness'))

    total_enter=0;total_matched=0;total_event=0
    observed_stages=set(); recorded_calls=[]; all_spans=[]
    for label,turn in turns:
        events=turn.get('events') or []
        ic=assess_integrity(turn)
        total_enter+=ic.get('enter_events',0)
        total_matched+=ic.get('matched_spans',0)
        total_event+=len(events)
        stage_set={e.get('stage') for e in events if isinstance(e,dict)}
        observed_stages |= stage_set
        checks.append(check(f'{label} exact span pairing',classify(ic.get('status')=='TRACE_INTEGRITY_VERIFIED',ic.get('status')!='TRACE_NOT_OBSERVED'),
                 f"matched={ic.get('matched_spans')} unique={ic.get('span_unique')} unmatched={len(ic.get('unmatched_spans') or [])} duplicates={len(ic.get('duplicate_spans') or [])} missing_parent={len(ic.get('missing_parents') or [])}"))
        async_status=(turn.get('async_trace_collection') or {}).get('status')
        checks.append(check(f'{label} async lifecycle',classify(async_status=='COMPLETE',async_status is not None),f'{async_status}'))
        http=turn.get('http_status')
        checks.append(check(f'{label} HTTP',classify(http==200,http is not None),str(http)))
        checks.append(check(f'{label} incoming message',classify(safe_nonempty(turn.get('input')),turn.get('input') is not None),'nonempty' if safe_nonempty(turn.get('input')) else 'missing/empty'))
        if label!='INITIAL':
            checks.append(check(f'{label} outgoing message',classify(safe_nonempty(turn.get('answer')),turn.get('answer') is not None),'nonempty' if safe_nonempty(turn.get('answer')) else 'missing/empty'))
        err=turn.get('first_observed_error')
        checks.append(check(f'{label} explicit technical faults','FAIL' if err else 'PASS' if events else 'NOT_VERIFIED',
                 str(err)[:220] if err else 'No explicit fault in captured events' if events else 'Events unavailable'))
        luna=turn.get('luna') or {}
        has_usage=all(is_number(luna.get(k)) for k in ('input_tokens','output_tokens','duration_ms'))
        if label!='CONTINUATION':
            checks.append(check(f'{label} Luna usage recorded',classify(has_usage,has_usage),
                 f"input={luna.get('input_tokens')} output={luna.get('output_tokens')} duration_ms={luna.get('duration_ms')}"))
        for ev in events:
            if isinstance(ev,dict) and (ev.get('stage') in ('luna_result','answer_model') or 'tokens' in ev):
                recorded_calls.append({'phase':label,'stage':ev.get('stage'),
                    'usage_present':is_number(ev.get('input_tokens')) and is_number(ev.get('output_tokens')),
                    'model_present':safe_nonempty(ev.get('model')),
                    'duration_present':is_number(ev.get('duration_ms'))})
        all_spans.extend((label,e) for e in events if isinstance(e,dict) and e.get('stage')=='function_function_enter')

    req=cont.get('tool_request') or {}
    valid_req=(req.get('version')=='PrimaToolRequestV1' and req.get('tool')=='prima_search' and safe_nonempty(req.get('query')))
    checks.append(check('Real Worker tool request',classify(valid_req,bool(req)),
                        'PrimaToolRequestV1/prima_search with nonempty query' if valid_req else 'Not captured'))
    checks.append(check('Continuation phase pair',classify([t.get('phase') for t in contturns]==['initial','tool_continuation']),str([t.get('phase') for t in contturns])))
    checks.append(check('Incoming text preserved across phases',classify(contturns[0].get('input')==contturns[1].get('input') and safe_nonempty(contturns[0].get('input'))),
                        'Equality from recorded summaries'))
    checks.append(check('Worker continuation outcome',classify(cont.get('status')=='WORKER_CONTINUATION_TECHNICAL_RECORDED',cont.get('status') is not None),str(cont.get('status'))))

    # Exactly two independently captured outbound wire identifiers and independent matching
    # acknowledgement would be needed to prove end-to-end wire identity. The existing runner
    # has only one generated turn_id shared by the body builder.
    wire=cont.get('wire_turn_ids') or {}
    request_ids=[wire.get('initial_sent'),wire.get('continuation_sent')]
    response_ids=[wire.get('initial_received'),wire.get('continuation_received')]
    wire_proof=(all(safe_nonempty(x) for x in request_ids+response_ids) and len(set(request_ids+response_ids))==1)
    checks.append(check('Actual turn_id request/response wire equality',
                        'PASS' if wire_proof else 'FAIL' if all(safe_nonempty(x) for x in request_ids+response_ids) else 'NOT_VERIFIED',
                        'Independently captured sent and received IDs' if wire_proof else 'Existing report has no independently captured response IDs','boundary'))
    origin=cont.get('context_origin')
    checks.append(check('Real Search V3 algorithm execution','NOT_VERIFIED',
          'Only synthetic or external file context known; no Search V3 execution evidence in reports', 'boundary'))
    checks.append(check('SearchContextV1 real provenance','NOT_VERIFIED',
          f'origin={origin}; browser Search V3 output not independently authenticated', 'boundary'))

    possible_llm=[x for x in recorded_calls if x['stage'] in ('luna_result','answer_model')]
    llm_issues=sum(1 for x in possible_llm if not x['usage_present'])
    checks.append(check('All-provider model usage reconciled','NOT_VERIFIED',
        f'LLM-related recorded events={len(possible_llm)} without input+output token fields={llm_issues}; no independent provider call ledger', 'boundary'))
    # Measurable: of observed spans, the fraction with a matching terminal event.
    # This is NOT the 90-95% executed-path denominator; some operations may emit no span.
    span_rate=(100*total_matched/total_enter) if total_enter else None
    checks.append(check('Recorded function span closure',classify(total_matched==total_enter,total_enter>0),
        f'{total_matched}/{total_enter}, {span_rate:.2f}%' if span_rate is not None else 'NO OBSERVED SPANS', 'measurement'))
    # Markers are only diagnostic presence, do not assume each should occur on all paths.
    present_markers={x:x in observed_stages for x in MARKERS}
    checks.append(check('Cross-module data lineage (actual args/returns)','NOT_VERIFIED',
        'Function enter/exit and checkpoint summaries do not independently capture argument/return transformations', 'boundary'))
    checks.append(check('Executed-path 90–95% coverage','NOT_VERIFIED',
        'No independently enumerated denominator of material transitions; recorded-span closure cannot substitute for it','boundary'))
    checks.append(check('Answer correctness','OUT_OF_SCOPE','Technical Trace V1 does not evaluate semantics','scope'))

    counts=Counter(item['status'] for item in checks)
    status='FAIL' if counts['FAIL'] else 'NOT_VERIFIED' if counts['NOT_VERIFIED'] else 'TECHNICAL_PASS'
    report={
      'contract':'PRIMA_TECHNICAL_TRACE_V1_R22427_EVIDENCE_GATE',
      'generated_at':datetime.now(timezone.utc).isoformat(),
      'overall':status,'assessment':'READ_ONLY_EXISTING_EVIDENCE',
      'source':{'batch':str(batch_path),'continuation':str(continuation_path),'current_worktree_sha256':current},
      'counts':dict(counts),'checks':checks,
      'metrics':{'turns':len(turns),'events':total_event,'recorded_function_enters':total_enter,
                 'matched_function_spans':total_matched,'recorded_span_closure_pct':round(span_rate,2) if span_rate is not None else None,
                 'executed_path_observability_pct':None,
                 'checkpoint_markers_observed':present_markers,'llm_related_events':possible_llm},
      'data_lineage':{'initial_input_equals_continuation_input':contturns[0].get('input')==contturns[1].get('input'),
                     'search_query_from_worker':req.get('query'),'search_context_origin':origin,
                     'actual_data_transformations':'NOT_VERIFIED'},
      'boundaries':{'search_v3_browser':'NOT_VERIFIED','full_llm_provider_reconciliation':'NOT_VERIFIED',
                    'answer_quality':'OUT_OF_SCOPE'},
      'safety':{'supabase_access':False,'worker_execution':False,'browser_execution':False,'source_edits':False,'deploy':False}}
    print('===== PRIMA R2.24.27 — FINAL EVIDENCE GATE =====')
    print('CURRENT WORKTREE:',str(current)[:20] if current else 'NOT_AVAILABLE')
    print('RECORDED EVENTS:',total_event,'| MATCHED SPANS:',f'{total_matched}/{total_enter}',
          '| SPAN CLOSURE:',f'{span_rate:.2f}%' if span_rate is not None else 'NOT_VERIFIED')
    print('EXECUTED-PATH COVERAGE: NOT_VERIFIED (separate denominator required)')
    print('---- CHECKS ----')
    for c in checks:print(f"{c['status']:13} {c['name']}: {c['evidence'][:130]}")
    print('---- UNRESOLVED ----')
    for c in checks:
        if c['status'] in ('FAIL','NOT_VERIFIED'):
            print(' -',c['name'],'=>',c['evidence'])
    print(f"RESULT: {status} | PASS {counts['PASS']} | FAIL {counts['FAIL']} | NOT_VERIFIED {counts['NOT_VERIFIED']}")
    if not args.no_write:
        REPORTS.mkdir(parents=True,exist_ok=True)
        dest=REPORTS/'r22427-technical-trace-final.json'
        dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print('REPORT:',dest.relative_to(ROOT))
    else:print('REPORT: NOT WRITTEN (--no-write)')
    print('NO DB, NO HUGO/CHROME, NO DEPLOY, NO NEW CONVERSATIONS')
    return 1 if counts['FAIL'] else 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('BLOCKED:',type(exc).__name__,str(exc),file=sys.stderr)
        sys.exit(2)
