import { recognizeStructuredFactQuestionV1 } from "./fast-gate.js";
import { isExplicitNameOnlyMessage, isStandaloneGreeting } from "./memory.js";

// Narrow, zero-token scope guard for plainly unrelated requests.
// Ambiguous and mixed requests must continue through the existing semantic path.
// This is not a general banned-word list: property decisions retain priority.
export function classifyClearlyOffTopicRequest(message = "") {
  const q = String(message || "").trim().toLowerCase();
  if (!q || q.length > 500) return null;
  const propertyTask = /\b(?:find|show|search|recommend|shortlist|compare|buy|sell|invest|viewing|book|schedule|contact|call me)\b[\s\S]{0,90}\b(?:projects?|properties|apartments?|villas?|districts?|areas?|communities|developers?|homes?|units?|specialists?)\b/i.test(q);
  if (propertyTask) return null;
  const subjectIsProperty = /\b(?:property|properties|project|projects|apartment|apartments|villa|villas|district|districts|community|communities|developer|developers|neighbou?rhood|neighbou?rhoods)\b/i.test(q);
  // A mixed question about Prima plus another domain is not a simple detour.
  if (/\b(?:prima|primadom|founder|who are you|your platform)\b/i.test(q)) return null;
  if (!subjectIsProperty && /\b(?:weather|forecast)\b/i.test(q)) return "weather";
  if (!subjectIsProperty && /\b(?:pizza|cooking|recipe|baking)\b/i.test(q)) return "cooking";
  // A direct invitation to intimate conversation is not a market question
  // merely because the person says "forget real estate" in the preface.
  if (!subjectIsProperty && /\b(?:sex|sexual|romantic|intimate|intimacy)\b/i.test(q) &&
      /\b(?:talk|chat|discuss|flirt|roleplay|relationship|relationships|with you|about you)\b/i.test(q)) return "personal_boundary";
  return null;
}

