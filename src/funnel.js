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


function commercialProgressScore(
  activeMemory
) {
  if (!Array.isArray(activeMemory)) {
    return 0;
  }

  const keys =
    new Set(
      activeMemory.map(
        item =>
          item?.fact_key
      )
    );

  let score = 0;

  if (
    keys.has("budget_min_aed") ||
    keys.has("budget_max_aed")
  ) {
    score += 1;
  }

  if (keys.has("buyer_goal")) {
    score += 1;
  }

  if (keys.has("bedrooms")) {
    score += 1;
  }

  if (keys.has("property_type")) {
    score += 1;
  }

  if (
    keys.has(
      "preferred_location_text"
    )
  ) {
    score += 1;
  }

  if (
    keys.has(
      "purchase_timeline_text"
    )
  ) {
    score += 1;
  }

  if (keys.has("financing")) {
    score += 1;
  }

  for (const item of activeMemory) {
    if (
      !String(
        item?.fact_key || ""
      ).startsWith(
        "project_decision:"
      )
    ) {
      continue;
    }

    const status =
      item
        ?.fact_value
        ?.status;

    if (status === "interested") {
      score += 1;
    }

    if (status === "shortlisted") {
      score += 2;
    }
  }

  return score;
}


function hasShortlist(
  activeMemory
) {
  return Array.isArray(activeMemory) &&
    activeMemory.some(
      item =>
        String(
          item?.fact_key || ""
        ).startsWith(
          "project_decision:"
        ) &&
        item
          ?.fact_value
          ?.status ===
            "shortlisted"
    );
}


export function hasImmediateCommercialSignal({
  message = "",
  route = null
} = {}) {
  const text =
    String(message).trim();

  if (
    route === "compare" ||
    route === "contact_intent"
  ) {
    return true;
  }

  return (
    /\bavailability\b|\bavailable\b/i
      .test(text) ||
    /\bpayment plan\b|\bterms\b/i
      .test(text) ||
    /\b(?:book|arrange|schedule)\s+(?:a\s+)?viewing\b/i
      .test(text) ||
    /\b(?:reserve|reservation)\b/i
      .test(text) ||
    /\bspecific unit\b/i
      .test(text) ||
    /\bshould i buy\b|\bworth buying\b|\bgood investment\b/i
      .test(text) ||
    /\binterested in buying\b|\bready to buy\b/i
      .test(text)
  );
}


function explicitHandoffRequest(
  message = ""
) {
  const text =
    String(message).trim();

  return (
    /\b(?:call|contact)\s+me\b/i
      .test(text) ||
    /\b(?:whatsapp)\s+me\b/i
      .test(text) ||
    /\b(?:speak|talk)\s+(?:to|with)\s+(?:an?\s+)?(?:advisor|agent|broker|specialist|someone)\b/i
      .test(text) ||
    /\b(?:book|arrange|schedule)\s+(?:a\s+)?viewing\b/i
      .test(text) ||
    /\b(?:i(?:'d| would)|we(?:'d| would))\s+like\s+(?:a\s+)?(?:call|consultation|viewing)\b/i
      .test(text)
  );
}


function acceptedPreviousOffer(
  message,
  previousState
) {
  if (
    previousState?.status !==
      "cta_offered"
  ) {
    return false;
  }

  return (
    /^(?:yes|yes please|sure|okay|ok|please do|absolutely|that would be helpful|sounds good)\b/i
      .test(
        String(message)
          .trim()
      )
  );
}


