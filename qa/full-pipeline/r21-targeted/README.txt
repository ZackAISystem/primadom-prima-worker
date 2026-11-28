PRIMA R2.1 — TARGETED OFFLINE SAFE FIX

Scope:
1. S18: Independent ADVISORY/KNOWLEDGE_QA question retains answer ownership over non-authorized Funnel acknowledgement. Consent, lead guard, persisted refusal, and Funnel memory are unchanged.
2. S27: Existing positive informational-contact detector can validate KNOWLEDGE_QA after Luna unsupported ONLY with route=market_question and contactAuthorization=false. Unrelated unsupported requests still CLARIFY.
3. S29: QA report preserves all memory_facts network errors. If a later successful read of the same operation/method appears, classify Technical WARN (never silently PASS), otherwise FAIL. This is NOT a Supabase repair.

Install:
cd "$HOME/zack-ai/zack-factory/primadom-prima-worker" || exit 1
unzip -o "$HOME/Downloads/PRIMA_R2_1_TARGETED_FIX_OFFLINE_SAFE.zip"
python3 qa/full-pipeline/r21-targeted/install.py --check
python3 qa/full-pipeline/r21-targeted/install.py --apply

NO LIVE TEST AUTOMATICALLY EXECUTED. Run regression deliberately only after local gate.
Old trailing whitespace in src/index.js:2008 remains unchanged.
