function hasConversationContext(context = {}) {
  return Array.isArray(
    context?.conversation?.recent_messages
  ) && context.conversation.recent_messages.length > 0;
}

function hasPageContext(context = {}) {
  return Boolean(
    context?.entity?.primary_slug ||
    (
      context?.page?.page_type &&
      context.page.page_type !== "homepage"
    )
  );
}

export function routeIntent(
  message = "",
  context = {}
) {
  const raw = String(message).trim();
  const q = raw.toLowerCase();

  if (!q) {
    return "unsupported";
  }

  // -------------------------------------------------------
  // PRIMA / PRIMADOM PERSONA
  // Deterministic local response: no Knowledge / no OpenAI.
  // -------------------------------------------------------

  if (
    /\b(who are you|what are you|about prima|prima ai|what can you do|what can you help|how can you help|your capabilities|your values|your principles|how do you work|who created you|who built you|who made you|thredeesh|primadom founder)\b/i
      .test(q)
  ) {
    return "persona_question";
  }

  // -------------------------------------------------------
  // CLEARLY OFF-TOPIC
  // Prevent accidental market_question / paid LLM routing.
  // -------------------------------------------------------

  const clearlyOffTopic =
    /\b(write (me )?a poem|write (me )?a song|write (me )?a story|tell (me )?a joke|recipe|football score|football match|movie recommendation|song lyrics|coding help|javascript code|python code|medical advice|doctor|weather forecast|temperature today|crypto price|bitcoin price)\b/i
      .test(q) ||
    /^\s*\d+(?:\.\d+)?\s*[\+\-*\/]\s*\d+(?:\.\d+)?\s*[=?]?\s*$/
      .test(q);

  if (clearlyOffTopic) {
    return "unsupported";
  }

  // -------------------------------------------------------
  // CONTACT / COMMERCIAL HANDOFF
  // -------------------------------------------------------

  if (
    /\b(call|contact|advisor|agent|broker|whatsapp|phone|speak to|talk to|viewing|book a viewing)\b/i.test(q)
  ) {
    return "contact_intent";
  }

  // -------------------------------------------------------
  // FOLLOW-UP
  // Requires existing conversation/page context.
  // -------------------------------------------------------

  const referentialFollowUp =
    /\b(this one|that one|the first one|the second one|the third one|those|these|what about|how about|and this|and that|which one|why this|why that|same for)\b/i.test(q);

  if (
    referentialFollowUp &&
    (
      hasConversationContext(context) ||
      hasPageContext(context)
    )
  ) {
    return "follow_up";
  }

  // -------------------------------------------------------
  // COMPARISON
  // -------------------------------------------------------

  if (
    /\b(compare|comparison|versus| vs |difference between|better than|which is better)\b/i.test(q)
  ) {
    return "compare";
  }

  // -------------------------------------------------------
  // CURRENT ENTITY FIT / SUITABILITY
  //
  // Example:
  // "What makes Passo suitable for a family?"
  //
  // This is a question about the current entity's knowledge,
  // not a request to discover or recommend another project.
  // -------------------------------------------------------

  const currentEntitySlug =
    String(
      context?.entity?.primary_slug ||
      ""
    )
      .trim()
      .toLowerCase();

  const currentEntityName =
    currentEntitySlug.replace(
      /-/g,
      " "
    );

  const mentionsCurrentEntity =
    Boolean(
      currentEntityName &&
      q.includes(currentEntityName)
    );

  const refersToCurrentEntity =
    /\b(this project|this property|this area|this district|this developer)\b/i
      .test(q);

  const asksCurrentEntityFit =
    /\b(suitable for|good for|fit for|works for|makes?.+suitable|makes?.+good)\b/i
      .test(q);

  if (
    hasPageContext(context) &&
    asksCurrentEntityFit &&
    (
      mentionsCurrentEntity ||
      refersToCurrentEntity
    )
  ) {
    return "page_question";
  }


  // -------------------------------------------------------
  // RECOMMENDATION / ADVICE
  // -------------------------------------------------------

  if (
    /\b(recommend|recommendation|suggest|what would you choose|what would you suggest|best for me|best for my|which area|what area|which project|what project|what suits|suitable for)\b/i.test(q)
  ) {
    return "recommendation";
  }

  // -------------------------------------------------------
  // PROPERTY DISCOVERY / SEARCH
  // -------------------------------------------------------

  if (
    /\b(find|show me|looking for|search for|give me options|show options|projects under|properties under|apartments under|villas under|townhouses under)\b/i.test(q)
  ) {
    return "property_search";
  }

  // -------------------------------------------------------
  // EXACT STRUCTURED FACT
  // -------------------------------------------------------

  if (
    /\b(price|starting price|handover|completion|payment plan|developer|district|location|status|unit types?|bedrooms?|size|service charge|launch date|completion date)\b/i.test(q)
  ) {
    return "exact_fact";
  }

  // -------------------------------------------------------
  // MARKET-WIDE QUESTION
  // -------------------------------------------------------

  if (
    /\b(market|market trend|transactions|transaction volume|rental market|rental demand|price trend|capital appreciation|market performance|dubai real estate|uae real estate)\b/i.test(q)
  ) {
    return "market_question";
  }

  // -------------------------------------------------------
  // CURRENT PAGE / ENTITY QUESTION
  // e.g. "What are the risks?"
  // -------------------------------------------------------

  if (hasPageContext(context)) {
    return "page_question";
  }

  // -------------------------------------------------------
  // WIDER UAE REAL-ESTATE CONSULTATION
  // -------------------------------------------------------

  const realEstateScope =
    /\b(real estate|property|properties|project|projects|developer|developers|district|community|area|apartment|apartments|villa|villas|townhouse|townhouses|penthouse|penthouses|off-plan|off plan|handover|buy|buyer|purchase|invest|investment|rental|rent|yield|roi|mortgage|bedroom|bedrooms|dubai|uae|abu dhabi)\b/i
      .test(q);

  if (realEstateScope) {
    return "market_question";
  }

  // Unknown homepage/general question must not
  // become a paid market_question by default.
  return "unsupported";
}
