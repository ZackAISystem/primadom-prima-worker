PRIMA R2.2 PHASE B2 - VERIFIED COMPARE + PROJECT CARDS

Scope: an already server-checkpointed and SearchContextV1-validated COMPARE+SEARCH
continuation may use the EXISTING Answer Composer to provide comparison text.
Its existing Search V3 project cards and pagination are preserved unchanged.
Server binds the original user message to the pending comparison via SHA-256.
No contact, new search, frontend changes or production deploy.

Safeguards:
- Source hashes must match installed Phase B1 exactly; otherwise SAFE STOP.
- Old index.js backed up into ~/Downloads; new helper removal is tracked.
- Node ESM check and offline assertions, with automatic rollback.
- Verified project identities are whitelisted against the existing search context.
- If comparison draft fails, original Search cards remain; metadata says pending.
- Model-generated comparison is flagged NOT independently fact-verified.

Limits:
- Supports verified project Search V3 continuation, not all standalone
  district/developer compare UI flows.
- Cannot prove quality or source accuracy from offline assertions.
- Backend synthesis adds a Composer call to affected mixed continuations.
- QA real continuation run remains needed after installation.

Install (Mac, after downloading to ~/Downloads):
  cd ~/zack-ai/zack-factory/primadom-prima-worker
  unzip -oq ~/Downloads/PRIMA_R2_2_PHASE_B2_COMPARISON_ASSEMBLY_OFFLINE_SAFE.zip
  python3 qa/full-pipeline/r22-phase-b2/install.py --check
  python3 qa/full-pipeline/r22-phase-b2/install.py --apply
