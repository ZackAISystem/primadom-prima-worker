// H29 — confirmed direct human-contact request from the user's own message.
// An explicit request to reach the client is separate from channel preferences.
// This is a narrow authorization signal, not a replacement for Router/Persona.
// No DB, no OpenAI, no project identity inference.
function clean(message) {
  return String(message ?? "").replace(/[\u2018\u2019]/g, "'").trim();
}

export function inspectDirectContactH29(message = "") {
  const text = clean(message);
  const empty = { direct_request: false, preferred_channel: null, introduced_name: null };
  if (!text || text.length > 2000) return empty;

  // An explicit prohibition on contact is never authorization. A prohibition
  // on PHONE calls alone is a channel restriction, not a general opt-out.
  const noContact = /\b(?:do\s+not|don't|dont|never|stop)\s+(?:(?:ask|have|tell)\s+(?:anyone|someone|your\s+team)\s+to\s+)?(?:contact|reach)\s+me\b|\bno\s+contact\b/i.test(text);
  if (noContact) return empty;

  const request = /\b(?:please|kindly|could|would|can|will|may|ask|have|let|i\s+(?:want|need|wish)|i(?:'d|\s+would)\s+(?:like|prefer))\b/i.test(text);
  const human = /\b(?:someone|anyone|representative|person|agent|advisor|adviser|specialist|broker|colleague|staff|team|office)\b/i.test(text);
  const outreach = /\b(?:email|e-mail|contact|reach(?:\s+out)?|get\s+in\s+touch|message|text|whatsapp|call|phone|get\s+back|follow\s+up|write)\b/i.test(text);
  const directed = /\b(?:me|myself)\b/i.test(text);
  // A request such as "Could your team email me?" is about contact with the
  // user, unlike "Could you explain what the email button does?".
  const recipientOfOutreach = /\b(?:email|e-mail|contact|message|text|whatsapp|call|phone|reach(?:\s+out\s+to)?|write\s+to)\s+me\b|\b(?:get\s+in\s+touch|follow\s+up|get\s+back)\s+(?:with|to)\s+me\b|\bgive\s+me\s+a\s+call\b/i.test(text);
  const direct = request && human && outreach && directed && recipientOfOutreach &&
    !/^\s*(?:how|why|what|when|where)\b/i.test(text);
  if (!direct) return empty;

  // Negative request on this same communication act must never be promoted.
  if (/\b(?:please\s+)?(?:don't|do\s+not|never)\s+(?:ask|have|tell|let|request|send)\b[\s\S]{0,95}\b(?:contact|email|message|call|reach)\s+me\b/i.test(text) ||
      /\bplease\s+not\s+(?:ask|have|tell|let)\b[\s\S]{0,95}\b(?:contact|email|message|call|reach)\s+me\b/i.test(text)) return empty;

  // Respect an explicit channel; the noun "email" by itself is not enough.
  const email = /\b(?:email|e-mail)\s+me\b|\b(?:email|e-mail)\s+only\b|\b(?:by|via|through|prefer|just|only)\s+(?:an?\s+)?(?:email|e-mail)\b/i.test(text);
  const whatsapp = /\bwhats\s*app\s+me\b|\bwhats\s*app\s+only\b|\b(?:by|via|through|prefer|just|only)\s+whats\s*app\b/i.test(text);
  const phone = /\b(?:call|phone)\s+me\b|\b(?:phone|call)\s+only\b|\b(?:by|via|through|prefer|just|only)\s+(?:phone|call)\b/i.test(text) &&
    !/\b(?:no|without|avoid)\s+(?:phone\s+)?calls?\b|\bdon't\s+call\s+me\b/i.test(text);
  const channels = [email && "email", whatsapp && "whatsapp", phone && "phone"].filter(Boolean);
  const preferred_channel = channels.length === 1 ? channels[0] : null;

  // Only the recognized, explicit self-introduction grammar is admitted.
  // This is not a generic named-entity extractor.
  const nameMatch = /\bthis\s+is\s+([\p{L}][\p{L}\p{M}'’-]{1,39})(?=\s*[,;.!?]|\s*$)/iu.exec(text);
  const introduced_name = nameMatch ? nameMatch[1] : null;
  return { direct_request: true, preferred_channel, introduced_name };
}


// H30 — preserve a verified first-person name across a second memory extraction.
// The conversation onboarding pass can re-extract facts with expectingName=true,
// replacing the earlier H29 direct-contact name. This adapter is intentionally
// narrow: no contact routing, no consent changes, no database or LLM calls.
export function retainDirectContactNameH30(facts = [], directContact = null) {
  const result = Array.isArray(facts) ? facts : [];
  if (!directContact?.direct_request || !directContact?.introduced_name) {
    return result;
  }
  return [
    ...result.filter(fact => fact?.fact_key !== "user_name"),
    {
      fact_key: "user_name",
      fact_value: directContact.introduced_name,
      confidence: 0.98,
      source: "h29_explicit_self_introduction"
    }
  ];
}
