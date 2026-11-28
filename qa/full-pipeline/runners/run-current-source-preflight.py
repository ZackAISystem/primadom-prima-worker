#!/usr/bin/env python3
"""Local live-source Worker preflight: no Supabase writes, no OpenAI calls."""
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'qa/full-pipeline/reports'
QA_CONFIG = ROOT / 'wrangler.qa.jsonc'
FINGERPRINT = ROOT / 'qa/full-pipeline/runners/source-fingerprint.py'
ROUTER = ROOT / 'tests/router-regression-p1.mjs'
LOADER = ROOT / 'qa/full-pipeline/runners/esm-loader.mjs'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'

def digest():
    proc = subprocess.run([sys.executable, str(FINGERPRINT)], cwd=ROOT, text=True, capture_output=True, check=True)
    return json.loads(proc.stdout)

def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1',0))
        return s.getsockname()[1]

def main():
    for f in (QA_CONFIG, FINGERPRINT, ROUTER, LOADER, WRANGLER):
        if not f.is_file():
            raise RuntimeError(f'MISSING_REQUIRED_FILE: {f.relative_to(ROOT)}')
    cfg = json.loads(strip_json_comments(QA_CONFIG.read_text()))
    if cfg.get('main') != 'src/index.js' or cfg.get('name') == 'primadom-prima-worker-live':
        raise RuntimeError('INVALID_QA_CONFIGURATION')
    before = digest()
    print('CURRENT SOURCE SHA256:', before['source_sha256'])
    print('SOURCE FILES:', before['source_count'])
    print('QA WORKER CONFIG:', QA_CONFIG.relative_to(ROOT))
    print('MODE: LOCAL / NO DEPLOY / HEALTH ONLY')
    router = subprocess.run(['node','--experimental-loader',str(LOADER),str(ROUTER)], cwd=ROOT, text=True, capture_output=True, timeout=60)
    print('ROUTER REGRESSION:', 'PASS' if router.returncode == 0 else 'FAIL')
    print((router.stdout or router.stderr)[-3200:])
    port = free_port()
    url = f'http://127.0.0.1:{port}/api/prima/health'
    cmd = [str(WRANGLER),'dev','--config',str(QA_CONFIG),'--local','--ip','127.0.0.1','--port',str(port)]
    health = None
    process = None
    error = None
    try:
        process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(70):
            if process.poll() is not None:
                error = f'WRANGLER_EXITED_{process.returncode}'
                break
            try:
                with urllib.request.urlopen(url, timeout=1) as response:
                    health = json.load(response)
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
                time.sleep(0.35)
        if health is None and error is None:
            error = 'LOCAL_WORKER_HEALTH_TIMEOUT'
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
    after = digest()
    unchanged = before['source_sha256'] == after['source_sha256']
    ok = router.returncode == 0 and isinstance(health,dict) and health.get('ok') is True and unchanged
    result = {
        'test': 'PRIMA_LIVE_SOURCE_LOCAL_WORKER_PREFLIGHT_V1',
        'time_utc':datetime.now(timezone.utc).isoformat(),
        'source_sha256':before['source_sha256'],
        'source_unchanged':unchanged,
        'git_commit':before.get('git_commit'),
        'git_branch':before.get('git_branch'),
        'router_regression':'PASS' if router.returncode == 0 else 'FAIL',
        'worker_health':'PASS' if isinstance(health,dict) and health.get('ok') is True else 'FAIL',
        'health_service':health.get('service') if isinstance(health,dict) else None,
        'supabase_configured':health.get('supabase_configured') if isinstance(health,dict) else None,
        'full_dialogue_test':'NOT_TESTED',
        'openai_calls':0,
        'supabase_writes_by_test':0,
        'deploys':0,
        'error':error,
        'status':'PASS' if ok else 'FAIL'
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    target = REPORTS/'current-source-preflight-latest.json'
    target.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print('WORKER HEALTH:',result['worker_health'])
    print('LIVE SOURCE UNCHANGED:',unchanged)
    print('E2E DIALOGUES:',result['full_dialogue_test'])
    print('REPORT:',target.relative_to(ROOT))
    print('FINAL:',result['status'])
    return 0 if ok else 1

def strip_json_comments(s):
    # Wrangler's jsonc config may use comments and trailing commas.
    import re
    s = re.sub(r'/\*.*?\*/|^\s*//[^\n]*$', '', s, flags=re.M|re.S)
    s = re.sub(r',\s*([}\]])',r'\1',s)
    return s

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('PREFLIGHT BLOCKED:',type(exc).__name__,str(exc)[:250],file=sys.stderr)
        sys.exit(2)
