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
    /\bphone\b|\bcall me\b/i
      .test(text)
  ) {
    return "phone";
  }

  return null;
}


function hasContactCue(
  message = ""
) {
  return (
    /\b(phone|whats\s*app|whatsapp|number|reach me|call me|contact me)\b/i
      .test(
        String(message)
      )
  );
}


function normalizePhoneCandidate(
  raw
) {
  const source =
    String(raw || "")
      .trim();

  const digits =
    source.replace(
      /\D/g,
      ""
    );

  if (
    digits.length < 8 ||
    digits.length > 15
  ) {
    return null;
  }

  if (
    source.startsWith("+")
  ) {
    return `+${digits}`;
  }

  return digits;
}


function extractPhone(
  message,
  {
    allowBare = false
  } = {}
) {
  const text =
    String(message || "");

  const candidates =
    text.match(
      /(?:\+\d[\d\s().-]{6,}\d|\b0\d[\d\s().-]{7,}\d\b)/g
    ) || [];

  for (const candidate of candidates) {
    const normalized =
      normalizePhoneCandidate(
        candidate
      );

    if (!normalized) {
      continue;
    }

    if (
      candidate
        .trim()
        .startsWith("+")
    ) {
      return {
        raw:
          candidate,
        normalized
      };
    }

    if (
      allowBare ||
      hasContactCue(text)
    ) {
      return {
        raw:
          candidate,
        normalized
      };
    }
  }

  /*
    After an accepted handoff, a user may
    reply with digits only.
  */
  if (allowBare) {
    const digitsOnly =
      text.match(
        /^\s*(\d[\d\s().-]{6,}\d)\s*$/
      );

    if (digitsOnly?.[1]) {
      const normalized =
        normalizePhoneCandidate(
          digitsOnly[1]
        );

      if (normalized) {
        return {
          raw:
            digitsOnly[1],
          normalized
        };
      }
    }
  }

  return null;
}


function isContactOnlyMessage(
  message,
  rawPhone
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

  text =
    text
      .replace(
        /\b(my|phone|whats\s*app|whatsapp|number|is|at|on|reach|me|call|contact|please)\b/gi,
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
          handoffAccepted
      }
    );

  if (!phone) {
    return emptyDecision();
  }

  const explicitChannel =
    explicitContactChannel(
      message
    );

  const contactChannel =
    explicitChannel ||
    "phone";

  const source =
    handoffAccepted
      ? "accepted_handoff"
      : "voluntary_contact";

  const memoryFacts = [
    {
      fact_key:
        "contact_phone",

      fact_value:
        phone.normalized,

      confidence:
        0.995
    }
  ];

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

  const contactOnly =
    isContactOnlyMessage(
      message,
      phone.raw
    );

  return {
    captured: true,

    response_type:
      "lead_transition",

    answer_override:
      (
        handoffAccepted ||
        contactOnly
      )
        ? "Thank you — I’ve got it."
        : null,

    follow_up:
      (
        handoffAccepted ||
        contactOnly
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
      Deliberately NO raw phone here.
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
