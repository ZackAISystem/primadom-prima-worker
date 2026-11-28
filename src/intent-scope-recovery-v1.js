// PRIMA FIX07 — Intent Scope Recovery V1.
// Information about a command is not execution of that command.
// This helper cannot authorize Contact, Search or verified facts.

export function classifyIntentScopeRecoveryV1({
  message = "",
  route = null,
  semanticRoute = null,
  planned = null,
  confidence = 0,
  contactAuthorization = false
} = {}) {
  const text = String(message || "").replaceAll("’", "'").trim();
  if (!text || text.length > 1200) return false;
  if (Number(confidence) < 0.70) return false;
  if (contactAuthorization === true) return false;

  const directContact =
    /\b(?:please|can you|could you)\s+(?:call me|contact me|arrange a call|have an agent call me|ask an agent to call me)\b/i.test(text);

  if (directContact) return false;

  // A quoted commercial command is the subject of a question,
  // not permission to execute that command.
  const quotedCommercialLanguage =
    /["“”'][^"“”']*\b(?:send me offers|contact agent|call agent|request callback)\b[^"“”']*["“”']/i.test(text);

  const explicitQuotation =
    /\b(?:quoting|quoted|quote|phrase|words|not an instruction|what does it mean)\b/i.test(text);

  const quotedMeaning =
    quotedCommercialLanguage &&
    explicitQuotation &&
    /\b(?:what does|what do|mean|explain|meaning)\b/i.test(text);

  // Data-sharing questions are informational, not a contact request.
  const contactDataSafety =
    /\b(?:website|site|agent|broker|form)\b/i.test(text) &&
    /\b(?:asks?|requests?|requires?|wants?)\b/i.test(text) &&
    /\b(?:my|your)\s+(?:phone\s+)?number\b/i.test(text) &&
    /\b(?:before|what questions|what should|how can)\b/i.test(text);

  // Property verification requires identification, not OFF_TOPIC.
  const registrationVerification =
    /\b(?:property|apartment|villa|home|unit)\b/i.test(text) &&
    /\b(?:legally registered|legal registration|registered legally|registration status)\b/i.test(text) &&
    /\b(?:without|no|missing|not provided|not supplied)\b/i.test(text) &&
    /\b(?:identifier|property id|reference number|identification)\b/i.test(text);

  const unsupportedKnowledge =
    route === "unsupported" &&
    semanticRoute === "unsupported" &&
    planned === "KNOWLEDGE_QA" &&
    (quotedMeaning || contactDataSafety || registrationVerification);

  // An instruction to ignore a quoted contact phrase must not
  // cancel the user's independent question about registration.
  const explainRegistration =
    /\b(?:explain|describe|tell me about)\s+(?:purchase\s+)?registration\b/i.test(text);

  const quotedContactExample =
    quotedCommercialLanguage ||
    /\b(?:ignore|quoted|quote|phrase)\b[\s\S]{0,70}\b(?:contact agent|call agent)\b/i.test(text);

  const registrationKnowledge =
    route === "market_question" &&
    semanticRoute === "market_question" &&
    planned === "CLARIFY" &&
    explainRegistration &&
    quotedContactExample;

  return unsupportedKnowledge || registrationKnowledge;
}
