#!/usr/bin/env python3
"""PRIMA R2.24.32: read-only executed-path provider ledger and safe boundary audit.
Never sends network requests, writes DB, or modifies Worker source.
Outputs no raw prompts, messages, tokens, IDs, API keys or request payloads.
"""
import argparse, collections, json, pathlib, sys
ROOT=pathlib.Path(__file__).resolve().parents[3]
REPORTS=ROOT/'qa/full-pipeline/reports'

def load(path):
    data=json.loads(path.read_text())
    if not isinstance(data,dict): raise ValueError('Report root is not an object')
    return data

def events_for(data):
    turns=data.get('turns')
    if not isinstance(turns,list):
        turns=[]
        def rec(x):
            if isinstance(x,dict):
                if isinstance(x.get('events'),list):turns.append(x)
                else:
                    for v in x.values():rec(v)
            elif isinstance(x,list):
                for v in x:rec(v)
        rec(data)
    return [(t.get('phase') or t.get('case') or 'recorded',t.get('events') or []) for t in turns if isinstance(t,dict)]

def audit_phase(phase, events):
    starts=collections.defaultdict(list); ends=collections.defaultdict(list)
    boundary=collections.defaultdict(lambda:{'in':0,'out':0,'safe_keys':set(),'filter_keys':set()})
    all_ev=collections.Counter()
    for e in events:
        if not isinstance(e,dict):continue
        kind=e.get('event') or e.get('stage'); all_ev[str(kind)]+=1
        if kind=='llm_http_start':starts[str(e.get('call_id'))].append(e)
        elif kind in ('llm_http_end','llm_http_error'):ends[str(e.get('call_id'))].append(e)
        elif kind in ('boundary_input','boundary_output'):
            idstr=str(e.get('id') or '')
            module=idstr.split(':',1)[0] if ':' in idstr else 'unknown'
            row=boundary[module]; row['in' if kind=='boundary_input' else 'out']+=1
            # Keep key names only. Never include actual payload or values in output.
            def seek(x,depth=0):
                if depth>3 or not isinstance(x,dict):return
                for k,v in x.items():
                    if k in {'route','action','phase','tool','version','response_type','language_code','entity_type','state','property_type','result_count','max_results'}:
                        row['safe_keys'].add(k)
                    if k=='safe_filters' and isinstance(v,dict):row['filter_keys'].update(v.keys())
                    if k in {'input','output','data','value','safe','metadata','summary','fields'}:seek(v,depth+1)
            seek(e)
    calls=[]
    for cid in sorted(set(starts)|set(ends)):
        a=starts[cid];b=ends[cid];event=b[-1] if b else {}
        usage=event.get('usage')
        usage=usage if isinstance(usage,dict) else {}
        sums={k:usage.get(k) for k in ('input_tokens','output_tokens','total_tokens') if isinstance(usage.get(k),int)}
        calls.append({'paired':len(a)==1 and len(b)==1,'started':len(a),'finished':len(b),
                      'usage_confirmed':bool(sums) and event.get('accounting')=='PROVIDER_REPORTED',
                      'usage':sums,'http_status':event.get('http_status'),
                      'model_observed':bool(event.get('model')),
                      'duration_observed':isinstance(event.get('duration_ms'),(int,float))})
    errs=[e for e in events if isinstance(e,dict) and (e.get('event')=='llm_http_error')]
    rows={m:{'input_events':v['in'],'output_events':v['out'],
             'safe_field_keys':sorted(v['safe_keys']), 'filter_field_keys':sorted(v['filter_keys'])} for m,v in sorted(boundary.items())}
    reconciled=bool(calls) and all(c['paired'] and c['usage_confirmed'] for c in calls)
    return {'phase':str(phase),'events':len(events),'provider_started':sum(map(len,starts.values())),
            'provider_finished':sum(map(len,ends.values())), 'provider_error_events':len(errs),
            'captured_provider_reconciliation':'PASS' if reconciled else ('NOT_OBSERVED' if not calls else 'NOT_VERIFIED'),
            'captured_calls':calls, 'data_boundary_events':all_ev['boundary_input']+all_ev['boundary_output'],
            'boundary_modules':rows,
            'cross_module_value_equality':'NOT_VERIFIED_NO_BOUNDARY_PAIR_VALUE_HASHES'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--report',type=pathlib.Path);args=p.parse_args()
    path=args.report or REPORTS/'search-continuation-trace-latest.json'
    if not path.is_file():raise SystemExit('BLOCKED: report not found: '+str(path))
    data=load(path)
    groups=events_for(data)
    if not groups:raise SystemExit('BLOCKED: no recorded turns/events; previous run may have failed')
    results=[audit_phase(name,ev) for name,ev in groups]
    out={'contract':'PRIMA_R22432_EXECUTED_PATH_LEDGER','source_report':str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
         'scoped_to':'RECORDED_EXECUTED_PHASES_ONLY','phases':results,
         'global_all_provider_coverage':'NOT_VERIFIED_UNTIL_ALL_RUNTIME_TRANSPORTS_AND_SCENARIOS_TESTED',
         'search_v3_execution':'NOT_VERIFIED_BY_WORKER_TRACE',
         'full_data_lineage':'NOT_VERIFIED_STRUCTURAL_AND_SAFE_KEYS_ONLY',
         'coverage_90_95':'NOT_VERIFIED_NO_INDEPENDENT_MATERIAL_TRANSITION_DENOMINATOR',
         'disclaimer':'A balanced provider ledger for observed calls does not prove every possible provider was intercepted.'}
    REPORTS.mkdir(parents=True,exist_ok=True)
    dest=REPORTS/'r22432-executed-ledger-latest.json';dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print('===== PRIMA R2.24.32 EXECUTED-PATH LEDGER =====')
    for item in results:
        print(f"{item['phase']}: provider {item['provider_started']}/{item['provider_finished']} | captured-call usage {item['captured_provider_reconciliation']} | boundaries {item['data_boundary_events']} | modules {len(item['boundary_modules'])}")
        for name,row in item['boundary_modules'].items():
            print(' ',name,'in',row['input_events'],'out',row['output_events'],'safe_keys',','.join(row['safe_field_keys']),'filters',','.join(row['filter_field_keys']))
    print('FULL LLM COVERAGE: NOT_VERIFIED; TRUE VALUE LINEAGE: NOT_VERIFIED; SEARCH V3: NOT_VERIFIED')
    print('REPORT:',dest.relative_to(ROOT))
if __name__=='__main__':main()
