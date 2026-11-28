#!/usr/bin/env python3
"""PRIMA technical trace V1 acceptance: read-only reports + actual contract tests.
No Hugo, browser, deployment, database operations, or source modification.
Does not claim browser Search V3 execution or semantic answer correctness.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
REPORTS=ROOT/'qa/full-pipeline/reports'
RUNNERS=ROOT/'qa/full-pipeline/runners'


def load_integrity():
    p=RUNNERS/'trace-integrity.py'
    if not p.exists():raise RuntimeError('MISSING_TRACE_INTEGRITY_RUNNER')
    spec=importlib.util.spec_from_file_location('prima_trace_integrity',p)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod.assess_turn


def check(name,status,details='',family='runtime',**extra):
    return {'name':name,'status':status,'detail':details,'family':family,**extra}


def status_from(ok,missing=False):
    return 'NOT_VERIFIED' if missing else ('PASS' if ok else 'FAIL')


def latest(pattern):
    paths=sorted(REPORTS.glob(pattern),key=lambda p:p.stat().st_mtime)
    return paths[-1] if paths else None


def nonempty(value):
    return isinstance(value,str) and bool(value.strip())


def quality_turn(turn,integrity,tag,require_output,require_luna):
    checks=[]
    http=turn.get('http_status')
    checks.append(check(f'{tag}: HTTP',status_from(http==200,missing=http is None),f'HTTP {http}'))
    ic=integrity(turn)
    checks.append(check(f'{tag}: span_id + parent',status_from(ic['status']=='TRACE_INTEGRITY_VERIFIED',missing=ic['status']=='TRACE_NOT_OBSERVED'),
        f"{ic['matched_spans']}/{ic['span_unique']}; missing={len(ic['unmatched_spans'])}; parent_missing={len(ic['missing_parents'])}",
        spans=ic['span_unique']))
    async_state=(turn.get('async_trace_collection') or {}).get('status')
    checks.append(check(f'{tag}: async collection',status_from(async_state=='COMPLETE',missing=async_state is None),str(async_state)))
    checks.append(check(f'{tag}: incoming message',status_from(nonempty(turn.get('input')),missing=turn.get('input') is None),'Recorded' if nonempty(turn.get('input')) else 'Missing/empty'))
    out=turn.get('answer')
    if require_output:
        checks.append(check(f'{tag}: outgoing answer',status_from(nonempty(out),missing=out is None),'Recorded' if nonempty(out) else 'No text captured'))
    else:
        # For tool calls, outgoing payload is captured in top-level report.tool_request,
        # not in summary.answer or summary.action. Validate separately below.
        checks.append(check(f'{tag}: textual answer not required','PASS','Initial response is a tool request; top-level tool_request validated separately'))
    luna=turn.get('luna') or {}
    tokens=(luna.get('input_tokens'),luna.get('output_tokens'))
    duration=luna.get('duration_ms')
    observed=all(isinstance(x,(int,float)) for x in tokens) and isinstance(duration,(int,float))
    if require_luna:
        checks.append(check(f'{tag}: Luna tokens + duration',status_from(observed,missing=not observed),f'in={tokens[0]}, out={tokens[1]}, ms={duration}'))
    else:
        checks.append(check(f'{tag}: Luna re-invocation', 'PASS' if not observed else 'OBSERVED',
            'No second Luna usage captured (permitted fast path)' if not observed else f'in={tokens[0]}, out={tokens[1]}, ms={duration}'))
    failures=turn.get('first_observed_error')
    if failures:
        checks.append(check(f'{tag}: recorded technical errors','FAIL',str(failures)[:250]))
    elif turn.get('events') is not None:
        checks.append(check(f'{tag}: recorded technical errors','PASS','No explicit error in captured trace'))
    else:
        checks.append(check(f'{tag}: recorded technical errors','NOT_VERIFIED','Full events missing'))
    return checks


def run_contract_tests():
    tests=['scripts/qa-prima-search-request-v1.mjs','scripts/qa-search-context-v1.mjs']
    results=[]
    loader=RUNNERS/'esm-loader.mjs'
    if not loader.is_file():
        return [check('Search contract tests','NOT_VERIFIED','ESM loader missing','contract')]
    for test in tests:
        cmd=['node','--no-warnings','--experimental-loader',str(loader),test]
        try:
            p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=45)
            passed=p.returncode==0
            results.append(check(test.split('/')[-1],'PASS' if passed else 'FAIL',
                (p.stdout+' '+p.stderr).strip()[-350:],'contract'))
        except (OSError,subprocess.TimeoutExpired) as e:
            results.append(check(test.split('/')[-1],'NOT_VERIFIED',str(e),'contract'))
    return results


def static_bridge_checks():
    frontend=ROOT.parent/'client-primadom-new/layouts/partials/home/search_engine.html'
    worker=ROOT/'src/index.js'
    search=ROOT/'src/search-context.js'
    request=ROOT/'src/prima-search-request.js'
    files={x: x.read_text(encoding='utf-8',errors='replace') if x.is_file() else ''
           for x in (frontend,worker,search,request)}
    patterns=[('Search V3 outbound publication',frontend,'publishSearchContextV1('),
              ('Search V3 result channel',frontend,'__PRIMADOM_PRIMA_SEARCH_RESULT_V1__'),
              ('Worker accepts continuation',worker,'tool_continuation'),
              ('Worker normalizes SearchContext',worker,'normalizeSearchContextV1('),
              ('Worker emits PrimaToolRequestV1',request,'PrimaToolRequestV1'),
              ('Worker accepts SearchContextV1',search,'SearchContextV1')]
    return [check(name,status_from(pattern in files[path],missing=not path.is_file()),
                  str(path.relative_to(ROOT.parent)),'contract') for name,path,pattern in patterns]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch',type=Path,help='R2.24.20/23 live batch JSON (default latest)')
    parser.add_argument('--continuation',type=Path,help='R2.24.25 report JSON (default latest)')
    args=parser.parse_args()
    integrity=load_integrity()
    checks=[]; sources={}
    batch=args.batch or latest('live-trace-batch-*.json')
    if not batch or not batch.is_file():
        checks.append(check('R04 batch trace','NOT_VERIFIED','No batch report','batch'))
    else:
        sources['batch']=str(batch.relative_to(ROOT) if batch.is_relative_to(ROOT) else batch)
        data=json.loads(batch.read_text(encoding='utf-8'))
        scenarios=data.get('scenarios') or []
        selected=next((s for s in scenarios if s.get('id')=='R04'),None)
        turns=(selected or {}).get('turns') or []
        if turns:
            checks+=quality_turn(turns[0],integrity,'R04',True,True)
            checks.append(check('R04 source unchanged',status_from(data.get('source_unchanged') is True,missing=data.get('source_unchanged') is None),str(data.get('source_unchanged')),'source'))
        else: checks.append(check('R04 observed','NOT_VERIFIED','R04 not included in latest batch','batch'))
    cont=args.continuation or (REPORTS/'search-continuation-trace-latest.json')
    if not cont.is_file():
        checks.append(check('Initial → continuation','NOT_VERIFIED','R2.24.25 report not present','continuation'))
    else:
        sources['continuation']=str(cont.relative_to(ROOT) if cont.is_relative_to(ROOT) else cont)
        data=json.loads(cont.read_text(encoding='utf-8'))
        turns=data.get('turns') or []
        if len(turns)==2:
            checks+=quality_turn(turns[0],integrity,'INITIAL',False,True)
            checks+=quality_turn(turns[1],integrity,'CONTINUATION',True,False)
            checks.append(check('Initial → continuation phase order',status_from([t.get('phase') for t in turns]==['initial','tool_continuation']),str([t.get('phase') for t in turns]),'lineage'))
            checks.append(check('Same incoming message across phases',status_from(nonempty(turns[0].get('input')) and turns[0].get('input')==turns[1].get('input')),'Recorded inputs compared','lineage'))
        else:checks.append(check('Initial → continuation: two turns','NOT_VERIFIED',f'Observed {len(turns)} turns','continuation'))
        checks.append(check('Bridge Worker result',status_from(data.get('status')=='WORKER_CONTINUATION_TECHNICAL_RECORDED',missing=data.get('status') is None),str(data.get('status')),'continuation'))
        request=data.get('tool_request') or {}
        request_ok=request.get('version')=='PrimaToolRequestV1' and request.get('tool')=='prima_search' and nonempty(request.get('query'))
        checks.append(check('Worker real tool request',status_from(request_ok,missing=not request),'version/tool/query recorded' if request_ok else str(request)[:200],'lineage'))
        before=data.get('source_sha256_before');after=data.get('source_sha256_after')
        checks.append(check('Continuation source unchanged',status_from(bool(before and after and before==after),missing=not (before and after)),f'before={str(before)[:12]} after={str(after)[:12]}','source'))
        origin=data.get('context_origin')
        checks.append(check('Browser Search V3 execution','NOT_VERIFIED',f'No browser execution in this series; context={origin}','boundary'))
        checks.append(check('SearchContextV1 external production lineage','NOT_VERIFIED','Synthetic input cannot establish actual browser SearchContext lineage','boundary'))
        # The report has a single turn_id for the pair, not two separately observed
        # wire-level turn IDs. Do not claim correlated per-request IDs.
        checks.append(check('Per-phase turn_id wire equality','NOT_VERIFIED','Runner constructs same turn_id, but response summaries do not capture both wire IDs','boundary'))
    checks+=run_contract_tests()
    checks+=static_bridge_checks()
    checks.append(check('All-model LLM token accounting','NOT_VERIFIED','Luna tokens known in initial; not all provider calls/payloads reconciled','boundary'))
    checks.append(check('End-to-end data lineage: all functions/inputs/outputs','NOT_VERIFIED','Function spans do not establish all argument/return transformations','boundary'))
    checks.append(check('90–95% executed-path observability','NOT_VERIFIED','No measured denominator/coverage proof for all material transitions','boundary'))
    checks.append(check('Answer correctness','OUT_OF_SCOPE','Technical Trace V1 does not judge semantics','boundary'))
    failures=[x for x in checks if x['status']=='FAIL']
    unresolved=[x for x in checks if x['status']=='NOT_VERIFIED']
    passes=[x for x in checks if x['status']=='PASS']
    overall='FAIL' if failures else 'NOT_VERIFIED' if unresolved else 'TECHNICAL_PASS'
    out={'contract':'PRIMA_TECHNICAL_TRACE_V1_ACCEPTANCE','generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
         'assessment':'READ_ONLY_EXISTING_REPORTS','overall':overall,'sources':sources,
         'counts':{'pass':len(passes),'fail':len(failures),'not_verified':len(unresolved)},
         'checks':checks,'no_new_db_requests':True,'no_deploy':True,'answer_quality':'NOT_EVALUATED'}
    REPORTS.mkdir(parents=True,exist_ok=True)
    target=REPORTS/'technical-acceptance-latest.json'
    target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('===== PRIMA TECHNICAL TRACE V1 — FINAL GATE =====')
    print('Source:',sources)
    for item in checks:
        print(f"{item['status']:14} {item['name']}: {item['detail'][:135]}")
    print(f"\nRESULT: {overall} | PASS {len(passes)} | FAIL {len(failures)} | NOT_VERIFIED {len(unresolved)}")
    print('SEARCH V3 BROWSER EXECUTION: NOT_VERIFIED')
    print('ANSWER QUALITY: NOT_EVALUATED')
    print('REPORT:',target.relative_to(ROOT))
    # 0 = checks computed, not necessarily full gate certified; 1 = evidenced failure.
    return 1 if failures else 0

if __name__=='__main__':sys.exit(main())
