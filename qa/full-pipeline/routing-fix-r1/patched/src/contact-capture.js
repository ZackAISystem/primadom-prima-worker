import { parsePhoneNumberFromString } from "libphonenumber-js/max";

function activeFactValue(
  activeMemory,
  factKey
) {
  if (!Array.isArray(activeMemory)) {
    return null;
  }

  for (
    let i = activeMemory.length - 1;
    i >= 0;
    i--
  ) {
    if (
      activeMemory[i]?.fact_key === factKey
    ) {
      return (
        activeMemory[i]
          ?.fact_value ??
        null
      );
    }
  }

  return null;
}


function currentFunnelState(
  activeMemory,
  funnelDecision
) {
  const currentTurn =
    funnelDecision
      ?.memory_facts
      ?.find(
        item =>
          item?.fact_key ===
            "funnel_state"
      )
      ?.fact_value;

  return (
    currentTurn ||
    activeFactValue(
      activeMemory,
      "funnel_state"
    )
  );
}


function explicitContactChannel(
  message = ""
) {
  const text =
    String(message);

  if (
    /\bwhats\s*app\b|\bwhatsapp\b/i
      .test(text)
  ) {
    return "whatsapp";
  }

  if (
    /\bemail\b|\be-mail\b/i
      .test(text)
  ) {
    return "email";
  }

  if (
    /\bphone\b|\bcall me\b/i
      .test(text)
  ) {
    return "phone";
  }

  return null;
}


// This only enables the existing H validation path; it never bypasses
// phone/email parsing, opt-out rules, Memory persistence or Lead RPC.
export function hasExplicitVoluntaryContactCue(message = "") {
  const text = String(message || "");
  return /\b(?:my|here(?:'s| is)|this is my|you can reach me (?:at|on)|please (?:email|call|whatsapp) me (?:at|on))\b[\s\S]{0,65}\b(?:phone|whats\s*app|whatsapp|email|e-mail|number|address)\b/i.test(text) ||
    /\b(?:you can reach me|email me|whatsapp me)\s+(?:at|on)\b/i.test(text);
}

function hasContactCue(
  message = ""
) {
  return (
    /\b(phone|whats\s*app|whatsapp|number|email|e-mail|reach me|call me|contact me)\b/i
      .test(
        String(message)
      )
  );
}


// H32_GLOBAL_PHONE_NORMALIZATION_V1
// No country is inferred from property location or user IP.
function normalizePhoneCandidate(raw) {
  const compact = String(raw || "")
    .replace(/[\s().()-]/g, "");

  const digits = compact.replace(/\D/g, "");

  let international = null;

  if (compact.startsWith("+")) {
    international = `+${digits}`;
  } else if (compact.startsWith("00")) {
    international = `+${digits.slice(2)}`;
  } else if (
    /^\d{11,15}$/.test(compact) &&
    !compact.startsWith("0")
  ) {
    // Try an explicit calling-code prefix without '+'.
    // Accept only if international validation succeeds.
    international = `+${digits}`;
  }

  if (!international) return null;

  const internationalDigits = international.slice(1);

  if (
    internationalDigits.length < 8 ||
    internationalDigits.length > 15
  ) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(
      international
    );

    return parsed?.isValid()
      ? parsed.number
      : null;
  } catch {
    return null;
  }
}

function extractPhone(
  message,
  {
    allowBare = false,
    contactChannel = null
  } = {}
) {
  const text = String(message || "");

  // International prefixes, plus sign, brackets,
  // hyphens, spaces, or unprefixed digit sequences.
  const candidates = text.match(
    /(?:\+\s*|00\s*)\d[\d\s().-]{5,}\d|\b\d[\d\s().-]{8,}\d\b/g
  ) || [];

  for (const candidate of candidates) {
    const raw = candidate.trim();

    const explicitInternational =
      raw.startsWith("+") ||
      raw.startsWith("00");

    if (
      !explicitInternational &&
      !allowBare &&
      !hasContactCue(text)
    ) {
      continue;
    }

    const normalized =
      normalizePhoneCandidate(raw);

    if (normalized) {
      return { raw, normalized };
    }
  }

  return null;
}

function extractEmail(
  message
) {
  const text =
    String(message || "");

  const match =
    text.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/i
    );

  if (!match?.[0]) {
    return null;
  }

  return {
    raw:
      match[0],

    normalized:
      match[0]
        .trim()
        .toLowerCase()
  };
}


