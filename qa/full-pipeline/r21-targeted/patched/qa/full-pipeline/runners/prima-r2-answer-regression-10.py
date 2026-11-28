#!/usr/bin/env python3
"""PRIMA R2 — after answer-priority patch, 10-case full-path regression.
No code edits, no deployment, no mock AI. --live-db enables TEN new persistent
synthetic conversations in the user's configured database (NO automatic cleanup).
Reports separate routing, answer relevance HEURISTICS and technical reliability.
"""
import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import json
import os
import queue
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
QA = ROOT / 'qa/full-pipeline'
RUNNER = QA / 'runners/run-function-trace-batch.py'
BUILD = QA / 'instrumentation/build-live-function-trace.cjs'
FINGER = QA / 'runners/source-fingerprint.py'
CONFIG = ROOT / 'wrangler.function-trace.local.jsonc'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'
CASES = QA / 'scenarios/prima-r1-full-path-regression-10.json'
REPORTS = QA / 'reports'
R1_MANIFEST = QA / 'routing-fix-r1/manifest.json'
R2_MANIFEST = QA / 'answer-fix-r2/manifest.json'
R1_RESULTS = REPORTS / 'prima-r1-regression-10-full-path.json'
BASELINE = QA / 'scenarios/prima-r1-regression-baseline.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_fingerprint():
    cp = subprocess.run([sys.executable, str(FINGER)], cwd=ROOT,
                        text=True, capture_output=True, check=True)
    return json.loads(cp.stdout)['source_sha256']


