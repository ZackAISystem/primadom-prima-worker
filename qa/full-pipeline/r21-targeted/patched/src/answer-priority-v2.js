/*
  PRIMA ANSWER PRIORITY V2 — final answer ownership, not a second Router.
  Existing Luna/DecisionPolicy, Search, Contact and evidence permissions
  remain unchanged. This module cannot authorize user contact or live claims.
*/

export function shouldDeferMarketFallbackToComposerV2({
  route = null,
  action = null
} = {}) {
  return route === "market_question" &&
    (action === "KNOWLEDGE_QA" || action === "ADVISORY");
}

// Preserve a clearly separate WH-question even when the user also refuses
// contact. Refusal is still written to state by the original P0 Funnel path.
// An opt-out alone, or a short confirmation like "okay?", is not another task.
export function hasIndependentInformationalQuestionV2(message = "") {
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text.includes("?")) return false;
  return /(?:^|[.!?;,]\s*|\b(?:but|and)\s+)(?:what|which|how|why|where|when|who)\b[^?!\n]{2,300}\?/iu
    .test(text);
}

// A Funnel refusal acknowledgement can be stored without replacing the
// answer to a separate question. Do not change contact permission or memory.
export function shouldPrioritizeIndependentAnswerOverFunnelV2({
  hasOtherTask = false,
  consent = false,
  action = null,
  decision = null
} = {}) {
  if (!hasOtherTask || consent || !decision?.answer_override ||
      decision?.lead_action ||
      !["KNOWLEDGE_QA", "ADVISORY"].includes(action)) return false;
  // The independent task, existing consent gate, and prohibition on lead
  // actions are the authorization boundaries. A Funnel state shape is not
  // proof that a distinct question should be discarded. Preserve all memory
  // facts and follow-up metadata; only release answer ownership.
  return true;
}