function isContactOnlyMessage(
  message,
  rawPhone,
  rawEmail
) {
  let text =
    String(message || "");

  if (rawPhone) {
    text =
      text.replace(
        rawPhone,
        " "
      );
  }

  if (rawEmail) {
    text =
      text.replace(
        rawEmail,
        " "
      );
  }

  text =
    text
      .replace(
        /\b(my|phone|whats\s*app|whatsapp|number|email|e-mail|is|at|on|reach|me|call|contact|please)\b/gi,
        " "
      )
      .replace(
        /[,:;.!?()+\-]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return text.length === 0;
}


function emptyDecision() {
  return {
    captured: false,
    response_type: null,
    answer_override: null,
    follow_up: null,
    lead_action: null,
    memory_facts: [],
    event_data: null
  };
}


export function evaluateContactCapture({
  message = "",
  activeMemory = [],
  currentFacts = [],
  funnelDecision = null
} = {}) {
  const funnelState =
    currentFunnelState(
      activeMemory,
      funnelDecision
    );

  const handoffAccepted =
    funnelState?.status ===
      "handoff_accepted";

  const phone =
    extractPhone(
      message,
      {
        allowBare:
          handoffAccepted,
        contactChannel:
          explicitContactChannel(message)
      }
    );

  const email =
    extractEmail(
      message
    );

  if (
    !phone &&
    !email
  ) {
    // H3_INVALID_CONTACT_CLARIFICATION_V1
    // A rejected number must not create a lead.
    const phoneAttempt =
      /(?:\+\s*\d[\d\s().()-]{3,}\d|\b00\d[\d\s().()-]{5,}\d\b|\b\d[\d\s().()-]{7,}\d\b)/
        .test(String(message));

    if (
      phoneAttempt &&
      (
        handoffAccepted ||
        hasContactCue(message)
      )
    ) {
      return {
        ...emptyDecision(),
        response_type: "answer",
        answer_override:
          "That number doesn't look valid for the contact method you chose. Could you check it and send the correct number with its country code? We can continue here in the meantime."
      };
    }

    return emptyDecision();
  }

  const explicitChannel =
    explicitContactChannel(
      message
    );

  const contactChannel =
    explicitChannel ||
    (
      phone
        ? "phone"
        : "email"
    );

  const source =
    handoffAccepted
      ? "accepted_handoff"
      : "voluntary_contact";

  const memoryFacts = [];

  if (phone) {
    memoryFacts.push({
      fact_key:
        "contact_phone",

      fact_value:
        phone.normalized,

      confidence:
        0.995
    });
  }

  if (email) {
    memoryFacts.push({
      fact_key:
        "contact_email",

      fact_value:
        email.normalized,

      confidence:
        0.995
    });
  }

  /*
    Preferred channel is stored only when
    the user actually stated it.
  */
  if (explicitChannel) {
    memoryFacts.push({
      fact_key:
        "preferred_contact_channel",

      fact_value:
        explicitChannel,

      confidence:
        0.99
    });
  }

  memoryFacts.push({
    fact_key:
      "funnel_state",

    fact_value: {
      status:
        "contact_captured",

      cta_type:
        funnelState
          ?.cta_type ||
        "voluntary_contact",

      progress_score:
        Number(
          funnelState
            ?.progress_score ??
          0
        ),

      contact_channel:
        contactChannel
    },

    confidence:
      0.995
  });

  // H33_PERSONAL_CONTACT_ACK_V1
  // Display original formatting; canonical memory stays unchanged.
  const rawName = activeFactValue(
    [...activeMemory, ...currentFacts],
    "user_name"
  );

  const name =
    typeof rawName === "string"
      ? rawName.trim()
      : "";

  const safeName =
    name.length <= 60 &&
    /^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)
      ? name
      : "";

  const contactDisplay =
    phone?.raw
      ? `your number as ${phone.raw.trim()}`
      : `your email address as ${String(email?.raw || email?.normalized || "").trim()}`;

  const contactAcknowledgement =
    `Thank you${safeName ? `, ${safeName}` : ""} — ` +
    `I’ve saved ${contactDisplay}. ` +
    "The Primadom team can follow up with you about the options we’ve discussed. " +
    "I’m here if you’d like to continue exploring.";

  const contactOnly =
    isContactOnlyMessage(
      message,
      phone?.raw,
      email?.raw
    );

  // A client may initiate the handoff in their FIRST message, with a name,
  // a contact and a requested viewing. This is a contact action, not a
  // request to compare or explain property facts. A real mixed information
  // question must still receive its factual answer.
  const directContactAction =
    /\b(?:please\s+)?(?:contact|call|whatsapp|email|message)\s+me\b/i.test(message) &&
    !/\b(?:what|which|why|how|are there|is there|compare|tell me about|explain)\b/i.test(message);
  const shouldAcknowledge = handoffAccepted || contactOnly || directContactAction;

  return {
    captured: true,

    response_type:
      "lead_transition",

    answer_override:
      (
        shouldAcknowledge
      )
        ? contactAcknowledgement
        : null,

    follow_up:
      (
        shouldAcknowledge
      )
        ? "Is there a convenient time for a Primadom specialist to reach you?"
        : null,

    lead_action: {
      type:
        "capture_lead",

      status:
        "contact_received",

      contact_channel:
        contactChannel
    },

    memory_facts:
      memoryFacts,

    /*
      Deliberately NO raw contact here.
      The canonical number lives in
      memory_facts only.
    */
    event_data: {
      has_contact:
        true,

      contact_channel:
        contactChannel,

      source
    }
  };
}