function declinedPreviousOffer(
  message,
  previousState
) {
  if (
    previousState?.status !==
      "cta_offered"
  ) {
    return false;
  }

  return (
    /^(?:not now|no thanks|no thank you|maybe later|not yet|i(?:'m| am) not ready)\b/i
      .test(
        String(message)
          .trim()
      )
  );
}


function candidateOffer({
  message,
  route,
  activeMemory,
  progressScore
}) {
  const text =
    String(message)
      .toLowerCase();

  if (
    /\bavailability\b|\bavailable\b/
      .test(text)
  ) {
    return {
      type:
        "availability_check",

      follow_up:
        "I can ask a Primadom specialist to check the latest availability for you. Would that be helpful?"
    };
  }

  if (
    /\bpayment plan\b|\bterms\b/
      .test(text)
  ) {
    return {
      type:
        "terms_check",

      follow_up:
        "I can ask a Primadom specialist to check the current terms for you. Would that be helpful?"
    };
  }

  if (
    route === "compare"
  ) {
    return {
      type:
        "comparison_consultation",

      follow_up:
        "Would you like to go through these options with a Primadom advisor?"
    };
  }

  if (
    /\bshould i buy\b|\bworth buying\b|\bgood investment\b|\binterested in buying\b|\bready to buy\b/i
      .test(text)
  ) {
    return {
      type:
        "project_consultation",

      follow_up:
        "Would you like me to connect you with a Primadom specialist to discuss this in more detail?"
    };
  }

  if (
    hasShortlist(
      activeMemory
    )
  ) {
    return {
      type:
        "shortlist_consultation",

      follow_up:
        "Would you like to go through these options with a Primadom advisor?"
    };
  }

  if (
    [
      "recommendation",
      "property_search",
      "compare",
      "follow_up"
    ].includes(route) &&
    progressScore >= 3
  ) {
    return {
      type:
        "detailed_consultation",

      follow_up:
        "If you’d like, I can arrange a more detailed consultation around your requirements."
    };
  }

  if (
    progressScore >= 5 &&
    route === "page_question"
  ) {
    return {
      type:
        "detailed_consultation",

      follow_up:
        "Would you like me to connect you with a Primadom specialist to discuss the next step?"
    };
  }

  return null;
}


function funnelFact(
  value
) {
  return {
    fact_key:
      "funnel_state",

    fact_value:
      value,

    confidence:
      0.99
  };
}


function emptyDecision() {
  return {
    response_type: null,
    answer_override: null,
    follow_up: null,
    lead_action: null,
    memory_facts: []
  };
}


export function evaluateFunnel({
  message = "",
  route = null,
  activeMemory = [],
  fullContext = false
} = {}) {
  /*
    CTA repetition rules require persistent
    conversation/client state.

    Stateless fact paths remain untouched
    for latency and deterministic answers.
  */
  if (!fullContext) {
    return emptyDecision();
  }

  const previousState =
    activeFactValue(
      activeMemory,
      "funnel_state"
    );

  const progressScore =
    commercialProgressScore(
      activeMemory
    );

  /*
    Explicit CTA rejection.
  */
  if (
    declinedPreviousOffer(
      message,
      previousState
    )
  ) {
    return {
      response_type:
        "answer",

      answer_override:
        "Of course. We can keep working through it here.",

      follow_up:
        null,

      lead_action:
        null,

      memory_facts: [
        funnelFact({
          status:
            "cta_declined",

          cta_type:
            previousState
              ?.cta_type ||
            null,

          progress_score:
            progressScore
        })
      ]
    };
  }

  /*
    Explicit handoff request OR acceptance
    of the immediately previous offer.
  */
  if (
    explicitHandoffRequest(
      message
    ) ||
    acceptedPreviousOffer(
      message,
      previousState
    )
  ) {
    return {
      response_type:
        "lead_transition",

      answer_override:
        "Sure — I can connect you with a Primadom specialist.",

      follow_up:
        "What’s the best phone number or WhatsApp to reach you on?",

      lead_action: {
        type:
          "request_contact",

        status:
          "awaiting_contact"
      },

      memory_facts: [
        funnelFact({
          status:
            "handoff_accepted",

          cta_type:
            previousState
              ?.cta_type ||
            "direct_contact",

          progress_score:
            progressScore
        })
      ]
    };
  }

  /*
    Once handoff is accepted, CTA logic stops.
    Contact capture is handled by the next
    Handoff/Contact layer.
  */
  if (
    previousState?.status ===
      "handoff_accepted"
  ) {
    return emptyDecision();
  }

  const offer =
    candidateOffer({
      message,
      route,
      activeMemory,
      progressScore
    });

  if (!offer) {
    return emptyDecision();
  }

  /*
    Ignored CTA is NOT rejection.
    Do not repeat until commercial progress
    has materially increased.
  */
  if (
    (
      previousState?.status ===
        "cta_offered" ||
      previousState?.status ===
        "cta_declined"
    ) &&
    progressScore <=
      Number(
        previousState
          ?.progress_score ??
        0
      )
  ) {
    return emptyDecision();
  }

  return {
    response_type:
      "answer",

    answer_override:
      null,

    follow_up:
      offer.follow_up,

    lead_action:
      null,

    memory_facts: [
      funnelFact({
        status:
          "cta_offered",

        cta_type:
          offer.type,

        progress_score:
          progressScore
      })
    ]
  };
}
