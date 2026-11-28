PRIMA — ANSWER PIPELINE R2 (LOCAL SAFE PATCH)
Basis: 10-case R1 regression, 2026-11-24.

Confirmed trace diagnosis:
- S03/S14/S15/S16/S17/S26/S27: final action KNOWLEDGE_QA,
  but src/index.js resolves emptyKnowledgePack, no resolveKnowledge call,
  no final generatePrimaAnswer call, src/local-responses.js returns the
  broad market_question live-statistics deflection.
- S18: final action ADVISORY, but contact refusal wins as Funnel answer
  and masks the independent informational question.
- S24/S29: final Composer called and gave plausibly relevant answers;
  factual accuracy not audited.

Minimal architecture repair:
1) The existing DecisionPolicy-approved KNOWLEDGE_QA / ADVISORY action
   may reach the one existing Composer on market_question, rather than
   being swallowed by a generic local market-statistics template.
2) An independent informational WH-question survives the existing
   contact-refusal acknowledgement, including an override from the Funnel.
   Refusal status still persists in Memory; no new Contact permission.

What the patch DOES NOT do:
- No second Router, new search, new LLM call, DB or schema rewrite.
- No change to R1 contact consent, Search V3, tool registry, Knowledge
  retrieval, grounding rules or production deployment.
- No claim that generated answers will pass until real re-test.
- It does not directly repair raw Router misclassifications.

Install in primadom-prima-worker repo:
  unzip -o "$HOME/Downloads/PRIMA_ANSWER_PIPELINE_R2_SAFE_FIX.zip"
  python3 qa/full-pipeline/answer-fix-r2/install.py --check
  python3 qa/full-pipeline/answer-fix-r2/install.py --apply
  git diff --check

The --apply step runs ONLY local offline unit tests and backs up src/index.js.
If SHA does not match source R1, it aborts WITHOUT editing anything.
Before live QA, verify composer factual constraints and consent.
Then use the previous 10-case regression runner and inspect full responses.

Conservative note: Routing PASS in the 10-case test measures final action,
not the correctness of intermediate Router routes (e.g. S18 contact_intent).

R2 FULL-PATH REGRESSION — after installing R2 locally:
  python3 qa/full-pipeline/runners/prima-r2-answer-regression-10.py
  python3 qa/full-pipeline/runners/prima-r2-answer-regression-10.py --live-db
  zip -j "$HOME/Desktop/PRIMA_R2_ANSWER_REGRESSION_10_RESULTS.zip" \
    qa/full-pipeline/reports/prima-r2-answer-regression-10-full-path.json \
    qa/full-pipeline/reports/prima-r2-answer-regression-10-full-path.md
  unzip -tq "$HOME/Desktop/PRIMA_R2_ANSWER_REGRESSION_10_RESULTS.zip"

The new R2 runner leaves the R1 runner, scenario set, R1 report, and 30
baseline unchanged. It compares R2 answers directly to the R1 report,
checks R1+R2 source hashes, and requires --live-db for live tests.
"