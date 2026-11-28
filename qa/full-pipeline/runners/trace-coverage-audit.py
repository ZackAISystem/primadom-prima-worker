#!/usr/bin/env python3
"""PRIMA Trace V2 coverage audit for actual R2.24.18 reports.
Read-only. Never claims inferred function calls are observed. No credentials/network.
"""
from pathlib import Path
import argparse, collections, datetime, html, json, re, sys
ROOT=Path(__file__).resolve().parents[3]
QA=ROOT/'qa/full-pipeline'
REPORTS=QA/'reports'
ARCH=QA/'baselines/architecture-map-v1.json'
EXPECTED=["turn_begin","router","fast_gate","luna_result","interpreter","conversation_move","decision_policy","executor_route","knowledge_plan","evidence","answer_model","answer_selection","final_response"]
CLASSES=['supabase_http','search_dispatch','db_blocked']
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def safe(x):return html.escape(str(x or ''),quote=True)
def badge(v):
    return '<span class="bad">'+safe(v)+'</span>' if v in ('FAIL','ERROR','NOT_OBSERVED','MISSING','INVALID') else '<span class="ok">'+safe(v)+'</span>'
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--report',help='Existing batch JSON; default latest R2.24.18')
    args=ap.parse_args()
    matches=sorted(REPORTS.glob('live-trace-batch-*.json'))
    path=Path(args.report).expanduser().resolve() if args.report else matches[-1] if matches else None
    if path is None or not path.is_file():raise SystemExit('NO_BATCH_REPORT: Run existing run-trace-batch.py first')
    data=read(path)
    arch=read(ARCH)
    modules=arch.get('modules',[])
    declared={f"{m.get('path')}::{fn.get('name')}" for m in modules for fn in m.get('functions',[]) if fn.get('name')}
    source_modules={p.relative_to(ROOT).as_posix() for p in (ROOT/'src').rglob('*.js') if p.is_file() and not p.name.startswith('.') and '.bak' not in p.name and '.backup' not in p.name}
    source_functions={n for n in declared if n.startswith('src/')}
    turns=[]; observed_modules=set(); observed_stages=set(); claimed_functions=set(); token_calls=[]; errors=[]
    for scenario in data.get('scenarios',[]):
      sid=scenario.get('id','?')
      for turn in scenario.get('turns',[]):
        events=turn.get('events',[])
        stages={e.get('stage') for e in events}
        observed_stages|=stages
        t={'case':sid,'turn_seq':turn.get('turn_seq'),'route':turn.get('route'),'action':turn.get('action'),
           'trace_id':turn.get('trace_id'),'events':len(events),'missing_checkpoints':[], 'observed_modules':[],
           'duration_ms':None,'luna_tokens':None,'answer_tokens':None,'events_detail':[],'errors':[]}
        has_search='search_dispatch' in stages
        expected=['turn_begin','router','fast_gate','luna_result','decision_policy','executor_route']
        if not has_search:expected+=['final_response']
        t['missing_checkpoints']=[s for s in expected if s not in stages]
        for i,e in enumerate(events):
          m=e.get('module') or ''
          # Checkpoint module/fn is an attribution only; never proof function was called.
          if m:observed_modules.add(m)
          duration=e.get('duration_ms')
          rec={'i':i+1,'stage':e.get('stage'),'module':m,'fn_label':e.get('fn'),
               'elapsed_ms':e.get('elapsed_ms'),'duration_ms':duration,
               'input_tokens':e.get('input_tokens'),'output_tokens':e.get('output_tokens'),
               'operation':e.get('operation'),'http_status':e.get('status'),'action':e.get('final_action') or e.get('next_action') or e.get('action'),
               'reason':e.get('reason'), 'confidence':e.get('confidence'), 'source':e.get('source'),
               'span_id':e.get('span_id'), 'parent_span_id':e.get('parent_span_id')}
          t['events_detail'].append(rec)
          if e.get('stage')=='final_response':t['duration_ms']=e.get('elapsed_ms')
          if e.get('stage') in ('luna_result','answer_model'):
            token_calls.append({'case':sid,'turn_seq':t['turn_seq'],'stage':e.get('stage'), 'input':e.get('input_tokens'),'output':e.get('output_tokens')})
            used=[e.get('input_tokens'),e.get('output_tokens')]
            if e.get('stage')=='luna_result':t['luna_tokens']=used
            else:t['answer_tokens']=used
          if e.get('stage')=='db_blocked' or e.get('status')=='network_error' or (isinstance(e.get('status'),int) and e['status']>=400):
            t['errors'].append({'event_index':i,'stage':e.get('stage'),'operation':e.get('operation'),'status':e.get('status')})
        t['observed_modules']=sorted({e.get('module') for e in events if e.get('module')})
        if t['missing_checkpoints']:errors.append({'case':sid,'turn_seq':t['turn_seq'],'type':'MISSING_CHECKPOINT','stages':t['missing_checkpoints']})
        if t['errors']:errors.extend({'case':sid,'turn_seq':t['turn_seq'], 'type':'HTTP_OR_QA_BLOCK','detail':x} for x in t['errors'])
        turns.append(t)
    observed_source={m for m in observed_modules if m.startswith('src/')}
    # There is no runtime function-entry probe in R2.24.18. A fn label is metadata, NOT a call span.
    function_coverage={'status':'NOT_MEASURABLE','function_entry_spans':0,
      'measured_function_coverage_pct':None,'approx_static_functions':len(source_functions),
      'reason':'R2.24.18 stage events are checkpoints, not function-entry/exit spans; do not count attributed fn names as executed functions.'}
    source_module_coverage={'observed_checkpoint_modules':len(observed_source),
      'static_source_modules':len(source_modules),
      'checkpoint_module_pct':round(100*len(observed_source & source_modules)/len(source_modules),1) if source_modules else None,
      'note':'This is checkpoint module attribution, not executed-line or function coverage.'}
    result={'contract':'PRIMA_TRACE_COVERAGE_AUDIT_V1','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'source_report':str(path),'source_sha256':data.get('source_sha256_before'),
      'source_unchanged':data.get('source_unchanged'),
      'traces':len(turns),'events_total':sum(t['events'] for t in turns),
      'source_module_checkpoints':source_module_coverage,
      'function_runtime_coverage':function_coverage,
      'end_to_end_browser_search':'NOT_MEASURED',
      'input_output_data_lineage':'NOT_MEASURED',
      'parent_child_call_tree':'NOT_MEASURED',
      'model_token_usage':token_calls,
      'first_detected_observability_issue':errors[0] if errors else None,
      'observed_stages':sorted(x for x in observed_stages if x),
      'not_observed_contract_stages':[s for s in EXPECTED if s not in observed_stages],
      'errors':errors,'turns':turns,'acceptance_90_95':'NOT_ACHIEVED',
      'acceptance_reason':'Function entry/exit coverage, cross-service search bridge, and parameter lineage not verified.'}
    REPORTS.mkdir(exist_ok=True,parents=True)
    output=REPORTS/'trace-coverage-latest.json'
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    style='''<style>body{font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:1240px;margin:32px auto;padding:0 18px;background:#111821;color:#e5ebf4}h1{font-size:28px}h2{margin-top:40px;font-size:20px}p,small{color:#9aaabd}table{width:100%;border-collapse:collapse;margin:10px 0 20px;table-layout:fixed}th,td{text-align:left;border-bottom:1px solid #344052;padding:10px 7px;vertical-align:top;word-break:break-word}th{color:#aab8ca}.bad{color:#f6a180}.ok{color:#72d9aa}.pill{display:inline-block;background:#29374a;padding:6px 11px;border-radius:7px;margin:3px}details{border:1px solid #344052;border-radius:9px;padding:12px;margin:12px 0}summary{cursor:pointer;font-weight:600}code{color:#d7bcff} .dim{color:#9aaabd}.warning{border-left:4px solid #f6a180;padding:12px 16px;background:#2b272e}</style>'''
    doc=['<!doctype html><html lang="ru"><meta charset="utf-8"><title>PRIMA Trace Coverage</title>',style,'<h1>PRIMA — фактическая наблюдаемость</h1>',
      '<p class="warning">Событие контрольной точки НЕ равно исполненному вызову функции. Оценка 90–95% пока не подтверждена.</p>',
      f'<div class="pill">Диалогов/сообщений: {len(turns)}</div><div class="pill">Событий: {result["events_total"]}</div>',
      f'<div class="pill">Функции: {function_coverage["status"]}</div>',
      f'<div class="pill">Source SHA: {safe(data.get("source_sha256_before"))[:16]}…</div>',
      '<h2>Границы покрытия</h2><table><tr><th>Участок</th><th>Фактический статус</th></tr>',
      f'<tr><td>Статические функции source</td><td>≈ {len(source_functions)} — только карта</td></tr>',
      f'<tr><td>Модули с checkpoint attribution</td><td>{len(observed_source & source_modules)} / {len(source_modules)}</td></tr>',
      '<tr><td>Функции с entry/exit span</td><td class="bad">Нет доказанных spans</td></tr>',
      '<tr><td>Search V3 + continuation</td><td class="bad">Не проверены сквозным запуском</td></tr>',
      '<tr><td>LLM usage</td><td>Только если провайдер вернул токены и они записаны в событие</td></tr></table>']
    for t in turns:
      doc.append(f'<details open><summary>{safe(t["case"])} / turn {safe(t["turn_seq"])} · route={safe(t["route"])} · action={safe(t["action"])} · {t["events"]} events</summary>')
      doc.append('<p>Отсутствующие обязательные точки: '+safe(', '.join(t['missing_checkpoints']) or 'нет в минимальном наборе')+'</p>')
      doc.append('<table><tr><th style="width:34px">#</th><th style="width:155px">Этап</th><th>Файл / label</th><th style="width:100px">t, мс</th><th style="width:100px">Δ, мс</th><th style="width:110px">Токены (in/out)</th><th>Решение / HTTP</th></tr>')
      for e in t['events_detail']:
        tok=' / '.join('—' if e[k] is None else str(e[k]) for k in ('input_tokens','output_tokens'))
        decision=e['action'] or e['operation'] or e['http_status'] or e['reason'] or ''
        doc.append('<tr>'+''.join(f'<td>{safe(x)}</td>' for x in [e['i'],e['stage'],e['module']+' / '+str(e['fn_label'] or ''),e['elapsed_ms'],e['duration_ms'],tok,decision])+'</tr>')
      doc.append('</table></details>')
    doc.append('<h2>Ошибки наблюдаемости</h2><pre>'+safe(json.dumps(errors[:30],ensure_ascii=False,indent=2))+'</pre>')
    doc.append('<p>Только чтение локальных отчётов. Ни Worker, ни Supabase, ни production не изменены.</p></html>')
    htmlpath=REPORTS/'trace-waterfall-latest.html';htmlpath.write_text('\n'.join(doc),encoding='utf8')
    print('PRIMA TRACE COVERAGE AUDIT')
    print('SOURCE REPORT:',path)
    print('TURNS:',len(turns),'EVENTS:',result['events_total'])
    print('CHECKPOINT MODULES:',len(observed_source & source_modules),'/',len(source_modules))
    print('FUNCTION LEVEL:',function_coverage['status'])
    print('SEARCH V3:',result['end_to_end_browser_search'])
    print('90-95% ACCEPTANCE:',result['acceptance_90_95'])
    print('JSON:',output)
    print('WATERFALL:',htmlpath)
    return 0
if __name__=='__main__':sys.exit(main())
