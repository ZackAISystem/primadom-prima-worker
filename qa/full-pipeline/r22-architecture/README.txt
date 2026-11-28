PRIMA R2.2 PHASE A — SAFE ARCHITECTURAL PATCH (OFFLINE)

Source: latest 5-file + 9-file Mac ZIPs received 2026-11-24.
Changes: src/index.js, src/decision-policy.js, src/entity-resolver.js,
         NEW src/task-plan-v1.js
No other source file is touched.

What this package DOES:
- Builds a typed task plan from already interpreted semantic tasks.
- Authorizes mixed COMPARE+SEARCH initial dispatch only when Luna's typed
  task plan contains both tasks and validates; explicit no-search prevents it.
- Reuses existing project Search V3 builder and permission gate. No new search.
- Distinguishes a singleton property-type concept from mandatory named-entity
  failure during an informational KNOWLEDGE_QA; keeps named-fact gates.
- Records safe QA task-plan/initial-dispatch checkpoints, with comparison
  explicitly marked pending in tool-response metadata.
- Preserves CONTACT consent gate, initial/continuation search boundary.

What this package DOES NOT yet establish:
- Completing the comparison text and project/district/developer cards on
  Search V3 tool_continuation in the browser.
- Persistent task-plan checkpoint independent of the browser payload.
- Fixes for knowledge_registry_v1 HTTP 500 or incomplete async trace.
- Resolution of S18 Persona/Funnel or all 30 live scenarios.

INSTALL (after downloading the ZIP to ~/Downloads):
 cd "$HOME/zack-ai/zack-factory/primadom-prima-worker" || exit 1
 unzip -oq "$HOME/Downloads/PRIMA_R2_2_PHASE_A_OFFLINE_SAFE.zip"
 python3 qa/full-pipeline/r22-architecture/install.py --check
 python3 qa/full-pipeline/r22-architecture/install.py --apply

BOTH --check and --apply are SHA-gated. Backups are in ~/Downloads/.
--apply runs only offline syntax and behavioral unit assertions; no deploy.
If any install check fails, the script restores original sources automatically.

NEXT: Test search continuation + verified comparison cards with actual UI
contract, then inspect Supabase failures and function trace. Do not claim
R2.2 is fully complete or run a full live 30 until those gates are closed.
