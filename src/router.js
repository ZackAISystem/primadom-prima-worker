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
  // DEFAULT WIDER CONSULTATION
  // -------------------------------------------------------

  return "market_question";
}
