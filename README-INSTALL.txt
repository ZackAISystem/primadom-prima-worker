PRIMA Full Pipeline QA — LIVE SOURCE LOCAL WORKER PREFLIGHT V1

Install to existing primadom-prima-worker repo, preserving all current files.
Only adds qa/full-pipeline/runners/run-current-source-preflight.py.
Run: python3 qa/full-pipeline/runners/run-current-source-preflight.py

Performs real protected router regression and starts actual current-src/index.js
using local Wrangler qa config, GET /api/prima/health, shuts Wrangler down.
Checks SHA256 before/after, saves report in qa/full-pipeline/reports.

No conversation is started, no Supabase writes, no real Luna calls, no deployment.
This is infrastructure verification; full E2E remains NOT_TESTED.

For full E2E, a separately verified data-write isolation and CRM/lead block is
required. Existing .dev.vars might contain production Supabase credentials.
