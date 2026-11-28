#!/usr/bin/env python3
"""R2.24.23: fix function trace log collection for waitUntil background tasks."""
from pathlib import Path
import ast, shutil
root=Path.cwd()
p=root/'qa/full-pipeline/runners/run-function-trace-batch.py'
if not (root/'src/index.js').is_file() or not p.is_file():
    raise SystemExit('Run in PRIMA Worker repo with R2.24.20 installed')
s=p.read_text()
if 'PRIMA_R22423_ASYNC_COLLECTOR_V1' in s:
    print('R2.24.23 ALREADY INSTALLED — no changes')
    raise SystemExit(0)
needle='                time.sleep(1.2)\n                logs=[]\n                while not q.empty():logs.append(q.get_nowait())'
if s.count(needle)!=1:raise SystemExit('BLOCKED: expected runner version not found; no files modified')
helper='''
# PRIMA_R22423_ASYNC_COLLECTOR_V1
# Wait for the HTTP root AND observed waitUntil-related spans to terminate.
# No synthetic events and no assumptions that HTTP 200 means all writes finished.
def collect_async_trace_logs(q, timeout_s=25.0, settle_s=0.75):
    deadline=time.monotonic()+timeout_s
    raw=[]
    trace_id=None
    settled_at=None
    while time.monotonic()<deadline:
        try:
            raw.append(q.get(timeout=min(.25,max(.001,deadline-time.monotonic()))))
        except queue.Empty:pass
        parsed=[event_parse(line) for line in raw]
        roots=[e for e in parsed if e and e.get('stage')=='function_request_begin' and e.get('trace_id')]
        if trace_id is None and roots:trace_id=str(roots[-1]['trace_id'])
        selected=[e for e in parsed if e and str(e.get('trace_id') or '')==trace_id] if trace_id else []
        ended=any(e.get('stage') in ('function_request_end','function_request_error') for e in selected)
        entries={str(e['span_id']) for e in selected if e.get('stage')=='function_function_enter' and e.get('span_id')}
        terminals={str(e['span_id']) for e in selected if e.get('stage') in ('function_function_exit','function_function_error') and e.get('span_id')}
        if ended and entries and entries==terminals:
            if settled_at is None:settled_at=time.monotonic()
            if time.monotonic()-settled_at>=settle_s:
                return raw,{'status':'COMPLETE','trace_id':trace_id,'pending':0,'waited_for_background':True}
        else:settled_at=None
    parsed=[event_parse(line) for line in raw]
    selected=[e for e in parsed if e and str(e.get('trace_id') or '')==trace_id] if trace_id else []
    entries={str(e['span_id']) for e in selected if e.get('stage')=='function_function_enter' and e.get('span_id')}
    terminals={str(e['span_id']) for e in selected if e.get('stage') in ('function_function_exit','function_function_error') and e.get('span_id')}
    pending=sorted(entries-terminals)
    return raw,{'status':'INCOMPLETE_TIMEOUT' if trace_id else 'TRACE_NOT_OBSERVED',
                'trace_id':trace_id,'pending':len(pending),'pending_ids':pending[:20],
                'terminal_without_entry':len(terminals-entries),'waited_for_background':True}
'''
s=s.replace(needle,'''                logs,async_collection=collect_async_trace_logs(q)
                print('  ASYNC:',async_collection['status'], 'pending=',async_collection.get('pending'))''')
marker='\ndef main():\n'
if s.count(marker)!=1:raise SystemExit('BLOCKED: main marker not found')
s=s.replace(marker,helper+marker)
old="""                info['turn_seq']=seq
                info['trace_id']=next((e.get('trace_id') for e in events if e.get('stage')=='turn_begin'),None)
                info['db_event_correlation']='best_effort_by_serial_turn_window'"""
new="""                info['turn_seq']=seq
                info['trace_id']=async_collection.get('trace_id')
                info['async_trace_collection']=async_collection
                info['db_event_correlation']='function_spans_correlated_by_trace_id; checkpoint_logs_best_effort'"""
if s.count(old)!=1:raise SystemExit('BLOCKED: report marker not found')
s=s.replace(old,new)
ast.parse(s)
backup=p.with_suffix('.py.bak-r22423')
if not backup.exists():shutil.copy2(p,backup)
p.write_text(s)
print('R2.24.23 INSTALLED — QA runner only')
print('BACKUP:',backup.relative_to(root))
print('SRC MODIFIED: 0; DB CALLS: 0; DEPLOYS: 0')
print('Collector waits for observed spans or reports a 25s timeout')
