#!/usr/bin/env python3
"""PRIMA R2.24.22. Read-only exact span pairing of recorded function events.
Does NOT treat absent trace events as proof that the application failed.
No API calls, DB writes, or modification of Worker source.
"""
import argparse
import collections
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'qa/full-pipeline/reports'


def assess_turn(turn):
    events = turn.get('events') or []
    by_id = collections.defaultdict(list)
    roots = set()
    malformed = []
    first_seq = {}
    actual_failures = []
    for idx, event in enumerate(events):
        stage = event.get('stage')
        if stage in ('function_request_begin', 'function_request_end', 'function_request_error'):
            roots.add(str(event.get('trace_id') or ''))
        if stage in ('function_function_enter', 'function_function_exit', 'function_function_error'):
            trace = event.get('trace_id')
            span = event.get('span_id')
            if not trace or not span:
                malformed.append({'event_index': idx+1, 'reason': 'SPAN_ID_OR_TRACE_ID_MISSING', 'id':event.get('id')})
                continue
            key = (str(trace), str(span))
            by_id[key].append((idx, event))
            if key not in first_seq:
                first_seq[key] = idx
        if stage == 'function_function_error':
            actual_failures.append({'event_index':idx+1,'id':event.get('id'),'trace_id':event.get('trace_id'),'span_id':event.get('span_id'),'error':event.get('error')})
    all_entries = sum(1 for event in events if event.get('stage')=='function_function_enter')
    all_terminals = sum(1 for event in events if event.get('stage') in ('function_function_exit','function_function_error'))
    matched = 0
    incomplete=[]
    duplicate=[]
    wrong_order=[]
    parents_missing=[]
    ids = set(by_id)
    for key in sorted(by_id, key=lambda key:first_seq[key]):
        event_list = by_id[key]
        entries = [(i,e) for i,e in event_list if e.get('stage')=='function_function_enter']
        terminals = [(i,e) for i,e in event_list if e.get('stage') in ('function_function_exit','function_function_error')]
        representative = entries[0][1] if entries else event_list[0][1]
        item={'trace_id':key[0],'span_id':key[1],'id':representative.get('id'),'parent_span_id':representative.get('parent_span_id'),
              'enter_events':len(entries),'terminal_events':len(terminals),'first_event_index':event_list[0][0]+1}
        if len(entries)==1 and len(terminals)==1 and terminals[0][0]>entries[0][0]:
            matched+=1
        elif len(entries)>1 or len(terminals)>1:
            duplicate.append(item)
        elif entries and terminals and terminals[0][0]<entries[0][0]:
            wrong_order.append(item)
        else:
            incomplete.append({**item,'observation':'SPAN_NOT_FULLY_CAPTURED'})
        parent = str(representative.get('parent_span_id') or '')
        if parent not in ('','root') and (key[0],parent) not in ids:
            parents_missing.append(item)
    trace_ids={key[0] for key in ids}
    root_missing = sorted(trace_ids-roots)
    # A function can still be running as the HTTP response is emitted; absence of a
    # terminal event in the batch window must not be attributed to the app itself.
    issues=bool(incomplete or duplicate or wrong_order or malformed or parents_missing or root_missing)
    status='TRACE_INTEGRITY_INCOMPLETE' if issues else 'TRACE_INTEGRITY_VERIFIED' if by_id else 'TRACE_NOT_OBSERVED'
    return {
        'status':status,'span_unique':len(by_id),'matched_spans':matched,
        'enter_events':all_entries,'terminal_events':all_terminals,
        'unmatched_spans':incomplete,'duplicate_spans':duplicate,'out_of_order_spans':wrong_order,
        'missing_parents':parents_missing,'malformed_spans':malformed,
        'trace_ids_without_request_marker':root_missing,
        'function_exceptions_observed':actual_failures,
        'notes':[
            'A mismatched span is an observability problem, not proof of a Worker failure.',
            'Asynchronous tasks may still be running after HTTP response or after the collection window.',
            'The original batch runner assigns events by a serial log window, not a verified cross-request correlation.',
            'No semantic answer quality is evaluated.'
        ]
    }


def main():
    ap=argparse.ArgumentParser(description='Read-only function trace integrity by trace_id/span_id')
    ap.add_argument('--report',type=Path,help='Existing batch trace JSON; default most recent')
    args=ap.parse_args()
    src=args.report
    if not src:
        matches=sorted(REPORTS.glob('live-trace-batch-*.json'),key=lambda f:f.stat().st_mtime)
        if not matches: raise SystemExit('No live batch report found; no requests made.')
        src=matches[-1]
    raw=json.loads(src.read_text(encoding='utf-8'))
    out={'contract':'PRIMA_TRACE_INTEGRITY_R22422','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'source_report':str(src),'source_unchanged':raw.get('source_unchanged'),
         'scenarios':[],'status':'TRACE_INTEGRITY_VERIFIED'}
    for sc in raw.get('scenarios') or []:
        for turn in sc.get('turns') or []:
            r=assess_turn(turn)
            out['scenarios'].append({'case':sc.get('id'),'turn_seq':turn.get('turn_seq'),'http_status':turn.get('http_status'),
                                     'trace_id':turn.get('trace_id'),**r})
            if r['status']!='TRACE_INTEGRITY_VERIFIED':out['status']='TRACE_INTEGRITY_INCOMPLETE'
            print(f"{sc.get('id')} turn {turn.get('turn_seq')}: HTTP {turn.get('http_status')} | {r['status']} | matched {r['matched_spans']}/{r['span_unique']} | incomplete {len(r['unmatched_spans'])} | duplicate {len(r['duplicate_spans'])} | parent_missing {len(r['missing_parents'])}")
            for item in (r['unmatched_spans']+r['duplicate_spans']+r['out_of_order_spans']+r['missing_parents'])[:12]:
                print('  ',item.get('id'),'span',item.get('span_id'),'parent',item.get('parent_span_id'),'enter',item.get('enter_events'),'terminal',item.get('terminal_events'))
    REPORTS.mkdir(parents=True,exist_ok=True)
    dest=REPORTS/'trace-integrity-latest.json'
    dest.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PRIMA TECHNICAL STATUS: NOT_INFERRED_FROM_TRACE_INTEGRITY')
    print('ANSWER QUALITY: NOT_EVALUATED')
    print('RESULT:',out['status'])
    print('REPORT:',dest.relative_to(ROOT))

if __name__=='__main__':main()
