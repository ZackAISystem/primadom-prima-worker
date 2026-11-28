#!/usr/bin/env python3
"""Offline aggregate of PRIMA Routing QA B01 B02 B03. No network, db or execution."""
from pathlib import Path
import collections,datetime,json,statistics,sys
R=Path(__file__).resolve().parents[1]/'reports'
paths=[R/f'routing-single-turn-b0{i}.json' for i in (1,2,3)]
missing=[str(p) for p in paths if not p.is_file()]
if missing:
    print('MISSING REPORTS:',*missing,sep='\n');sys.exit(2)
batches=[json.loads(p.read_text()) for p in paths]
all_cases=[x for b in batches for x in b.get('scenarios',[])]
ids=[x.get('id') for x in all_cases]
if len(ids)!=30 or len(set(ids))!=30:
    print('BLOCKED: need 30 distinct executed scenarios; found',len(ids),len(set(ids)));sys.exit(2)
counts=dict(collections.Counter(x.get('status','NOT_VERIFIED') for x in all_cases))
items=[]
repeats=collections.defaultdict(list)
for c in all_cases:
    checks=((c.get('verdict') or {}).get('checks') or {})
    for key,check in checks.items():
        if check.get('status') in ('FAIL','REVIEW','NOT_VERIFIED'):
            repeats[key+':'+check['status']].append(c.get('id'))
    a=c.get('actual') or {}
    v=c.get('verdict') or {}
    items.append({'id':c.get('id'),'group':(c.get('expected') or {}).get('group'),'message':c.get('message'), 'status':c.get('status'),
                  'route':v.get('recognized_route'),'luna_action':v.get('luna_action'), 'policy_action':v.get('policy_action'),
                  'approved_action':v.get('approved_action'),'http_status':a.get('http_status'),
                  'async_status':(a.get('async_trace_collection') or {}).get('status'),
                  'time_ms':c.get('latency_ms'),'luna_duration_ms':(a.get('luna') or {}).get('duration_ms'),
                  'answer_recorded':bool(c.get('response_answer_full') or a.get('answer')),
                  'answer_quality':'NOT_REVIEWED','event_count':len(a.get('events') or []),
                  'first_observed_error':a.get('first_observed_error'),'checks':checks})
results={'contract':'PRIMA_ROUTING_QA_30_REPORT','created_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'status':'RECORDED_NOT_YET_HUMAN_REVIEWED','scope':'30 fresh conversations / initial message only','scenarios':items,
         'counts':counts,'repeated_anomalies':[{'signature':k,'count':len(v),'tests':v} for k,v in sorted(repeats.items()) if len(v)>=2],
         'limitations':['B01 had no per-test HTTP wall-clock timing; do not fabricate it. Luna duration may be available.',
           'Answers not graded: response text may be limited to 2500 chars in B01 summary',
           'No continuation or actual Search V3 browser/catalog QA','PASS is a routing test judgment, not response truth or correctness']}
latencies=[c['time_ms']['message_http'] for c in items if c['time_ms'] and isinstance(c['time_ms'].get('message_http'),(int,float))]
results['http_latency_summary_ms']={'observed':len(latencies),'min':min(latencies) if latencies else None,
    'median':round(statistics.median(latencies),2) if latencies else None,'max':max(latencies) if latencies else None}
(R/'routing-30-consolidated.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n')
lines=['# PRIMA Routing QA — 30 initial-message tests','',f"Counts: {counts}",f"HTTP latency measured for {len(latencies)}/30 cases (B01 not captured)",'',
       '| ID | Status | Route | Luna | Policy | HTTP ms | Async |','|---|---|---|---|---|---:|---|']
for c in items:
    ms=c['time_ms']['message_http'] if c['time_ms'] else 'N/A'
    lines.append(f"| {c['id']} | {c['status']} | {c['route']} | {c['luna_action']} | {c['policy_action']} | {ms} | {c['async_status']} |")
lines+=['','## Repeated anomalies']
for r in results['repeated_anomalies']:
    lines.append(f"- {r['signature']}: {r['count']} ({', '.join(r['tests'])})")
lines+=['','## Important','- Runtime function/events and responses are in each routing-single-turn-b0N.json.','- B01 full HTTP wall time was not measured; only metrics already emitted in B01 can be used.','- Response accuracy and semantic correctness require separate review.','- Five context cases assess within-message references/corrections, not multi-turn memory.']
(R/'routing-30-consolidated.md').write_text('\n'.join(lines)+'\n')
print('===== PRIMA ROUTING QA — 30 CASES =====')
print('COUNTS',counts,'HTTP LATENCY MEASURED',len(latencies),'OF 30')
for c in items:
    print(c['id'],c['status'], 'route='+str(c['route']),'Luna='+str(c['luna_action']),'policy='+str(c['policy_action']), 'http_ms='+str(c['time_ms']['message_http'] if c['time_ms'] else 'N/A'))
print('REPEATS',results['repeated_anomalies'])
print('REPORT',R/'routing-30-consolidated.json')
print('MARKDOWN',R/'routing-30-consolidated.md')
