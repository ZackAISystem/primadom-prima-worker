PRIMA R2.2 PHASE B1 — SERVER-OWNED MULTI-TASK CHECKPOINT

SOURCE BASIS: exact installed Phase A src/index.js from SHA-verified package.
DOES:
- Save compare+search task plan in existing server-owned pending_semantic_v12 record
  for the same turn, including when there are no new memory changes.
- Require an acknowledged guarded Supabase conversation checkpoint before
  the initial Search handoff; fail closed if it cannot be stored.
- Restore verified compound state on the same turn_id, turn_seq and validated
  matching SearchContext, without trusting a browser-supplied task plan.
- Emit QA checkpoints and return explicit partial completion status.
DOES NOT:
- Generate comparison paragraphs, rank candidate projects, or render new cards.
- Modify frontend EN/RU assets or Search V3.
- Make DB calls in installer/tests. No deployments.

INSTALL: unzip package into repo root, then
 python3 qa/full-pipeline/r22-phase-b1/install.py --check
 python3 qa/full-pipeline/r22-phase-b1/install.py --apply

It is NOT the full Phase B compare+cards feature. It is a safe prerequisite.
