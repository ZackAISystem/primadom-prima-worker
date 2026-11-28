// PRIMA FIX06B — Missing Target Clarification V1.
// Applies only when Decision Policy has already selected CLARIFY.
// Never resolves an entity, invents a fact, or authorizes contact/search.

export function buildMissingTargetClarificationV1({
  message = "",
  action = null
} = {}) {
  if (action !== "CLARIFY") return null;

  const text = String(message || "").trim();
  if (!text || text.length > 1500) return null;

  const missingTarget =
    /\bunnamed\b/i.test(text) ||
    /\b(?:have|has)\s+not\s+(?:said|specified|supplied|identified)\b/i.test(text) ||
    /\bnot\s+(?:specified|supplied|identified)\b/i.test(text) ||
    /\bwithout\s+(?:a|an|the|its)\s+(?:property\s+)?(?:name|address|identifier)\b/i.test(text);

  if (!missingTarget) return null;

  if (/\b(?:schools?|closest school|nearest school)\b/i.test(text) &&
      /\b(?:home|property|address)\b/i.test(text)) {
    return "Which property or address do you mean? I need its location before I can identify nearby schools reliably.";
  }

  if (/\bdeveloper\b/i.test(text) &&
      /\b(?:delays?|track record|delivery history)\b/i.test(text)) {
    return "Which developer do you mean? I need its name before checking project delivery history or delay claims.";
  }

  if (/\bhandover\b/i.test(text) &&
      /\b(?:date|latest|verified|confirmed)\b/i.test(text)) {
    return "Which specific project do you mean? I need the project name to check its latest verified handover date.";
  }

  if (/\b(?:price|AED)\b/i.test(text) &&
      /\b(?:project|villa|apartment|property)\b/i.test(text)) {
    return "Which specific project or property do you mean? A current AED price requires an identified property and a verified, up-to-date source.";
  }

  if (/\b(?:exact number|single exact number)\b/i.test(text) &&
      /\b(?:villa|apartment|property)\b/i.test(text)) {
    return "Which specific property do you mean, and which exact figure would you like verified? I cannot provide a reliable number without those details.";
  }

  return null;
}
