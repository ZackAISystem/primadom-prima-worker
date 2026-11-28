#!/usr/bin/env python3
"""Read-only split status: routing-only vs trace health vs non-scored answer quality.
No external calls, no modifications to original 3 reports, explicit manual adjudications.
"""
from pathlib import Path
from collections import Counter
import json
root=Path(__file__).resolve().parents[3]
report=root/'qa/full-pipeline/reports'
cases=[]
for batch in ('b01','b02','b03'):
    path=report/f'routing-single-turn-{batch}.json'
    cases.extend(json.loads(path.read_text())['scenarios'])
assert len(cases)==30 and len({x['id'] for x in cases})==30
# Manual adjudications are explicitly named, not inferred from nonexistent answer assertions.
routing_fail={'S15':'An information-only inquiry was redirected to unsupported',
              'S16':'Contact action chosen despite no authorization',
              'S24':'Validated advisory replaced with clarification',
              'S27':'An explanatory quoted request redirected to unsupported'}
routing_review={'S09':'Opt-out acknowledged; advisory route was not retained'}
invalid_answers={'S03','S14','S15','S16','S17','S18','S26','S27','S29'}
results=[]
for s in cases:
    id=s['id']; a=s['actual']; technical=a.get('async_trace_collection',{}).get('status','UNKNOWN')
    route_status='FAIL' if id in routing_fail else 'REVIEW' if id in routing_review else 'PASS'
    results.append({'id':id,'original_verdict':s['status'],'routing_only_adjudication':route_status,
       'routing_rationale':routing_fail.get(id) or routing_review.get(id) or ('Pure Persona answer is legitimate; no next_action' if id=='S08' else ('Routing passed, but async trace did not complete' if id in ('S04','S25') else 'Recorded route and action satisfy accepted checks')),
       'technical_trace':technical,
       'text_answer':bool(a.get('answer')),
       'content_review':'CLEARLY_NONRESPONSIVE' if id in invalid_answers else 'NOT_FACT_CHECKED'})
cc=Counter(r['routing_only_adjudication'] for r in results)
assert cc==Counter({'PASS':25,'FAIL':4,'REVIEW':1})
print('===== ROUTING-ONLY EXPERT ADJUDICATION ON EXISTING 30 REPORTS =====')
print('PASS',cc['PASS'],'/30 = 83.33%; FAIL',cc['FAIL'],'REVIEW',cc['REVIEW'])
print('TECH ASYNC INCOMPLETE:', [r['id'] for r in results if r['technical_trace']!='COMPLETE'])
print('TEXT ANSWERS:',sum(r['text_answer'] for r in results),'CLEAR NONRESPONSIVE:',len(invalid_answers))
print('NOTE: not a rerun; no model calls, no DB writes. Answer factual quality unscored.')
out=report/'routing-30-routing-only-adjudication-r1.json'
out.write_text(json.dumps({'contract':'ROUTING_30_SEPARATED_STATUS_R1', 'routing_only_counts':dict(cc),
'answer_quality':'NOT_FACT_CHECKED', 'results':results},ensure_ascii=False,indent=2)+'\n')
print('REPORT',out)
