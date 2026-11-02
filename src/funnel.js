import { decideCommercialNextStepV1 } from "./commercial-decision.js";
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
  route = null,
  fastGate = null
} = {}) {
  const text =
    String(message).trim();

  if (explicitContactOptOut(text)) {
    return true;
  }

  if (
    Array.isArray(fastGate?.exact_facts) &&
    fastGate.exact_facts.some(fact =>
      fact === "availability" ||
      fact === "payment_plan"
    )
  ) {
    return true;
  }

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



/*
  G2_CONTEXTUAL_CTA_POLICY_V1
  Explicit contact opt-out overrides positive contact intent.
*/
export function explicitContactOptOut(message = "") {
  const text = String(message)
    .trim()
    .toLowerCase()
    .replaceAll("’", "'");

  return (
    // A durable ban on unsolicited advisor offers is not a ban on one channel.
    /\b(?:don't|dont|do not|never|stop)\b[\s\S]{0,55}\b(?:offer|suggest|propose|bring up)\b[\s\S]{0,55}\b(?:advisor|adviser|agent|specialist|office|team|contact|call|phone|whatsapp|handoff)\b/.test(text) ||
    /\b(?:don't|dont|do not|never)\s+(?:(?:offer|suggest|ask)\s+(?:me\s+)?(?:to\s+)?(?:contact(?:ing)?|call|message|text|whatsapp|speak|talk|connect)\b|(?:contact|call|message|text|whatsapp)\s+me\b)/.test(text) ||
    /\b(?:stop|no more)\s+(?:contacting\s+me|calling\s+me|(?:offering|suggesting|asking)\b.*\b(?:advisor|specialist|contact|call|consultation)|(?:calls|messages|contact|advisor offers)\b)/.test(text) ||
    /\b(?:don't|dont|do not)\s+want\s+(?:you\s+)?to\s+(?:call|contact|message|text)\s+me\b/.test(text)
  );
}

export function explicitHandoffRequest(
  message = ""
) {
  const text =
    String(message).trim();

  return (
    /\b(?:call|contact)\s+me\b/i
      .test(text) ||
    /\b(?:whatsapp)\s+me\b/i
      .test(text) ||
    /\b(?:i(?:'d| would)|we(?:'d| would))\s+like\s+to\s+(?:speak|talk)\s+(?:with|to)\s+(?:(?:a|an|your|the)\s+)?(?:primadom\s+)?(?:team|office|specialist|advisor|adviser|agent)\b/i
      .test(text) ||
    /\b(?:please\s+)?(?:connect|put)\s+me\s+(?:with|in touch with)\s+(?:(?:your|the|a|an)\s+)?(?:primadom\s+)?(?:team|office|specialist|advisor|adviser|agent)\b/i
      .test(text) ||
    /\b(?:please\s+)?(?:arrange|request|ask|have)\s+(?:for\s+)?(?:(?:your|the|a|an)\s+)?(?:primadom\s+)?(?:team|office|specialist|advisor|adviser|agent|someone)\s+(?:to\s+)?(?:contact|reach|email|message|call)\s+me\b/i
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


/*
  G35_CANONICAL_COMMERCIAL_FACT_BRIDGE_V1

  Reuse canonical requested_facts produced by the
  existing RequestInterpreterV1.

  No new model, no second interpretation call.
  Do not infer commercial intent from topics alone.
*/
function hasCanonicalCommercialFact(
  interpretation,
  fact
) {
  if (
    interpretation?.version !== "RequestInterpreterV1" ||
    !Number.isFinite(interpretation?.overall_confidence) ||
    interpretation.overall_confidence < 0.70 ||
    !Array.isArray(interpretation?.tasks)
  ) {
    return false;
  }

  return interpretation.tasks.some(task =>
    task?.needs_clarification === false &&
    Array.isArray(task?.requested_facts) &&
    task.requested_facts.includes(fact)
  );
}


/*
  G36_SEMANTIC_COMMERCIAL_SIGNAL_V1

  Consumes the existing RequestInterpreter output.
  No second model call and no invented contact consent.
*/
function canonicalCommercialSignal(interpretation) {
  if (
    interpretation?.version !== "RequestInterpreterV1" ||
    Number(interpretation?.overall_confidence) < 0.70 ||
    !Number.isFinite(Number(interpretation?.overall_confidence))
  ) {
    return null;
  }

  const signal = interpretation?.commercial_signal;

  const allowed = new Set([
    "none",
    "availability",
    "payment_terms",
    "comparison",
    "shortlist_review",
    "purchase_ready",
    "viewing",
    "specialist_contact",
    "contact_opt_out"
  ]);

  if (
    !signal ||
    !allowed.has(signal.intent) ||
    !Number.isFinite(signal.confidence) ||
    signal.confidence < 0.75 ||
    typeof signal.explicit_request !== "boolean"
  ) {
    return null;
  }

  return signal;
}

function semanticDirectHandoff(interpretation) {
  const signal = canonicalCommercialSignal(interpretation);

  return signal?.explicit_request === true &&
    (
      signal.intent === "viewing" ||
      signal.intent === "specialist_contact"
    );
}

function candidateOffer({
  message,
  route,
  activeMemory,
  progressScore,
  interpretation = null
}) {
  const semantic = canonicalCommercialSignal(interpretation);

  const semanticOffers = {
    availability: {
      type: "availability_check",
      follow_up:
        "I can connect you with a Primadom specialist to confirm the latest availability. Would you like me to arrange that?"
    },
    payment_terms: {
      type: "terms_check",
      follow_up:
        "I can connect you with a Primadom specialist to confirm the current purchase terms. Would you like me to arrange that?"
    },
    comparison: {
      type: "comparison_consultation",
      follow_up:
        "Would you like to review these options with a Primadom specialist?"
    },
    shortlist_review: {
      type: "shortlist_consultation",
      follow_up:
        "Would you like a Primadom specialist to help you review your shortlist?"
    },
    purchase_ready: {
      type: "project_consultation",
      follow_up:
        "Would you like me to connect you with a Primadom specialist to discuss the next step?"
    },
    viewing: {
      type: "viewing_consultation",
      follow_up:
        "I can help you discuss a viewing with a Primadom specialist. Would you like me to arrange contact?"
    },
    specialist_contact: {
      type: "direct_consultation",
      follow_up:
        "I can help connect you with a Primadom specialist. Would that be helpful?"
    }
  };

  if (semantic && semanticOffers[semantic.intent]) {
    return semanticOffers[semantic.intent];
  }

  const text =
    String(message)
      .toLowerCase();

  if (
    /\bavailability\b|\bavailable\b/
      .test(text) ||
    hasCanonicalCommercialFact(
      interpretation,
      "availability"
    )
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
      .test(text) ||
    hasCanonicalCommercialFact(
      interpretation,
      "payment_plan"
    )
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
    /\binterested in buying\b|\bready to buy\b/i
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


/*
  G38_TEMPORARY_REFUSAL_PRIORITY_V1

  A model classification alone cannot turn an explicitly
  temporary refusal into a permanent contact opt-out.

  Explicit permanent opt-out wording always takes priority.
*/
function g38TemporaryRefusal(message, previousState) {
  const text = String(message || "")
    .trim()
    .toLowerCase()
    .replaceAll("’", "'");

  if (explicitContactOptOut(message)) {
    return false;
  }

  const permanentLanguage =
    /\b(?:never|anymore|ever again|no more|permanently)\b/i
      .test(text);

  if (permanentLanguage) {
    return false;
  }

  return (
    declinedPreviousOffer(message, previousState) ||
    /\b(?:not now|not yet|just yet|maybe later|perhaps later|for now)\b/i
      .test(text) ||
    /\b(?:keep|continue)\s+(?:talking|discussing|looking|exploring)\b/i
      .test(text) ||
    /\bi(?:'d| would)\s+rather\s+(?:keep|continue)\b/i
      .test(text)
  );
}


export function evaluateFunnel({
  message = "",
  route = null,
  activeMemory = [],
  fullContext = false,
  interpretation = null,
  commercialContext = null
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

  // G42_RUNTIME_DECISION_BRIDGE_V1
  // Existing progress calculation remains authoritative
  // until the Buyer Progress model is implemented.
  const g42Decision =
    commercialContext?.version === "CommercialContextV1"
      ? decideCommercialNextStepV1({
          commercialContext,
          activeMemory,
          primaryTaskResolved: true,
          materialProgress:
            progressScore >
            Number(previousState?.progress_score ?? 0)
        })
      : null;

  /*
    Explicit permanent contact opt-out.
    Check before interpreting positive contact intent.
  */
  if (
    explicitContactOptOut(message) ||
    (
      canonicalCommercialSignal(interpretation)?.intent ===
        "contact_opt_out" &&
      !g38TemporaryRefusal(message, previousState)
    )
  ) {
    return {
      response_type: "answer",
      answer_override:
        "Understood. I won’t suggest contacting a Primadom specialist again unless you ask. We can continue here.",
      follow_up: null,
      lead_action: null,
      memory_facts: [
        funnelFact({
          status: "contact_opted_out",
          cta_type: null,
          progress_score: progressScore
        })
      ]
    };
  }

  if (
    previousState?.status === "contact_opted_out" &&
    !explicitHandoffRequest(message) &&
    !semanticDirectHandoff(interpretation)
  ) {
    return emptyDecision();
  }

  // G42_POST_CONTACT_GUARD_V1
  // A known contact must never trigger another
  // phone request or proactive specialist CTA.
  // Explicit recontact execution belongs to Block H.
  if (
    g42Decision?.contact_already_known === true
  ) {
    return emptyDecision();
  }

  // G7: A client may pause an already accepted handoff without a permanent opt-out.
  // The next explicit request still reopens the handoff through the same G → H flow.
  if (
    previousState?.status === "handoff_accepted" &&
    g38TemporaryRefusal(message, previousState) &&
    !explicitHandoffRequest(message)
  ) {
    return {
      response_type: "answer",
      answer_override: "Of course. We can continue here without arranging contact.",
      follow_up: null,
      lead_action: null,
      memory_facts: [funnelFact({
        status: "cta_declined",
        cta_type: previousState?.cta_type || null,
        progress_score: progressScore
      })]
    };
  }

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
    semanticDirectHandoff(interpretation) ||
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
        /\b(?:email|e-mail)\b/i.test(message) &&
        /\b(?:prefer|rather|don't|do not|without|instead|by|via|through)\b/i.test(message)
          ? "What email address would you like the Primadom team to use?"
          : "What’s the best phone number or WhatsApp to reach you on?",

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

  // G5_PRIMARY_TASK_FIRST_SELECTION_GUARD_V1
  // The customer is asking for an actual shortlist or comparison.
  // Complete that primary task before another proactive CTA.
  // Explicit contact requests and previous-offer decisions
  // are handled above this guard.
  const g5PrimaryTaskText =
    String(message || "").toLowerCase();

  // G19: a noun such as "on my shortlist" is evidence of buyer progress,
  // not an instruction to build a new shortlist.  Do not suppress a viewing
  // offer merely because the client also mentions layouts or options.
  // Selection-task protection still applies when the user actually asks
  // to compare, find, recommend or build a shortlist.
  const g5PendingSelectionTask =
    (/\b(?:narrow|compare|recommend|suggest|find|identify)\b|\bshow\s+(?:me|us)\b/i
      .test(g5PrimaryTaskText) &&
     /\b(?:options?|projects?|developments?|properties|apartments?|homes?|alternatives|candidates|layouts?)\b/i
      .test(g5PrimaryTaskText)) ||
    /\b(?:shortlist|shortlisting)\s+(?:(?:the|my|our|these|those|some|a|few|several|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+){0,3}(?:options?|projects?|developments?|properties|apartments?|homes?|alternatives|candidates)\b/i
      .test(g5PrimaryTaskText);

  if (g5PendingSelectionTask) {
    return emptyDecision();
  }

  // G5_CONDITIONAL_VIEWING_BRIDGE_V1
  // Narrow deterministic evidence when Interpreter is not used.
  // This is an offer, not permission to capture contact details.
  const g5Text = String(message || "")
    .toLowerCase()
    .replaceAll("’", "'");

  const g5KnownProject = Boolean(
    commercialContext?.buyer_context?.primary_project_slug ||
    commercialContext?.buyer_context?.project_entities?.length
  );

  const g5ConditionalViewing =
    route === "contact_intent" &&
    g5KnownProject &&
    /\b(?:viewing|site visit|property visit)\b/i.test(g5Text) &&
    /\b(?:we'd|i'd|we would|i would|we want|i want|we plan|i plan)\s+(?:like\s+to\s+)?(?:move\s+towards?|consider|explore|start|begin|work\s+towards?|look\s+into)\b/i.test(g5Text) &&
    !/\b(?:not|never|don't|do not|no)\s+(?:want|plan|ready|interested|arrange|schedule|book)\b/i.test(g5Text);

  const g5ConditionalOffer =
    g5ConditionalViewing &&
    [
      "insufficient_semantic_confidence",
      "primary_task_first",
      "help_customer_progress",
      "exploration_no_contact_needed"
    ].includes(g42Decision?.reason);

  // G19_LIVE_VIEWING_BRIDGE_V1
  // RequestInterpreter may correctly route a known project's show-unit question
  // to page_question while emitting no commercial_signal.  A concrete, dated
  // viewing request plus near-term buyer readiness is still a practical need.
  // Do not override opt-out, previous-offer cooldown or selection tasks above.
  const g19ColdViewingQuestion =
    g5KnownProject &&
    /^(?:(?:can|could|may)\s+(?:i|we)\s+|is\s+it\s+possible\s+to\s+)(?:view|see|visit|tour)\s+/i.test(g5Text) &&
    !explicitHandoffRequest(message);
  const g19PracticalViewingRequest =
    (/\b(?:viewing|site visit|show\s+unit|(?:see|view|visit)\s+(?:a\s+)?(?:(?:suitable|specific|two-bedroom|2-bedroom)\s+)?(?:apartment|unit|property))\b/i.test(g5Text) ||
     g19ColdViewingQuestion) &&
    /\b(?:could|can|would|possible|arrange|schedule|book|during\s+(?:my|our)\s+visit)\b/i.test(g5Text);
  const g19NearTermBuyer =
    /\b(?:ready\s+to\s+(?:move\s+forward|buy|purchase|proceed)|(?:make|take)\s+a\s+(?:purchase\s+)?decision|(?:this|next)\s+month|tomorrow|(?:this|next)\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(g5Text);
  const g19ResearchOnly =
    /\b(?:just\s+(?:learning|researching|browsing)|not\s+(?:planning|ready|looking|intending)\s+to\s+(?:buy|purchase|proceed)|hypothetically|in\s+the\s+distant\s+future)\b/i.test(g5Text);
  const g19QualifiedProjectViewing =
    g5KnownProject &&
    ["page_question", "exact_fact", "follow_up"].includes(route) &&
    g19PracticalViewingRequest && g19NearTermBuyer && !g19ResearchOnly &&
    [
      "insufficient_semantic_confidence",
      "help_customer_progress",
      "exploration_no_contact_needed",
      "no_commercial_action"
    ].includes(g42Decision?.reason);

  // Reuse the existing verified project + immediate commercial need policy.
  // This only authorizes an offer; it never authorizes contact capture.
  // No extra routing system or OpenAI call is introduced.
  const legacyOffer =
    candidateOffer({
      message,
      route,
      activeMemory,
      progressScore,
      interpretation
    });
  const g6ActionableProjectNeed =
    g5KnownProject &&
    ["exact_fact", "page_question", "follow_up"].includes(route) &&
    ["availability_check", "terms_check"].includes(legacyOffer?.type) &&
    ["insufficient_semantic_confidence", "help_customer_progress", "exploration_no_contact_needed"].includes(g42Decision?.reason);

  // G4.2 remains authoritative for all other cases.
  if (
    g42Decision &&
    g42Decision.decision !== "offer_contact" &&
    !g5ConditionalOffer &&
    !g6ActionableProjectNeed &&
    !g19QualifiedProjectViewing
  ) {
    return emptyDecision();
  }

  // G1_COMMERCIAL_DECISION_TO_FUNNEL_BRIDGE_V1
  // No additional OpenAI calls.
  // G3_CONTEXTUAL_COMMERCIAL_OFFER_V1
  // CommercialContextV1 is the existing source.
  // No new interpreter, memory writes or LLM calls.
  const baseOffer =
    legacyOffer ||
    (
      (
        g42Decision?.decision === "offer_contact" ||
        g5ConditionalOffer ||
        g6ActionableProjectNeed ||
        g19QualifiedProjectViewing
      )
        ? {
            type: "project_consultation",
            follow_up:
              "Would you like me to connect you with a Primadom specialist to discuss the next step?"
          }
        : null
    );

  const g3Buyer =
    commercialContext?.buyer_context || {};

  const g3Slug =
    typeof g3Buyer.primary_project_slug === "string"
      ? g3Buyer.primary_project_slug.trim()
      : "";

  const g3Project =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g3Slug)
      ? g3Slug.split("-").map((part, index) =>
          index > 0 &&
          ["by", "at", "in", "on", "of", "the"].includes(part)
            ? part
            : part[0].toUpperCase() + part.slice(1)
        ).join(" ")
      : null;

  const g3Known =
    g3Buyer.known_facts;

  const g3Facts =
    Array.isArray(g3Known)
      ? g3Known
      : g3Known && typeof g3Known === "object"
        ? Object.entries(g3Known).map(([fact_key, fact_value]) => ({
            fact_key,
            fact_value
          }))
        : [];

  const g3BedroomFact =
    g3Facts.find(f =>
      /^(?:bedrooms?|bedroom_count|bedroom_preference|unit_type|preferred_unit_type)$/i
        .test(String(f?.fact_key || ""))
    );

  const g3BedroomValue =
    String(g3BedroomFact?.fact_value ?? "").trim();

  const g3BedroomMatch =
    /^(\d)\s*(?:br|bedrooms?|beds?)?$/i.exec(g3BedroomValue);

  const g3Bedrooms =
    g3BedroomMatch &&
    Number(g3BedroomMatch[1]) >= 1 &&
    Number(g3BedroomMatch[1]) <= 6
      ? Number(g3BedroomMatch[1])
      : null;

  const g3Needs =
    Array.isArray(commercialContext?.commercial_needs)
      ? commercialContext.commercial_needs
          .filter(value => typeof value === "string")
          .join(" ")
          .toLowerCase()
      : "";

  const g3PreferenceText =
    g3Facts
      .filter(f =>
        /(?:preference|priority|requirement|buyer_goal|family|lifestyle)/i
          .test(String(f?.fact_key || ""))
      )
      .map(f =>
        typeof f?.fact_value === "string"
          ? f.fact_value
          : ""
      )
      .join(" ")
      .toLowerCase();

  const g3Privacy =
    /\bprivacy\b|\bprivate\b/i.test(g3PreferenceText);

  const g3Views =
    /\bview\b|\bviews\b/i.test(g3PreferenceText);

  const g3Visit =
    g19ColdViewingQuestion ||
    /\b(?:visiting|visit dubai|in dubai|coming to dubai|viewing|next month)\b/i
      .test(String(message || "")) ||
    /\b(?:viewing|site_visit|appointment)\b/i
      .test(g3Needs);

  const g3Details = [
    g3Bedrooms
      ? `${g3Bedrooms}-bedroom layouts`
      : "suitable unit options",
    g3Privacy ? "privacy" : null,
    g3Views ? "views" : null
  ].filter(Boolean).join(", ");

  // G V1.1: keep all actionable needs, not only the first signal.
  // Structured commercial needs come from the same canonical Interpreter;
  // lexical evidence here only refines the wording, never permits contact.
  const g3MessageText = String(message || "").toLowerCase();
  const g3NeedFlags = {
    availability: /\bavailability\b|\bavailable\s+(?:units?|apartments?|layouts?)\b/.test(g3MessageText) ||
      /\bavailability\b/.test(g3Needs),
    payment: /\bpayment\s+(?:plan|terms|schedule)\b|\bpurchase\s+terms\b|\binstallments?\b/.test(g3MessageText) ||
      /\bpayment_terms\b/.test(g3Needs),
    investment: /\b(?:rental\s+(?:potential|yield|income|assumptions?)|investment\s+(?:return|analysis)|net\s+yield|roi)\b/.test(g3MessageText) ||
      /\binvestment_analysis\b/.test(g3Needs),
    viewing: g3Visit,
  };
  const g3SpecificTasks = [
    g3NeedFlags.availability ? "confirm current unit availability" : null,
    g3NeedFlags.payment ? "review current purchase terms" : null,
    g3NeedFlags.investment ? "discuss the assumptions needed to assess rental potential" : null,
    g3NeedFlags.viewing ? "discuss a possible viewing" : null
  ].filter(Boolean);
  const g3Action = g3SpecificTasks.length
    ? g3SpecificTasks.length === 1
      ? g3SpecificTasks[0]
      : g3SpecificTasks.slice(0, -1).join(", ") +
        " and " + g3SpecificTasks.at(-1)
    : baseOffer?.type === "comparison_consultation" ||
      baseOffer?.type === "shortlist_consultation"
        ? "review your shortlisted options"
        : `review ${g3Details} and the next practical steps`;

  const g3ContextualFollowUp =
    g3Project
      ? `For ${g3Project}, I can connect you with a Primadom specialist to ${g3Action}. Would you prefer to speak with the team or continue exploring here?`
      : null;

  const offer =
    baseOffer &&
    (
      g42Decision?.decision === "offer_contact" ||
      g5ConditionalOffer ||
      g6ActionableProjectNeed ||
      g19QualifiedProjectViewing
    ) &&
    g3ContextualFollowUp
      ? {
          ...baseOffer,
          follow_up: g3ContextualFollowUp
        }
      : baseOffer;

  if (!offer) {
    return emptyDecision();
  }

  /*
    Ignored CTA is NOT rejection.
    Do not repeat until commercial progress
    has materially increased.
  */
  const meaningfulProgress =
    progressScore >
    Number(previousState?.progress_score ?? 0);

  const sameOffer =
    offer.type === previousState?.cta_type;

  /*
    "Not now" requires meaningful progress.
    Ignored offers may be renewed for a new reason.
    The same offer is not immediately repeated.
  */
  if (
    previousState?.status === "cta_declined" &&
    !meaningfulProgress
  ) {
    return emptyDecision();
  }

  if (
    (
      previousState?.status === "cta_offered" ||
      previousState?.status === "contact_captured"
    ) &&
    !meaningfulProgress &&
    sameOffer
  ) {
    return emptyDecision();
  }

  const g5OfferAsAnswer =
    route === "contact_intent" &&
    (
      g42Decision?.decision === "offer_contact" ||
      g5ConditionalOffer
    );

  return {
    response_type:
      "answer",

    answer_override:
      g5OfferAsAnswer ? offer.follow_up : null,

    follow_up:
      g5OfferAsAnswer ? null : offer.follow_up,

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
