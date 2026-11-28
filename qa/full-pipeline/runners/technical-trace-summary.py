#!/usr/bin/env python3
"""Local read-only summary of actual PRIMA function-trace report.
Does not assert answer correctness or invent missing Luna usage.
"""
import argparse, datetime, html, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT/'qa/full-pipeline/reports'


def check_turn(turn, source_ok, report_error, scenario_error):
    events = turn.get('events') or []
    stages = {e.get('stage') for e in events}
    failures = []
    recovered = []
    for i,e in enumerate(events):
        status=e.get('status')
        stage=e.get('stage')
        is_fault=(stage in ('function_function_error','db_blocked') or
                  status in ('network_error','error','failed') or
                  (isinstance(status,int) and status>=400))
        if is_fault:
            item={'event_index':i+1,'stage':stage,'file':e.get('module'),
                  'function':e.get('fn') or e.get('id'),
                  'operation':e.get('operation'), 'status':status,
                  'detail':e.get('error_code') or e.get('error')}
            recovered.append(item)
    http=turn.get('http_status')
    if not isinstance(http,int) or http>=400: failures.append({'reason':'FINAL_HTTP_FAILURE','status':http})
    if report_error: failures.append({'reason':'RUNNER_ERROR','detail':report_error})
    if scenario_error: failures.append({'reason':'SCENARIO_ERROR','detail':scenario_error})
    if source_ok is False: failures.append({'reason':'SOURCE_CHANGED'})
    # A caught function exception may be recovered. Do not infer request failure.
    if any(e.get('stage')=='function_function_error' for e in events):
        recovered.append({'reason':'FUNCTION_EXCEPTION_OBSERVED_CHECK_RECOVERY'})
    if 'turn_begin' not in stages or 'final_response' not in stages:
        failures.append({'reason':'MISSING_OBSERVABILITY_CHECKPOINT'})
    fn=turn.get('function_trace') or {}
    # Entry/exit COUNTS are not a span integrity proof. A terminal can arrive
    # outside the runner's log window; only trace_id+span_id pairing can assess it.
    if failures:
        return 'TECHNICAL_FAIL', failures, recovered
    if fn.get('span_pairs_verified') is False:
        return 'NOT_VERIFIED', [{'reason':'TRACE_INTEGRITY_INCOMPLETE',
            'detail':'See trace-integrity-latest.json for exact unmatched span IDs'}], recovered
    if recovered:
        return 'TECHNICAL_WARN', [], recovered
    if not events or not turn.get('input') or turn.get('answer') is None or not any(e.get('stage')=='luna_result' for e in events):
        return 'NOT_VERIFIED', [{'reason':'INPUT_OUTPUT_OR_EVENTS_NOT_RECORDED'}], []
    return 'TECHNICAL_PASS', [], []


