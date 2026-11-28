#!/usr/bin/env python3
"""R2.24.29: summarize provider-level LLM accounting and boundary metadata from function trace reports."""
from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[3]
reportdir=root/'qa/full-pipeline/reports'
import argparse
p=argparse.ArgumentParser()
p.add_argument('--report',type=Path)
args=p.parse_args()
source=args.report or reportdir/'live-trace-batch-latest.json'
if not source.exists():
 matches=sorted(reportdir.glob('live-trace-batch-*.json'),key=lambda x:x.stat().st_mtime)
 if not matches:raise SystemExit('BLOCKED: no function trace batch report. Run R04 with live-db explicitly first.')
 source=matches[-1]
data=json.loads(source.read_text())
turns=data.get('turns') or []
if not turns:
 # Batch report may nest under scenarios. Search recursively for turn dicts with events.
 def walk(x):
  if isinstance(x,dict):
   if isinstance(x.get('events'),list):yield x
   else:
    for y in x.values():yield from walk(y)
  elif isinstance(x,list):
   for y in x:yield from walk(y)
 turns=list(walk(data))
providers=[];boundaries=[]
for t in turns:
 for e in t.get('events') or []:
  evt=e.get('event')
  if evt in ('llm_http_start','llm_http_end','llm_http_error'):providers.append(e)
  if evt in ('boundary_input','boundary_output'):boundaries.append(e)
ends=[e for e in providers if e.get('event')=='llm_http_end']
starts={e.get('call_id') for e in providers if e.get('event')=='llm_http_start'}
finished={e.get('call_id') for e in providers if e.get('event') in ('llm_http_end','llm_http_error')}
provider_complete=bool(starts) and starts<=finished
usage_complete=provider_complete and bool(ends) and all(e.get('accounting')=='PROVIDER_REPORTED' and e.get('usage') for e in ends)
if not starts:provider_state='NOT_VERIFIED_NO_PROVIDER_HTTP_EVENTS'
elif not provider_complete:provider_state='NOT_VERIFIED_UNPAIRED_CALLS'
elif usage_complete:provider_state='CAPTURED_CALLS_USAGE_RECORDED_NOT_ALL_PROVIDERS_PROVEN'
else:provider_state='PARTIAL_USAGE'
input_ids={e.get('id') for e in boundaries if e.get('event')=='boundary_input'}
output_ids={e.get('id') for e in boundaries if e.get('event')=='boundary_output'}
result={'contract':'PRIMA_QA_R22429','source_report':str(source),'provider_http_events':len(providers),
 'provider_calls_started':len(starts),'provider_calls_finished':len(finished),
 'provider_status':provider_state,'provider_usage_total':{},
 'boundary_events':len(boundaries),'boundary_modules':sorted({str(e.get('id') or '').split(':')[0] for e in boundaries}),
 'boundary_input_functions':len(input_ids),'boundary_output_functions':len(output_ids),
 'data_lineage':'STRUCTURAL_BOUNDARIES_ONLY_NOT_FULL_VALUES',
 'full_provider_accounting':'NOT_VERIFIED_UNTIL_CALL_INVENTORY_RECONCILED',
 'search_v3_execution':'NOT_VERIFIED_BY_WORKER_TRACE',
 'executed_path_95_percent':'NOT_VERIFIED_WITHOUT_TRANSITION_DENOMINATOR'}
for e in ends:
 for k,v in (e.get('usage') or {}).items():
  if isinstance(v,int):result['provider_usage_total'][k]=result['provider_usage_total'].get(k,0)+v
reportdir.mkdir(parents=True,exist_ok=True)
out=reportdir/'r22429-provider-lineage-latest.json'
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('===== PRIMA R2.24.29 PROVIDER + LINEAGE =====')
print('SOURCE:',source)
print('PROVIDER HTTP:',len(starts),'started /',len(finished),'finished |',provider_state)
print('PROVIDER USAGE:',result['provider_usage_total'] or 'NOT_CAPTURED')
print('DATA BOUNDARIES:',len(boundaries),'events,',len(result['boundary_modules']),'modules')
print('FULL DATA LINEAGE:',result['data_lineage'])
print('ALL-MODEL RECONCILIATION:',result['full_provider_accounting'])
print('REPORT:',out.relative_to(root))
