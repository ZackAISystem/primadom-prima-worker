# PRIMA — Full Pipeline Trace QA

## Purpose

Permanent, version-controlled QA framework for Prima AI.

Trace the path from user input through semantic interpretation,
conversation state, decision policy, tool execution and response.

## Primary development order

1. Validate the seven-file routing core.
2. Fix confirmed routing conflicts.
3. Validate and repair the answer layer.
4. Validate Search, Knowledge, Memory, Registry and Funnel.
5. Run full production E2E regression.

## Modes

- routing-only: semantic interpretation and final action
- execution: selected tool, evidence and executor outcome
- full-pipeline: complete path including generated response

## Critical invariants

- One authorized final next_action per turn.
- All distinct user tasks must be preserved.
- Router hints do not override validated Luna semantics.
- A search refinement preserves unchanged criteria.
- Memory recall does not trigger a fresh search.
- Search continuation does not redispatch Search.
- Contact requires verified explicit consent.
- An incorrect answer does not automatically mean routing failed.
- Missing instrumentation is NOT_TESTED, never PASS.
- A static dependency map is not a runtime call trace.

## Baselines

The architecture map is a historical source snapshot.
Regenerate and compare it after significant source changes.

## Safety

No secrets, contact details or raw full conversations in traces by default.
No live lead creation from automated QA.
No production deployment during test infrastructure setup.

## Current state

Foundation only. Runtime instrumentation and batch runner
must be implemented before executing semantic test suites.\n
## LIVE SOURCE ALWAYS — mandatory

Every QA run MUST execute current source files from the active working tree.
Never execute frozen copies, cached bundles, backups, or historical snapshots.

Before each run, capture the source SHA-256 manifest and Git state.
If source changes after the fingerprint, invalidate the run and restart.

For local Wrangler testing, restart/rebuild the Worker after source changes.
For remote QA Worker testing, verify deployed build identity before execution.
If build identity cannot be verified, report NOT_VERIFIED, never PASS.

Historical baselines are comparison artifacts only, never executable sources.
Use the existing Supabase data; do not clone the database for QA.
