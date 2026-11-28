#!/usr/bin/env python3
"""Evidence-based Technical Trace V1 gate; no IO beyond local reports/source.
Never upgrades unproven full browser search or end-to-end value lineage to PASS.
"""
import json, pathlib, collections, subprocess, sys, hashlib, datetime
ROOT=pathlib.Path(__file__).resolve().parents[3]
R=ROOT/'qa/full-pipeline/reports'
SRC=ROOT.parent/'client-primadom-new/layouts/partials/home/search_engine.html'

def read(p):
 try: return json.loads(p.read_text())
 except Exception: return None

def nested_turns(obj):
 found=[]
 def recurse(x):
  if isinstance(x,dict):
   if isinstance(x.get('events'),list):found.append(x)
   else:
    for v in x.values():recurse(v)
  elif isinstance(x,list):
   for v in x:recurse(v)
 recurse(obj)
 return found

report=read(R/'search-continuation-trace-latest.json')
ledger=read(R/'r22432-executed-ledger-latest.json')
search=read(R/'r22433-search-source-execution.json')
checks=[]
def check(name,passed,proof,scope='technical'):
 checks.append({'name':name,'status':'PASS' if passed else 'NOT_VERIFIED','proof':proof,'scope':scope})

turns=nested_turns(report) if report else []
all_events=[e for t in turns for e in t.get('events',[]) if isinstance(e,dict)]
starts=collections.Counter(str(e.get('call_id')) for e in all_events if (e.get('event') or e.get('stage'))=='llm_http_start')
ends=collections.Counter(str(e.get('call_id')) for e in all_events if (e.get('event') or e.get('stage')) in ('llm_http_end','llm_http_error'))
valid_calls=set(starts)|set(ends)
usage_events=[e for e in all_events if (e.get('event') or e.get('stage'))=='llm_http_end' and e.get('accounting')=='PROVIDER_REPORTED' and isinstance(e.get('usage'),dict) and all(isinstance(e['usage'].get(k),int) for k in ('input_tokens','output_tokens'))]
check('Capturable LLM calls paired',bool(valid_calls) and all(starts[k]==ends[k]==1 for k in valid_calls),f'{sum(starts.values())} start / {sum(ends.values())} end in recorded turns')
check('Provider usage on executed calls',len(usage_events)==sum(ends.values()) and bool(usage_events),f'{len(usage_events)} provider usage / {sum(ends.values())} completed')
check('Complete all-provider call inventory',False,'No independently exhaustive inventory of dynamic provider calls and all routes')

bounds=collections.defaultdict(lambda:collections.Counter())
for e in all_events:
 k=e.get('event') or e.get('stage')
 if k in ('boundary_input','boundary_output'):
  label=str(e.get('id','unknown')).split(':',1)[0];bounds[label][k]+=1
check('Recorded structural boundaries',bool(bounds) and all(v['boundary_input']==v['boundary_output'] for v in bounds.values()),f'{sum(sum(c.values()) for c in bounds.values())} events / {len(bounds)} modules')
check('Full cross-module value lineage',False,'No independent input->output value/hash causality across all material handoffs')

check('Original Search V3 parser executed',bool(search and search.get('status')=='PASS' and search.get('source_sha256')==hashlib.sha256(SRC.read_bytes()).hexdigest() if SRC.exists() else False),'Original normalText / detectTypes / detectBedrooms executed with source SHA')
check('Full Search V3 DOM/catalog execution',False,'Exact browser DOM and real catalogue search not observed')
check('SearchContextV1 real provenance',False,'Existing continuation report uses SYNTHETIC_EMPTY_FIXTURE_NOT_SEARCH_V3')

# Counts derive only from independent *recorded* events, never claims of coverage.
observed=set()
for e in all_events:
 if e.get('event') in ('boundary_input','boundary_output'): observed.add(str(e.get('id','')).split(':',1)[0])
mandatory=['src/context.js','src/conversation-move.js','src/decision-policy.js','src/fast-gate.js','src/persona-semantic-a1.js','src/prima-search-request.js','src/router.js','src/search-context.js','src/search-response.js']
known=len([m for m in mandatory if m in observed]);denom=len(mandatory)
check('Coverage of declared QA module checkpoint list',known==denom,f'{known}/{denom} declared modules emitted boundary events')
check('90-95% of independently enumerated material transitions',False,'Module presence is not an independently enumerated executed-transition denominator')

wire='NOT_VERIFIED'
if isinstance(report,dict):
 wire=str((report.get('wire_identity_check') or {}).get('status') or 'NOT_VERIFIED')
check('Wire identity: request and response',wire=='PASS',f'Runner wire_identity_check: {wire}; request-only equality is insufficient for full PASS')

out={'contract':'PRIMA_R22433_FINAL_TECHNICAL_EVIDENCE','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_report':'search-continuation-trace-latest.json','checks':checks,
 'counts':dict(collections.Counter(x['status'] for x in checks)), 'result':'COMPLETE' if all(x['status']=='PASS' for x in checks) else 'INCOMPLETE',
 'open_critical': [c['name'] for c in checks if c['status']!='PASS'],
 'limitations':'No source mutation, network, Hugo, Chrome, or Supabase. Pure Search V3 parser functions only; not complete browser search.'}
R.mkdir(parents=True,exist_ok=True)
(R/'r22433-final-gate.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('===== PRIMA R2.24.33 — SINGLE FINAL GATE =====')
for c in checks:print(f"{c['status']:13} {c['name']} | {c['proof']}")
print('RESULT:',out['result'],'| PASS',out['counts'].get('PASS',0),'| NOT_VERIFIED',out['counts'].get('NOT_VERIFIED',0))
print('REPORT:',(R/'r22433-final-gate.json').relative_to(ROOT))
if not turns:print('WARNING: No continuation report events found; previously recorded evidence missing')
