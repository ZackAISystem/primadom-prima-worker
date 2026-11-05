const EXACT_FACT_PATTERNS = Object.freeze({
  price: [
    /\bprice\b/i,
    /\bcost\b/i,
    /\bhow much\b/i,
    /\bstarting price\b/i
  ],

  handover: [
    /\bhandover\b/i,
    /\bhand(?:ed|ing)?\s+over\b/i,
    /\bcomplet(?:ion|e|ed|es|ing)\b/i
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
  ],

  // Match already-supported StructuredAnswer fact keys. Do not add a
  // separate question catalogue or bypass authoritative Knowledge.
  service_charges: [
    /\bservice charges?\b/i
  ],

  unit_size: [
    /\b(?:unit size|floor area|size|sq\.?\s?ft|sqft|square feet)\b/i
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


function hasPotentialExplicitEntityReference(
  message = "",
  exactFacts = []
) {
  let residual =
    String(message || "")
      .toLowerCase();

  /*
    Reuse the SAME existing fact vocabulary.
    We are not creating another question catalogue.
  */
  for (const fact of exactFacts) {
    const patterns =
      EXACT_FACT_PATTERNS[
        fact
      ] || [];

    for (const pattern of patterns) {
      const flags =
        pattern.flags.includes("g")
          ? pattern.flags
          : pattern.flags + "g";

      residual =
        residual.replace(
          new RegExp(
            pattern.source,
            flags
          ),
          " "
        );
    }
  }

  /*
    Remove generic grammar / current-context references.

    Anything meaningful left after this may be
    an explicit entity reference and therefore
    should go through RequestInterpreterV1.

    No project/developer/district names live here.
  */
  residual =
    residual
      .replace(
        /\b(what|whats|what's|when|where|who|how|does|do|did|is|are|was|were|will|would|can|could|please|tell|me|the|this|that|these|those|it|its|project|property|development|current|recorded|starting|start|starts|from|of|for|about|in|at|by|exact|exactly|expected|located|minimum|maximum|and|or|also|both|plus|aed|dhs|dirham|dirhams)\b/g,
        " "
      )
      .replace(
        /[^a-z0-9]+/g,
        " "
      )
      .trim();

  return Boolean(residual);
}



function cleanDeterministicEntityName(
  value = ""
) {
  return String(value || "")
    .trim()
    .replace(
      /^[\s"'“”‘’]+|[\s"'“”‘’?.!,;:]+$/g,
      ""
    )
    .trim();
}


export function extractDeterministicEntityCandidate({
  route = null,
  message = "",
  exactFacts = []
} = {}) {
  const text =
    String(message || "")
      .trim();

  if (!text) {
    return null;
  }

  const patterns = [];

  /*
    Exact fact:
    intent/fact are already known deterministically.
    We only extract the entity phrase.
  */
  if (
    route === "exact_fact" &&
    exactFacts.length === 1
  ) {
    const fact =
      exactFacts[0];

    if (fact === "location") {
      patterns.push(
        /^\s*where\s+is\s+(.+?)(?:\s+located)?\s*[?.!]*$/i,
        /^\s*what(?:'s|\s+is)\s+the\s+location\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "developer") {
      patterns.push(
        /^\s*who\s+is\s+the\s+developer\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i,
        /^\s*who\s+develops\s+(.+?)\s*[?.!]*$/i,
        /^\s*who\s+developed\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "price") {
      patterns.push(
        /^\s*how\s+much\s+is\s+(.+?)\s*[?.!]*$/i,
        /^\s*what(?:'s|\s+is)\s+the\s+(?:starting\s+)?price\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "handover") {
      patterns.push(
        /^\s*when\s+(?:is|was)\s+(.+?)\s+(?:expected|scheduled|due|planned)\s+to\s+be\s+(?:complet(?:e|ed)|handed\s+over)\s*[?.!]*$/i,
        /^\s*when\s+is\s+(.+?)(?:\s+expected\s+to)?\s+(?:handover|handing\s+over|complete|completed)\s*[?.!]*$/i,
        /^\s*what(?:'s|\s+is)\s+the\s+(?:handover|completion)(?:\s+date)?\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i,
        /^\s*when\s+(?:is|was)\s+the\s+(?:handover|completion)(?:\s+date)?\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i,
        /^\s*when\s+(?:will|would|should|does|did)\s+(.+?)\s+(?:be\s+)?(?:complet(?:e|ed)|handed\s+over|hand\s+over|handover)\s*[?.!]*$/i,
        /^\s*when\s+(?:is|was)\s+(.+?)\s+(?:expected|scheduled|due|planned)\s+to\s+be\s+(?:complet(?:e|ed)|handed\s+over)\s*[?.!]*$/i,
        /^\s*when\s+(?:is|was)\s+(.+?)\s+(?:complet(?:e|ed)|handed\s+over)\s*[?.!]*$/i
      );
    }

    if (fact === "status") {
      patterns.push(
        /^\s*what(?:'s|\s+is)\s+the\s+status\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "payment_plan") {
      patterns.push(
        /^\s*what(?:'s|\s+is)\s+the\s+payment\s+plan\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i,
        /^\s*does\s+(.+?)\s+have\s+a\s+payment\s+plan\s*[?.!]*$/i
      );
    }

    if (fact === "bedrooms") {
      patterns.push(
        /^\s*what\s+bedrooms?\s+(?:are\s+available\s+)?(?:at|in)\s+(.+?)\s*[?.!]*$/i,
        /^\s*what\s+unit\s+types?\s+(?:are\s+available\s+)?(?:at|in)\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "service_charges") {
      patterns.push(
        /^\s*what(?:'s|\s+is|\s+are)\s+the\s+service\s+charges?\s+(?:at|for|of)\s+(.+?)\s*[?.!]*$/i
      );
    }

    if (fact === "unit_size") {
      patterns.push(
        /^\s*what(?:'s|\s+is)\s+the\s+(?:unit\s+)?size\s+(?:at|for|of)\s+(.+?)\s*[?.!]*$/i
      );
    }
  }

  /*
    Simple overview.
  */
  if (route === "page_question") {
    patterns.push(
      /^\s*tell\s+me\s+about\s+(.+?)\s*[?.!]*$/i,
      /^\s*what\s+can\s+you\s+tell\s+me\s+about\s+(.+?)\s*[?.!]*$/i,
      /^\s*give\s+me\s+an?\s+overview\s+of\s+(.+?)\s*[?.!]*$/i
    );
  }

  /*
    Clear entity-specific recommendation/investment questions.
    Final reasoning may still use Luna; entity extraction does not.
  */
  if (route === "recommendation") {
    patterns.push(
      /^\s*is\s+(.+?)\s+(?:a\s+)?good\s+(?:investment|for\s+investment)\b.*$/i,
      /^\s*what\s+do\s+you\s+think\s+about\s+(.+?)\s+for\s+investment\s*[?.!]*$/i,
      /^\s*what\s+do\s+you\s+think\s+of\s+(.+?)\s+for\s+investment\s*[?.!]*$/i,
      /^\s*would\s+you\s+invest\s+in\s+(.+?)\s*[?.!]*$/i,
      /^\s*is\s+(.+?)\s+worth\s+considering\s+for\s+investment\s*[?.!]*$/i
    );
  }

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    const name =
      cleanDeterministicEntityName(
        match?.[1] || ""
      );

    if (
      name &&
      name.length >= 2 &&
      name.length <= 120
    ) {
      return {
        type:
          "unknown",

        name,

        slug:
          null,

        role:
          "primary",

        source:
          "fast_gate"
      };
    }
  }

  return null;
}



// E15: a SINGLE ownership point for the existing StructuredAnswer fact keys.
// Router and conversational entity references reuse this fact vocabulary.
// Detection is not retrieval. The canonical Registry + Knowledge retain authority.
export function detectStructuredFactKeysV1(message = "") {
  return detectedExactFacts(String(message || ""));
}

export function recognizeStructuredFactQuestionV1(message = "") {
  const text = String(message || "").trim();
  if (!text || text.length > 240 || hasContactIntent(text)) return false;
  if (/\b(?:compare|versus|recommend|suggest|invest|buy|sell|contact|call|viewing|why|risk|roi|returns?)\b/i.test(text)) return false;
  const facts = detectStructuredFactKeysV1(text);
  if (facts.length !== 1) return false;
  if (extractDeterministicEntityCandidate({
    route: "exact_fact", message: text, exactFacts: facts
  })) return true;
  // A conversational pronoun is NOT an entity guess: the canonical state
  // is still verified by resolveNamedEntity before any zero-token answer.
  return /^(?:what|when|where|who|how|is|are|does|do|will)\b/i.test(text) &&
    /\b(?:it|its|this project|that project|this property|that property|this one|that one)\b/i.test(text);
}

// High-confidence Persona continuation.
// Never substitutes for semantic understanding when reference is uncertain.
export function resolveContextualPersonaIntent({
  message = "",
  context = null
} = {}) {
  const state = context?.conversation?.dialogue_state;

  if (
    state?.active_thread?.active_topic !== "persona_question" ||
    state?.dialogue_mechanics?.last_route !== "persona_question"
  ) return null;

  // Previous generated answers are NOT contractual strings. Resolve
  // founder co-reference from the existing Persona thread and recent
  // discussion subject, never a fixed FAQ sentence in assistant output.
  const turns = Array.isArray(context?.conversation?.recent_messages)
    ? context.conversation.recent_messages : [];
  const founderInRecentThread = turns.slice(-6).some(turn =>
    /\b(?:thredeesh|founder|founded|creator)\b/i.test(String(turn?.content || ""))
  );
  if (!founderInRecentThread) return null;

  const q = String(message || "").trim();

  if (
    !q ||
    q.length > 320 ||
    !/\b(?:he|him|his|founder|thredeesh)\b/i.test(q)
  ) return null;

  // Exclude requests needing search, finance, commercial or safety handling.
  if (
    /\b(?:buy|sell|find|search|show|compare|invest|investment|roi|return|profit|guarantee|price|budget|mortgage|rent|payment|call|contact|phone|email|stop|cancel|refuse|not|never|privacy|data|project|apartment|bedroom|viewing|meeting|developer|district)\b/i.test(q)
  ) return null;

  if (
    /\b(?:career|experience|background|professional|worked|emaar|track record|tenure)\b/i.test(q)
  ) {
    return /\b(?:relevant|relevance|benefit|useful|why|buyers|clients)\b/i.test(q)
      ? "founder_relevance"
      : "founder_career";
  }

  if (
    /\b(?:tell|share|more)\b/i.test(q) &&
    /\b(?:him|founder|thredeesh)\b/i.test(q)
  ) return "founder_profile";

  return null;
}

export function evaluateFastGate({
  route = null,
  message = "",
  context = {},
  conversationMove = null
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
  // HIGH-CONFIDENCE CONVERSATION REFERENCE
  //
  // Zero-LLM is allowed only when the existing canonical
  // resolver produced an actionable entity slug.
  //
  // If reference identity is incomplete, preserve the
  // existing Interpreter / clarification fallback.
  // -------------------------------------------------------

  if (
    conversationMove
      ?.version ===
        "ConversationMoveV1" &&
    conversationMove
      ?.move_type ===
        "reference" &&
    Number(
      conversationMove
        ?.confidence ||
      0
    ) >= 0.95 &&
    conversationMove
      ?.effective_route ===
        "follow_up" &&
    conversationMove
      ?.reference
      ?.resolved === true &&
    Boolean(
      conversationMove
        ?.reference
        ?.slug
    ) &&
    route === "follow_up"
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "high_confidence_follow_up_reference",

      entity,

      exact_facts: []
    };
  }


  // -------------------------------------------------------
  // HIGH-CONFIDENCE CONVERSATION REFINEMENT
  //
  // ConversationMoveV1 has already compared the durable
  // previous state with the current merged state.
  //
  // A high-confidence property-search refinement is fully
  // understood deterministically and does not require the
  // Request Interpreter.
  // -------------------------------------------------------

  if (
    conversationMove
      ?.version ===
        "ConversationMoveV1" &&
    conversationMove
      ?.move_type ===
        "refinement" &&
    Number(
      conversationMove
        ?.confidence ||
      0
    ) >= 0.95 &&
    conversationMove
      ?.effective_route ===
        "property_search" &&
    route === "property_search"
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "high_confidence_search_refinement",

      entity,

      exact_facts: []
    };
  }


  // -------------------------------------------------------
  // PERSONA / COMPANY / FOUNDER
  //
  // Canonical Persona facts are deterministic.
  // No Request Interpreter, Knowledge, Search or OpenAI.
  // -------------------------------------------------------

  if (
    route === "persona_question"
  ) {
    return {
      version: "FastGateV1",

      decision: "execute",

      use_interpreter: false,

      reason:
        "persona_question_deterministic",

      entity,

      exact_facts: []
    };
  }


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
  // current page = resolved project
  // "What is the handover?"
  //
  // No LLM.
  // -------------------------------------------------------

  if (
    route === "exact_fact" &&
    exactFacts.length === 1 &&
    entityResolved &&
    !contact &&
    !hasPotentialExplicitEntityReference(
      text,
      exactFacts
    )
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
  // MULTIPLE VERIFIED STRUCTURED FACTS / CURRENT RESOLVED ENTITY
  // The StructuredAnswer already supports requested_facts as an array.
  // A pure two/three-fact lookup needs Knowledge, not a paid Interpreter.
  // Explicit entity names, action requests and ambiguous messages retain
  // the existing semantic path. No user-facing response is stored here.
  // -------------------------------------------------------

  if (
    route === "exact_fact" &&
    exactFacts.length >= 2 &&
    exactFacts.length <= 3 &&
    !exactFacts.includes("payment_plan") &&
    entityResolved &&
    !contact &&
    !/\b(?:find|search|compare|versus|recommend|suggest|invest|buy|sell|contact|call|email|whatsapp|viewing)\b/i.test(text) &&
    !hasPotentialExplicitEntityReference(text, exactFacts)
  ) {
    return {
      version: "FastGateV1",
      decision: "execute",
      use_interpreter: false,
      reason: "verified_multi_fact_resolved_entity",
      entity,
      exact_facts: exactFacts
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

      decision: "interpret",

      use_interpreter: true,

      reason:
        "exact_fact_entity_resolution_required",

      entity: null,

      exact_facts:
        exactFacts
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
  // ROUTER UNRESOLVED
  //
  // The deterministic router is intentionally narrow.
  // A long-tail or named-entity request may still be valid.
  // RequestInterpreterV1 decides semantically.
  // -------------------------------------------------------

  if (
    route === "unsupported"
  ) {
    return {
      version: "FastGateV1",

      decision: "interpret",

      use_interpreter: true,

      reason:
        "router_unresolved_requires_interpretation",

      entity,

      exact_facts:
        exactFacts
    };
  }


  // -------------------------------------------------------
  // BLOCK_D_D5_VERIFIED_NAMED_DISTRICT_ZERO_LLM_V4
  // The UI has already verified exactly one canonical district in D5.
  // This is a completed entity lookup, not a prompt to generate an answer.
  // Never take this path for comparisons, advice or project discovery.
  const verifiedNamedDistrict =
    route === "property_search" &&
    context?.turn?.phase === "tool_continuation" &&
    context?.search?.version === "SearchContextV1" &&
    context.search.language === "en" &&
    context.search.entity_type === "district" &&
    context.search.state === "results" &&
    context.search.source === "prima_ui_verified_entity_batch_v1" &&
    context.search.result_count === 1 &&
    context.search.current_batch_offset === 0 &&
    Array.isArray(context.search.results) &&
    context.search.results.length === 1 &&
    context.search.results[0]?.entity_type === "district" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(context.search.results[0]?.slug || "") &&
    context.search.results[0]?.canonical_url ===
      "/en/areas/" + context.search.results[0]?.slug + "/" &&
    /\b(?:district|area|community|neighbou?rhood)\b/i.test(text) &&
    !/\b(?:projects?|properties|developers?|apartments?|villas?|townhouses?|compare|versus|recommend|suggest|should|would|roi|risk|investment|returns?|profit|mortgage|contact|call|book|schedule|viewing|advisor|analy[sz]e|assess|evaluate)\b/i.test(text);

  if (verifiedNamedDistrict) {
    return {
      version: "FastGateV1", decision: "execute",
      use_interpreter: false,
      reason: "verified_completed_named_district_search",
      entity, exact_facts: []
    };
  }

  // BLOCK_D_VERIFIED_PROJECT_SEARCH_ZERO_LLM_V1
  //
  // The frontend has ALREADY executed a project Search, and
  // the normalized verified SearchContext is attached to the
  // tool_continuation. Do not pay for a second interpretation
  // of an explicit, single-purpose discovery request.
  //
  // A multi-task / advisory / ambiguous request intentionally
  // stays on the existing RequestInterpreter path. No names,
  // districts, prices, queries or canned answers live here.
  // -------------------------------------------------------
  const completedProjectSearch =
    route === "property_search" &&
    context?.turn?.phase === "tool_continuation" &&
    context?.search?.version === "SearchContextV1" &&
    context?.search?.language === "en" &&
    context?.search?.entity_type === "project" &&
    context?.search?.state === "results" &&
    Number.isInteger(context?.search?.result_count) &&
    context.search.result_count > 0 &&
    Array.isArray(context.search.results) &&
    context.search.results.length > 0 &&
    context.search.results.every(item =>
      item?.entity_type === "project" &&
      typeof item?.slug === "string" &&
      item.slug.length > 0 &&
      typeof item?.canonical_url === "string" &&
      item.canonical_url.startsWith("/en/projects/")
    );

  const explicitSimpleDiscovery =
    /\b(?:find|show|list|search|looking for|give me|only)\b/i.test(text) &&
    /\b(?:projects?|properties|apartments?|villas?|townhouses?|homes?|residences?)\b/i.test(text);

  // Conservative exclusions: if one utterance also requests
  // comparison, explanation, judgment, contact or extra tasks,
  // keep the single existing Interpreter call available.
  const requiresSemanticSearchInterpretation =
    /\b(?:compare|comparison|versus|vs\.?|why|explain|analy[sz]e|assess|evaluate|recommend|suggest|should|would|best|worth|roi|risk|investment|returns?|profit|mortgage|contact|call|book|schedule|viewing|advisor|broker|think|advise)\b/i.test(text) ||
    /\b(?:and|also|plus|together with|as well as)\b/i.test(text);

  if (
    completedProjectSearch &&
    explicitSimpleDiscovery &&
    !requiresSemanticSearchInterpretation
  ) {
    return {
      version: "FastGateV1",
      decision: "execute",
      use_interpreter: false,
      reason: "verified_completed_project_search",
      entity,
      exact_facts: exactFacts
    };
  }

  // P003D_SAFE_INITIAL_SEARCH_V1
  // Only a first-turn, single-action EN project discovery may skip the
  // RequestInterpreter. All conditions/parameters go to the EXISTING Search V3
  // verbatim; this gate does not parse filters or generate response content.
  // Never apply to continuations, entity fact lookups, name introductions,
  // recommendations, exclusions, comparisons or compound asks.
  const firstTurnSimpleProjectSearch =
    route === "property_search" &&
    context?.turn?.phase === "initial" &&
    context?.turn?.turn_seq === 1 &&
    context?.page?.language_code === "en" &&
    !context?.search?.version &&
    !context?.conversation?.dialogue_state?.active_thread?.active_topic &&
    text.length > 15 && text.length <= 200 &&
    /^[\x20-\x7E]+$/.test(text) &&
    /^(?:show(?:\s+me)?|find(?:\s+me)?|search\s+for|i(?:'m|\s+am)\s+looking\s+for|we(?:'re|\s+are)\s+looking\s+for)\s+/i.test(text) &&
    /\b(?:properties|property|apartments?|villas?|townhouses?|homes?|penthouses?|residences?)\b/i.test(text) &&
    !/[?;:\n]/.test(text) &&
    !/\b(?:and|but|also|plus|as well as|together with|or|however|instead|except|excluding|exclude|without|avoid|no|not|never|only|prefer|preferably|ideally|rather|near|around|similar|same|other|another|different|more|previous|earlier|last|again|before|after|between|if|unless|while)\b/i.test(text) &&
    !/\b(?:recommend|suggest|shortlist|compare|comparison|versus|vs|why|explain|what|who|which|when|how|where|assess|analy[sz]e|evaluate|should|would|could|best|worth|roi|risk|investment|investor|returns?|profit|mortgage|advisor|broker|book|schedule|viewing|contact|call|whatsapp|email|my name|call me|i'm [a-z]+,|i am [a-z]+,)\b/i.test(text) &&
    !contact;

  if (firstTurnSimpleProjectSearch) {
    return {
      version: "FastGateV1",
      decision: "execute",
      use_interpreter: false,
      reason: "p003d_safe_initial_project_search",
      entity,
      exact_facts: exactFacts
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