def collect(report):
    result={'contract':'PRIMA_TECHNICAL_TRACE_SUMMARY_V2',
        'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_report_contract':report.get('contract'),
        'source_sha256':report.get('source_sha256_before') or report.get('source_sha256'),
        'source_unchanged':report.get('source_unchanged'),
        'answer_quality':'NOT_EVALUATED','search_v3':'NOT_CLAIMED',
        'turns':[]}
    for scene in report.get('scenarios',[]):
        for turn in scene.get('turns') or []:
            events=turn.get('events') or []
            luna_events=[e for e in events if e.get('stage')=='luna_result']
            luna=turn.get('luna') or {}
            calls=[]
            for e in luna_events:
                calls.append({'model':e.get('model') or 'NOT_OBSERVED',
                    'route':e.get('primary_route') or luna.get('primary_route'),
                    'action':e.get('next_action') or luna.get('next_action'),
                    'duration_ms':e.get('duration_ms'),
                    'input_tokens':e.get('input_tokens'),
                    'output_tokens':e.get('output_tokens'),
                    'total_tokens':e.get('total_tokens') if isinstance(e.get('total_tokens'),int) else
                        (e['input_tokens']+e['output_tokens'] if isinstance(e.get('input_tokens'),int) and isinstance(e.get('output_tokens'),int) else None),
                    'error_code':e.get('error_code'),
                    'actual_request_payload':'NOT_CAPTURED',
                    'actual_response_payload':'NOT_CAPTURED'})
            answer_models=[]
            for e in events:
                if e.get('stage')=='answer_model':
                    answer_models.append({'model':e.get('model') or 'NOT_OBSERVED',
                        'input_tokens':e.get('input_tokens'), 'output_tokens':e.get('output_tokens'),
                        'duration_ms':e.get('duration_ms')})
            status,failures,recovered=check_turn(turn,report.get('source_unchanged'),report.get('error'),scene.get('error'))
            function_trace=turn.get('function_trace') or {}
            entry=function_trace.get('entry_events')
            exit_count=function_trace.get('exit_events')
            result['turns'].append({
                'scenario':scene.get('id'),'turn_seq':turn.get('turn_seq'),
                'trace_id':turn.get('trace_id'),'status':status,
                'incoming_message':turn.get('input'), 'outgoing_message':turn.get('answer'),
            'outgoing_message_may_be_truncated':len(str(turn.get('answer') or ''))>=2500,
                'response_type':turn.get('response_type'),
                'http_status':turn.get('http_status'),
                'route':turn.get('route'), 'action':turn.get('action'),
                'luna_calls_observed':len(calls),'luna_calls':calls,
                'answer_model_calls_observed':len(answer_models),'answer_model_calls':answer_models,
                'tokens_recorded':{
                    'luna_input':sum(x['input_tokens'] for x in calls if isinstance(x['input_tokens'],int)) if calls and all(isinstance(x['input_tokens'],int) for x in calls) else None,
                    'luna_output':sum(x['output_tokens'] for x in calls if isinstance(x['output_tokens'],int)) if calls and all(isinstance(x['output_tokens'],int) for x in calls) else None,
                    'other_model_input':sum(x['input_tokens'] for x in answer_models if isinstance(x['input_tokens'],int)) if answer_models and all(isinstance(x['input_tokens'],int) for x in answer_models) else None,
                    'other_model_output':sum(x['output_tokens'] for x in answer_models if isinstance(x['output_tokens'],int)) if answer_models and all(isinstance(x['output_tokens'],int) for x in answer_models) else None,
                    'complete_all_providers':'NOT_VERIFIED'},
                'events_count':len(events),'function_entries':entry,'function_exits':exit_count,
                'first_failure':failures[0] if failures else recovered[0] if recovered else None,
                'failures':failures,'recoverable_errors':recovered,
                'db_calls':turn.get('db_operations') or [],
                'trace_details_source':'original batch JSON events[]',
                'answer_quality':'NOT_EVALUATED'
            })
    return result


