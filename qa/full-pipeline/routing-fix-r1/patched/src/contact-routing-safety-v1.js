// PRIMA ROUTING QA FIX 01 — No new routing engine. This is a narrow
// human-contact authorization guard for informational/quoted requests.
// No persistence, no model calls, no side effects.
export function isInformationalContactInquiryV1(message = "") {
  const q = String(message || "").toLowerCase().replace(/[’]/g, "'").trim();
  if (!q || q.length > 2000) return false;
  const contactTopic = /\b(?:contact|callback|call|calling|phone|agent|advisor|adviser|broker|specialist|consultation|viewing|handoff)\b/.test(q);
  if (!contactTopic) return false;
  const asksMeaning = /\b(?:explain|meaning|means?|phrase|words?|asking for an explanation|asking for information|what information|what details|how can i|how do i|what does|what would|what is|what are)\b/.test(q);
  if (!asksMeaning) return false;
  // Explicitly informational / non-authorizing use of human-contact terms,
  // including instructions quoted as examples. Do not promote them to action.
  const noCurrentPermission = /\b(?:not giving|not granting|not providing|without)\s+(?:(?:you|your team|my)\s+)?(?:permission|consent|authorization)\b/.test(q) ||
    /\b(?:do not|don't|dont|never|not asking you to)\b[\s\S]{0,110}\b(?:arrange|schedule|book|contact|call|message|reach|collect|send|connect)\b/.test(q) ||
    /\b(?:do not|don't|dont|never|not asking you to)\b[\s\S]{0,110}\b(?:contact details|phone number|whatsapp|lead|agent|advisor)\b/.test(q) ||
    /\b(?:not permission|no permission|not consent|no consent|for information only|explanation only)\b/.test(q);
  const quotedInstruction = /\b(?:phrase|words?|wrote|quoted|quote)\b/.test(q) &&
    /["“”'][^"“”']{3,100}["“”']/.test(String(message || ""));
  return Boolean(noCurrentPermission || quotedInstruction);
}

export function deniesCurrentContactAuthorizationV1(message = "") {
  const q = String(message || "").toLowerCase().replace(/[’]/g, "'").trim();
  if (!q) return false;
  if (isInformationalContactInquiryV1(message)) return true;
  return /\b(?:not giving|not granting|not providing|without)\s+(?:(?:you|your team|my)\s+)?(?:permission|consent|authorization)\s+(?:to|for)\s+(?:contact|call|reach|message|email|phone|text)\b/.test(q) ||
    /\b(?:do not|don't|dont|never)\s+(?:contact|call|message|reach|email|phone|text)\s+me\b/.test(q);
}

// A geographic scope in a general informational question is not a unique
// project/developer to disambiguate. Exact facts and named projects are excluded.
export function isGeneralEmirateScopeV1({ message = "", route = "", entityName = "" } = {}) {
  if (!["market_question", "page_question"].includes(route)) return false;
  const place = String(entityName || "").toLowerCase().trim();
  const emirates = ["dubai", "abu dhabi", "sharjah", "ajman", "fujairah", "ras al khaimah", "umm al quwain"];
  if (!emirates.includes(place)) return false;
  const text = String(message || "").toLowerCase();
  const normalized = " " + text.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ") + " ";
  return ["in", "across", "throughout", "within"].some(
    preposition => normalized.includes(" " + preposition + " " + place + " ")
  );
}