function hasConversationContext(context = {}) {
  // A compact persisted ConversationStateV1 is also conversation context.
  // No database reads or inference are performed in Router.
  const conversation = context?.conversation || {};
  return (
    (Array.isArray(conversation.recent_messages) &&
      conversation.recent_messages.length > 0) ||
    Boolean(conversation?.dialogue_state?.continuity_references?.current_entity?.slug)
  );
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

  // Routing is intentionally a coarse, zero-token gate, not the semantic
  // owner. Keep high-confidence ACTIONS distinct from mere topic words.
  const explicitPropertyDiscovery =
    /\b(?:find|show(?: me)?|list|search for|looking for|give me options|show options)\b/i.test(q) &&
    /\b(?:projects?|properties|apartments?|villas?|townhouses?|homes?|penthouses?|developers?|districts?|areas|residences?)\b/i.test(q);
  const explicitComparison =
    /\b(?:compare|comparison|versus|vs\.?|better than|which is better)\b/i.test(q);
  // A named recommendation action is not a pure Persona question.
  // Leave task decomposition to A1/Interpreter, never a second Router.
  const explicitRecommendationAction =
    /\b(?:recommend|suggest|shortlist)\b/i.test(q) &&
    /\b(?:projects?|properties|apartments?|villas?|homes?|developers?|districts?|areas|communities|neighbou?rhoods)\b/i.test(q);
  const contactRefusal =
    /\b(?:do not|don't|dont|never|without|stop|no)\b[\s\S]{0,85}\b(?:contact|call|reach|whatsapp|agent|advisor|broker|specialist|viewing)\b/i.test(q);
  // Personal naming is not a request to telephone the user. The coarse
  // route gate does not create or memorize a name; Persona/Memory owns that.
  // Restrict this exclusion to address-as-name grammar, not any phrase
  // containing "call me" (which may be a genuine contact request).
  const personalNameInstruction =
    !contactRefusal &&
    /\b(?:(?:you\s+can\s+)?call\s+me|address\s+me\s+as|refer\s+to\s+me\s+as)\s+(?!back\b|later\b|tomorrow\b|today\b|now\b|soon\b|at\b|on\b|when\b|about\b|regarding\b|for\b|again\b)([\p{L}][\p{L}'’-]{1,35})(?=\s*(?:$|[.!?,]|\s+(?:for|in|from|instead|please|and)\b))/iu.test(raw);
  const explicitContactRequest = !contactRefusal && !personalNameInstruction && (
    /\b(?:call|contact|message|whatsapp)\s+me\b/i.test(q) ||
    /\b(?:connect|put)\s+me\s+(?:with|in touch with)\b/i.test(q) ||
    /\b(?:find|get|recommend)\s+(?:me\s+)?(?:an?\s+)?(?:agent|advisor|broker|specialist)\b/i.test(q) ||
    /\b(?:speak|talk)\s+(?:to|with)\s+(?:someone|an?\s+(?:agent|advisor|broker|specialist)|the\s+(?:agent|advisor|broker|specialist))\b/i.test(q) ||
    /\b(?:book|arrange|schedule)\s+(?:a\s+|an\s+)?(?:property\s+)?viewing\b/i.test(q) ||
    /\b(?:want|need|would like)\b[\s\S]{0,55}\b(?:agent|advisor|broker|specialist)\b[\s\S]{0,24}\b(?:contact|call)\s+me\b/i.test(q)
  );

  // Personal-memory recall is a conversation task, not discovery.
  // Avoid swallowing explicit Search/Compare/Contact/Recommendation requests.
  const personalMemoryRecall =
    /\b(?:remember|recall|remind me|what did i (?:say|tell|mention)|have i (?:said|told|mentioned))\b/i.test(q) &&
    /\b(?:my|our|i|we)\b/i.test(q) &&
    !explicitPropertyDiscovery && !explicitComparison &&
    !explicitContactRequest && !explicitRecommendationAction;
  if (personalMemoryRecall) return "persona_question";

  // PRIMA_GREETING_REGRESSION_FIX_V1
  // Standalone greetings are Persona, not OFF_TOPIC.
  // Mixed greeting + substantive request stays on normal routing.
  if (isStandaloneGreeting(raw)) {
    return "persona_question";
  }

  // A greeting + explicit self-introduction is a local Persona/Memory turn.
  // No A1/Interpreter call; name extraction and persistence remain in index.js.
  if (isExplicitNameOnlyMessage(raw)) {
    return "persona_question";
  }

  // Explicitly unrelated requests must win over stray "real estate" words
  // in a negated preface (e.g., "Forget real estate ...").
  // Genuine property actions/contact still belong to their capabilities.
  if (classifyClearlyOffTopicRequest(raw) &&
      !explicitPropertyDiscovery && !explicitComparison &&
      !explicitRecommendationAction && !explicitContactRequest) {
    return "unsupported";
  }

  // -------------------------------------------------------
  // PRIMA / PRIMADOM PERSONA
  // Deterministic local response: no Knowledge / no OpenAI.
  // -------------------------------------------------------

    const personaCoreQuestion =
      /\b(who are you|what are you|who is prima|what is prima|about prima|are you human|are you a human|are you a real person|are you a broker|are you thredeesh|are you the founder|what is primadom|what's primadom|what is primadom\.ai|what is primadomai|what's primadomai|about primadom|about primadom\.ai|about primadomai|what can you do|what can you help|how can you help|what does prima do|your capabilities|your values|your principles|how do you work|how do you make decisions|your approach|who is thredeesh|tell me (?:more )?about thredeesh|what experience does thredeesh have|what market do you cover|which market do you cover|what markets do you cover|what market do you specialize in|what markets do you specialize in|where do you operate|what is your scope|what's your scope)\b/i
        .test(q);

    const personaFounderCreatorQuestion =
      /\b(?:who\s+(?:founded|created|built|made)\s+(?:you|this\s+ai|prima(?:\s*ai)?|primadom(?:\.ai|\s*ai|\s+real\s+estate)?)|who(?:'s|\s+is)\s+behind\s+(?:this\s+ai|prima(?:\s*ai)?|primadom(?:\.ai|\s*ai|\s+real\s+estate)?)|who(?:'s|\s+is)\s+(?:the\s+)?(?:founder|creator)(?:\s+of\s+(?:prima(?:\s*ai)?|primadom(?:\.ai|\s*ai|\s+real\s+estate)?))?|(?:founder|creator)\s+of\s+(?:prima(?:\s*ai)?|primadom(?:\.ai|\s*ai|\s+real\s+estate)?)|tell\s+me\s+(?:more\s+)?about\s+(?:the\s+)?(?:founder|creator))\b/i
        .test(q);

    // Topic-level Persona recognition. This handles natural questions about
    // Prima, the company, the platform and founder without a phrase catalog.
    // Explicit real-estate tasks and contact requests always retain ownership.
    const personaSubject =
      /\b(?:prima(?:\s+ai)?|primadom(?:\.ai|\s+ai|\s+real\s+estate)?|thredeesh|mannambeth|founder|creator)\b/i.test(q);
    const personaAbout =
      /\b(?:who|what|why|how|where|when|which|does|do|did|is|are|was|were|tell me|explain|describe|share)\b/i.test(q);
    const personaSelfScope =
      /\b(?:your|you)\b/i.test(q) &&
      /\b(?:principles?|values?|mission|purpose|origin|philosophy|capabilities|expertise|experience|background|guidance|approach|different|competenc|guarantee(?:d)?|promise|knowledge|sources?|help|support)\b/i.test(q);
    // Questions ABOUT Prima's own knowledge, sources and support are Persona.
    // Concrete project facts, discovery, comparisons and contact retain their existing routes.
    const personaCapabilityExplanation =
      (/(?:\b(?:you|your)\b[\s\S]{0,90}\b(?:help|knowledge|sources?|explain|information|support|provide)\b|\b(?:information|knowledge|sources?)\b[\s\S]{0,75}\b(?:you|your)\b)/i.test(q) &&
        /\b(?:what|where|how|when|which|whose|why|based on|come from|after)\b/i.test(q)) ||
      /\b(?:after[- ]sales|post[- ]purchase)\b[\s\S]{0,80}\b(?:prima|primadom)\b/i.test(q);
    const previous=Array.isArray(context?.conversation?.recent_messages)
      ? context.conversation.recent_messages.slice(-3).map(t=>String(t?.content||"")).join(" ") : "";
    const founderReference =
      /\b(?:he|him|his)\b/i.test(q) &&
      /\b(?:thredeesh|mannambeth|founder|emaar)\b/i.test(previous) &&
      /\b(?:career|experience|background|emaar|work|did|lead|built|created|qualifications)\b/i.test(q);
    const personaEmaarExperience =
      /\bemaar\b/i.test(q) &&
      /\b(?:you|your|he|him|his|founder)\b/i.test(q) &&
      /\b(?:work|worked|personally|experience|career|years)\b/i.test(q);
    const personaPrincipleContinuation =
      /\b(?:those|these|the)\s+(?:principles|values)\b/i.test(q) &&
      /\b(?:prima|primadom|principles|values)\b/i.test(previous);
    const personaPropertyFact =
      /\b(?:price|handover|payment plan|availability|service charge|unit size|floor plans?)\b/i.test(q) &&
      /\b(?:property|project|building|unit|apartment|villa|residence)\b/i.test(q);
    if ((personaSubject && personaAbout || personaSelfScope || personaCapabilityExplanation ||
      founderReference || personaPrincipleContinuation || personaEmaarExperience) && !personaPropertyFact &&
      !explicitPropertyDiscovery && !explicitComparison && !explicitContactRequest &&
      !explicitRecommendationAction && !personalMemoryRecall) {
      return "persona_question";
    }

    // Never let a Persona mention swallow an explicitly requested capability.
    if (
      (personaCoreQuestion || personaFounderCreatorQuestion ||
        /^(?:prima\s*ai|(?:what(?:'s| is)|who(?:'s| is)|tell me about)\s+prima\s*ai)[?.!]*$/i.test(q)) &&
      !explicitPropertyDiscovery &&
      !explicitComparison &&
      !explicitContactRequest &&
      !explicitRecommendationAction
    ) {
      return "persona_question";
    }

  // A pure statement of buyer preferences is NOT a search instruction.
  // Use the existing A1 semantic gateway; it owns profile_update vs mixed tasks.
  // Do not create a new route or treat a question as a profile statement.
  const profileDeclaration =
    !/[?]/.test(raw) &&
    !explicitPropertyDiscovery &&
    !explicitComparison &&
    !explicitContactRequest &&
    !explicitRecommendationAction &&
    (
      /^(?:my|our)\s+(?:budget|price range|preferred (?:area|location)|preferences?)\s+(?:is|are|would be|has changed to)\b/i.test(q) ||
      /^i(?:'m| am)\s+(?:planning to buy|hoping for)\b/i.test(q) &&
      !/\b(?:apartments?|villas?|projects?|properties|homes?|residences?|townhouses?)\b/i.test(q)
    );
  if (profileDeclaration) {
    return "persona_question";
  }

  // -------------------------------------------------------
  // CLEARLY OFF-TOPIC
  // Prevent accidental market_question / paid LLM routing.
  // -------------------------------------------------------

  const clearlyOffTopic =
    /\b(write (me )?a poem|write (me )?a song|write (me )?a story|tell (me )?a joke|recipe|football score|football match|movie recommendation|song lyrics|coding help|javascript code|python code|medical advice|doctor|weather|temperature today|crypto(?:currency)?|bitcoin)\b/i
      .test(q) ||
    /^\s*\d+(?:\.\d+)?\s*[\+\-*\/]\s*\d+(?:\.\d+)?\s*[=?]?\s*$/
      .test(q);

  if (clearlyOffTopic && !/\b(?:property|properties|real estate|market|project|projects|district|districts|developer|developers|community|communities)\b/i.test(q) &&
      !explicitPropertyDiscovery && !explicitComparison &&
      !explicitRecommendationAction) {
    return "unsupported";
  }

  // -------------------------------------------------------
  // CONTACT / COMMERCIAL HANDOFF
  // -------------------------------------------------------

  // A naming request is a Persona/Profile update, not Contact. Mixed
  // Search/Compare/Recommendation still follows its explicit action route.
  if (personalNameInstruction && !explicitPropertyDiscovery &&
      !explicitComparison && !explicitRecommendationAction) {
    return "persona_question";
  }

  // A negation or passive mention does not authorize Contact.
  // Genuine opt-out state continues to be enforced by Funnel downstream.
  if (contactRefusal && !explicitPropertyDiscovery && !explicitComparison &&
      !explicitRecommendationAction) {
    return "unsupported";
  }
  if (explicitContactRequest && !explicitPropertyDiscovery && !explicitComparison &&
      !explicitRecommendationAction) {
    return "contact_intent";
  }

  // -------------------------------------------------------
  // SEARCH RESULTS → RECOMMENDATION
  //
  // SearchContextV1 resolves "these projects".
  // A request to choose/recommend among those results is
  // recommendation reasoning, not an unresolved follow-up.
  // -------------------------------------------------------

  const hasSearchResults =
    context?.search?.version ===
      "SearchContextV1" &&
    context?.search?.state ===
      "results" &&
    Array.isArray(
      context?.search?.results
    ) &&
    context.search.results.length > 0;

  const asksSearchRecommendation =
    /\b(recommend|suggest)\b/i
      .test(q) ||
    /\b(?:which|what)\b[\s\S]{0,80}\bwould you choose\b/i
      .test(q) ||
    /\b(?:which|what)\b[\s\S]{0,80}\b(?:better|best|strongest)\b/i
      .test(q) ||
    /\b(best|strongest)\b[\s\S]{0,50}\b(for me|for us|option|project|choice)\b/i
      .test(q);

  if (
    hasSearchResults &&
    asksSearchRecommendation
  ) {
    return "recommendation";
  }


  // -------------------------------------------------------
  // FOLLOW-UP
  // Requires existing conversation/page context.
  // -------------------------------------------------------


  // E32_CONTEXTUAL_DEVELOPER_FOLLOWUP_V1
  // Specific contextual property-development question.
  if (
    /^where\s+does\s+(?:it|this developer|that developer)\s+(?:(?:mainly|mostly|typically)\s+)?(?:develop|build)(?:\s+projects)?\s*[?.!]*(?:\s+copy)?$/i.test(raw) &&
    hasConversationContext(context)
  ) {
    return "page_question";
  }

  const referentialFollowUp =
    /\b(this one|that one|(?:the\s+)?(?:first|second|third)\s+(?:one|project|developer|district|area|option)|those|these|what about|how about|and this|and that|which one|why this|why that|same for)\b/i.test(q);

  if (
    referentialFollowUp &&
    !explicitComparison &&
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

  /*
    Comparison of concepts is Knowledge QA, not
    entity-to-entity comparison.

    Explicit comparison of real-estate entities
    retains the COMPARE route.

    This is a conservative deterministic guard.
    Semantic Interpreter remains responsible for
    broader natural-language classification.
  */
  const conceptualDifferenceQuestion =
    /\b(?:difference|distinction)\s+between\b/i
      .test(q) &&
    /\b(?:what|explain|understand|meaning|mean|how|difference|distinction)\b/i
      .test(q) &&
    !/\b(?:compare|comparison|versus|vs\.?|which is better)\b/i
      .test(q);

  if (conceptualDifferenceQuestion) {
    return "page_question";
  }

  if (
    /\b(compare|comparison|versus| vs |difference between|better than|which is better)\b/i.test(q)
  ) {
    return "compare";
  }

  // -------------------------------------------------------
  // CURRENT ENTITY FIT / SUITABILITY
  //
  // Example:
  // "What makes this project suitable for a family?"
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
  // HIGH-CONFIDENCE ENTITY OVERVIEW
  //
  // Entity identity is NOT guessed here.
  // Registry resolution happens later.
  // -------------------------------------------------------

  if (
    /^\s*(?:tell\s+me\s+about|what\s+can\s+you\s+tell\s+me\s+about|give\s+me\s+an?\s+overview\s+of)\s+.+?[?.!]*\s*$/i
      .test(q)
  ) {
    return "page_question";
  }


  // -------------------------------------------------------
  // RECOMMENDATION / ADVICE
  // -------------------------------------------------------

  // High-confidence entity-specific investment wording.
  // The entity itself is resolved later by Registry.
  if (
    /\b(?:good\s+(?:investment|for\s+investment)|worth\s+considering\s+for\s+investment|would\s+you\s+invest\s+in)\b/i
      .test(q) ||
    /\bwhat\s+do\s+you\s+think\s+(?:about|of)\b[\s\S]{1,120}\bfor\s+investment\b/i
      .test(q)
  ) {
    return "recommendation";
  }

  if (
    /\b(recommend|recommendation|suggest|what would you choose|what would you suggest|best for me|best for my|which area|what area|which project|what project|what suits|suitable for)\b/i.test(q)
  ) {
    return "recommendation";
  }

  // -------------------------------------------------------
  // PROPERTY DISCOVERY / SEARCH
  // -------------------------------------------------------

  // P0-01: a concrete buyer search expressed as "I'm interested in..."
  // remains Search, not Persona, market commentary or an exact fact.
  const concreteBuyerInterest =
    /^i(?:'m| am)\s+interested in\b/i.test(q) &&
    /\b(?:apartments?|villas?|townhouses?|properties|projects?|homes?|residences?)\b/i.test(q) &&
    /\b(?:under|below|near|around|aed|bedrooms?|in\s+\w+|at\s+\w+)\b/i.test(q);

  if (
    explicitPropertyDiscovery ||
    concreteBuyerInterest ||
    /\b(find|show me|show\s+(?:3|three)\s+more|looking for|search for|give me options|show options|projects under|properties under|apartments under|villas under|townhouses under)\b/i.test(q)
  ) {
    return "property_search";
  }

  // General choice criteria are advisory, not a district's exact fact.
  // This preserves an explicit NEW task after a temporary off-topic detour.
  if (/\b(?:what|which)\s+(?:should|would|do)\s+(?:i|we)\s+consider\b/i.test(q) &&
      /\b(?:choosing|selecting|buying|moving to|living in)\b/i.test(q) &&
      /\b(?:district|area|community|neighbou?rhood)\b/i.test(q)) {
    return "recommendation";
  }

  // -------------------------------------------------------
  // EXACT STRUCTURED FACT
  // -------------------------------------------------------

  if (
    recognizeStructuredFactQuestionV1(raw) ||
    /\b(price|starting price|handover|completion|payment plan|developer|district|location|located|status|unit types?|bedrooms?|size|service charge|launch date|completion date)\b/i.test(q)
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

  // Unsupported-language text must reach the existing semantic gateway
  // rather than being called a page question because a browser page is open.
  // Already-detected exact facts, Search, Compare, etc. have returned above.
  const pageLanguage = String(context?.language || context?.page?.language_code || "en")
    .toLowerCase().split("-")[0];
  if (pageLanguage !== "en" || /[^\x00-\x7F]/.test(raw) && /[^\x00-\x7F]/.test(raw.replace(/[\d\s.,!?—–-]/g, ""))) {
    return "unsupported";
  }
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
