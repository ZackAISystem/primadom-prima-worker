#!/usr/bin/env python3
"""Install R2.24.29 QA-only builder, refuse unknown current builder versions."""
from pathlib import Path
import hashlib,sys
root=Path(__file__).resolve().parents[3]
target=root/'qa/full-pipeline/instrumentation/build-live-function-trace.cjs'
patch=Path(__file__).with_name('build-live-function-trace-r22429.cjs.txt')
expected='f25074543aba9979053b616b4f3fb3569286cda00ee0b63ad560bdf89c7e4231'
if not target.is_file() or not patch.is_file():raise SystemExit('BLOCKED: missing QA builder or patch')
current=target.read_bytes()
if hashlib.sha256(current).hexdigest()!=expected:
 if current==patch.read_bytes():print('R2.24.29 ALREADY INSTALLED');sys.exit(0)
 raise SystemExit('BLOCKED: QA builder differs from known R2.24.20 baseline; no files changed. Provide latest builder to merge safely.')
backup=target.with_suffix('.cjs.bak-r22420')
backup.write_bytes(current)
target.write_bytes(patch.read_bytes())
print('R2.24.29 QA BUILDER INSTALLED')
print('BACKUP:',backup.relative_to(root))
print('WORKER src/: UNCHANGED | DEPLOY: NONE | DB: NONE')
