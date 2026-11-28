#!/usr/bin/env python3
"""Install R2.24.30 into the existing QA continuation runner only.
Does not modify src, DB schema, external services, or the Search V3 implementation.
"""
from pathlib import Path
import hashlib,sys
root=Path(__file__).resolve().parents[3]
runner=root/'qa/full-pipeline/runners/search-continuation-trace.py'
if not runner.is_file():raise SystemExit('BLOCKED: existing QA continuation runner missing')
s=runner.read_text()
marker='def main():\n'
call_marker='        report[\'status\']=\'WORKER_CONTINUATION_TECHNICAL_RECORDED\'\n        provenance_and_lineage(report)\n'
if 'def summarize_provider_and_boundaries_r22430(' in s:
 print('R2.24.30 ALREADY INSTALLED');sys.exit(0)
if s.count(marker)!=1 or s.count(call_marker)!=1 or 'def provenance_and_lineage(report):' not in s:
 raise SystemExit('BLOCKED: unfamiliar runner; no files changed')
addition='''def summarize_provider_and_boundaries_r22430(report):
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


'''
s=s.replace(marker,addition+marker,1)
s=s.replace(call_marker,call_marker+'        summarize_provider_and_boundaries_r22430(report)\n',1)
# Report incomplete phases too, without suppressing original exception.
anchor="        if report.get('turns') and 'wire_identity_check' not in report:\n            provenance_and_lineage(report)\n"
if s.count(anchor)!=1:raise SystemExit('BLOCKED: missing finally anchor')
s=s.replace(anchor,anchor+"        if report.get('turns') and 'r22430_evidence' not in report:\n            summarize_provider_and_boundaries_r22430(report)\n",1)
compile(s,str(runner),'exec')
backup=runner.with_name(runner.name+'.bak-r22430')
if backup.exists():raise SystemExit('BLOCKED: backup already exists, avoid overwriting prior state')
backup.write_text(runner.read_text())
runner.write_text(s)
print('R2.24.30 INSTALLED — existing QA continuation runner only')
print('BACKUP:',backup.relative_to(root))
print('PRODUCTION src/: UNCHANGED | SEARCH V3: UNCHANGED | NO DB CALLS OR DEPLOY')