def render(data):
    esc=lambda x:html.escape(str(x if x is not None else 'NOT_OBSERVED'))
    cards=[]
    for x in data['turns']:
        tokens=x['tokens_recorded']; s=x['status']
        badge='#1f7a58' if s=='TECHNICAL_PASS' else '#9b5c09' if s in ('TECHNICAL_WARN','NOT_VERIFIED') else '#a82d3f'
        errs=html.escape(json.dumps(x['first_failure'],ensure_ascii=False,indent=2)) if x['first_failure'] else 'No observed technical failures'
        luna_rows=''.join(f"<tr><td>{esc(c['model'])}</td><td>{esc(c['route'])}</td><td>{esc(c['action'])}</td><td>{esc(c['duration_ms'])}</td><td>{esc(c['input_tokens'])}</td><td>{esc(c['output_tokens'])}</td></tr>" for c in x['luna_calls']) or '<tr><td colspan="6">NOT_OBSERVED</td></tr>'
        cards.append(f'''<section><div class="head"><h2>{esc(x['scenario'])} · Turn {esc(x['turn_seq'])}</h2><span style="color:{badge}">{esc(s)}</span></div>
        <div class="metrics"><div><small>HTTP</small><b>{esc(x['http_status'])}</b></div><div><small>Events</small><b>{x['events_count']}</b></div><div><small>Function entry/exit</small><b>{esc(x['function_entries'])} / {esc(x['function_exits'])}</b></div><div><small>Luna tokens in/out</small><b>{esc(tokens['luna_input'])} / {esc(tokens['luna_output'])}</b></div></div>
        <h3>Incoming message — actual</h3><pre>{esc(x['incoming_message'])}</pre>
        <h3>Outgoing answer — actual</h3><pre>{esc(x['outgoing_message'])}</pre>
        <h3>Luna — observed calls, tokens, time</h3><table><thead><tr><th>Model</th><th>Route</th><th>Action</th><th>Latency ms</th><th>Input</th><th>Output</th></tr></thead><tbody>{luna_rows}</tbody></table>
        <p class="note">Luna request/response payloads are NOT_CAPTURED in this report; do not mistake a checkpoint for a full provider transcript. Answer quality: NOT_EVALUATED.</p>
        <details><summary>First technical issue / recovered error</summary><pre>{errs}</pre></details>
        <details><summary>Full technical details are in original batch JSON</summary><p>Open the referenced batch JSON to inspect function spans, HTTP events and module attribution.</p></details></section>''')
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRIMA Technical Trace</title><style>body{max-width:1050px;margin:34px auto;padding:0 18px;font:15px/1.55 -apple-system,BlinkMacSystemFont,Arial;color:#20252b;background:#f8f9fb}h1{font-size:27px}h2{font-size:19px;margin:0}h3{font-size:14px;margin:20px 0 6px}section{background:white;border:1px solid #dddfe4;border-radius:14px;padding:22px;margin:18px 0}.head{display:flex;justify-content:space-between;gap:12px;align-items:center}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0}.metrics div{background:#f3f5f7;padding:11px;border-radius:9px}small{display:block;color:#67717d}b{font-size:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f7;border-radius:8px;padding:14px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eaedf0;text-align:left;padding:8px}th{font-size:12px;color:#5d6773}.note{color:#6b7280;font-size:13px}summary{cursor:pointer;padding:8px 0}</style><h1>PRIMA — Technical Trace</h1><p>Technical status only. PASS ≠ correct answer. Missing observations remain NOT_OBSERVED.</p>''' + ''.join(cards) + '</html>'


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--report',type=Path,help='Path to existing live-trace-batch JSON (default latest)')
    args=p.parse_args()
    if args.report: source=args.report
    else:
        candidates=sorted(REPORTS.glob('live-trace-batch-*.json'),key=lambda p:p.stat().st_mtime)
        if not candidates:raise SystemExit('No live batch reports found. Run existing trace runner first.')
        source=candidates[-1]
    raw=json.loads(source.read_text(encoding='utf-8'))
    if not isinstance(raw.get('scenarios'),list):raise SystemExit('Batch report lacks scenarios[]. No status assigned.')
    obj=collect(raw)
    obj['original_report']=str(source.resolve())
    REPORTS.mkdir(parents=True,exist_ok=True)
    out=REPORTS/'technical-trace-latest.json'
    page=REPORTS/'technical-trace-latest.html'
    out.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    page.write_text(render(obj),encoding='utf8')
    print('===== PRIMA TECHNICAL TRACE =====')
    print('SOURCE:',source.relative_to(ROOT) if source.is_relative_to(ROOT) else source)
    for x in obj['turns']:
        t=x['tokens_recorded']
        print(f"{x['scenario']} turn {x['turn_seq']} {x['status']} | HTTP {x['http_status']} | events {x['events_count']}")
        print('  INPUT:',str(x['incoming_message'])[:180])
        print('  OUTPUT:',str(x['outgoing_message'])[:250])
        print('  LUNA:',x['luna_calls_observed'],'calls; TOKENS',t['luna_input'],'/',t['luna_output'])
        if x['first_failure']:print('  FIRST TECHNICAL ISSUE:',x['first_failure'])
    print('ANSWER QUALITY: NOT_EVALUATED')
    print('LLM PAYLOADS: NOT_CAPTURED; full provider token accounting NOT_VERIFIED')
    print('JSON:',out.relative_to(ROOT))
    print('HTML:',page.relative_to(ROOT))
    return 0
if __name__=='__main__':raise SystemExit(main())
