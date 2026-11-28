// PRIMA ROUTING QA FIX 01 — No new routing engine. This is a narrow
// human-contact authorization guard for informational/quoted requests.
// No persistence, no model calls, no side effects.
// P0-QA-100: An instruction to prepare a handoff is not permission to send it.
// Keep this distinct from declining only a particular communication channel.
export function isDeferredContactSubmissionV1(message = "") {
  const q = String(message || "").toLowerCase().replace(/[’]/g, "'").trim();
  if (!q || q.length > 2000) return false;
  return /\b(?:do not|don't|dont|never|please not|not to)\s+(?:yet\s+)?(?:send|submit|forward|share|dispatch|pass along|create)\b[^.!?\n]{0,100}\b(?:anything|it|request|lead|details|information|contact|number|form|approval)\b/i.test(q) ||
    /\b(?:do not|don't|dont|never)\s+(?:send|submit|forward|share|create)\b[^.!?\n]{0,110}\buntil\b/i.test(q) ||
    /\b(?:wait|hold off|pause)\b[^.!?\n]{0,80}\b(?:sending|submitting|forwarding|sharing|creating)\b/i.test(q);
}

export function isInformationalContactInquiryV1(message = "") {
  const q = String(message || "").toLowerCase().replace(/[’]/g, "'").trim();
  if (!q || q.length > 2000) return false;
  // FIX07B: asking about sharing a phone number is informational,
  // never a current authorization to capture contact details.
  const privacyQuestion =
    /\b(?:website|site|form|agent|broker)\b[\s\S]{0,100}\b(?:asks?|requests?)\s+for\s+(?:my|your)\s+(?:phone\s+)?number\b/i.test(q) &&
    /\b(?:what questions|what should|before providing|before sharing|how can)\b/i.test(q);
  if (privacyQuestion) return true;

  const contactTopic = /\b(?:contact|callback|call|calling|phone|agent|advisor|adviser|broker|specialist|consultation|viewing|handoff|lead|consent)\b/.test(q);
  if (!contactTopic) return false;
  const asksMeaning = /\b(?:explain|meaning|means?|phrase|words?|asking for an explanation|asking for information|what information|what details|how can i|how do i|how would i|what does|what would|what is|what are)\b/.test(q);
  // Conditional/future questions describe a potential action; they do not
  // authorize a handoff in the current turn. Restrict this to a question or
  // explicit educational framing, so a real affirmative request still works.
  const futureHypothetical = /\b(?:hypothetically|if i (?:ever|wanted|were to)|if we (?:ever|wanted|were to)|i (?:might|may|could|would) (?:ask|request) (?:for )?(?:a )?(?:call|callback|contact) later)\b/.test(q) &&
    (q.includes("?") || asksMeaning);
  const explicitNoCurrentContact = /\b(?:no|without)\s+(?:(?:phone|agent|advisor|specialist)\s+)?(?:calls?|callbacks?|contact|messages?|emails?|outreach)\s+(?:now|today|yet|at the moment|for now)\b/.test(q) ||
    /\b(?:no|not)\s+(?:callback|contact|call|message|outreach)\s+(?:now|today|yet|at the moment|for now)\b/.test(q);
  // Quoting a request to explain/reject it must never authorize that request.
  const quotedNegatedRequest = /\b(?:i|we)\s+(?:did\s+not|didn't|never)\s+(?:say|ask|request|authorize|consent\s+to)\b[\s\S]{0,95}\b(?:call|contact|callback|phone|message|agent|advisor|specialist)\b/.test(q) ||
    /\b(?:i|we)\s+(?:asked|meant)\s+(?:what|how|why)\b[\s\S]{0,100}\b(?:call|contact|callback|agent|advisor|specialist)\b/.test(q);
  const noCurrentPermission = /\b(?:not giving|not granting|not providing|without)\s+(?:(?:you|your team|my)\s+)?(?:permission|consent|authorization)\b/.test(q) ||
    /\b(?:do not|don't|dont|never|not asking you to)\b[\s\S]{0,110}\b(?:arrange|schedule|book|contact|call|message|reach|collect|send|connect)\b/.test(q) ||
    /\b(?:do not|don't|dont|never|not asking you to)\b[\s\S]{0,110}\b(?:contact details|phone number|whatsapp|lead|agent|advisor)\b/.test(q) ||
    /\b(?:not permission|no permission|not consent|no consent|for information only|explanation only)\b/.test(q);
  const quotedInstruction = /\b(?:phrase|words?|wrote|quoted|quote|brochure|pasted|marketing instruction|my friend wrote|says)\b/.test(q) &&
    /["“”'][^"“”']{3,180}["“”']/.test(String(message || ""));
  // A question about obeying quoted material is a request for analysis,
  // never a live instruction from the user.  The quote may contain "contact me".
  const quotedMetaQuestion = quotedInstruction &&
    /\b(?:should|would|could|can|must|do|does)\s+(?:you|prima|the assistant)\s+(?:ever\s+)?(?:obey|follow|execute|act on|comply with|ignore)\b[^?\n]{0,100}\b(?:quoted|quote|text|instruction|message|ad|brochure|it)\b/i.test(q);
  const quotedOnly = quotedInstruction &&
    /\b(?:not requesting|not asking|do not execute|don't execute|explain|what does|what do|what does it imply|what does this mean|rather than)\b/.test(q);
  const futureProcess = /\bif i (?:decide|choose|want|wanted|later|eventually)\b[\s\S]{0,120}\b(?:viewing|contact|call|book)\b/.test(q) &&
    /\b(?:what|how|would|need)\b/.test(q);
  const thirdPartyCall = /\b(?:my friend|a friend|someone else|third party)\b[\s\S]{0,120}\b(?:received a call|wrote|called)\b/.test(q) &&
    /\b(?:not requesting|not asking|discussing|explain|meaning)\b/.test(q);
  return Boolean(quotedMetaQuestion || quotedOnly || futureProcess || thirdPartyCall || quotedNegatedRequest || (asksMeaning || futureHypothetical) &&
    (noCurrentPermission || quotedInstruction || futureHypothetical || explicitNoCurrentContact));
}

export function deniesCurrentContactAuthorizationV1(message = "") {
  const q = String(message || "").toLowerCase().replace(/[’]/g, "'").trim();
  if (!q) return false;
  if (isDeferredContactSubmissionV1(message)) return true;
  if (isInformationalContactInquiryV1(message)) return true;
  // Standalone refusals and restricted outreach do not require a separate
  // explanation question. Never treat these as consent to begin contact.
  if (/\b(?:no (?:sales )?calls|no contact(?: please)?|do not create a lead|don't create a lead|withdraw (?:my|our) (?:earlier )?(?:consent|interest)|not requesting (?:one|a call)|not relevant)\b/i.test(q) &&
      /\b(?:calls?|contact|lead|phone|number|consent|interest)\b/i.test(q)) return true;
  // An explicit current refusal overrides speculative future interest.
  if (/\b(?:no|without)\s+(?:(?:phone|agent|advisor|specialist)\s+)?(?:calls?|callbacks?|contact|messages?|emails?|outreach)\s+(?:now|today|yet|at the moment|for now)\b/.test(q)) return true;
  if (/\b(?:do\s+not|don't|dont|never)\s+want\s+(?:any\s+)?(?:calls?|messages?|texts?|emails?|contact)\b/i.test(q) ||
      /\b(?:no|without)\s+(?:calls?|messages?|texts?|emails?)\s+(?:or\s+(?:calls?|messages?|texts?|emails?)\s+)?(?:now|today|at\s+the\s+moment|for\s+now)\b/i.test(q)) return true;
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