def check_r2_and_deps():
    required = [RUNNER, BUILD, FINGER, CONFIG, WRANGLER, R1_MANIFEST, R2_MANIFEST, R1_RESULTS, CASES,
                BASELINE, ROOT / 'src/index.js']
    missing = [str(p) for p in required if not p.is_file()]
    if missing:
        raise RuntimeError('REQUIRED_FILES_MISSING: ' + ', '.join(missing))
    r1 = json.loads(R1_MANIFEST.read_text(encoding='utf8'))
    r2 = json.loads(R2_MANIFEST.read_text(encoding='utf8'))
    r21_path = QA / 'r21-targeted/manifest.json'
    r21 = json.loads(r21_path.read_text(encoding='utf8')) if r21_path.exists() else {}
    r21_files = r21.get('files', {})
    bad = []
    # Keep R1 safety and routing sources fixed, except index.js which R2
    # intentionally replaces. Never accept unknown local source drift.
    for rel, obj in r1['changed_files'].items():
        if rel == 'src/index.js' or rel in r21_files:
            continue
        p = ROOT / rel
        if not p.exists() or sha(p) != obj['patched_sha256']:
            bad.append(rel)
    for rel, expected in r1['new_files'].items():
        p = ROOT / rel
        if not p.exists() or sha(p) != expected:
            bad.append(rel)
    for rel, obj in r2['changed_files'].items():
        p = ROOT / rel
        expected = r21_files.get(rel, {}).get('after_sha256', obj['patched_sha256'])
        if not p.exists() or sha(p) != expected:
            bad.append(rel)
    for rel, original_expected in r2['new_files'].items():
        p = ROOT / rel
        expected = r21_files.get(rel, {}).get('after_sha256', original_expected)
        if not p.exists() or sha(p) != expected:
            bad.append(rel)
    for rel, hashes in r21_files.items():
        p = ROOT / rel
        if not p.exists() or sha(p) != hashes['after_sha256']:
            bad.append(rel)
    if bad:
        raise RuntimeError('R2_HASH_MISMATCH_NO_REQUESTS_SENT: ' + ', '.join(sorted(set(bad))) +
                           '. Verify R1 plus the approved R2 answer patch.')
    print('R2.1 SOURCE HASH PREFLIGHT: PASS (R1+R2 preserved + R2.1 verified)', flush=True)
    spec = importlib.util.spec_from_file_location('prima_trace_runner', RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in ('post', 'event_parse', 'summarize_turn', 'collect_async_trace_logs'):
        if not callable(getattr(mod, name, None)):
            raise RuntimeError('REQUIRED_TRACE_METHOD_MISSING: ' + name)
    return mod


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def regex_any(patterns, text):
    return any(re.search(pattern, text, flags=re.I) for pattern in patterns)


def semantic_heuristic(case, answer, response_type):
    """Conservative reviewer triage; NEVER a factual-accuracy or semantic PASS."""
    if not isinstance(answer, str) or not answer.strip():
        return {'status': 'NOT_VERIFIED', 'reason': 'No textual answer captured',
                'factual_accuracy': 'NOT_EVALUATED'}
    generic = [
        r"outside my UAE property specialty",
        r"found more than one match for Dubai",
        r"don't have verified live Dubai-wide market figures",
        r"won.t suggest contacting a Primadom specialist again unless you ask",
        r"cannot help with that request",
    ]
    if regex_any(generic, answer):
        return {'status': 'FAIL_GENERIC_DEFLECTION',
                'reason': 'Known nonresponsive template from the prior 30-case baseline',
                'factual_accuracy': 'NOT_EVALUATED'}
    if response_type == 'clarification':
        return {'status': 'REVIEW', 'reason': 'Clarification instead of requested explanation',
                'factual_accuracy': 'NOT_EVALUATED'}
    patterns = case['relevance_signals']
    present = [label for label, rules in patterns.items() if regex_any(rules, answer)]
    missing = [label for label in patterns if label not in present]
    if len(present) >= case['min_relevance_signals']:
        status = 'LIKELY_RELEVANT_REVIEW_FACTS'
    else:
        status = 'REVIEW'
    return {'status': status, 'signals_present': present, 'signals_missing': missing,
            'reason': 'Keyword signals are a triage aid, NOT a semantic or factual-accuracy certification',
            'factual_accuracy': 'NOT_EVALUATED'}


def assess(case, actual, response, baseline):
    policy = actual.get('policy') or {}
    luna = actual.get('luna') or {}
    action = policy.get('final_action') or actual.get('action')
    route = luna.get('primary_route') or actual.get('route')
    events = actual.get('events') or []
    stages = {e.get('stage') for e in events}
    tool = isinstance(response, dict) and (response.get('response_type') == 'tool_request' or
                                          response.get('version') == 'PrimaToolRequestV1')
    search_dispatched = 'search_dispatch' in stages or tool
    forbidden_contact = action == 'CONTACT'
    allowed = case['expected_actions']
    route_status = ('NOT_VERIFIED' if action is None else
                    'FAIL' if action not in allowed or forbidden_contact or search_dispatched else 'PASS')
    route_details = {
        'status': route_status,
        'recognized_route': route,
        'luna_action': luna.get('next_action'),
        'policy_action': policy.get('final_action'),
        'policy_reason': policy.get('reason'),
        'allowed_actions': allowed,
        'contact_not_authorized': not forbidden_contact,
        'search_not_requested': not search_dispatched,
        'luna_policy_drift': (luna.get('next_action') != policy.get('final_action')
                              if luna.get('next_action') and policy.get('final_action') else None),
    }
    answer = (response.get('answer') if isinstance(response, dict) and isinstance(response.get('answer'), str)
              else actual.get('answer') or '')
    quality = semantic_heuristic(case, answer, actual.get('response_type'))
    async_info = actual.get('async_trace_collection') or {}
    db_errors = [op for op in actual.get('db_operations', [])
                 if isinstance(op.get('status'), int) and op['status'] >= 400 or
                 op.get('status') == 'network_error']
    lead_ops = [op for op in actual.get('db_operations', [])
                if 'lead' in str(op.get('operation') or '').lower()]
    # A later successful read of the same resource makes a network failure
    # recoverable for this turn, but never deletes the original error evidence.
    operations = actual.get('db_operations', [])
    recovered_db_errors = []
    unresolved_db_errors = []
    for error in db_errors:
        try:
            position = next(i for i, op in enumerate(operations) if op is error)
        except StopIteration:
            position = -1
        recovered = position >= 0 and error.get('status') == 'network_error' and any(
            later.get('operation') == error.get('operation') and
            later.get('method') == error.get('method') and
            isinstance(later.get('status'), int) and 200 <= later['status'] < 300
            for later in operations[position + 1:]
        )
        (recovered_db_errors if recovered else unresolved_db_errors).append(error)
    trace = actual.get('function_trace') or {}
    tech = {
        'http_status': actual.get('http_status'),
        'async_status': async_info.get('status'),
        'span_entries': trace.get('entry_events'),
        'span_exits': trace.get('exit_events'),
        'span_errors': trace.get('error_events'),
        'span_pairs_verified': trace.get('span_pairs_verified'),
        'db_errors': db_errors,
        'recovered_db_errors': recovered_db_errors,
        'unresolved_db_errors': unresolved_db_errors,
        'lead_related_db_operations': lead_ops,
        'status': ('FAIL' if actual.get('http_status') != 200 or unresolved_db_errors or lead_ops else
                   'REVIEW' if async_info.get('status') != 'COMPLETE' or trace.get('span_pairs_verified') is not True
                   else 'WARN' if recovered_db_errors else 'PASS'),
    }
    old = baseline.get(case['id'], {})
    regression = {
        'old_policy_action': old.get('policy_action'),
        'new_policy_action': policy.get('final_action'),
        'old_answer': old.get('answer'),
        'new_answer': answer,
        'old_async_status': old.get('async_status'),
        'old_internal_error': old.get('first_observed_error'),
        'new_internal_error': actual.get('first_observed_error'),
        'old_http_ms': old.get('http_ms'),
    }
    signals = []
    if forbidden_contact: signals.append('UNAUTHORIZED_CONTACT_ACTION')
    if lead_ops: signals.append('LEAD_RELATED_DB_OPERATION_REVIEW')
    if search_dispatched: signals.append('UNEXPECTED_SEARCH_DISPATCH')
    if route_status == 'FAIL' and not forbidden_contact and not search_dispatched:
        signals.append('WRONG_FINAL_ACTION')
    if quality['status'] == 'FAIL_GENERIC_DEFLECTION':
        signals.append('NONRESPONSIVE_TEMPLATE')
    if quality['status'] == 'REVIEW':
        signals.append('ANSWER_RELEVANCE_REVIEW')
    if tech['async_status'] != 'COMPLETE': signals.append('ASYNC_INCOMPLETE')
    for op in db_errors: signals.append('DB_HTTP_ERROR:' + str(op.get('operation')))
    if tech['span_pairs_verified'] is not True: signals.append('SPAN_PAIRS_NOT_VERIFIED')
    return {'routing': route_details, 'answer': quality, 'technical': tech,
            'before_after': regression, 'error_signatures': signals}


def write_report(data):
    REPORTS.mkdir(exist_ok=True, parents=True)
    js = REPORTS / 'prima-r2-answer-regression-10-full-path.json'
    md = REPORTS / 'prima-r2-answer-regression-10-full-path.md'
    js.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    out = [
        '# PRIMA — Answer Priority R2 / 10-case full-path regression', '',
        f"Timestamp (UTC): {data['created_at']}",
        f"Source SHA256: `{data.get('source_sha256_before')}`",
        f"Cases executed: **{len(data['scenarios'])}/10**", '',
        '**Interpretation:** Routing results, answer relevance triage and technical reliability are SEPARATE. '
        'LIKELY_RELEVANT_REVIEW_FACTS is never proof of factual correctness. Initial turn only; no Search V3 continuation.', '',
        '| Case | Routing | Answer relevance | Technical | HTTP ms | Total trace ms | Luna → Policy |',
        '|---|---|---|---|---:|---:|---|',
    ]
    for item in data['scenarios']:
        v = item.get('verification') or {}
        rt = v.get('routing') or {}
        a = v.get('answer') or {}
        t = v.get('technical') or {}
        lat = item.get('latency_ms') or {}
        old = v.get('before_after') or {}
        out.append('| {id} | {r} | {a} | {t} | {hm} | {tm} | {luna} → {policy} |'.format(
            id=item['id'], r=rt.get('status', item.get('status', 'NOT_RUN')),
            a=a.get('status', 'NOT_VERIFIED'), t=t.get('status', 'NOT_VERIFIED'),
            hm=lat.get('message_http', '—'), tm=lat.get('message_plus_async_trace_collection', '—'),
            luna=rt.get('luna_action', '—'), policy=rt.get('policy_action', '—')))
    out.extend(['', '## Repeated error signatures', ''])
    for x in data.get('repeated_errors') or []:
        out.append(f"- `{x['signature']}` — {x['count']} cases ({', '.join(x['cases'])})")
    out.extend(['', '## Per-case evidence', ''])
    for item in data['scenarios']:
        v = item.get('verification') or {}
        out.append('### ' + item['id'] + ' — ' + item['category'])
        out.append('**Input:** ' + item['message'])
        out.append('**Old answer:** ' + str((v.get('before_after') or {}).get('old_answer') or '(not captured)'))
        out.append('**New answer:** ' + str(item.get('response_answer_captured') or '(not captured)'))
        if not item.get('answer_capture_full'):
            out.append('**Capture limit:** text came from the existing trace summary; may be truncated at 2,500 chars.')
        out.append('**Errors:** ' + ', '.join(v.get('error_signatures') or ['none observed']))
        out.append('')
    out.extend(['## Boundaries', '',
                '- Each case is a fresh conversation with ONE initial user message.',
                '- Existing 30-case baseline is read-only, R1 runtime uses actual Worker and Luna.',
                '- No source files are modified and nothing is deployed.',
                '- Live database mode writes synthetic conversations; no automatic deletion.',
                '- The presence of DB operations in a trace does not prove their full side effects.',
                '- Search V3 / browser bridge and answer fact-checking are outside this regression.'])
    md.write_text('\n'.join(out) + '\n', encoding='utf8')
    print('JSON:', js.relative_to(ROOT), flush=True)
    print('MARKDOWN:', md.relative_to(ROOT), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live-db', action='store_true')
    args = p.parse_args()
    cases = json.loads(CASES.read_text(encoding='utf8'))['scenarios']
    if len(cases) != 10 or len({c['id'] for c in cases}) != 10:
        raise RuntimeError('EXACTLY_TEN_UNIQUE_SCENARIOS_REQUIRED')
    mod = check_r2_and_deps()
    # Compare against the ACTUAL immediately preceding R1 run, not only
    # the original 30-case baseline. Existing R1 report stays untouched.
    r1_results = json.loads(R1_RESULTS.read_text(encoding='utf8'))
    baseline = {
        item['id']: {
            'policy_action': (item.get('actual') or {}).get('policy', {}).get('final_action'),
            'answer': item.get('response_answer_captured'),
            'async_status': (item.get('actual') or {}).get('async_trace_collection', {}).get('status'),
            'first_observed_error': (item.get('actual') or {}).get('first_observed_error'),
            'http_ms': (item.get('latency_ms') or {}).get('message_http')
        }
        for item in r1_results.get('scenarios', [])
    }
    if set(baseline) != {case['id'] for case in cases}:
        raise RuntimeError('R1_RESULTS_INCOMPLETE_OR_MISMATCH_NO_REQUESTS_SENT')
    if not args.live_db:
        print('PREFLIGHT PASS. SAFE STOP: add --live-db to run 10 real Worker turns and create 10 persistent QA conversations.')
        print('NO LUNA CALLS / DB WRITES / DEPLOYS.')
        return 0
    before = source_fingerprint()
    print('SOURCE BEFORE:', before, flush=True)
    subprocess.run(['node', str(BUILD)], cwd=ROOT, check=True)
    port = free_port()
    base = f'http://127.0.0.1:{port}'
    command = [str(WRANGLER), 'dev', '--config', str(CONFIG), '--local', '--ip', '127.0.0.1', '--port', str(port),
               '--var', 'PRIMA_QA_RUNTIME_TRACE:1', '--var', 'PRIMA_QA_FUNCTION_TRACE:1',
               '--var', 'PRIMA_TURN_TRACE:1', '--var', 'PRIMA_PERSONA_GENERATIVE_A1:1',
               '--var', 'PRIMA_SEARCH_PRODUCTION:1']
    proc = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1, start_new_session=True)
    q = queue.Queue()
    watcher = threading.Thread(target=lambda: [q.put(line.rstrip('\n')) for line in proc.stdout], daemon=True)
    watcher.start()
    data = {'contract': 'PRIMA_R2_ANSWER_REGRESSION_10_FULL_PATH',
            'created_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            'status': 'IN_PROGRESS', 'source_sha256_before': before,
            'scope': 'TEN_FRESH_CONVERSATIONS_SINGLE_INITIAL_MESSAGE',
            'production_deploy': False,
            'live_db_writes': 'TEN_SYNTHETIC_CONVERSATIONS_NO_AUTOMATIC_CLEANUP',
            'factual_answer_accuracy': 'NOT_EVALUATED',
            'search_v3_continuation': 'NOT_TESTED',
            'scenarios': []}
    error = None
    try:
        import urllib.request
        for _ in range(80):
            if proc.poll() is not None:
                raise RuntimeError('LOCAL_WRANGLER_EXITED')
            try:
                with urllib.request.urlopen(base + '/api/prima/health', timeout=0.75) as f:
                    health = json.loads(f.read())
                if health.get('ok') and health.get('supabase_configured'):
                    break
            except Exception:
                time.sleep(.35)
        else:
            raise RuntimeError('WORKER_NOT_READY')
        page = {'language_code': 'en', 'url_path': '/en/__qa__/prima-r2-answer-regression/',
                'canonical_url_path': '/en/__qa__/prima-r2-answer-regression/'}
        for index, case in enumerate(cases, 1):
            if source_fingerprint() != before:
                raise RuntimeError('SOURCE_CHANGED_DURING_BATCH')
            print(f'[{index:02}/10] {case["id"]} {case["category"]}: {case["message"]}', flush=True)
            start_ns = time.perf_counter_ns()
            sc, started = mod.post(base, '/api/prima/conversation/start',
                                   {'initiator': 'user', 'visitor_id': None, 'session_id': None, 'page': page})
            start_ms = round((time.perf_counter_ns() - start_ns) / 1e6, 2)
            conv = started.get('conversation') if isinstance(started, dict) else None
            cid = conv.get('conversation_id') if isinstance(conv, dict) else None
            token = started.get('conversation_access_token') if isinstance(started, dict) else None
            item = {'id': case['id'], 'category': case['category'], 'message': case['message'],
                    'conversation_id': cid, 'conversation_start_ms': start_ms}
            if sc not in (200, 201) or not cid or not token:
                item['status'] = 'CONVERSATION_START_FAIL'
                item['conversation_start_http'] = sc
                data['scenarios'].append(item)
                print('  CONVERSATION_START_FAIL HTTP', sc, flush=True)
                continue
            while not q.empty():
                q.get_nowait()
            tid = str(uuid.uuid4())
            item['turn_id'] = tid
            start_ns = time.perf_counter_ns()
            status, response = mod.post(base, '/api/prima/message',
                                        {'conversation_id': cid, 'user': {'message': case['message']},
                                         'page': page, 'turn': {'version': 'ConversationTurnV1',
                                                               'turn_id': tid, 'turn_seq': 1, 'phase': 'initial'}},
                                        token)
            http_ms = round((time.perf_counter_ns() - start_ns) / 1e6, 2)
            lines, async_info = mod.collect_async_trace_logs(q)
            total_ms = round((time.perf_counter_ns() - start_ns) / 1e6, 2)
            events = [mod.event_parse(line) for line in lines]
            events = [ev for ev in events if isinstance(ev, dict)]
            info = mod.summarize_turn(case['message'], status, response, events)
            info['async_trace_collection'] = async_info
            has_full_answer = isinstance(response, dict) and isinstance(response.get('answer'), str)
            answer = response.get('answer') if has_full_answer else info.get('answer')
            item.update({'latency_ms': {'message_http': http_ms,
                                        'message_plus_async_trace_collection': total_ms},
                         'actual': info,
                         'response_type': response.get('response_type') if isinstance(response, dict) else None,
                         'response_answer_full': answer if has_full_answer else None,
                         'response_answer_captured': answer,
                         'answer_capture_full': has_full_answer,
                         'response_contract': {k: response[k] for k in
                                               ('version', 'response_type', 'route', 'action', 'next_action')
                                               if isinstance(response, dict) and k in response}})
            item['verification'] = assess(case, info, response, baseline)
            data['scenarios'].append(item)
            v = item['verification']
            print(f"  ROUTE={v['routing']['status']} ANSWER={v['answer']['status']} "
                  f"TECH={v['technical']['status']} | Luna={v['routing']['luna_action']} "
                  f"Policy={v['routing']['policy_action']} | HTTP={http_ms}ms "
                  f"TRACE={total_ms}ms EVENTS={len(events)}", flush=True)
    except Exception as exc:
        error = type(exc).__name__ + ': ' + str(exc)[:500]
        print('ERROR:', error, file=sys.stderr)
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=6)
        watcher.join(timeout=1)
        after = source_fingerprint()
        data['source_sha256_after'] = after
        data['source_unchanged'] = before == after
        signatures = collections.defaultdict(list)
        for item in data['scenarios']:
            for x in (item.get('verification') or {}).get('error_signatures') or []:
                signatures[x].append(item['id'])
        data['repeated_errors'] = [{'signature': key, 'count': len(ids), 'cases': ids}
                                   for key, ids in sorted(signatures.items()) if len(ids) > 1]
        data['counts'] = {
            'routing': dict(collections.Counter(x.get('verification', {}).get('routing', {}).get('status', 'NOT_VERIFIED')
                                                for x in data['scenarios'])),
            'answer_relevance': dict(collections.Counter(x.get('verification', {}).get('answer', {}).get('status', 'NOT_VERIFIED')
                                                         for x in data['scenarios'])),
            'technical': dict(collections.Counter(x.get('verification', {}).get('technical', {}).get('status', 'NOT_VERIFIED')
                                                  for x in data['scenarios'])),
        }
        data['status'] = ('ERROR' if error or before != after or len(data['scenarios']) != 10
                          else 'RECORDED_WITH_FINDINGS')
        if error:
            data['error'] = error
        write_report(data)
        print('\n===== PRIMA R1 REGRESSION 10 — FULL PATH =====', flush=True)
        print('COUNTS:', data['counts'], flush=True)
        print('SOURCE UNCHANGED:', data['source_unchanged'], flush=True)
        print('RESULT:', data['status'], flush=True)
    return 2 if data['status'] == 'ERROR' else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('BLOCKED:', type(exc).__name__, str(exc)[:600], file=sys.stderr)
        sys.exit(2)
