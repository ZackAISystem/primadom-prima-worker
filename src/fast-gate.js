const EXACT_FACT_PATTERNS = Object.freeze({
  price: [
    /\bprice\b/i,
    /\bcost\b/i,
    /\bhow much\b/i,
    /\bstarting price\b/i
  ],

  handover: [
    /\bhandover\b/i,
    /\bcompletion\b/i
  ],

  developer: [
    /\bdeveloper\b/i,
    /\bwho develops\b/i,
    /\bwho developed\b/i
  ],

  location: [
    /\blocation\b/i,
    /\bwhere is\b/i
  ],

  status: [
    /\bstatus\b/i,
    /\boff[- ]?plan\b/i,
    /\bready\b/i
  ],

  bedrooms: [
    /\bbedrooms?\b/i,
    /\b[1-9]br\b/i,
    /\bunit types?\b/i
  ],

  payment_plan: [
    /\bpayment plan\b/i,
    /\binstallments?\b/i
  ]
});


const CONTACT_PATTERNS = [
  /\bcall me\b/i,
  /\bcontact me\b/i,
  /\bspeak (?:to|with) (?:someone|an advisor|an agent)\b/i,
  /\btalk (?:to|with) (?:someone|an advisor|an agent)\b/i,
  /\bbook (?:a )?viewing\b/i,
  /\barrange (?:a )?viewing\b/i
];


function matchesAny(
  message,
  patterns
) {
  return patterns.some(pattern =>
    pattern.test(message)
  );
}


function detectedExactFacts(
  message = ""
) {
  const result = [];

  for (
    const [fact, patterns]
    of Object.entries(
      EXACT_FACT_PATTERNS
    )
  ) {
    if (
      matchesAny(
        message,
        patterns
      )
    ) {
      result.push(fact);
    }
  }

  return result;
}


function hasContactIntent(
  message = ""
) {
  return matchesAny(
    message,
    CONTACT_PATTERNS
  );
}


function hasResolvedEntity(
  context = {}
) {
  return Boolean(
    context
      ?.entity
      ?.primary_type &&
    context
      ?.entity
      ?.primary_slug
  );
}


function currentEntity(
  context = {}
) {
  if (
    !hasResolvedEntity(context)
  ) {
    return null;
  }

  return {
    type:
      context.entity.primary_type,

    slug:
      context.entity.primary_slug
  };
}


export function evaluateFastGate({
  route = null,
  message = "",
  context = {}
} = {}) {
  const text =
    String(message || "").trim();

  const exactFacts =
    detectedExactFacts(text);

  const contact =
    hasContactIntent(text);

  const entityResolved =
    hasResolvedEntity(context);

  const entity =
    currentEntity(context);


  // -------------------------------------------------------
  // PURE CONTACT INTENT
  //
  // No entity or LLM required.
  // Backend lead rules decide whether name / phone
  // must be requested.
  // -------------------------------------------------------

  if (
    route === "contact_intent" &&
    exactFacts.length === 0
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "simple_contact_intent",

      entity,

      exact_facts: []
    };
  }


  // -------------------------------------------------------
  // EXACT FACT + RESOLVED ENTITY
  //
  // Example:
  // current page = Passo
  // "What is the handover?"
  //
  // No LLM.
  // -------------------------------------------------------

  if (
    route === "exact_fact" &&
    exactFacts.length === 1 &&
    entityResolved &&
    !contact
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "exact_fact_entity_resolved",

      entity,

      exact_facts:
        exactFacts
    };
  }


  // -------------------------------------------------------
  // EXACT FACT BUT ENTITY UNKNOWN
  //
  // Example:
  // homepage
  // "What is the handover?"
  //
  // We already understand the request.
  // Calling an LLM would add latency without adding value.
  // Ask for the missing entity directly.
  // -------------------------------------------------------

  if (
    route === "exact_fact" &&
    exactFacts.length === 1 &&
    !entityResolved &&
    !contact
  ) {
    return {
      version: "FastGateV1",

      decision: "clarify",

      use_interpreter: false,

      reason:
        "exact_fact_entity_missing",

      entity: null,

      exact_facts:
        exactFacts,

      clarification: {
        missing:
          "entity",

        question:
          "Which project do you mean?"
      }
    };
  }


  // -------------------------------------------------------
  // MULTI-PART REQUEST
  //
  // Examples:
  // "What is the handover and can someone call me?"
  // "What is the price and handover?"
  //
  // Interpreter decomposes the message into tasks.
  // -------------------------------------------------------

  if (
    exactFacts.length > 1 ||
    (
      exactFacts.length > 0 &&
      contact
    )
  ) {
    return {
      version: "FastGateV1",

      decision: "interpret",

      use_interpreter: true,

      reason:
        "compound_request",

      entity,

      exact_facts:
        exactFacts
    };
  }


  // -------------------------------------------------------
  // UNSUPPORTED
  //
  // Do not waste an LLM call merely to confirm
  // something already deterministically unsupported.
  // -------------------------------------------------------

  if (
    route === "unsupported"
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "deterministic_unsupported",

      entity,

      exact_facts:
        exactFacts
    };
  }


  // -------------------------------------------------------
  // SEMANTIC / AMBIGUOUS REQUEST
  //
  // Examples:
  // "Is this good for my family?"
  // "Would another area suit us better?"
  // "Is it worth the premium?"
  //
  // This is where Luna adds value.
  // -------------------------------------------------------

  return {
    version: "FastGateV1",

    decision: "interpret",

    use_interpreter: true,

    reason:
      "semantic_interpretation_required",

    entity,

    exact_facts:
      exactFacts
  };
}
