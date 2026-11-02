// H34 — Narrow explicit self-introduction with an affirmative contact request.
// No model call, contact authorization, lead creation, or general Memory change.
// This only supplies a name fact when the user explicitly introduces themself.
export function extractH34FirstTurnContactNameFact(message = "") {
  const text = String(message ?? "").trim();
  if (!text || text.length > 1200) return null;
  const match = /^(?:(?:hi|hello|hey)\s*[,!:.\-]?\s*)?i(?:['’]m|\s+am)\s+([\p{L}][\p{L}\p{M}'’-]{1,39})(?=\s*[,;.!?]|\s*$)/iu.exec(text);
  if (!match) return null;
  const name = match[1];
  // Explicitly exclude phrases that describe a state or goal, not a name.
  if (/^(?:looking|interested|ready|here|trying|thinking|planning|hoping|waiting|calling|asking|wondering|not|sorry|unable|sure|just|happy|curious|currently)$/i.test(name)) return null;
  const affirmative = /\b(?:please|could|would|can|ask|need|want)\b/i.test(text);
  const direct = /\b(?:contact|email|call|message|reach|whatsapp)\s+me\b/i.test(text);
  const refusal = /\b(?:don't|do\s+not|never|stop)\s+(?:contact|email|call|message|reach|whatsapp)\s+me\b/i.test(text);
  if (!affirmative || !direct || refusal) return null;
  return {
    fact_key: "user_name",
    fact_value: name,
    confidence: 0.98,
    source: "h34_explicit_first_person_contact_intro"
  };
}
