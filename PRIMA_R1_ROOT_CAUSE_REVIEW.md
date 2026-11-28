# PRIMA R1 — 10-case deep trace root-cause review

Source: uploaded `PRIMA_R1_REGRESSION_10_RESULTS.zip` on 2026-11-24.

## Confirmed call graph

| Cases | Final action | knowledge_plan | `resolveKnowledge` called | `emptyKnowledgePack` called | Final `generatePrimaAnswer` | Final source |
|---|---|---|---|---|---|---|
| S03 S14 S15 S16 S17 S26 S27 | KNOWLEDGE_QA | false | NO | YES | NO | `local` |
| S18 | ADVISORY | true | YES | NO | NO | `funnel` |
| S24 | KNOWLEDGE_QA | true | YES | NO | YES | `openai_composer` |
| S29 | ADVISORY | true | YES | NO | YES | `openai_composer` |

**Critical nuance:** the `knowledge_plan` checkpoint labels its stage
`src/knowledge.js:resolveKnowledge` even where that function is NOT called.
The function-level trace proves that seven cases instead execute
`src/index.js:emptyKnowledgePack`. Thus treating its stage label as a
function invocation would misdiagnose the failure.

## Source-level root cause

**Seven cases:** `src/tool-registry.js` maps `market_question` to zero tools
for market-live-data safety. In `src/index.js` the `needsKnowledge` check
therefore returns false; this creates `emptyKnowledgePack` and skips the
resolver. `src/local-responses.js:buildLocalRouteAnswer` returns the
unconditional market-wide statistical-data refusal for *all*
`market_question` requests. In `src/index.js`, `useOpenAI` requires
`!localAnswer`, so the local answer suppresses the existing final Composer.
The true failure is an answer-ownership/market-subtype conflation, **not**
a Luna or Supabase outage.

**S18:** `inspectPersonaContactConsentV1`'s `hasOtherTask` demands a small
set of property-related vocabulary, so `What can I research first?` is not
recognized as an independent question. Contact refusal is still correct,
and the Funnel's `answer_override` masks the actual informational task. R2 preserves the refusal memory state but lets a separate informational answer proceed.

## Residual route drift

The automatic `routing: PASS 10` covers the final action/safety expectation;
it does not certify every intermediate route. Raw route checkpoints:
- S14 and S26: `page_question` → executor `market_question`
- S18: `contact_intent` → executor `recommendation`
- S24: `property_search` → executor `page_question`
- S29: `persona_question` → executor `recommendation`
- S15 and S27: Luna's `primary_route=contact_intent` but final action
  is safely `KNOWLEDGE_QA`.

## Safe next gate

Apply R2 locally, run offline QA, then run the included R2-compatible 10-case live
regression, compare answer quality AND consent/non-search constraints.
Afterward test all 30 before broader 100-300-case runs. Do not mark this
as closed until end-to-end answers and grounding are reviewed.
