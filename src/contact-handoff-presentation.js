// PRIMA H28 — presentation of an explicitly requested human handoff.
// Scoped to Contact Capture; never creates consent or changes G/Funnel policy.
function latestSafeName(currentFacts = [], activeMemory = []) {
  // Current-turn facts take precedence over a name from an earlier turn.
  const all = [...(Array.isArray(activeMemory) ? activeMemory : []),
               ...(Array.isArray(currentFacts) ? currentFacts : [])];
  for (let i = all.length - 1; i >= 0; i--) {
    const fact = all[i];
    if (fact?.fact_key !== "user_name") continue;
    const name = typeof fact.fact_value === "string" ? fact.fact_value.trim() : "";
    if (name.length > 0 && name.length <= 60 &&
        /^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name) &&
        name.split(/\s+/u).length <= 3) return name;
  }
  return null;
}

function requestedChannel(message = "") {
  const text = String(message || "").replaceAll("’", "'");
  // Never infer a channel from the mere presence of a word (e.g. "no email").
  const explicitEmail = /\b(?:email|e-mail)\s+only\b|\b(?:only|just|prefer|rather|via|by)\s+(?:\w+\s+){0,2}(?:email|e-mail)\b|\b(?:email|e-mail)\s+(?:please|instead)\b/i.test(text) &&
    !/\b(?:no|not|don't|do not)\s+(?:use\s+)?(?:email|e-mail)\b/i.test(text);
  const explicitWhatsApp = /\bwhats\s*app\s+only\b|\b(?:only|just|prefer|rather|via|by)\s+(?:whats\s*app|whatsapp)\b/i.test(text) &&
    !/\b(?:no|not|don't|do not)\s+(?:use\s+)?(?:whats\s*app|whatsapp)\b/i.test(text);
  const explicitPhone = /\b(?:phone|call)\s+only\b|\b(?:only|just|prefer|rather|via|by)\s+(?:phone|call)\b/i.test(text) &&
    !/\b(?:no|not|don't|do not)\s+(?:use\s+)?(?:phone|call)\b/i.test(text);
  if ([explicitEmail, explicitWhatsApp, explicitPhone].filter(Boolean).length !== 1) return null;
  return explicitEmail ? "email" : explicitWhatsApp ? "whatsapp" : "phone";
}

export function presentContactHandoffH28({
  message = "", route = "", consent = null, decision = null,
  activeMemory = [], currentFacts = [], preferredChannel = null
} = {}) {
  // Only the already-authorized direct-contact-intent path is eligible.
  // A model's route cannot grant consent. No changes to a proactive CTA.
  if (route !== "contact_intent" || !consent?.consent ||
      consent?.refusal || consent?.suppress || !consent?.explicitRequest ||
      decision?.response_type !== "lead_transition" ||
      decision?.lead_action?.type !== "request_contact" ||
      decision?.lead_action?.status !== "awaiting_contact") return decision;

  const channel = requestedChannel(message) || (
    ["email","whatsapp","phone"].includes(preferredChannel) ? preferredChannel : null
  ) || (
    /\b(?:email|e-mail)\s+only\b/i.test(String(message)) ? "email" : null
  );
  const name = latestSafeName(currentFacts, activeMemory);
  if (!channel && !name) return decision;

  const reason = /\b(?:viewing|view|visit|tour|showing)\b/i.test(String(message))
    ? "about the viewing you mentioned"
    : "about your enquiry";
  const answer = name
    ? `Of course, ${name} — I can help connect you with a Primadom specialist ${reason}.`
    : decision.answer_override;
  const followUp = channel === "email"
    ? "What email address would you like the Primadom team to use?"
    : channel === "whatsapp"
      ? "What WhatsApp number, including the country code, should our team use?"
      : channel === "phone"
        ? "What phone number, including the country code, should our team use?"
        : decision.follow_up;
  const memoryFacts = Array.isArray(decision.memory_facts) ? [...decision.memory_facts] : [];
  if (channel && !memoryFacts.some(f => f?.fact_key === "preferred_contact_channel")) {
    memoryFacts.push({fact_key:"preferred_contact_channel",fact_value:channel,confidence:0.99});
  }
  // No new lead action, no contact capture, no LLM, no PII in diagnostics.
  return {...decision, answer_override: answer, follow_up: followUp, memory_facts: memoryFacts};
}
