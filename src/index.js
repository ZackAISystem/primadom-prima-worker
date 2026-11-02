import { buildCommercialContextV1 } from "./commercial-context.js";
import {
  analyzeRecommendationCriteriaV1,
  recommendationKnownConstraintsV1
} from "./recommendation-criteria.js";
import { handleD5DistrictPreview } from "./district-search-preview-v1.js";
import { handleD4DeveloperPreview } from "./developer-search-preview-v1.js";
import { discoverDevelopersV1 } from "./developer-discovery-v1.js";
import { supabaseSelect as d4SupabaseSelect } from "./supabase.js";
import { routeIntent, classifyClearlyOffTopicRequest } from "./router.js";
import { normalizeConversationTurn } from "./conversation-turn.js";
import { classifyPureBuyerProfileUpdateV1, buildBuyerProfileAcknowledgementV1 } from "./profile-update-v1.js";
import {
  evaluateFastGate,
  resolveContextualPersonaIntent,
  extractDeterministicEntityCandidate,
  detectStructuredFactKeysV1
} from "./fast-gate.js";
import { interpretRequest } from "./request-interpreter.js";
import { eligible as personaA1Eligible, generate as personaA1Generate } from "./persona-semantic-a1.js";
import {
  resolveNamedEntity,
  buildKnowledgeContext
} from "./entity-resolver.js";
import {
  extractProjectComparisonPair,
  extractProjectComparisonTarget
} from "./compare.js";
import {
  extractMemoryFacts,
  isContextualNameCandidate,
  isNonNameOnboardingReply,
  isExplicitNameOnlyMessage,
  isStandaloneGreeting,
  isExpectingNameFromRecentMessages,
  normalizeMemoryFactValue
} from "./memory.js";
import {
  extractEntityDecisionFacts,
  hasEntityDecisionSignal,
  isPureEntityDecisionStatementV1
} from "./entity-decision-memory.js";
import {
  evaluateFunnel,
  hasImmediateCommercialSignal,
  explicitHandoffRequest,
  explicitContactOptOut
} from "./funnel.js";
import {
  evaluateContactCapture,
  hasExplicitVoluntaryContactCue
} from "./contact-capture.js";
import { issueConversationAccessToken, verifyConversationAccess } from "./conversation-access.js";
import {
  primaReturnTrustedOriginV1,
  primaIssueReturnCookieV1,
  primaReadReturnSessionV1,
  primaCredentialedJsonV1,
  primaTrustedPreflightHeadersV1
} from "./return-session-v1.js";
import { presentContactHandoffH28 } from "./contact-handoff-presentation.js";
import { inspectDirectContactH29, retainDirectContactNameH30 } from "./direct-contact-intent-h29.js";
import { extractH34FirstTurnContactNameFact } from "./contact-first-turn-intro-h34.js";
import { expectedContactOnlyI32 } from "./contact-received-fastpath-i32.js";
import {
  buildContextEnvelope,
  buildLocalContextEnvelope,
  hydrateLocalConversationControlState
} from "./context.js";
import {
  refreshConversationStateV1,
  applyConversationMoveToStateV1
} from "./conversation-state.js";
import {
  recognizeConversationMove
} from "./conversation-move.js";
import {
  decideNextActionV1,
  routeForNextActionV1
} from "./decision-policy.js";
import {
  buildConversationOrderingV1
} from "./conversation-ordering.js";
import { resolveKnowledge } from "./knowledge.js";
import {
  buildPrimaSearchRequest
} from "./prima-search-request.js";
import {
  buildSearchRouteResponse
} from "./search-response.js";
import {
  resolveProjectCardFacts,
  projectCardFactsFromSearchKnowledge,
  attachProjectCardFacts
} from "./card-facts.js";
import {
  shouldResolveSearchCandidateKnowledge,
  resolveSearchCandidateKnowledge,
  mergeSearchCandidateKnowledge
} from "./search-knowledge.js";
import { buildEvidencePack } from "./evidence-pack.js";
import {
  shouldUseOpenAI,
  generatePrimaAnswer
} from "./openai-reasoning.js";
import { buildStructuredAnswer } from "./structured-answer.js";
import { buildGroundedFallback, buildVerifiedProjectOverview } from "./grounded-fallback.js";
import { buildLocalRouteAnswer } from "./local-responses.js";
import {
  getToolIds,
  canUseTool
} from "./tool-registry.js";
import {
  persistMemoryFacts,
  loadActiveMemory
} from "./memory-store.js";
import {
  persistPrimaLeadV1
} from "./prima-lead.js";
import {
  supabaseInsert,
  supabaseInsertIdempotentMessage,
  supabaseInsertIdempotentEvent,
  supabaseUpdate,
  supabaseUpdateReturning
} from "./supabase.js";


// RESTORE-02A — store only small, verified project-card display references.
// No duplicate ResponseContract JSON, contacts, memory, search data or credentials.
// This whitelist is also applied on replay; unsafe/unknown values fail closed.
function primaRestoreProjectCardsV2(input) {
  if (!Array.isArray(input)) return [];
  const result = [];
  const seen = new Set();
  const safeText = (value, limit) =>
    typeof value === "string" ? value.trim().slice(0, limit) : "";
  for (const card of input.slice(0, 10)) {
    if (result.length >= 3) break;
    const slug = safeText(card?.slug, 120);
    const canonical = safeText(card?.canonical_url, 240);
    const matched = /^\/(en|ru|hi|zh|es|fr|de|ar)\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(canonical);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        !matched || matched[2] !== slug || seen.has(slug) ||
        (card?.entity_type && card.entity_type !== "project")) continue;
    seen.add(slug);
    const facts = card?.facts || {};
    const image = safeText(card?.gallery_1, 800);
    const safeImage = /^https:\/\/[^\s<>"']+$/.test(image) ||
      /^\/images\/[a-zA-Z0-9_./-]+$/.test(image) ? image : "";
    result.push({
      entity_type:"project", slug, canonical_url:canonical,
      gallery_1:safeImage,
      image_alt:safeText(card?.image_alt, 160),
      facts: {
        title:safeText(facts.title, 160),
        price_display:safeText(facts.price_display, 80),
        district:safeText(facts.district, 120),
        developer:safeText(facts.developer, 120)
      }
    });
  }
  return result;
}

// G24_COLD_START_VIEWING_PROJECT_V1
// Extract ONLY an explicitly named, simple in-person viewing question.
// A name is never trusted until the existing Registry confirms one project.
// No assumption about project availability or permission to collect contact.
function extractColdStartViewingProjectV1(message = "") {
  const text = String(message || "").trim();
  if (!text || text.length > 220 || explicitHandoffRequest(text) ||
      explicitContactOptOut(text) ||
      /\b(?:compare|recommend|shortlist|book|schedule|arrange|contact|call|whatsapp|email)\b/i.test(text)) return null;

  const match = text.match(
    /^(?:(?:can|could|may)\s+(?:i|we)\s+|is\s+it\s+possible\s+to\s+)(?:view|see|visit|tour)\s+(?:the\s+)?(.+?)\s*[?.!]*$/i
  );
  if (!match) return null;

  const name = String(match[1] || "")
    .replace(/\s+(?:(?:next|this)\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|today|on\s+(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s*$/i, "")
    .replace(/\s*[?.!]+$/, "")
    .trim();
  if (!name || name.length > 90 || !/^[a-z0-9][a-z0-9 &'.-]*$/i.test(name) ||
      name.split(/\s+/).length > 8) return null;
  return {type: "project", name, role: "primary", source: "g24_cold_start_viewing_registry_required"};
}
// END_G24_COLD_START_VIEWING_PROJECT_V1

/*
  TOPIC_BOUNDARY_V1: a user can say "back to real estate" and ask a
  *new* substantive question in the same turn. Only such an explicit
  question defeats the suspended-topic resume. Bare "back to ..." still
  belongs to Conversation Control and uses the existing resume logic.
*/
function explicitNewTaskAfterReturnV1(message = "", context = {}) {
  const m = String(message || "").trim().match(
    /^(?:(?:alright|okay|ok|so|now|anyway)[,\s]+)?(?:let'?s\s+)?back\s+to\s+(?:real\s+estate|property|properties|the\s+property\s+search)\s*[.!,:;–—-]+\s*(.+)$/i
  );
  if (!m) return null;
  const actual = String(m[1] || "").trim();
  if (!/^(?:what|which|how|where|can|could|would|should|do|does|is|are|show|find|search|compare|recommend|suggest|tell|explain)\b/i.test(actual)) return null;
  const route = routeIntent(actual, context);
  return ["market_question", "page_question", "recommendation", "property_search", "compare", "exact_fact", "follow_up"].includes(route)
    ? route : null;
}

function protectTopicMoveV1({move, message, originalRoute, freshRoute}) {
  if (!move?.effective_route) return move;
  // Clear personal/off-topic turn: never silently turn into live-market QA.
  if (originalRoute === "unsupported" && classifyClearlyOffTopicRequest(message)) {
    return {...move, move_type: "temporary_tangent", effective_route: "unsupported",
      reason: "explicit_off_topic_request"};
  }
  // A complete new buyer question is not an implicit request to repeat Persona.
  if (freshRoute && freshRoute !== "persona_question" &&
      (move.move_type === "resume" || move.effective_route === "persona_question")) {
    return {...move, move_type: "switch", effective_route: freshRoute,
      reason: "explicit_new_task_after_return"};
  }
  return move;
}

/*
  Block C — resumed conversation self-reference.

  Restoring a thread does not imply re-executing its
  capability. A question about previously supplied
  user constraints can be answered from ConversationStateV1.

  Conservative by design: explicit resume + identifiable
  personal-context question only. Other resume turns
  retain their existing action policy.
*/
function buildResumedContextReferenceV1({
  message = "",
  conversationMove = null,
  context = null
} = {}) {
  if (
    conversationMove?.move_type !== "resume" ||
    conversationMove?.reason !==
      "explicit_resume_to_suspended_thread"
  ) {
    return null;
  }

  const text = String(message || "");

  const personalReference =
    /\b(?:my|i|me|we|our)\b/i.test(text);

  const recallRequest =
    /\b(?:remember|remind|recall|did i (?:say|tell|mention)|have i (?:said|told|mentioned)|what (?:was|is|did)|which (?:was|is))\b/i
      .test(text);

  const explicitSearch =
    /\b(?:show|find|search|list|browse|display)\s+(?:me\s+)?(?:more\s+)?(?:properties|projects|homes|apartments|options|results)\b/i
      .test(text);

  if (
    !personalReference ||
    !recallRequest ||
    explicitSearch
  ) {
    return null;
  }

  const previous =
    context?.conversation?.dialogue_state || {};

  const saved =
    previous?.continuity_references
      ?.suspended_thread
      ?.request_state ||
    previous?.request_state ||
    {};

  const parts = [];

  const asksBudget =
    /\b(?:budget|price range|spending limit|afford)\b/i
      .test(text);

  const asksGoal =
    /\b(?:looking for|goal|objective|priority|priorities|investment aim)\b/i
      .test(text);

  const asksLocation =
    /\b(?:location|area|district|where)\b/i
      .test(text);

  const asksBedrooms =
    /\b(?:bedrooms?|beds?)\b/i
      .test(text);

  if (
    !asksBudget &&
    !asksGoal &&
    !asksLocation &&
    !asksBedrooms
  ) {
    return null;
  }

  const formatAED = value => {
    const n = Number(value);

    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }

    return "AED " + n.toLocaleString("en-US");
  };

  if (asksBudget) {
    const min =
      formatAED(saved?.budget?.min_aed);

    const max =
      formatAED(saved?.budget?.max_aed);

    if (min && max) {
      parts.push(
        "Your saved budget is " + min +
        " to " + max + "."
      );
    } else if (max) {
      parts.push(
        "You told me your budget is up to " +
        max + "."
      );
    } else if (min) {
      parts.push(
        "You indicated a budget starting from " +
        min + "."
      );
    }
  }

  if (asksGoal) {
    const goal =
      saved?.goal ||
      previous?.continuity_references
        ?.suspended_thread
        ?.active_thread
        ?.active_goal ||
      previous?.active_thread?.active_goal;

    if (typeof goal === "string" && goal.trim()) {
      parts.push(
        "Your saved goal is " + goal.trim() + "."
      );
    }
  }

  if (asksLocation && saved?.location) {
    parts.push(
      "Your preferred location is " +
      String(saved.location) + "."
    );
  }

  if (
    asksBedrooms &&
    saved?.bedrooms != null
  ) {
    parts.push(
      "You specified " +
      String(saved.bedrooms) +
      " bedroom(s)."
    );
  }

  if (!parts.length) {
    return null;
  }

  return {
    version: "ResumedContextReferenceV1",
    action: "REFERENCE",
    answer: parts.join(" ")
  };
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...cors
    }
  });

function buildResponse({
  conversationId,
  route,
  answer
}) {
  return {
    version: "ResponseContractV1",
    conversation_id: conversationId,
    route,
    response_type: "answer",
    answer,
    cards: [],
    follow_up: null,
    lead_action: null,
    meta: {
      language: "en",
      used_openai: false,
      used_database: false,
      used_search: false
    }
  };
}

// P0_PERSONA_CONTACT_CONSENT_BOUNDARY_20261022
// A Persona/refusal/name turn must never authorize a contact request merely
// because the Router, semantic model or Funnel detects a contact-related word.
// This is authorization, not semantic routing or a catalogue of answers.
function inspectPersonaContactConsentV1({ message = "", route = "", activeMemory = [] } = {}) {
  const raw = String(message || "").trim();
  const normalized = raw.replaceAll("’", "'");
  // Do not confuse declining a phone channel with declining the handoff.
  // Permanent contact opt-out, channel preference and conditional interest
  // are distinct permissions; Funnel owns commercial timing.
  const refusal = explicitContactOptOut(normalized);
  const channelPreference = /\b(?:phone|whatsapp|number)\b/i.test(normalized) &&
    /\b(?:rather not|prefer not|don't want|do not want|without|no phone)\b/i.test(normalized);
  const conditionalInterest = /\b(?:viewing|site visit|property visit)\b/i.test(normalized) &&
    /\b(?:consider|explore|might|may|thinking|planning|move towards|work towards|before arranging)\b/i.test(normalized) &&
    !/\b(?:don't|do not|never)\s+(?:contact|call|message)\s+me\b/i.test(normalized);
  const naming = /\b(?:(?:you\s+can\s+)?call\s+me|address\s+me\s+as|refer\s+to\s+me\s+as)\s+(?!back\b|later\b|tomorrow\b|today\b|now\b|soon\b|at\b|on\b|when\b|about\b|regarding\b|for\b|again\b)[\p{L}][\p{L}'’-]{1,35}(?=\s*(?:$|[.!?,]|\s+(?:for|in|from|instead|please|and)\b))/iu.test(normalized) ||
    /\b(?:my name is|i go by|you may address me as)\s+[\p{L}][\p{L}'’-]{1,35}\b/iu.test(normalized);
  // A name in a combined message must not suppress an explicit request to
  // contact the client, or a self-offered contact. Name-only onboarding is separate.
  const contactOfferedByUser = hasExplicitVoluntaryContactCue(normalized);
  const h29DirectRequest = inspectDirectContactH29(normalized).direct_request;
  const namingOnly = naming && !explicitHandoffRequest(normalized) && !contactOfferedByUser && !h29DirectRequest;
  // Positive evidence must be in the user's CURRENT text, never a model route.
  const explicitRequest = !refusal && !namingOnly &&
    (explicitHandoffRequest(normalized) || h29DirectRequest) &&
    !/\b(?:not ready|not yet|don't want|do not want)\s+(?:to\s+)?(?:book|arrange|schedule|contact)\b/i.test(normalized);
  const positiveRequest = explicitRequest;
  const prior = [...(Array.isArray(activeMemory) ? activeMemory : [])]
    .reverse().find(fact => fact?.fact_key === "funnel_state")?.fact_value || null;
  const consentFollowThrough = !refusal && !namingOnly &&
    ["handoff_accepted", "awaiting_contact"].includes(prior?.status);
  const acceptance = !refusal && !namingOnly && prior?.status === "cta_offered" &&
    /^(?:yes(?:,? please)?|sure|okay|ok|please do|go ahead|let's do it|connect me|sounds good)[.!\s]*$/i.test(normalized);
  const consent = Boolean(positiveRequest || consentFollowThrough || acceptance || (!refusal && contactOfferedByUser));
  const personaScope = ["persona_question", "unsupported", "contact_intent"].includes(route);
  const priorOfferDecline = prior?.status === "cta_offered" &&
    /^(?:not now|no thanks|no thank you|maybe later|not yet|i(?:'m| am) not ready)\b/i.test(normalized);
  const suppress = refusal || namingOnly ||
    (personaScope && !consent && !conditionalInterest && !priorOfferDecline);
  const hasOtherTask = /\b(?:find|show|search|compare|recommend|explain|tell me about|what|which|how|why)\b/i.test(normalized) &&
    /\b(?:property|properties|projects?|developers?|districts?|areas?|prices?|payment|investment|compare)\b/i.test(normalized);
  return { refusal, naming: namingOnly, consent, suppress, hasOtherTask, prior,
    explicitRequest, conditionalInterest, priorOfferDecline, channelPreference };
}
// END_P0_PERSONA_CONTACT_CONSENT_BOUNDARY_20261022


// G19_PROPERTY_VIEWING_SCOPE_RECOVERY_V1
// The semantic model can label a feasibility question as contact_intent.
// Lack of contact authorization must NOT turn a verified property question
// into OFF_TOPIC. This classifier only selects Knowledge; it never consents.
function isUnconsentedProjectViewingQuestionV1({message = "", context = null, authorization = null} = {}) {
  if (authorization?.consent || authorization?.refusal || authorization?.naming ||
      explicitHandoffRequest(message) || explicitContactOptOut(message)) return false;

  const state = context?.conversation?.dialogue_state || {};
  const current = state?.continuity_references?.current_entity;
  const verified = Array.isArray(state?.e21_verified_entities) &&
    state.e21_verified_entities.some(entity =>
      entity?.type === "project" &&
      entity?.slug === current?.slug &&
      typeof entity.slug === "string" && entity.slug.length > 0);
  if (!verified || current?.type !== "project") return false;

  const text = String(message || "").trim();
  // A genuine question about whether an in-person viewing is possible,
  // not a request to collect details, contact the user or book immediately.
  const viewing = /\b(?:viewings?|view|visit|visiting|see|tour|show[ -]?units?)\b/i.test(text);
  // A verified, explicitly named project also establishes property context.
  // No specific project names or user phrases are hard-coded here.
  const projectName = String(current.slug || "")
    .replace(/-/g, " ").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  const normalizedText = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const namesCurrentProject = projectName.length >= 3 &&
    normalizedText.includes(" " + projectName + " ");
  const property = /\b(?:apartments?|units?|properties|projects?|layouts?|floor[ -]?plans?|show[ -]?units?)\b/i.test(text) || namesCurrentProject;
  const feasibility = /\b(?:possible|whether|availability|could\s+i|can\s+i|would\s+it|what|which|how|is\s+there|are\s+there)\b/i.test(text);
  const directArrangement = /\b(?:please|can\s+you|could\s+you|would\s+you)\s+(?:help\s+me\s+)?(?:book|schedule|arrange|organize|set\s+up)\b/i.test(text);
  const selectionTask = /\b(?:compare|recommend|suggest|find\s+me|show\s+me\s+more|search\s+for)\b/i.test(text) ||
    /\b(?:please|can\s+you|could\s+you|would\s+you)\s+shortlist\b/i.test(text);
  return viewing && property && feasibility && !directArrangement && !selectionTask;
}
// END_G19_PROPERTY_VIEWING_SCOPE_RECOVERY_V1

function emptyKnowledgePack(route) {
  return {
    version: "NoKnowledgeRequiredV1",
    resolved: false,
    page: null,
    blocks: [],
    relations: [],
    meta: {
      route,
      page_type: null,
      blocks_loaded: 0,
      relations_loaded: 0,
      used_database: false,
      resolver_latency_ms: 0,
      database_calls: 0,
      retrieval_mode: "not_required"
    }
  };
}



function isGlobalNoKnowledgeGuard(
  message
) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  const paymentPlan =
    /\b(payment plan|payment schedule|installment plan|instalment plan|installments|instalments)\b/i
      .test(q);

  const liveAvailability =
    /\b(availability|available right now|available now|units? available|live inventory|inventory now)\b/i
      .test(q);

  return (
    paymentPlan ||
    liveAvailability
  );
}



const PROPERTY_SEARCH_CONSTRAINT_FACT_KEYS_V1 =
  new Set([
    "budget_min_aed",
    "budget_max_aed",
    "bedrooms",
    "property_type",
    "preferred_location_text",
    "purchase_timeline_text",
    "buyer_goal"
  ]);


function promoteConstraintLedPropertySearchRoute(
  route,
  facts = []
) {
  if (route !== "unsupported") {
    return route;
  }

  const hasSearchConstraint =
    (Array.isArray(facts) ? facts : [])
      .some(fact => {
        if (
          !PROPERTY_SEARCH_CONSTRAINT_FACT_KEYS_V1
            .has(fact?.fact_key)
        ) {
          return false;
        }

        const value =
          fact?.fact_value;

        return (
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
        );
      });

  return hasSearchConstraint
    ? "property_search"
    : route;
}


function canUseStatelessFastPath({
  body,
  message,
  route
}) {
  if (
    route === "persona_question" ||
    route === "market_question" ||
    route === "unsupported" ||
    isGlobalNoKnowledgeGuard(message)
  ) {
    return true;
  }

  const hasResolvedPage =
    Boolean(
      body?.page?.page_id &&
      body?.page?.page_type
    );

  const hasResolvedEntity =
    Boolean(
      body?.entity?.primary_type &&
      body?.entity?.primary_slug
    );

  if (
    !hasResolvedPage ||
    !hasResolvedEntity
  ) {
    return false;
  }

  /*
    Explicit project comparison does not need
    synchronous conversation/history reads.

    The Compare Bundle RPC already returns:
    - both projects
    - selected knowledge
    - active client memory

    Referential targets remain on the full
    conversation path.
  */
  if (
    route === "compare" &&
    body?.entity?.primary_type === "project"
  ) {
    const target =
      extractProjectComparisonTarget(
        message,
        body?.entity?.primary_slug || ""
      );

    const needsHistory =
      /\b(this one|that one|the first one|the second one|the third one|first one|second one|third one|previous one|earlier one|those|these)\b/i
        .test(
          target || ""
        );

    return Boolean(
      target &&
      !needsHistory
    );
  }

  if (route === "exact_fact") {
    return true;
  }

  if (route !== "page_question") {
    return false;
  }

  /*
    These phrases can depend on earlier
    conversation state/preferences.
    Keep them on the full-context path.
  */
  const needsConversationHistory =
    /\b(the other|other one|another one|previous|earlier|same one|as before|for us|for me|my preferences|our preferences|those options|these options)\b/i
      .test(message);

  return !needsConversationHistory;
}


function mergeCurrentTurnMemory(
  existingMemory = [],
  currentFacts = []
) {
  const byKey = new Map();

  for (const fact of existingMemory || []) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      fact
    );
  }

  for (const fact of currentFacts || []) {
    if (!fact?.fact_key) {
      continue;
    }

    byKey.set(
      fact.fact_key,
      {
        fact_key:
          fact.fact_key,

        fact_value:
          fact.fact_value,

        confidence:
          fact.confidence,

        updated_at:
          new Date().toISOString(),

        source:
          "current_turn"
      }
    );
  }

  return [...byKey.values()];
}


function buildConversationPatch(
  body,
  route,
  dialogueState = null
) {
  const patch = {
    current_intent: route,
    last_message_at:
      new Date().toISOString()
  };

  if (body?.page?.page_id) {
    patch.current_page_id =
      body.page.page_id;
  }

  if (body?.page?.page_type) {
    patch.current_page_type =
      body.page.page_type;
  }

  if (body?.page?.url_path) {
    patch.current_url_path =
      body.page.url_path;
  }

  if (body?.page?.canonical_url_path) {
    patch.current_canonical_url_path =
      body.page.canonical_url_path;
  }

  if (body?.page?.language_code) {
    patch.language_code =
      body.page.language_code;
  }

  if (body?.entity?.primary_type) {
    patch.current_primary_entity_type =
      body.entity.primary_type;
  }

  if (body?.entity?.primary_slug) {
    patch.current_primary_entity_slug =
      body.entity.primary_slug;
  }

  if (body?.entity?.secondary_type) {
    patch.current_secondary_entity_type =
      body.entity.secondary_type;
  }

  if (body?.entity?.secondary_slug) {
    patch.current_secondary_entity_slug =
      body.entity.secondary_slug;
  }

  if (
    dialogueState?.version ===
      "ConversationStateV1"
  ) {
    patch.dialogue_state =
      dialogueState;
  }

  return patch;
}


async function persistDeterministicNameTurn({
  env,
  conversationId,
  body,
  message,
  facts = [],
  answer,
  kind = "name_onboarding"
}) {
  const route =
    "persona_question";

  const userRows =
    await supabaseInsertIdempotentMessage(
      env,
      "messages",
      {
        conversation_id:
          conversationId,

        turn_id:
          body?.turn?.turn_id || null,

        turn_seq:
          body?.turn?.turn_seq ?? null,

        turn_phase:
          body?.turn?.phase || null,

        role:
          "user",

        content:
          message,

        route,

        page_id:
          body?.page?.page_id ||
          null,

        page_type:
          body?.page?.page_type ||
          null,

        primary_entity_type:
          body?.entity?.primary_type ||
          null,

        primary_entity_slug:
          body?.entity?.primary_slug ||
          null,

        secondary_entity_type:
          body?.entity?.secondary_type ||
          null,

        secondary_entity_slug:
          body?.entity?.secondary_slug ||
          null,

        metadata: {
          contract:
            "ContextEnvelopeV1",
          kind:
            `${kind}_turn`
        }
      },
      "message_id,created_at"
    );

  const userMessageId =
    userRows?.[0]?.message_id ||
    null;

  await Promise.all([
    facts.length > 0
      ? persistMemoryFacts(
          env,
          {
            conversationId,

            visitorId:
              body?.visitor_id ||
              null,

            sourceMessageId:
              userMessageId,

            facts
          }
        )
      : Promise.resolve([]),

    supabaseInsertIdempotentMessage(
      env,
      "messages",
      {
        conversation_id:
          conversationId,

        turn_id:
          body?.turn?.turn_id || null,

        turn_seq:
          body?.turn?.turn_seq ?? null,

        turn_phase:
          body?.turn?.phase || null,

        role:
          "assistant",

        content:
          answer,

        route,

        response_type:
          "answer",

        page_id:
          body?.page?.page_id ||
          null,

        page_type:
          body?.page?.page_type ||
          null,

        primary_entity_type:
          body?.entity?.primary_type ||
          null,

        primary_entity_slug:
          body?.entity?.primary_slug ||
          null,

        secondary_entity_type:
          body?.entity?.secondary_type ||
          null,

        secondary_entity_slug:
          body?.entity?.secondary_slug ||
          null,

        metadata: {
          contract:
            "PersonaV1",
          kind:
            `${kind}_response`,
          used_openai:
            false
        }
      },
      "message_id,created_at"
    )
  ]);

  const response =
    buildResponse({
      conversationId,
      route,
      answer
    });

  response.turn =
    body?.turn ||
    null;

  response.meta.used_database =
    true;

  response.meta.used_openai =
    false;

  response.meta.used_search =
    false;

  response.meta.used_interpreter =
    false;

  response.meta.used_final_openai =
    false;

  response.meta.interpreter_latency_ms =
    0;

  response.meta.final_openai_latency_ms =
    0;

  response.meta.interpreter_input_tokens =
    0;

  response.meta.interpreter_output_tokens =
    0;

  response.meta.final_input_tokens =
    0;

  response.meta.final_output_tokens =
    0;

  response.meta.total_openai_tokens =
    0;

  response.meta.name_onboarding_requested =
    false;

  return response;
}


/*
 * MEM07: only explicit, profile-only EN statements use this narrow local path.
 * No Search V3 / Request Interpreter / Persona A1 / Funnel / Lead is invoked.
 * Canonical storage stays prima.memory_facts; Conversation State is updated
 * through the existing guarded conversation-turn ordering mechanism.
 */
async function persistDeterministicProfileTurnV1({
  env, conversationId, body, message, facts
}) {
  const [priorFacts, envelope] = await Promise.all([
    loadActiveMemory(env, conversationId),
    buildContextEnvelope(env, body, message, [])
  ]);
  const merged = mergeCurrentTurnMemory(priorFacts, facts);
  envelope.memory.active_facts = merged;

  const previousTopic =
    envelope.conversation?.dialogue_state?.active_thread?.active_topic ||
    envelope.conversation?.current_intent ||
    "follow_up";
  const activeTopic = [
    "property_search", "recommendation", "compare", "page_question",
    "exact_fact", "market_question", "follow_up"
  ].includes(previousTopic) ? previousTopic : "follow_up";

  const state = refreshConversationStateV1(envelope, {
    route: activeTopic,
    response_type: "answer"
  });
  // This is a profile statement, not a new Search or a change of thread.
  state.dialogue_mechanics.last_user_intent = "follow_up";
  state.dialogue_mechanics.last_route = "follow_up";
  const answer = buildBuyerProfileAcknowledgementV1(facts, merged);
  const response = buildResponse({
    conversationId, route: "follow_up", answer
  });
  response.turn = body?.turn || null;
  response.meta = {
    ...response.meta,
    used_database: true,
    used_interpreter: false,
    used_final_openai: false,
    used_openai: false,
    used_search: false,
    total_openai_tokens: 0,
    openai_calls_attempted: 0,
    interpreter_input_tokens: 0,
    interpreter_output_tokens: 0,
    final_input_tokens: 0,
    final_output_tokens: 0,
    next_action: "PROFILE_UPDATE",
    next_action_reason: "mem07_explicit_pure_profile_update"
  };

  // Guard ordering before modifying a new conversation state or memory.
  const ordering = buildConversationOrderingV1({
    conversationId, turn: body?.turn
  });
  const patch = {
    ...buildConversationPatch(body, activeTopic, state),
    ...ordering.patch
  };
  if (ordering.guarded) {
    const updated = await supabaseUpdateReturning(
      env, "conversations", ordering.query, patch
    );
    if (updated.length === 0) {
      throw new Error("mem07_stale_or_duplicate_turn");
    }
  } else {
    await supabaseUpdate(env, "conversations",
      `conversation_id=eq.${conversationId}`, patch);
  }

  const commonMessage = {
    conversation_id: conversationId,
    turn_id: body?.turn?.turn_id || null,
    turn_seq: body?.turn?.turn_seq ?? null,
    turn_phase: body?.turn?.phase || null,
    page_id: body?.page?.page_id || null,
    page_type: body?.page?.page_type || null,
    primary_entity_type: body?.entity?.primary_type || null,
    primary_entity_slug: body?.entity?.primary_slug || null,
    secondary_entity_type: body?.entity?.secondary_type || null,
    secondary_entity_slug: body?.entity?.secondary_slug || null
  };
  const userRows = await supabaseInsertIdempotentMessage(env, "messages", {
    ...commonMessage,
    role: "user", content: message, route: "follow_up",
    metadata: {contract:"ContextEnvelopeV1",kind:"mem07_profile_update"}
  }, "message_id,created_at");
  const sourceMessageId = userRows?.[0]?.message_id || null;
  if (!sourceMessageId) throw new Error("mem07_user_message_not_saved");
  const saved = await persistMemoryFacts(env, {
    conversationId, visitorId: body?.visitor_id || null,
    sourceMessageId, facts
  });
  if (!Array.isArray(saved) || saved.length !== facts.length) {
    throw new Error("mem07_memory_not_saved");
  }
  await supabaseInsertIdempotentMessage(env, "messages", {
    ...commonMessage,
    role: "assistant", content: answer, route: "follow_up",
    response_type: "answer", used_openai: false, used_database: true,
    used_search: false,
    metadata: {contract:"ResponseContractV1",kind:"mem07_profile_ack",used_openai:false}
  }, "message_id,created_at");
  if (env?.PRIMA_PERSONA_DIAGNOSTICS === "1") {
    response.meta.conversation_state = state;
  }
  return response;
}


/*
 * MEM11 — deterministic, verified project decision.
 * The resolved project MUST come from active verified conversation
 * state or a previously resolved project message; no slug guessing.
 * Normal Search/Contact/Mixed requests never enter this path.
 */
async function persistDeterministicEntityDecisionTurnV1({
  env, conversationId, body, message
}) {
  const [priorFacts, envelope] = await Promise.all([
    loadActiveMemory(env, conversationId),
    buildContextEnvelope(env, body, message, [])
  ]);
  const facts = extractEntityDecisionFacts({
    message, context: envelope, activeMemory: priorFacts
  });
  const decision = facts.find(f =>
    String(f?.fact_key || "").startsWith("project_decision:")
  );
  if (!decision || facts.length < 2) return null;

  const slug = decision.fact_value?.entity_slug;
  const status = decision.fact_value?.status;
  if (!slug || !["interested", "shortlisted", "rejected"].includes(status)) {
    return null;
  }
  // The local zero-token decision path requires E21-verified provenance.
  // Do not mistake a client-supplied page/entity slug or an unverified
  // conversation_state reference for verified project identity.
  const verified = envelope.conversation?.dialogue_state?.e21_verified_entities;
  if (!Array.isArray(verified) || !verified.some(item =>
    item?.type === "project" && item?.slug === slug
  )) return null;
  const merged = mergeCurrentTurnMemory(priorFacts, facts);
  envelope.memory.active_facts = merged;
  const previousTopic =
    envelope.conversation?.dialogue_state?.active_thread?.active_topic;
  const activeTopic = [
    "page_question", "property_search", "recommendation", "compare",
    "exact_fact", "market_question", "follow_up"
  ].includes(previousTopic) ? previousTopic : "follow_up";
  const state = refreshConversationStateV1(envelope, {
    route: activeTopic, response_type: "answer"
  });
  state.dialogue_mechanics.last_user_intent = "follow_up";
  state.dialogue_mechanics.last_route = "follow_up";
  // Keep a proven project as the live entity; do not change the search.
  state.continuity_references.current_entity = {type: "project", slug};
  // Preserve the verified E21 proof for later decisions and references.
  const priorVerified = envelope.conversation?.dialogue_state?.e21_verified_entities;
  if (Array.isArray(priorVerified)) state.e21_verified_entities = priorVerified;

  const displayName = slug.split("-").map(w =>
    w ? w[0].toUpperCase() + w.slice(1) : w
  ).join(" ");
  const answer = status === "interested"
    ? `Noted — you're interested in ${displayName}. I'll remember that when we compare options.`
    : status === "shortlisted"
    ? `Added ${displayName} to your shortlist. I'll keep it in mind for future comparisons.`
    : `Understood — I'll mark ${displayName} as not suitable${
        decision.fact_value?.reason ? ` because ${decision.fact_value.reason}` : ""
      } and take that into account in future recommendations.`;

  const ordering = buildConversationOrderingV1({
    conversationId, turn: body?.turn
  });
  const patch = {
    ...buildConversationPatch(body, activeTopic, state),
    ...ordering.patch
  };
  if (ordering.guarded) {
    const updated = await supabaseUpdateReturning(
      env, "conversations", ordering.query, patch
    );
    if (updated.length === 0) {
      throw new Error("mem11_stale_or_duplicate_turn");
    }
  } else {
    await supabaseUpdate(env, "conversations",
      `conversation_id=eq.${conversationId}`, patch);
  }

  const commonMessage = {
    conversation_id: conversationId,
    turn_id: body?.turn?.turn_id || null,
    turn_seq: body?.turn?.turn_seq ?? null,
    turn_phase: body?.turn?.phase || null,
    page_id: body?.page?.page_id || null,
    page_type: body?.page?.page_type || null,
    primary_entity_type: "project",
    primary_entity_slug: slug,
    secondary_entity_type: body?.entity?.secondary_type || null,
    secondary_entity_slug: body?.entity?.secondary_slug || null
  };
  const userRows = await supabaseInsertIdempotentMessage(
    env, "messages", {
      ...commonMessage, role: "user", content: message, route: "follow_up",
      metadata: {contract: "ContextEnvelopeV1", kind: "mem11_decision_update"}
    }, "message_id,created_at"
  );
  const sourceMessageId = userRows?.[0]?.message_id || null;
  if (!sourceMessageId) throw new Error("mem11_user_message_not_saved");
  const saved = await persistMemoryFacts(env, {
    conversationId, visitorId: body?.visitor_id || null,
    sourceMessageId, facts
  });
  if (!Array.isArray(saved) || saved.length !== facts.length) {
    throw new Error("mem11_decision_memory_not_saved");
  }
  await supabaseInsertIdempotentMessage(env, "messages", {
    ...commonMessage, role: "assistant", content: answer, route: "follow_up",
    response_type: "answer", used_openai: false, used_database: true,
    used_search: false,
    metadata: {
      contract: "ResponseContractV1", kind: "mem11_decision_ack",
      used_openai: false
    }
  }, "message_id,created_at");
  const response = buildResponse({
    conversationId, route: "follow_up", answer
  });
  response.turn = body?.turn || null;
  response.meta = {
    ...response.meta,
    used_database: true, used_openai: false, used_search: false,
    used_interpreter: false, used_final_openai: false,
    total_openai_tokens: 0, openai_calls_attempted: 0,
    interpreter_input_tokens: 0, interpreter_output_tokens: 0,
    final_input_tokens: 0, final_output_tokens: 0,
    next_action: "DECISION_UPDATE",
    next_action_reason: "mem11_verified_pure_project_decision"
  };
  if (env?.PRIMA_PERSONA_DIAGNOSTICS === "1") {
    response.meta.conversation_state = state;
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    // D5 local preview. Uses the already enabled local search preview flag.
    if ((env?.PRIMA_D4_PREVIEW === "1" ||
         env?.PRIMA_SEARCH_PRODUCTION === "1") &&
        new URL(request.url).pathname === "/__prima_d5_districts") {
      const origin = request.headers.get("Origin") || "";
      const hostname = new URL(request.url).hostname;
      const productionOrigins = {
        "api.primadom.ai": "https://prima.primadom.ai",
        "api-staging.primadom.ai": "https://prima-staging.primadom.ai"
      };

      const productionAllowed =
        env?.PRIMA_SEARCH_PRODUCTION === "1" &&
        productionOrigins[hostname] === origin &&
        Boolean(productionOrigins[hostname]);

      const localAllowed =
        env?.PRIMA_D4_PREVIEW === "1" &&
        ["localhost", "127.0.0.1"].includes(hostname) &&
        ["http://localhost:4173", "http://127.0.0.1:4173"].includes(origin);

      const allowed = productionAllowed || localAllowed;

      if (!allowed) {
        return Response.json(
          {ok:false,error:"origin_not_allowed"},
          {status:403,headers:{"Vary":"Origin"}}
        );
      }
      const h = allowed ? {
        "Access-Control-Allow-Origin":origin,
        "Access-Control-Allow-Methods":"GET, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type",
        "Vary":"Origin"
      } : {};
      if (request.method === "OPTIONS") {
        return new Response(null,{status:204,headers:h});
      }
      const result = await handleD5DistrictPreview(request,env);
      const headers = new Headers(result.headers);
      for (const [key,value] of Object.entries(h)) headers.set(key,value);
      return new Response(result.body,{status:result.status,headers});
    }
    // D4 preview only. Disabled by default.
    if (
      (env?.PRIMA_D4_PREVIEW === "1" ||
       env?.PRIMA_SEARCH_PRODUCTION === "1") &&
      new URL(request.url).pathname === "/__prima_d4_developers"
    ) {
      const origin = request.headers.get("Origin") || "";
      const hostname = new URL(request.url).hostname;
      const productionOrigins = {
        "api.primadom.ai": "https://prima.primadom.ai",
        "api-staging.primadom.ai": "https://prima-staging.primadom.ai"
      };

      const productionAllowed =
        env?.PRIMA_SEARCH_PRODUCTION === "1" &&
        productionOrigins[hostname] === origin &&
        Boolean(productionOrigins[hostname]);

      const localAllowed =
        env?.PRIMA_D4_PREVIEW === "1" &&
        ["localhost", "127.0.0.1"].includes(hostname) &&
        ["http://localhost:4173", "http://127.0.0.1:4173"].includes(origin);

      const allowed = productionAllowed || localAllowed;

      if (!allowed) {
        return Response.json(
          {ok:false,error:"origin_not_allowed"},
          {status:403,headers:{"Vary":"Origin"}}
        );
      }

      const corsHeaders = allowed ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      } : {};

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const response = await handleD4DeveloperPreview(request, env);
      const headers = new Headers(response.headers);

      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        headers
      });
    }

    const url = new URL(request.url);

    // Sensitive diagnostics are never public merely because ?debug=1 was supplied.
    const debugEnabled =
      url.searchParams.get("debug") === "1" &&
      env.PRIMA_PERSONA_DIAGNOSTICS === "1" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: primaTrustedPreflightHeadersV1(request) || cors
      });
    }

    // =====================================================
    // HEALTH
    // =====================================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/prima/health"
    ) {
      return json({
        ok: true,
        service: "primadom-prima-worker",
        version: "0.3.0",
        phase: "day-1-memory",
        language: "en",
        supabase_configured: Boolean(
          env.SUPABASE_REST_URL &&
          env.SUPABASE_SECRET_KEY
        ),
        timestamp: new Date().toISOString()
      });
    }

    // RESTORE-03A — secure return in the same browser, not user identity.
    // Cookie is HttpOnly, signed and short-lived; disabled on workers.dev.
    if (request.method === "POST" &&
        url.pathname === "/api/prima/conversation/session/attach") {
      if (!primaReturnTrustedOriginV1(request)) {
        return primaCredentialedJsonV1(request,{ok:false,error:"origin_not_allowed"},403);
      }
      let body = null;
      try { body = await request.json(); }
      catch { return primaCredentialedJsonV1(request,{ok:false,error:"invalid_json"},400); }
      const id = String(body?.conversation_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
          !(await verifyConversationAccess(request,env,id))) {
        return primaCredentialedJsonV1(request,{ok:false,error:"conversation_access_denied"},403);
      }
      try {
        const cookie = await primaIssueReturnCookieV1(request,env,id);
        if (!cookie) return primaCredentialedJsonV1(request,{ok:true,status:"host_unconfigured"});
        return primaCredentialedJsonV1(request,{ok:true,status:"attached"},200,{"set-cookie":cookie});
      } catch {
        return primaCredentialedJsonV1(request,{ok:false,error:"return_session_unavailable"},503);
      }
    }

    if (request.method === "GET" &&
        url.pathname === "/api/prima/conversation/session") {
      if (!primaReturnTrustedOriginV1(request)) {
        return primaCredentialedJsonV1(request,{ok:false,error:"origin_not_allowed"},403);
      }
      try {
        const conversationId = await primaReadReturnSessionV1(request,env);
        if (!conversationId) return primaCredentialedJsonV1(request,{ok:true,status:"none"});
        // Server-issued signed cookie is browser access only. No user PII or
        // memory content is returned here. Replay still uses RESTORE-01 auth.
        return primaCredentialedJsonV1(request,{
          ok:true,status:"active",version:"PrimaReturnSessionV1",
          conversation_id:conversationId,
          conversation_access_token:await issueConversationAccessToken(env,conversationId)
        });
      } catch {
        return primaCredentialedJsonV1(request,{ok:false,error:"return_session_unavailable"},503);
      }
    }

    // =====================================================
    // START CONVERSATION
    // =====================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/conversation/start"
    ) {
      let body = {};

      try {
        body = await request.json();
      } catch {
        // request body is optional
      }

      try {
        const rows = await supabaseInsert(
          env,
          "conversations",
          {
            visitor_id: body.visitor_id || null,
            session_id: body.session_id || null,

            language_code:
              body?.page?.language_code || "en",

            started_page_id:
              body?.page?.page_id || null,

            current_page_id:
              body?.page?.page_id || null,

            current_page_type:
              body?.page?.page_type || null,

            current_url_path:
              body?.page?.url_path || null,

            current_canonical_url_path:
              body?.page?.canonical_url_path || null,

            current_primary_entity_type:
              body?.entity?.primary_type || null,

            current_primary_entity_slug:
              body?.entity?.primary_slug || null,

            current_secondary_entity_type:
              body?.entity?.secondary_type || null,

            current_secondary_entity_slug:
              body?.entity?.secondary_slug || null,

            metadata: {
              source: "prima_dialog",
              contract: "ContextEnvelopeV1"
            }
          },
          "conversation_id,status,language_code,started_at"
        );

        const conversationInitiator =
          body?.initiator === "user"
            ? "user"
            : "prima";

        const greeting =
          conversationInitiator === "prima"
            ? "Hi, I’m Prima 👋 I’m an AI real estate advisor focused on the UAE market. How should I address you?"
            : null;

        const startedConversationId =
          rows?.[0]?.conversation_id ||
          null;

        if (
          greeting &&
          startedConversationId
        ) {
          await supabaseInsertIdempotentMessage(
            env,
            "messages",
            {
              conversation_id:
                startedConversationId,

              turn_id:
                body?.turn?.turn_id || null,

              turn_seq:
                body?.turn?.turn_seq ?? null,

              turn_phase:
                body?.turn?.phase || null,

              role:
                "assistant",

              content:
                greeting,

              route:
                "persona_question",

              response_type:
                "answer",

              page_id:
                body?.page?.page_id ||
                null,

              page_type:
                body?.page?.page_type ||
                null,

              primary_entity_type:
                body?.entity?.primary_type ||
                null,

              primary_entity_slug:
                body?.entity?.primary_slug ||
                null,

              secondary_entity_type:
                body?.entity?.secondary_type ||
                null,

              secondary_entity_slug:
                body?.entity?.secondary_slug ||
                null,

              metadata: {
                contract:
                  "PersonaV1",
                kind:
                  "conversation_start_greeting",
                used_openai:
                  false
              }
            },
            "message_id,created_at"
          );
        }

        return json({
          ok: true,
          version:
            "ConversationStartV1",

          initiator:
            conversationInitiator,

          greeting,

          meta: {
            used_openai:
              false,

            input_tokens:
              0,

            output_tokens:
              0,

            total_openai_tokens:
              0
          },

          conversation:
            rows[0],
          conversation_access_token:
            await issueConversationAccessToken(env, startedConversationId)
        });
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "conversation_start_failed"
          },
          500
        );
      }
    }

    // RESTORE-01: authorized, read-only replay of an existing conversation.
    // A UUID alone never grants access. Do not return memory_facts, contact
    // credentials, analytics or arbitrary metadata to the frontend.
    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/conversation/restore"
    ) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ok:false,error:"invalid_json"},400);
      }

      const id = String(body?.conversation_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return json({ok:false,error:"invalid_conversation_id"},400);
      }
      if (!(await verifyConversationAccess(request, env, id))) {
        return json({ok:false,error:"conversation_access_denied"},403);
      }

      try {
        const [conversations, messageRows] = await Promise.all([
          d4SupabaseSelect(env, "conversations", [
            `conversation_id=eq.${encodeURIComponent(id)}`,
            "select=conversation_id,language_code,last_applied_turn_seq,dialogue_state",
            "limit=1"
          ].join("&")),
          d4SupabaseSelect(env, "messages", [
            `conversation_id=eq.${encodeURIComponent(id)}`,
            "select=message_id,role,content,created_at,turn_seq,turn_id,metadata",
            "order=created_at.asc,message_id.asc",
            "limit=301"
          ].join("&"))
        ]);
        const conversation = conversations?.[0];
        if (!conversation) {
          return json({ok:false,error:"conversation_not_found"},404);
        }
        const completeRows = Array.isArray(messageRows) ? messageRows : [];
        // Bounded replay. Never silently claim that a truncated history is complete.
        const hasMore = completeRows.length > 300;
        const messages = completeRows.slice(0, 300).filter(row =>
          row?.role === "user" || row?.role === "assistant"
        ).map(row => ({
          message_id: row.message_id,
          role: row.role,
          content: String(row.content || ""),
          created_at: row.created_at,
          turn_seq: row.turn_seq,
          turn_id: row.turn_id,
          // Restore only catalog-card references; never expose raw metadata.
          cards: row.role === "assistant"
            ? primaRestoreProjectCardsV2(row.metadata?.restore_project_cards_v2)
            : []
        }));
        const responseHeaders = {
          ...cors,
          "content-type":"application/json; charset=utf-8",
          "cache-control":"no-store, private",
          "referrer-policy":"no-referrer"
        };
        return new Response(JSON.stringify({
          ok:true,
          version:"ConversationRestoreV1",
          conversation_id:conversation.conversation_id,
          language_code:conversation.language_code || "en",
          last_applied_turn_seq:conversation.last_applied_turn_seq ?? 0,
          messages,
          history_truncated:hasMore
        }), {status:200,headers:responseHeaders});
      } catch (error) {
        // No user messages, contact data or raw DB error in the API response.
        console.error("prima_restore_read_failed");
        return json({ok:false,error:"conversation_restore_unavailable"},503);
      }
    }

    // H-SECURITY-V1: this legacy endpoint exposed full conversation memory.
    // It is not used by the bundled frontend. Keep it disabled until a
    // server-to-server authenticated CRM interface replaces it.
    if (url.pathname === "/api/prima/lead-context") {
      return json({ok:false, error:"not_found"}, 404);
    }

    // =====================================================
    // MESSAGE
    // =====================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/prima/message"
    ) {
      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "invalid_json"
          },
          400
        );
      }

      const conversationId =
        body?.conversation_id || null;

      const message =
        String(body?.user?.message || "").trim();

      const turn =
        normalizeConversationTurn(
          body
        );

      body.turn =
        turn;

      if (!conversationId) {
        return json(
          {
            ok: false,
            error: "conversation_id_required"
          },
          400
        );
      }

      if (!message) {
        return json(
          {
            ok: false,
            error: "message_required"
          },
          400
        );
      }

      // H-SECURITY-V1: a conversation UUID is not proof of ownership.
      // Validate before any Memory, messages or conversation state is read.
      if (!(await verifyConversationAccess(request, env, conversationId))) {
        return json({ok:false, error:"conversation_access_denied"}, 403);
      }

      try {
        const workerTurnStartedAt = Date.now();
        // I33 DIAGNOSTICS-ONLY: timestamps, never user text, names or PII.
        // Disabled outside explicit PRIMA_PERSONA_DIAGNOSTICS=1 local QA.
        const i33Perf = env?.PRIMA_PERSONA_DIAGNOSTICS === "1" ? {} : null;
        const i33Mark = (key) => { if (i33Perf) i33Perf[key] = Date.now(); };
        i33Mark("worker_start");
        let a1StartedAt = null;
        let a1FinishedAt = null;
        let interpreterCallAttempted = false;
        let extractedFacts =
          extractMemoryFacts(message);
        // H34: narrow explicit self-introduction in a contact request, e.g.
        // "Hi, I'm Zack. Please contact me ...". This does not authorize contact.
        const h34FirstTurnNameFact = extractH34FirstTurnContactNameFact(message);
        if (h34FirstTurnNameFact &&
            !extractedFacts.some(f => f?.fact_key === "user_name")) {
          extractedFacts.push(h34FirstTurnNameFact);
        }
        // H29: independent evidence of a direct request for human contact.
        const h29Direct = inspectDirectContactH29(message);
        if (h29Direct.direct_request && h29Direct.introduced_name &&
            !extractedFacts.some(f => f?.fact_key === "user_name")) {
          extractedFacts.push({fact_key:"user_name",fact_value:h29Direct.introduced_name,
            confidence:0.98,source:"h29_explicit_self_introduction"});
        }

        // MEM11: single explicit project decisions are not Search or Persona.
        // Only verified project context can authorize the local Memory write.
        // No OpenAI, no search, no contact/lead action.
        if (
          turn?.phase === "initial" &&
          !h29Direct.direct_request &&
          (body?.page?.language_code || "en") === "en" &&
          isPureEntityDecisionStatementV1(message)
        ) {
          const decisionResponse = await persistDeterministicEntityDecisionTurnV1({
            env, conversationId, body, message
          });
          if (decisionResponse) return json(decisionResponse);
        }

        // MEM07: explicit buyer profile facts with NO actionable search,
        // comparison, contact or advice request must not re-run Search V3.
        // Keep this ahead of the Interpreter and Persona semantic gateway.
        const mem07Profile = turn?.phase === "initial" && !h29Direct.direct_request
          ? classifyPureBuyerProfileUpdateV1(
              message, body?.page?.language_code || "en"
            )
          : null;
        if (mem07Profile) {
          const mem07Response = await persistDeterministicProfileTurnV1({
            env, conversationId, body, message,
            facts: mem07Profile.facts
          });
          return json(mem07Response);
        }

        let activeMemory =
          mergeCurrentTurnMemory(
            [],
            extractedFacts
          );

        let contextEnvelope =
          buildLocalContextEnvelope(
            body,
            message,
            activeMemory
          );

        refreshConversationStateV1(
          contextEnvelope
        );

        let route =
          routeIntent(
            message,
            contextEnvelope
          );

        route =
          promoteConstraintLedPropertySearchRoute(
            route,
            extractedFacts
          );
        if (h29Direct.direct_request) route = "contact_intent";

        // MEM02: all unambiguous greeting-only turns stay entirely local,
        // including turn 2+ with Persona A1 enabled. Preserve mixed tasks.
        if (route === "persona_question" && isStandaloneGreeting(message)) {
          const greetingResponse = await persistDeterministicNameTurn({
            env,
            conversationId,
            body,
            message,
            facts: [],
            kind: "social_greeting",
            answer: "Hi! 👋 What would you like to explore in UAE real estate today?"
          });
          return json(greetingResponse);
        }

        let fastGate =
          evaluateFastGate({
            route,
            message,
            context:
              contextEnvelope
          });

        let interpreterResult =
          null;

        let interpreterClarification =
          null;

        const contextualNameCandidate =
          route === "unsupported" &&
          isContextualNameCandidate(
            message
          );

          const explicitNameOnlyMessage =
            isExplicitNameOnlyMessage(
              message
            );

          const onboardingAwaitingName =
            body?.onboarding
              ?.awaiting_name === true;

        const entityDecisionSignal =
          hasEntityDecisionSignal(
            message
          );

        const immediateCommercialSignal =
          hasImmediateCommercialSignal({
            message,
            route,
            fastGate
          });

        const baseFastPath =
          !contextualNameCandidate &&
            !explicitNameOnlyMessage &&
            !onboardingAwaitingName &&
          !entityDecisionSignal &&
          !(env?.PRIMA_PERSONA_GENERATIVE_A1 === "1" && route === "persona_question" && turn?.turn_seq > 1) &&
          !fastGate.use_interpreter &&
          canUseStatelessFastPath({
            body,
            message,
            route
          });

        /*
          Commercial CTA needs active funnel memory,
          but an explicit resolved-page request does
          not need synchronous conversation state +
          recent-message reads.

          This preserves:
          - ignored CTA suppression
          - accepted handoff state
          - Client Memory

          while keeping the commercial path light.
        */
        const lightweightCommercialPath =
          immediateCommercialSignal &&
          baseFastPath;

        const statelessFastPath =
          baseFastPath &&
          !immediateCommercialSignal;


        let deferredCommercialMemoryTask =
          null;

        /*
          Explicit compare already resolves through
          resolve_project_compare_bundle_v1, which
          loads conversation-scoped active memory.

          Start Funnel memory loading concurrently
          with Compare Bundle instead of serially.
        */
        if (
          lightweightCommercialPath &&
          route === "compare"
        ) {
          deferredCommercialMemoryTask =
            loadActiveMemory(
              env,
              conversationId
            );
        } else if (lightweightCommercialPath) {
          const memoryBeforeTurn =
            await loadActiveMemory(
              env,
              conversationId
            );

          activeMemory =
            mergeCurrentTurnMemory(
              memoryBeforeTurn,
              extractedFacts
            );

          contextEnvelope =
            buildLocalContextEnvelope(
              body,
              message,
              activeMemory
            );

          refreshConversationStateV1(
            contextEnvelope
          );

          route =
            routeIntent(
              message,
              contextEnvelope
            );

          route =
            promoteConstraintLedPropertySearchRoute(
              route,
              extractedFacts
            );
          if (h29Direct.direct_request) route = "contact_intent";
        } else if (!statelessFastPath) {
          i33Mark("context_load_start");
          const [
            memoryBeforeTurn,
            fullContextEnvelope
          ] = await Promise.all([
            loadActiveMemory(
              env,
              conversationId
            ),

            buildContextEnvelope(
              env,
              body,
              message,
              []
            )
          ]);
          i33Mark("context_load_end");

          const expectingName =
            isExpectingNameFromRecentMessages(
              fullContextEnvelope
                ?.conversation
                ?.recent_messages
            );

          if (
            (
              onboardingAwaitingName ||
              expectingName
            )
          ) {
            // H30: onboarding hydration must not discard an explicit,
            // verified self-introduction from the direct H29 contact request.
            // Preserve the user's own name, never infer contact consent here.
            extractedFacts = retainDirectContactNameH30(
              extractMemoryFacts(
                message,
                {
                  expectingName: true
                }
              ),
              h29Direct
            );
            // The onboarding re-extraction must not drop H34's explicit
            // name, just as H30 preserves the original H29 self-introduction.
            if (h34FirstTurnNameFact &&
                !extractedFacts.some(f => f?.fact_key === "user_name")) {
              extractedFacts.push(h34FirstTurnNameFact);
            }
          }

            const effectiveAwaitingName =
              onboardingAwaitingName ||
              expectingName;

            const nameFact =
              extractedFacts.find(
                fact =>
                  fact?.fact_key ===
                    "user_name"
              ) ||
              null;

            const previousNameFact =
              memoryBeforeTurn.find(
                fact =>
                  fact?.fact_key ===
                    "user_name"
              ) ||
              null;

            const previousName =
              String(
                previousNameFact
                  ?.fact_value ||
                ""
              ).trim();

            const currentName =
              String(
                nameFact
                  ?.fact_value ||
                ""
              ).trim();

            const isTerminalNameTurn =
              Boolean(
                nameFact &&
                (
                  (
                    contextualNameCandidate &&
                    effectiveAwaitingName
                  ) ||
                  explicitNameOnlyMessage
                )
              );

            if (isTerminalNameTurn) {
              const isCorrection =
                Boolean(
                  previousName &&
                  currentName &&
                  previousName
                    .toLowerCase() !==
                  currentName
                    .toLowerCase()
                );

              const nameAnswer =
                isCorrection
                  ? `Got it — ${currentName}. I’ll call you ${currentName} from now on. How can I help you today?`
                  : explicitNameOnlyMessage &&
                    !effectiveAwaitingName
                    ? `Got it — ${currentName}. How can I help you today?`
                    : `Nice to meet you, ${currentName}. How can I help you today?`;

              const response =
                await persistDeterministicNameTurn({
                  env,
                  conversationId,
                  body,
                  message,
                  facts:
                    extractedFacts,
                  answer:
                    nameAnswer
                });

              return json(response);
            }

            if (
              effectiveAwaitingName &&
              isNonNameOnboardingReply(
                message
              )
            ) {
              const response =
                await persistDeterministicNameTurn({
                  env,
                  conversationId,
                  body,
                  message,
                  facts: [],
                  answer:
                    "No problem. How can I help you today?"
                });

              return json(response);
            }

          const entityDecisionFacts =
            extractEntityDecisionFacts({
              message,
              context:
                fullContextEnvelope,
              activeMemory:
                memoryBeforeTurn
            });

          if (
            entityDecisionFacts.length > 0
          ) {
            extractedFacts = [
              ...extractedFacts,
              ...entityDecisionFacts
            ];
          }

          activeMemory =
            mergeCurrentTurnMemory(
              memoryBeforeTurn,
              extractedFacts
            );

          fullContextEnvelope
            .memory
            .active_facts =
              activeMemory;

          contextEnvelope =
            fullContextEnvelope;

          refreshConversationStateV1(
            contextEnvelope
          );

          route =
            routeIntent(
              message,
              contextEnvelope
            );

          route =
            promoteConstraintLedPropertySearchRoute(
              route,
              extractedFacts
            );
          if (h29Direct.direct_request) route = "contact_intent";
        }


        /*
          ConversationMoveV1.

          B has already determined current state.
          C now determines what the current user turn
          means relative to that active state.

          Only high-confidence moves may override route.
        */
        /*
          Fast response != stateless conversation.

          For turn 2+, local deterministic paths load only
          the compact conversation-control row before
          ConversationMoveV1 runs.

          Full recent-message / memory hydration remains
          skipped, preserving the fast-path architecture.
        */
        const shouldHydrateFastControlState =
          Boolean(
            conversationId
          ) &&
          (
            statelessFastPath ||
            lightweightCommercialPath
          ) &&
          (
            body?.turn?.turn_seq !== 1
          );

        if (
          shouldHydrateFastControlState
        ) {
          contextEnvelope =
            await hydrateLocalConversationControlState(
              env,
              contextEnvelope
            );

          refreshConversationStateV1(
            contextEnvelope
          );
        }


        /*
          E21: compact verified-identity history. This is independent of C's
          suspended threads. The reducer stays unchanged; no content payload
          or browser-page attribution is stored here.
        */
        const e21History = Array.isArray(
          contextEnvelope?.conversation?.dialogue_state?.e21_verified_entities
        ) ? contextEnvelope.conversation.dialogue_state.e21_verified_entities
          .filter(item => ["project", "developer", "district"].includes(item?.type) &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item?.slug || "")))
          .slice(-5) : [];
        const e21Current = contextEnvelope?.conversation?.dialogue_state
          ?.continuity_references?.current_entity;
        const e21ImplicitCue = /\b(?:the\s+)?(?:previous|earlier|other)\s+(?:project|one)\b/i.test(message) &&
          !/\b(?:find|search|show|list|compare|recommend|suggest|contact|call|whatsapp|viewing|why|roi|risk)\b/i.test(message);
        const e21Prior = e21ImplicitCue ? [...e21History].reverse().find(item =>
          item.type !== e21Current?.type || item.slug !== e21Current?.slug) : null;
        const e21ReferenceCandidate = e21Prior ? {
          type: e21Prior.type, slug: e21Prior.slug,
          name: e21Prior.name || e21Prior.slug,
          role: "primary", source: "e21_verified_previous_entity"
        } : null;
        const e21FactKeys = detectStructuredFactKeysV1(message);
        const e21FactTask = e21ReferenceCandidate && e21FactKeys.length === 1;
        const e21ReferenceOnly = e21ReferenceCandidate && e21FactKeys.length === 0 &&
          /^(?:and\s+)?(?:what\s+about\s+)?(?:the\s+)?(?:previous|earlier|other)\s+(?:project|one)\s*[?.!]*$/i.test(message.trim());

        const originalTopicRoute = route;
        const explicitReturnTaskRoute = explicitNewTaskAfterReturnV1(message, contextEnvelope);
        let conversationMove =
          protectTopicMoveV1({
            move: recognizeConversationMove({message, route, context:contextEnvelope}),
            message, originalRoute: originalTopicRoute, freshRoute: explicitReturnTaskRoute
          });

        // E20: resume restores the entity/thread, not the current factual task.
        // Only an explicit, single verified-fact question may override the
        // old thread capability. Preserve C's move_type=resume for restoration.
        if (
          conversationMove?.move_type === "resume" &&
          conversationMove?.reason === "explicit_resume_to_suspended_thread" &&
          originalTopicRoute === "exact_fact" &&
          detectStructuredFactKeysV1(message).length === 1 &&
          !/\b(?:compare|versus|recommend|suggest|contact|call|whatsapp|viewing|why|risk|roi|returns?)\b/i.test(message)
        ) {
          conversationMove = {
            ...conversationMove,
            effective_route: "exact_fact",
            reason: "explicit_resume_to_suspended_thread"
          };
        }
        // E21: preserve explicit fact task + verified previous referent.
        // A pure "the other one" is only a reference, never an AI question.
        if (e21FactTask || e21ReferenceOnly) {
          conversationMove = {
            version: "ConversationMoveV1", move_type: "reference",
            effective_route: e21FactTask ? "exact_fact" : "follow_up",
            confidence: 1, reason: "e21_verified_previous_entity",
            reference: {resolved: true, type: e21ReferenceCandidate.type,
              slug: e21ReferenceCandidate.slug, name: e21ReferenceCandidate.name,
              source: "e21_verified_previous_entity"},
            changed_fields: []
          };
        }
        if (
          conversationMove
            ?.effective_route
        ) {
          route =
            conversationMove
              .effective_route;
        }

        // F-V1 PAGINATION HANDOFF: The verified F1 shortlist is already
        // selected. A click on the existing pagination control must keep
        // its recommendation route; it is not a new property search.
        // Validate the entire F1 catalog context before overriding routing.
        // Other Search, follow-up, CTA and Persona turns are untouched.
        const fV1VerifiedMore =
          message === "Show 3 more" &&
          turn?.phase === "initial" &&
          body?.search_context?.version === "SearchContextV1" &&
          body.search_context.source === "prima_f1_verified_project_catalog_v1" &&
          body.search_context.language === "en" &&
          body.search_context.entity_type === "project" &&
          body.search_context.state === "results" &&
          Array.isArray(body.search_context.results) &&
          body.search_context.results.length >= 2 &&
          body.search_context.results.length <= 10 &&
          Number.isInteger(body.search_context.current_batch_offset) &&
          body.search_context.current_batch_offset > 0 &&
          body.search_context.current_batch_offset < body.search_context.results.length &&
          Number.isInteger(body.search_context.requested_count) &&
          body.search_context.requested_count >= 1 &&
          body.search_context.requested_count <= 10 &&
          body.search_context.results.every(item =>
            item?.entity_type === "project" &&
            typeof item.slug === "string" &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) &&
            item.canonical_url === "/en/projects/" + item.slug + "/"
          );
        if (fV1VerifiedMore &&
            ["property_search", "recommendation"].includes(route)) {
          route = "recommendation";
        }

        /*
          Prima semantic understanding layer.

          FastGate keeps obvious high-confidence requests cheap.
          RequestInterpreterV1 handles semantic, ambiguous,
          compound and long-form / voice-style requests.

          Interpreter does not answer the user and does not
          retrieve knowledge. It only normalizes the request.
        */
        fastGate =
          evaluateFastGate({
            route,
            message,
            context:
              contextEnvelope,
            conversationMove
          });

        // E23: an isolated reference-only request with no conversational
        // referent, no search results and no verified identity history cannot
        // be resolved by the Interpreter. Use existing follow-up clarification.
        // This does not apply to compound tasks or substantive questions.
        const e23BareUnresolvedReference = route === "follow_up" &&
          /^(?:tell\s+me\s+about\s+the\s+(?:first|second|third)\s+one|(?:and\s+)?what\s+about\s+the\s+other\s+one)\s*[?.!]*$/i.test(String(message || "").trim()) &&
          !conversationMove?.reference?.resolved &&
          !contextEnvelope?.conversation?.dialogue_state?.continuity_references?.current_entity &&
          !contextEnvelope?.state?.continuity_references?.current_entity &&
          !contextEnvelope?.working_entity?.slug &&
          !contextEnvelope?.entity?.primary_slug &&
          !(Array.isArray(contextEnvelope?.search?.results) && contextEnvelope.search.results.length > 0) &&
          !(Array.isArray(contextEnvelope?.conversation?.dialogue_state?.e21_verified_entities) &&
            contextEnvelope.conversation.dialogue_state.e21_verified_entities.length > 0);
        if (e23BareUnresolvedReference && fastGate.use_interpreter) {
          fastGate = { ...fastGate, decision: "execute", use_interpreter: false,
            reason: "e23_empty_reference_clarification" };
        }

        // G V1.1 — confirmed handoff after an existing CTA.
        // Use the already-known funnel decision for a single-purpose,
        // explicit request. Preserve Interpreter for new or compound
        // factual questions, unverified context and ambiguous answers.
        const g11PreviousFunnelState =
          [...(Array.isArray(activeMemory) ? activeMemory : [])]
            .reverse()
            .find(fact => fact?.fact_key === "funnel_state")?.fact_value || null;
        const g11ConfirmedContactTransition =
          ["contact_intent", "exact_fact", "unsupported"].includes(route) &&
          ["cta_offered", "cta_declined", "contact_opted_out"]
            .includes(g11PreviousFunnelState?.status) &&
          explicitHandoffRequest(message) &&
          !explicitContactOptOut(message) &&
          !/[?]/.test(message) &&
          !/\b(?:compare|recommend|explain|calculate|evaluate|analy[sz]e|verify|what is|how much|which one)\b/i.test(message);
        if (g11ConfirmedContactTransition) {
          // This is a context-bound Funnel move, not a new semantic route.
          // An unrelated task or unanswered question still gets Interpreter.
          route = "contact_intent";
          fastGate = {
            ...evaluateFastGate({route, message, context:contextEnvelope, conversationMove}),
            decision: "execute",
            use_interpreter: false,
            reason: "g11_confirmed_contact_after_existing_offer"
          };
        }

        /*
          Deterministic Named Entity Bridge V1.

          High-confidence requests must not spend an LLM call
          merely to convert an explicit entity phrase into a
          canonical Primadom registry identity.

          Existing Registry resolution remains authoritative.
          Existing Request Interpreter remains the fallback
          whenever deterministic extraction/resolution cannot
          safely finish the job.

          This does NOT mutate physical browser context.
        */
        // Confirmed Persona referent: avoid unnecessary Luna call.
        const directPersonaIntent =
          ["persona_question", "page_question", "unsupported"]
            .includes(route)
            ? resolveContextualPersonaIntent({
                message,
                context: contextEnvelope
              })
            : null;

        if (directPersonaIntent) {
          route = "persona_question";
          fastGate = evaluateFastGate({
            route,
            message,
            context: contextEnvelope,
            conversationMove
          });
        }

        const ordinalMatch =
          route === "follow_up"
            ? String(
                message || ""
              ).match(
                /\b(?:the\s+)?(first|second|third)\s+(?:one|project|option)\b/i
              )
            : null;

        const ordinalIndexByName = {
          first: 0,
          second: 1,
          third: 2
        };

        const ordinalIndex =
          ordinalMatch
            ? ordinalIndexByName[
                ordinalMatch[1]
                  .toLowerCase()
              ]
            : null;

        const searchBatchOffset =
          Number.isInteger(
            contextEnvelope?.search
              ?.current_batch_offset
          )
            ? contextEnvelope.search
                .current_batch_offset
            : 0;

        const ordinalSearchResult =
          Number.isInteger(
            ordinalIndex
          ) &&
          Array.isArray(
            contextEnvelope?.search
              ?.results
          )
            ? contextEnvelope.search
                .results[
                  searchBatchOffset +
                  ordinalIndex
                ] ||
              null
            : null;

        const ordinalSearchCandidate =
          ["project", "developer", "district"].includes(
              ordinalSearchResult?.entity_type ||
              contextEnvelope?.search?.entity_type
            ) &&
          ordinalSearchResult
            ?.slug
            ? {
                type:
                  ordinalSearchResult.entity_type ||
                  contextEnvelope.search.entity_type,

                name:
                  ordinalSearchResult
                    .title ||
                  ordinalSearchResult
                    .slug,

                slug:
                  ordinalSearchResult
                    .slug,

                role:
                  "primary",

                source:
                  "search_context_ordinal"
              }
            : null;

        const comparisonPair =
          route === "compare"
            ? extractProjectComparisonPair(
                message
              )
            : null;

        const comparisonPrimaryCandidate =
          comparisonPair?.primary
            ? {
                type: "unknown",
                name:
                  comparisonPair
                    .primary,
                slug: null,
                role: "primary",
                source:
                  "compare_pair"
              }
            : null;

        const compareClarificationCandidate =
          conversationMove
            ?.reason ===
              "pending_clarification_answer"
            ? {
                type:
                  "unknown",

                name:
                  message,

                slug:
                  null,

                role:
                  "comparison_target",

                source:
                  "compare_clarification"
              }
            : null;

        /*
          D3-01: A deterministically resolved SearchContext
          reference is an authoritative entity candidate.
          Preserve its identity through Knowledge resolution.
        */
        const searchReferenceCandidate =
          conversationMove?.reference?.resolved === true &&
          conversationMove.reference.source ===
            "search_context_ordinal" &&
          ["project", "developer", "district"].includes(
              conversationMove.reference.type
            ) &&
          Boolean(conversationMove.reference.slug)
            ? {
                type: conversationMove.reference.type,
                slug: conversationMove.reference.slug,
                name:
                  conversationMove.reference.name ||
                  conversationMove.reference.slug,
                role: "primary",
                source: "search_context_ordinal"
              }
            : null;

        /*
          E1_ACTIVE_ENTITY_REFERENCE_V1

          Resolve explicit conversational references for
          fact questions using verified active entity state.

          No route overrides and no invented identities.
        */
        function resolveE1ActiveReference({
          route,
          message,
          context
        }) {
          if (
            !["exact_fact", "follow_up"].includes(route) ||
            !/\b(?:that one|this one|that project|this project|that developer|this developer|that district|this district|it|its)\b/i.test(message) ||
            detectStructuredFactKeysV1(message).length !== 1
          ) {
            return null;
          }

          const references =
            context?.conversation
              ?.dialogue_state
              ?.continuity_references ||
            {};

          const candidates = [
            context?.working_entity,
            references.current_entity
          ];

          for (const entity of candidates) {
            const type = String(entity?.type || "");
            const slug = String(entity?.slug || "");

            if (
              !["project", "developer", "district"].includes(type) ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
            ) {
              continue;
            }

            return {
              type,
              slug,
              name:
                String(entity?.name || "").trim() ||
                slug.replace(/-/g, " "),
              role: "primary",
              source: "e1_active_conversation_reference"
            };
          }

          return null;
        }

        // E1_ACTIVE_ENTITY_REFERENCE_END_V1
        const e1ActiveReferenceCandidate =
          resolveE1ActiveReference({
            route,
            message,
            context: contextEnvelope
          });

        /*
          E1_FACT_REFERENCE_CANDIDATE_V1
          Pass the resolved conversation reference to Registry.
          No invented entity and no route override.
        */
        const e1ResolvedFactReferenceCandidate =
          route === "exact_fact" &&
          conversationMove?.reason ===
            "resolved_reference_fact_request" &&
          conversationMove?.reference?.resolved === true &&
          ["project", "developer", "district"].includes(
            conversationMove.reference.type
          ) &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
            String(conversationMove.reference.slug || "")
          )
            ? {
                type: conversationMove.reference.type,
                slug: conversationMove.reference.slug,
                name:
                  conversationMove.reference.name ||
                  conversationMove.reference.slug,
                role: "primary",
                source: "e1_resolved_fact_reference"
              }
            : null;


        /*
          E32_CONTEXTUAL_DEVELOPER_FOLLOWUP_V1
          Keep the selected developer available
          for contextual portfolio and area questions.
          The existing Registry Resolver remains required.
        */
        const e32ActiveDeveloper = (() => {
          // E41_SUSPENDED_DEVELOPER_REFERENCE_V1
          // Current developer wins. A current project
          // does not erase its previously selected developer.
          const candidates = [
            contextEnvelope?.conversation?.dialogue_state
              ?.continuity_references?.current_entity,
            contextEnvelope?.conversation?.dialogue_state
              ?.continuity_references?.suspended_thread
              ?.continuity_references?.current_entity,
            contextEnvelope?.conversation?.state
              ?.continuity_references?.suspended_thread
              ?.continuity_references?.current_entity,
            contextEnvelope?.conversation_state
              ?.continuity_references?.suspended_thread
              ?.continuity_references?.current_entity,
            contextEnvelope?.state
              ?.continuity_references?.suspended_thread
              ?.continuity_references?.current_entity,
            contextEnvelope?.conversation?.state
              ?.continuity_references?.current_entity,
            contextEnvelope?.conversation_state
              ?.continuity_references?.current_entity,
            contextEnvelope?.state
              ?.continuity_references?.current_entity
          ];

          for (const candidate of candidates) {
            const type = String(candidate?.type || "");
            const slug = String(candidate?.slug || "");

            if (
              type !== "developer" ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
            ) continue;

            return {
              type: "developer",
              slug,
              name: String(candidate?.name || "").trim() ||
                slug.replace(/-/g, " "),
              role: "primary",
              source: "e3_active_developer"
            };
          }

          return null;
        })();

        const e32DeveloperAreaIntent =
          /^where\s+does\s+(?:it|this developer|that developer)\s+(?:(?:mainly|mostly|typically)\s+)?(?:develop|build)(?:\s+projects)?\s*[?.!]*(?:\s+copy)?$/i.test(
            String(message || "").trim()
          );

        const e32DeveloperAreaCandidate =
          ["page_question", "exact_fact"].includes(route) &&
          e32DeveloperAreaIntent
            ? e32ActiveDeveloper
            : null;

        /*
          E06_MULTI_FACT_VERIFIED_ENTITY_V17
          Only identify the entity for a pure 2-3 fact lookup.
          Existing Registry remains the authority. No LLM bypass for
          ambiguous, unknown or action-bearing requests.
        */
        const e06Facts = detectStructuredFactKeysV1(message);
        const e06PureFact =
          route === "exact_fact" &&
          e06Facts.length >= 2 && e06Facts.length <= 3 &&
          !e06Facts.includes("payment_plan") &&
          !/\b(?:find|search|compare|versus|recommend|suggest|invest|buy|sell|contact|call|email|whatsapp|viewing|why|risk|roi|returns?)\b/i.test(message);
        const e06NamedMatch = e06PureFact
          ? String(message || "").match(/\b(?:of|for)\s+([a-z][a-z0-9 &'’.-]{1,119})\s*[?.!]*$/i)
          : null;
        const e06NamedEntity = e06NamedMatch?.[1]?.trim() || null;
        const e06Pronoun = /\b(?:it|its|this project|that project|this property|that property)\b/i.test(message);
        const e06CurrentEntity =
          contextEnvelope?.working_entity ||
          contextEnvelope?.conversation?.dialogue_state?.continuity_references?.current_entity;
        const e06ContextEntity =
          e06PureFact && !e06NamedEntity && e06Pronoun &&
          ["project", "developer", "district"].includes(e06CurrentEntity?.type) &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(e06CurrentEntity?.slug || ""))
            ? {
                type: e06CurrentEntity.type,
                slug: e06CurrentEntity.slug,
                name: e06CurrentEntity.name || e06CurrentEntity.slug,
                role: "primary",
                source: "e06_verified_conversation_entity"
              }
            : null;
        const e06EntityCandidate = e06PureFact && e06NamedEntity
          ? {
              type: "unknown",
              name: e06NamedEntity,
              slug: null,
              role: "primary",
              source: "e06_named_entity_registry_required"
            }
          : e06ContextEntity;

        // G24: first-turn in-person viewing without Search or Discuss.
        // Entity Resolver must verify a single canonical project before
        // this request may enter Knowledge/Funnel. Never infer consent.
        const g24ColdViewingCandidate =
          turn?.phase === "initial" &&
          !contextEnvelope?.working_entity?.slug &&
          !contextEnvelope?.entity?.primary_slug &&
          !contextEnvelope?.conversation?.dialogue_state?.continuity_references?.current_entity?.slug &&
          !contextEnvelope?.search?.results?.length &&
          ["unsupported", "contact_intent", "page_question"].includes(route)
            ? extractColdStartViewingProjectV1(message)
            : null;

        const deterministicEntityCandidate =
          e21ReferenceCandidate ||
          e06EntityCandidate ||
          searchReferenceCandidate ||
          ordinalSearchCandidate ||
          e1ResolvedFactReferenceCandidate ||
          e1ActiveReferenceCandidate ||
          e32DeveloperAreaCandidate ||
          compareClarificationCandidate ||
          comparisonPrimaryCandidate ||
          g24ColdViewingCandidate ||
          extractDeterministicEntityCandidate({
            route,
            message,

            exactFacts:
              Array.isArray(
                fastGate?.exact_facts
              )
                ? fastGate.exact_facts
                : []
          });

        let deterministicEntityResolution =
          null;

        if (deterministicEntityCandidate) {
          try {
            deterministicEntityResolution =
              await resolveNamedEntity({
                env,

                candidate:
                  deterministicEntityCandidate,

                context:
                  contextEnvelope,

                route: g24ColdViewingCandidate ? "page_question" : route
              });
          } catch (error) {
            /*
              Fail open.

              If Registry resolution fails technically,
              preserve the entire existing Interpreter path.
            */
            console.error(
              "prima_deterministic_entity_resolution_failed",
              error
            );

            deterministicEntityResolution =
              null;
          }
        }



        const deterministicEntityReady =
          Boolean(
            deterministicEntityResolution
              ?.resolved ||
            deterministicEntityResolution
              ?.status ===
                "current_entity"
          );

        // A resolved Registry row, not the phrase or the model, is the
        // authority. A missed/ambiguous name retains the original routing.
        const g24VerifiedViewing = Boolean(
          g24ColdViewingCandidate &&
          deterministicEntityResolution?.resolved &&
          deterministicEntityResolution?.page?.primary_entity_type === "project" &&
          deterministicEntityResolution?.page?.page_type_id === "project_page"
        );
        if (g24VerifiedViewing) {
          route = "page_question";
          conversationMove = {
            version: "ConversationMoveV1", move_type: "switch",
            effective_route: "page_question", confidence: 1,
            reason: "g24_verified_cold_start_project_viewing", changed_fields: []
          };
        }

        const preInterpreterDialogueState =
          contextEnvelope
            ?.conversation
            ?.dialogue_state ||
          null;

        const preInterpreterCompareRefs =
          preInterpreterDialogueState
            ?.continuity_references ||
          {};

        const preInterpreterCompareDecision =
          preInterpreterDialogueState
            ?.active_thread
            ?.active_topic === "compare" &&
          Boolean(
            preInterpreterCompareRefs
              ?.current_entity
              ?.slug
          ) &&
          Boolean(
            preInterpreterCompareRefs
              ?.comparison_target
          ) &&
          /\b(?:which one|which would you choose|what would you choose|which is better|which one is better|better for investment|choose for investment|prefer for investment)\b/i
            .test(message);


        // I32: only a standalone expected contact after the preceding
        // accepted handoff can bypass the semantic model. H validates the
        // contact in this read-only preflight and later persists it normally.
        // C/G/Router/Persona/Memory are not modified; failures fall back.
        const i32ExpectedContactOnly = expectedContactOnlyI32({
          message,
          activeMemory,
          recentMessages: contextEnvelope?.conversation?.recent_messages,
          turn,
          languageCode: contextEnvelope?.page?.language_code
        }) && evaluateContactCapture({
          message,
          activeMemory
        }).captured === true;
        if (i32ExpectedContactOnly) {
          route = "contact_intent";
          fastGate = {
            ...fastGate,
            decision: "execute",
            use_interpreter: false,
            reason: "i32_expected_contact_only"
          };
        }

        const deterministicRouteBeforeInterpreter =
          route;

        // A1: single semantic call for candidate Persona/unsupported messages.
        // Successful semantic routing never re-enters RequestInterpreter.
        // Fallback to the legacy Interpreter happens ONLY after a model error.
        let personaA1 = null;
        if (
          env?.PRIMA_PERSONA_GENERATIVE_A1 === "1" &&
          personaA1Eligible({route,turn,message}) &&
          !i32ExpectedContactOnly &&
          !(route === "unsupported" && classifyClearlyOffTopicRequest(message)) &&
          !deterministicEntityReady && !preInterpreterCompareDecision
        ) {
          a1StartedAt = Date.now();
          personaA1 = await personaA1Generate({
            env,message,context:contextEnvelope,memory:activeMemory,route
          });
          a1FinishedAt = Date.now();
          if (personaA1?.decision === "answer") {
            route = "persona_question";
          } else if (personaA1?.decision === "route") {
            interpreterResult = {
              interpretation:personaA1.interpretation,
              // Tokens accounted against personaA1 exactly ONCE below.
              meta:{used_openai:false,latency_ms:0,input_tokens:0,
                output_tokens:0,total_tokens:0}
            };
            route = personaA1.interpretation.primary_route;
            if (contextEnvelope) {
              contextEnvelope.request_interpretation = personaA1.interpretation;
            }
            const semanticFacts=(personaA1.interpretation.memory_candidates||[])
              .filter(item=>item?.key && item?.value && Number(item.confidence)>=0.8)
              .map(item=>({fact_key:item.key === "name" ? "user_name" : item.key,
                fact_value:normalizeMemoryFactValue(item.key === "name" ? "user_name" : item.key,item.value),
                confidence:Number(item.confidence),source:"persona_semantic_a1"}));
            if (semanticFacts.length) {
              extractedFacts=[...extractedFacts,...semanticFacts];
              activeMemory=mergeCurrentTurnMemory(activeMemory,semanticFacts);
              contextEnvelope.memory ??= {active_facts:[]};
              contextEnvelope.memory.active_facts=activeMemory;
              refreshConversationStateV1(contextEnvelope);
            }
          }
        }

        if (
          fastGate.use_interpreter &&
          !["answer","route"].includes(personaA1?.decision) &&
          // A failed but already attempted A1 request must not trigger a second paid interpreter.
          !personaA1?.used &&
          !(route === "unsupported" && classifyClearlyOffTopicRequest(message)) &&
          !deterministicEntityReady &&
          !preInterpreterCompareDecision &&
          // F-V1 LIMITED: verified existing Search D/F shortlist does not
          // need a second semantic interpretation. Project pagination uses an
          // initial turn; D4/D5 use RecommendationEntityContextV1.
          !(
            route === "recommendation" &&
            (
              (
                body?.search_context?.version === "SearchContextV1" &&
                body.search_context.source === "prima_f1_verified_project_catalog_v1" &&
                body.search_context.entity_type === "project" &&
                ["results", "empty"].includes(body.search_context.state) &&
                Array.isArray(body.search_context.results) &&
                body.search_context.results.every(item =>
                  item && typeof item.slug === "string" &&
                  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) &&
                  item.canonical_url === "/en/projects/" + item.slug + "/"
                ) &&
                (
                  turn?.phase === "tool_continuation" ||
                  (message === "Show 3 more" &&
                   Number.isInteger(body.search_context.current_batch_offset) &&
                   body.search_context.current_batch_offset > 0)
                )
              ) ||
              (
                turn?.phase === "tool_continuation" &&
                body?.recommendation_context?.version === "RecommendationEntityContextV1" &&
                ["developer", "district"].includes(body.recommendation_context.entity_type) &&
                body.recommendation_context.query === message &&
                Array.isArray(body.recommendation_context.results) &&
                Number.isInteger(body.recommendation_context.requested_count) &&
                body.recommendation_context.requested_count >= 1 &&
                body.recommendation_context.requested_count <= 10
              )
            )
          )
        ) {
          try {
            interpreterCallAttempted = true;
            interpreterResult =
              await interpretRequest({
                env,
                message,

                page:
                  contextEnvelope?.page ||
                  null,

                entity:
                  contextEnvelope?.entity ||
                  null,

                memory:
                  activeMemory,

                conversation:
                  contextEnvelope?.conversation || null,

                fallbackRoute:
                  route,

                fastGate
              });

            const interpretation =
              interpreterResult
                ?.interpretation ||
              null;

            if (
              interpretation
                ?.primary_route
            ) {
              route =
                interpretation
                  .primary_route;
            }

            if (
              contextEnvelope &&
              interpretation
            ) {
              contextEnvelope
                .request_interpretation =
                  interpretation;
            }

            const tasks =
              Array.isArray(
                interpretation?.tasks
              )
                ? interpretation.tasks
                : [];

            const primaryTask =
              tasks.find(
                task =>
                  task?.route === route
              ) ||
              tasks[0] ||
              null;

            if (
              primaryTask
                ?.needs_clarification &&
              primaryTask
                ?.clarification_question
            ) {
              interpreterClarification =
                primaryTask
                  .clarification_question;
            }

            /*
              Long natural / voice requests may contain
              durable client facts that deterministic
              Memory regexes cannot safely extract.

              Reuse existing Memory persistence format.
            */
            const semanticMemoryFacts =
              Array.isArray(
                interpretation
                  ?.memory_candidates
              )
                ? interpretation
                    .memory_candidates
                    .filter(
                      item =>
                        item?.key &&
                        item?.value &&
                        Number(
                          item?.confidence
                        ) >= 0.8
                    )
                    .map(
                      item => ({
                        fact_key:
                          item.key,

                        fact_value:
                          normalizeMemoryFactValue(
                            item.key,
                            item.value
                          ),

                        confidence:
                          Number(
                            item.confidence
                          ),

                        source:
                          "request_interpreter"
                      })
                    )
                : [];

            if (
              semanticMemoryFacts.length > 0
            ) {
              extractedFacts = [
                ...extractedFacts,
                ...semanticMemoryFacts
              ];

              activeMemory =
                mergeCurrentTurnMemory(
                  activeMemory,
                  semanticMemoryFacts
                );

              if (!contextEnvelope.memory) {
                contextEnvelope.memory = {
                  active_facts: []
                };
              }

              contextEnvelope
                .memory
                .active_facts =
                  activeMemory;

              refreshConversationStateV1(
                contextEnvelope
              );
            }

          } catch (error) {
            console.error(
              "prima_request_interpreter_failed",
              error
            );

            /*
              Fail open.
              Existing deterministic runtime remains usable
              if Interpreter ever fails.
            */
            interpreterResult =
              null;
          }
        }


        /*
          Canonical semantic request.

          FastGate and RequestInterpreter converge here.
          No concrete entity names are encoded in runtime.
        */
        const resolvedInterpretation =
          interpreterResult
            ?.interpretation ||
          null;

        /*
          RequestInterpreter is authoritative whenever
          it successfully canonicalizes the request.
        */
        const interpretedRoute =
          resolvedInterpretation
            ?.primary_route ||
          null;

        const canonicalRoutes =
          new Set([
            "exact_fact",
            "page_question",
            "market_question",
            "compare",
            "property_search",
            "recommendation",
            "follow_up",
            "contact_intent",
            "persona_question",
            "unsupported"
          ]);

        const interpretedRouteIsCanonical =
          Boolean(
            interpretedRoute &&
            canonicalRoutes.has(
              interpretedRoute
            )
          );

        const interpreterDowngradedInDomain =
          interpretedRoute ===
            "unsupported" &&
          deterministicRouteBeforeInterpreter !==
            "unsupported";

        const currentTurnSemanticMemoryUpdate =
          Array.isArray(
            resolvedInterpretation
              ?.memory_candidates
          ) &&
          resolvedInterpretation
            .memory_candidates
            .some(
              item =>
                item?.key &&
                item?.value &&
                Number(
                  item?.confidence
                ) >= 0.8
            );

        const currentTurnSemanticProfileUpdate =
          currentTurnSemanticMemoryUpdate &&
          resolvedInterpretation
            ?.turn_kind ===
              "profile_update";

        if (interpretedRouteIsCanonical) {
          if (
            interpreterDowngradedInDomain
          ) {
            route =
              deterministicRouteBeforeInterpreter;

            interpreterClarification =
              null;
          } else {
            route = interpretedRoute;
          }
        }

        if (
          currentTurnSemanticProfileUpdate &&
          (!Array.isArray(resolvedInterpretation?.tasks) ||
            resolvedInterpretation.tasks.length === 0)
        ) {
          route =
            "recommendation";

          interpreterClarification =
            null;
        }

        /*
          Final ConversationMoveV1 pass.

          The first pass protects deterministic
          refinement/reference paths before the
          Interpreter.

          If the Interpreter was required, route may
          now be semantically canonicalized. Re-run
          move recognition against that final route so
          switch / tangent / resume telemetry reflects
          the actual user move before persistence.
        */
        conversationMove = protectTopicMoveV1({
          move: recognizeConversationMove({message, route, context:contextEnvelope}),
          message, originalRoute: originalTopicRoute, freshRoute: explicitReturnTaskRoute
        });

        // E20: resume restores the entity/thread, not the current factual task.
        // Only an explicit, single verified-fact question may override the
        // old thread capability. Preserve C's move_type=resume for restoration.
        if (
          conversationMove?.move_type === "resume" &&
          conversationMove?.reason === "explicit_resume_to_suspended_thread" &&
          originalTopicRoute === "exact_fact" &&
          detectStructuredFactKeysV1(message).length === 1 &&
          !/\b(?:compare|versus|recommend|suggest|contact|call|whatsapp|viewing|why|risk|roi|returns?)\b/i.test(message)
        ) {
          conversationMove = {
            ...conversationMove,
            effective_route: "exact_fact",
            reason: "explicit_resume_to_suspended_thread"
          };
        }
        // E21: preserve explicit fact task + verified previous referent.
        // A pure "the other one" is only a reference, never an AI question.
        if (e21FactTask || e21ReferenceOnly) {
          conversationMove = {
            version: "ConversationMoveV1", move_type: "reference",
            effective_route: e21FactTask ? "exact_fact" : "follow_up",
            confidence: 1, reason: "e21_verified_previous_entity",
            reference: {resolved: true, type: e21ReferenceCandidate.type,
              slug: e21ReferenceCandidate.slug, name: e21ReferenceCandidate.name,
              source: "e21_verified_previous_entity"},
            changed_fields: []
          };
        }
        if (
          conversationMove
            ?.effective_route
        ) {
          route =
            conversationMove
              .effective_route;
        }


        // Final task-priority guard: a fresh, explicit advisory question after
        // "back to ..." must not be replaced by the suspended Persona topic
        // or a generic market-wide label during semantic normalization.
        if (explicitReturnTaskRoute &&
            originalTopicRoute === explicitReturnTaskRoute &&
            route !== explicitReturnTaskRoute &&
            ["persona_question", "market_question", "exact_fact"].includes(route)) {
          route = explicitReturnTaskRoute;
          conversationMove = {
            ...(conversationMove || {}), version: "ConversationMoveV1",
            move_type: "switch", effective_route: route,
            reason: "explicit_new_task_after_return", changed_fields: []
          };
        }

        if (personaA1?.decision === "answer") route = "persona_question";
        const retainedDecisionState =
          contextEnvelope
            ?.conversation
            ?.dialogue_state ||
          null;

        const retainedDecisionRefs =
          retainedDecisionState
            ?.continuity_references ||
          {};

        const asksCompareDecision =
          /\b(?:which one|which would you choose|what would you choose|which is better|which one is better|better for investment|choose for investment|prefer for investment)\b/i
            .test(message);

        const useActiveCompareDecision =
          [
            "follow_up",
            "recommendation",
            "clarification",
            "clarify"
          ].includes(route) &&
          retainedDecisionState
            ?.active_thread
            ?.active_topic === "compare" &&
          Boolean(
            retainedDecisionRefs
              ?.current_entity
              ?.slug
          ) &&
          Boolean(
            retainedDecisionRefs
              ?.comparison_target
          ) &&
          asksCompareDecision;

        if (useActiveCompareDecision) {
          route =
            "compare";

          contextEnvelope
            .working_entity =
              retainedDecisionRefs
                .current_entity;

          contextEnvelope
            .working_comparison_target =
              retainedDecisionRefs
                .comparison_target;

          interpreterClarification =
            null;

          conversationMove = {
            version:
              "ConversationMoveV1",

            move_type:
              "continuation",

            effective_route:
              "compare",

            confidence:
              1,

            reason:
              "active_compare_decision",

            changed_fields:
              []
          };
        }

        /*
          Explicit resume is authoritative once
          ConversationMoveV1 has resolved it against
          a real suspended_thread.

          The current "back to ..." phrase describes
          conversation navigation. It must not later
          be reinterpreted as a new entity request.
        */
        const resumeRouteAuthoritative =
          conversationMove
            ?.move_type === "resume" &&
          typeof conversationMove
            ?.effective_route === "string" &&
          conversationMove
            .effective_route
            .length > 0;

        const resolvedTasks =
          Array.isArray(
            resolvedInterpretation
              ?.tasks
          )
            ? resolvedInterpretation.tasks
            : [];

        const semanticTask =
          resolvedTasks.find(
            task =>
              task?.route === route
          ) ||
          resolvedTasks[0] ||
          null;

        let requestedFacts =
          (
            Array.isArray(
              semanticTask
                ?.requested_facts
            ) &&
            semanticTask
              .requested_facts
              .length > 0
          )
            ? semanticTask
                .requested_facts
            : (
                Array.isArray(
                  fastGate
                    ?.exact_facts
                )
                  ? fastGate
                      .exact_facts
                  : []
              );


        /*
          E1_REFERENCED_REQUESTED_FACT_V1

          Preserve the explicit factual task once an
          existing conversation reference was resolved.

          No invented facts: this only identifies which
          verified field the user requested.
        */
        if (
          route === "exact_fact" &&
          conversationMove?.reason ===
            "resolved_reference_fact_request" &&
          conversationMove?.reference?.resolved === true &&
          requestedFacts.length === 0
        ) {
          const text = String(message || "");

          const fact =
            /\bdeveloper\b/i.test(text)
              ? "developer"
              : /\b(?:handover|completion)\b/i.test(text)
                ? "handover"
                : /\bprice\b/i.test(text)
                  ? "price"
                  : /\b(?:location|located|district)\b/i.test(text)
                    ? "location"
                    : /\bstatus\b/i.test(text)
                      ? "status"
                      : null;

          if (fact) {
            requestedFacts = [fact];
          }
        }

        /*
          Semantic wiring invariants.

          Interpreter may help understand language, but the
          canonical request handed to Knowledge must remain sane:

          1. exact_fact without an actual requested fact is invalid;
             it is an entity/page question instead.

          2. a question targeting one named real-estate entity is not
             a generic Dubai-wide market question merely because the
             user mentions investment / market / performance.
        */
        const interpretedNamedEntity =
          (
            Array.isArray(
              resolvedInterpretation
                ?.entities
            )
              ? resolvedInterpretation
                  .entities
              : []
          ).find(
            item =>
              item?.name &&
              item?.type &&
              item.type !== "unknown"
          ) ||
          null;

        let semanticRouteCorrected =
          false;

        if (
          !resumeRouteAuthoritative &&
          route === "exact_fact" &&
          requestedFacts.length === 0
        ) {
          route =
            "page_question";

          semanticRouteCorrected =
            true;
        }

        if (
          !resumeRouteAuthoritative &&
          route === "market_question" &&
          interpretedNamedEntity
        ) {
          route =
            "page_question";

          semanticRouteCorrected =
            true;
        }

        if (
          semanticRouteCorrected &&
          resolvedInterpretation
        ) {
          resolvedInterpretation
            .primary_route =
              route;

          /*
            These correction cases are normally single-task
            interpretations. Keep the canonical task aligned too,
            so Knowledge Planner / EvidencePack do not see two
            conflicting semantic routes.
          */
          if (
            semanticTask &&
            resolvedTasks.length === 1
          ) {
            semanticTask.route =
              route;
          }
        }


        /*
          Keep the semantic envelope aligned with the
          authoritative resumed route as well.

          This prevents downstream planners from seeing:
            runtime route = resumed thread
            interpreter route = navigation phrase
        */
        if (
          resumeRouteAuthoritative &&
          resolvedInterpretation
        ) {
          resolvedInterpretation
            .primary_route =
              route;

          if (
            semanticTask &&
            resolvedTasks.length === 1
          ) {
            semanticTask.route =
              route;
          }

          /*
            A clarification generated from the current
            navigation phrase must not override the
            already-resolved suspended thread.
          */
          interpreterClarification =
            null;
        }


        const resumedContextReference =
          buildResumedContextReferenceV1({
            message,
            conversationMove,
            context: contextEnvelope
          });

        // G3104_KNOWN_PROJECT_COMMERCIAL_INTENT_V1
        // A request for current inventory or purchase terms
        // at an already identified project is not a request
        // to discover ten other projects.
        //
        // Reuse InterpreterV1. Never invent live availability.
        // Preserve Search, Compare and tool continuations.
        const g3104Signal =
          resolvedInterpretation?.commercial_signal;

        const g3104SemanticEvidence =
          resolvedInterpretation?.version ===
            "RequestInterpreterV1" &&
          Number(resolvedInterpretation?.overall_confidence) >= 0.75 &&
          (
            (
              Number(g3104Signal?.confidence) >= 0.8 &&
              [
                "availability",
                "payment_terms"
              ].includes(g3104Signal?.intent)
            ) ||
            (
              Array.isArray(resolvedInterpretation?.tasks) &&
              resolvedInterpretation.tasks.some(task =>
                task?.needs_clarification !== true &&
                Array.isArray(task?.requested_facts) &&
                task.requested_facts.some(fact =>
                  fact === "availability" ||
                  fact === "payment_plan"
                )
              )
            )
          );

        const g3104ProjectSlug =
          contextEnvelope?.working_entity?.slug ||
          contextEnvelope?.conversation?.dialogue_state
            ?.continuity_references?.current_entity?.slug ||
          contextEnvelope?.entity?.primary_slug ||
          null;

        const g3104NormalizedSlug =
          typeof g3104ProjectSlug === "string" &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g3104ProjectSlug)
            ? g3104ProjectSlug.replace(/-/g, " ")
            : null;

        const g3104NormalizedMessage =
          " " + String(message || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim() + " ";

        const g3104ProjectMentioned =
          Boolean(g3104NormalizedSlug) &&
          g3104NormalizedMessage.includes(
            " " + g3104NormalizedSlug + " "
          );

        const g3104DiscoveryOrComparison =
          /\b(?:compare|versus|similar to|alternatives? to|other projects)\b/i
            .test(String(message || ""));

        const g3104CurrentProjectCheck =
          route === "property_search" &&
          turn?.phase !== "tool_continuation" &&
          !resumedContextReference &&
          !interpreterClarification &&
          g3104SemanticEvidence &&
          g3104ProjectMentioned &&
          !g3104DiscoveryOrComparison;

        if (g3104CurrentProjectCheck) {
          // Existing Knowledge + Funnel path.
          // No new tool, no automatic contact consent.
          route = "page_question";
        }

        if (personaA1?.decision === "answer") route = "persona_question";
        // P0: the model's contact route never substitutes for human consent.
        const p0BeforeDecision = inspectPersonaContactConsentV1({
          message, route, activeMemory
        });
        // A current, explicit user request can reopen an earlier opt-out.
        // Merely considering a viewing cannot authorize collecting contacts.
        // G19: semantic contact_intent can be a non-contact feasibility
        // question. Restore the verified project Knowledge route before the
        // consent boundary otherwise maps it to unsupported.
        const g19ViewingInformationOnly =
          route === "contact_intent" &&
          isUnconsentedProjectViewingQuestionV1({
            message, context: contextEnvelope, authorization: p0BeforeDecision
          });
        if (p0BeforeDecision.explicitRequest &&
            ["persona_question", "unsupported"].includes(route)) {
          route = "contact_intent";
          interpreterClarification = null;
        } else if (route === "contact_intent" &&
                   !p0BeforeDecision.consent &&
                   !p0BeforeDecision.conditionalInterest &&
                   !p0BeforeDecision.priorOfferDecline) {
          route = g19ViewingInformationOnly
            ? "page_question"
            : p0BeforeDecision.naming ? "persona_question" : "unsupported";
          interpreterClarification = null;
        }
        const nextAction =
          resumedContextReference
            ? {
                version: "DecisionPolicyV1",
                action: "REFERENCE",
                reason:
                  "resumed_conversation_context_reference"
              }
            : decideNextActionV1({
            route,
            conversationMove,
            interpretation:
              resolvedInterpretation,
            clarification:
              interpreterClarification
          });

        route =
          routeForNextActionV1(
            nextAction,
            route
          );

        /*
          Interpreter clarification is provisional.

          If E has selected a real capability, let that
          capability and Entity Resolver attempt the task
          before asking the user to clarify.

          A real ambiguous / not_found result downstream
          may still create a clarification.
        */
        if (
          nextAction?.action !== "CLARIFY" &&
          interpreterClarification
        ) {
          interpreterClarification =
            null;
        }


        /*
          Explicit named entity may override the
          ambient page ONLY for Knowledge retrieval.

          Analytics / Funnel / Lead attribution keep
          the physical browser page.
        */
        let entityResolution =
          (
            !resumeRouteAuthoritative &&
            deterministicEntityReady
          )
            ? deterministicEntityResolution
            : null;

        let knowledgeContextEnvelope =
          entityResolution?.resolved
            ? buildKnowledgeContext(
                contextEnvelope,
                entityResolution
              )
            : contextEnvelope;

        /*
          E_RESUME_KNOWLEDGE_BRIDGE_V18
          The ConversationMove reducer restores persisted state for the
          *response* later. Knowledge needs the same verified target now.
          Never infer identity from navigation words; use only the saved
          suspended-thread entity, verified against the existing Registry.
        */
        if (resumeRouteAuthoritative && route === "exact_fact") {
          const resumedEntity = contextEnvelope?.conversation?.dialogue_state
            ?.continuity_references?.suspended_thread
            ?.continuity_references?.current_entity;
          const resumedType = String(resumedEntity?.type || "");
          const resumedSlug = String(resumedEntity?.slug || "");
          if (
            ["project", "developer", "district"].includes(resumedType) &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resumedSlug)
          ) {
            try {
              const resumedResolution = await resolveNamedEntity({
                env,
                candidate: {
                  type: resumedType,
                  slug: resumedSlug,
                  name: resumedEntity?.name || resumedSlug,
                  role: "primary",
                  source: "verified_suspended_thread"
                },
                context: contextEnvelope,
                route
              });
              if (resumedResolution?.resolved && resumedResolution?.page) {
                entityResolution = resumedResolution;
                knowledgeContextEnvelope = buildKnowledgeContext(
                  contextEnvelope, resumedResolution
                );
                contextEnvelope.working_entity = {
                  type: resumedType,
                  slug: resumedSlug,
                  name: resumedResolution.entity_name || resumedEntity?.name || resumedSlug
                };
              } else if (
                resumedResolution?.status === "current_entity" &&
                contextEnvelope?.entity?.primary_type === resumedType &&
                contextEnvelope?.entity?.primary_slug === resumedSlug
              ) {
                contextEnvelope.working_entity = {
                  type: resumedType,
                  slug: resumedSlug,
                  name: resumedEntity?.name || resumedSlug
                };
              }
            } catch (error) {
              console.error("prima_e_resume_knowledge_resolution_failed", error);
            }
          }
        }

        /*
          E19_EXPLICIT_ENTITY_RETURN_V1
          A named return is stronger evidence than an ambient pronoun such as
          "its". Resolve the named entity via the existing Registry before
          Knowledge. This is NOT a general alias/search parser or an implicit
          "previous one" history store. Real suspended-thread resumes retain
          their existing C/V18 flow.
        */
        if (!resumeRouteAuthoritative &&
            ["exact_fact", "page_question"].includes(route)) {
          const namedReturn = String(message || "").trim().match(
            /\b(?:go\s+back\s+to|get\s+back\s+to|back\s+to|return\s+to)\s+([^.!?\n]{2,120}?)(?=[.!?](?:\s|$)|$)/i
          );
          const targetName = String(namedReturn?.[1] || "").trim();
          if (targetName && !/^(?:it|this|that|the|previous|earlier|our)\s+(?:one|project|topic|search|conversation)?$/i.test(targetName)) {
            try {
              const returnResolution = await resolveNamedEntity({
                env,
                candidate: {
                  type: "unknown",
                  name: targetName,
                  slug: null,
                  role: "primary",
                  source: "e19_explicit_named_return"
                },
                context: contextEnvelope,
                route
              });
              if (returnResolution?.resolved && returnResolution?.page) {
                entityResolution = returnResolution;
                knowledgeContextEnvelope = buildKnowledgeContext(
                  contextEnvelope, returnResolution
                );
                contextEnvelope.working_entity = {
                  type: returnResolution.page.primary_entity_type,
                  slug: returnResolution.page.primary_entity_slug,
                  name: returnResolution.entity_name || targetName
                };
                interpreterClarification = null;
              } else if (returnResolution?.status === "current_entity" &&
                         contextEnvelope?.entity?.primary_type &&
                         contextEnvelope?.entity?.primary_slug) {
                // Registry helper's current_entity result is valid only when
                // it matches the physical page identity; no invented page.
                contextEnvelope.working_entity = {
                  type: contextEnvelope.entity.primary_type,
                  slug: contextEnvelope.entity.primary_slug,
                  name: targetName
                };
                interpreterClarification = null;
              } else {
                // A named return that cannot be verified must never answer
                // from the previously active, unrelated project.
                entityResolution = null;
                interpreterClarification =
                  "I couldn't verify that entity in the Primadom knowledge base. Could you confirm its exact name?";
              }
            } catch (error) {
              console.error("prima_e19_named_return_resolution_failed", error);
              entityResolution = null;
              interpreterClarification =
                "I couldn't verify that entity right now. Could you confirm its exact name?";
            }
          }
        }

        if (
  !resumeRouteAuthoritative &&
  !deterministicEntityReady &&
  resolvedInterpretation &&
  !interpreterClarification &&
  !(route === "recommendation" &&
    turn?.phase === "tool_continuation" &&
    body?.recommendation_context?.version === "RecommendationEntityContextV1" &&
    ["district","developer"].includes(body?.recommendation_context?.entity_type)) &&
  !(route === "recommendation" &&
    /^(?:please\s+)?(?:recommend|suggest)\b/i.test(String(message || "")) &&
    /\b(?:developers?|districts?|areas|communities|neighbou?rhoods)\b/i.test(String(message || "")) &&
    !/\bprojects?\b/i.test(String(message || "")))
) {
          entityResolution =
            await resolveNamedEntity({
              env,

              interpretation:
                resolvedInterpretation,

              context:
                contextEnvelope,

              route
            });

          if (
            entityResolution
              ?.resolved
          ) {
            knowledgeContextEnvelope =
              buildKnowledgeContext(
                contextEnvelope,
                entityResolution
              );
          }

          // F28_STRICT_RECOMMENDATION_GEOGRAPHY_V1
          // Known SearchContext location is a geographic
          // constraint, not an ambiguous project name.
          const f28NormalizeLocation = value =>
            String(value || "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();

          const f28NamedLocation =
            f28NormalizeLocation(
              entityResolution?.entity_name
            );

          const f28MessageLocation =
            " " + f28NormalizeLocation(message) + " ";

          const f28SearchLocations = [
            contextEnvelope?.search?.filters?.district,
            contextEnvelope?.search?.filters?.emirate
          ];

          // F29_EXPLICIT_EMIRATE_RECOMMENDATION_GUARD_V1
          // Explicit UAE emirate filters are geography,
          // not named projects. Works even if SearchContext
          // filter normalization changes the field shape.
          const f29ExplicitEmirate =
            [
              "dubai",
              "abu dhabi",
              "sharjah",
              "ajman",
              "fujairah",
              "ras al khaimah",
              "umm al quwain"
            ].includes(f28NamedLocation) &&
            /\b(?:recommend|suggest)\b/i.test(
              String(message || "")
            ) &&
            /\b(?:projects?|properties?|apartments?|villas?|townhouses?|homes?|residences?|developments?)\b/i.test(
              String(message || "")
            );

          const f28VerifiedGeography =
            route === "recommendation" &&
            Boolean(f28NamedLocation) &&
            (
              f28SearchLocations.some(
                value =>
                  f28NormalizeLocation(value) ===
                    f28NamedLocation
              ) ||
              f29ExplicitEmirate
            ) &&
            [
              "in",
              "within",
              "across",
              "throughout"
            ].some(
              prefix =>
                f28MessageLocation.includes(
                  " " + prefix + " " +
                  f28NamedLocation + " "
                )
            );

          // F23_RECOMMENDATION_DUBAI_SCOPE_GUARD_V1
          // A broad "in Dubai" market filter is not
          // an ambiguous named project.
          // Preserve genuine entity clarifications.
          const f23DubaiMarketScope =
            route === "recommendation" &&
            /^dubai$/i.test(
              String(
                entityResolution?.entity_name || ""
              ).trim()
            ) &&
            /\b(?:recommend|suggest)\b/i.test(
              String(message || "")
            ) &&
            /\b(?:projects?|properties?|homes?|apartments?|villas?|townhouses?|residences?|developments?)\b/i.test(
              String(message || "")
            ) &&
            /\b(?:in|across|throughout)\s+Dubai(?=\s*(?:[,!.?]|$|\bfor\b|\bwith\b|\bunder\b))/i.test(
              String(message || "")
            );

          if (
            entityResolution?.status === "ambiguous" &&
            !f23DubaiMarketScope &&
            !f28VerifiedGeography
          ) {
            interpreterClarification =
              (
                `I found more than one match for ${entityResolution.entity_name}. ` +
                "Which one do you mean?"
              );
          }

          // F14_RECOMMENDATION_BUYER_FIT_ENTITY_GUARD_V1
          // Buyer-profile terms are not named entities.
          // Unknown real estate entities retain their existing guard.
          const f14BuyerProfileTerm =
            route === "recommendation" &&
            /^(?:family|families|investor|investors|end[ -]?user|buyers?|homebuyers?)$/i
              .test(String(entityResolution?.entity_name || "").trim());

          // F27_GENERIC_RECOMMENDATION_CATEGORY_GUARD
          // Do not resolve category nouns as project names.
          // Genuine named-entity failures remain unchanged.
          const f27GenericRecommendationCategory =
            route === "recommendation" &&
            /\b(?:recommend|suggest)\b/i.test(
              String(message || "")
            ) &&
            /^(?:(?:residential|off[ -]?plan|investment|luxury|new)\s+)?(?:projects?|properties?|apartments?|villas?|townhouses?|homes?|residences?|developments?)$/i
              .test(
                String(
                  entityResolution?.entity_name || ""
                ).trim()
              );

          if (
            entityResolution?.status === "not_found" &&
            !f14BuyerProfileTerm &&
            !f27GenericRecommendationCategory &&
            !f28VerifiedGeography
          ) {
interpreterClarification =
              (
                `I couldn't match ${entityResolution.entity_name} ` +
                "to the Primadom knowledge base. Could you give me the exact name?"
              );
          }
        }


        if (
          entityResolution?.resolved &&
          knowledgeContextEnvelope
            ?.entity
            ?.primary_slug
        ) {
          const resolvedWorkingEntity = {
            type:
              knowledgeContextEnvelope
                .entity
                .primary_type ||
              null,

            slug:
              knowledgeContextEnvelope
                .entity
                .primary_slug,

            name:
              knowledgeContextEnvelope
                .entity
                .primary_name ||
              entityResolution
                ?.entity_name ||
              null
          };

          if (
            conversationMove
              ?.reason ===
                "pending_clarification_answer" &&
            route === "compare"
          ) {
            const retainedCurrentEntity =
              contextEnvelope
                ?.conversation
                ?.dialogue_state
                ?.continuity_references
                ?.current_entity ||
              null;

            if (
              !contextEnvelope
                ?.working_entity
                ?.slug &&
              retainedCurrentEntity
                ?.slug
            ) {
              contextEnvelope
                .working_entity = {
                  type:
                    retainedCurrentEntity
                      .type ||
                    null,

                  slug:
                    retainedCurrentEntity
                      .slug
                };
            }

            contextEnvelope
              .working_comparison_target =
                resolvedWorkingEntity
                  .name ||
                resolvedWorkingEntity
                  .slug;

            knowledgeContextEnvelope =
              contextEnvelope;
          } else {
            contextEnvelope
              .working_entity =
                resolvedWorkingEntity;
          }

          refreshConversationStateV1(
            contextEnvelope,
            {
              route
            }
          );
        }


        /*
          Day 3 — Dialog → Prima Search.

          property_search first asks the client-side
          shared Project Search to execute the real
          deterministic Search rules.

          This is an intermediate tool request, NOT
          a user-visible ResponseContractV1 answer.

          Nothing is persisted yet. The client returns
          SearchContextV1 and resubmits the same user
          request; only that completed pass continues
          into answer generation + persistence.
        */
        const searchDispatchAllowed =
          nextAction?.action === "SEARCH" ||
          (
            nextAction?.action === "ADVISORY" &&
            route === "recommendation"
          );

        // D4 local preview — direct Developer Registry search.
        // D4 preview: direct developer discovery by generic request
        // or by a name that actually exists in Supabase Registry.
        const d4Text = String(message || "").trim();

        const d4PreviewEnabled =
          env?.PRIMA_D4_PREVIEW === "1" ||
          env?.PRIMA_SEARCH_PRODUCTION === "1";

        const d4GenericDevelopers =
          /^(?:show me developers|show developers|list developers|find developers)[.!?]?$/i
            .test(d4Text);

        const d4CandidateMatch =
          d4Text.match(
            /^(?:find|show me)\s+(.{2,90}?)\s*[.!?]?$/i
          );

        const d4CandidateName =
          String(d4CandidateMatch?.[1] || "").trim();

        const d4PotentialName =
          d4CandidateName.length >= 2 &&
          !/^(?:projects?|properties|apartments?|villas?|townhouses?|penthouses?|districts?|areas|developers?)$/i
            .test(d4CandidateName) &&
          !/\b(?:projects?|apartments?|villas?|townhouses?|penthouses?|districts?|under|below|above|over|budget|bedrooms?|aed)\b/i
            .test(d4CandidateName);

        let d4NamedDeveloper = false;

        if (
          d4PreviewEnabled &&
          !d4GenericDevelopers &&
          d4PotentialName
        ) {
          try {
            const discovery =
              await discoverDevelopersV1({
                query: d4Text,
                select: (table, query) =>
                  d4SupabaseSelect(env, table, query),
                offset: 0,
                batchSize: 3
              });

            d4NamedDeveloper =
              discovery?.state === "results" &&
              discovery.result_count > 0;
          } catch (error) {
            console.error(
              "d4_name_resolution_failed",
              error
            );
          }
        }

        // D4_23A_REGISTRY_PORTFOLIO: verify developer against Registry
        // before sending short portfolio requests to the existing D4 UI adapter.
        // All non-developer and faceted project requests keep their normal route.
        // D4_25_QUICK_CLOSE: named portfolio, budgeted portfolio or villas by developer.

        const e32PortfolioIntent =
          /^(?:(?:show me|show|find|list)\s+)?(?:all\s+)?(?:its|their|that developer(?:'s)?|this developer(?:'s)?)\s+projects\s*[.!?]*$/i.test(
            d4Text
          ) &&
          Boolean(e32ActiveDeveloper);

        const e32PortfolioText =
          e32PortfolioIntent
            ? `Show me ${e32ActiveDeveloper.name} projects`
            : d4Text;

        const d4PortfolioMatch = e32PortfolioText.match(
          /^(?:(?:show me|show|find|list)\s+)?(?:all\s+)?(.{2,90}?)\s+projects(?:\s+(?:under|below|up to)\s+(?:AED\s*)?[\d,.]+\s*(?:million|thousand|m|k)?)?\s*[.!?]?$/i
        ) || e32PortfolioText.match(
          /^(?:(?:show me|show|find|list)\s+)?villas?\s+by\s+(.{2,90}?)\s*[.!?]?$/i
        );
        let d4PortfolioVerified = false;
        if (d4PreviewEnabled && d4PortfolioMatch && (!contextEnvelope?.search || e32PortfolioIntent)) {
          const candidate = String(d4PortfolioMatch[1] || "").trim();
          if (candidate &&
              !/\b(?:under|below|over|above|budget|aed|villas?|apartments?|bedrooms?|in dubai|in abu dhabi)\b/i.test(candidate)) {
            try {
              const discovered = await discoverDevelopersV1({
                query: `Find ${candidate}`,
                select: (table, query) => d4SupabaseSelect(env, table, query),
                offset: 0,
                batchSize: 3
              });
              const normalizeName = value => String(value || "")
                .toLowerCase().replace(/&/g, " and ")
                .replace(/[^a-z0-9]+/g, " ").trim();
              const actual = normalizeName(discovered?.results?.[0]?.title);
              const wanted = normalizeName(candidate);
              d4PortfolioVerified = discovered?.result_count === 1 &&
                !!wanted && (actual === wanted || actual.startsWith(wanted + " "));
            } catch (error) {
              console.error("d4_portfolio_resolution_failed", error);
            }
          }
        }

        // D6_SEARCH_ENTITY_PRECEDENCE_V2: project requests mentioning
        // "same developer" are PROJECT search, not developer discovery.
        // This is entity-type precedence, independent of word order.
        const d4FacetedDevelopers =
          /\bdevelopers?\b/i.test(d4Text) &&
          !/\b(?:projects?|properties|apartments?|villas?|townhouses?|penthouses?|residences?)\b/i.test(d4Text) &&
          /\b(?:abu dhabi|dubai|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|in|with|under|below|over|above|aed|villas?|apartments?|budget|bedrooms?)\b/i.test(d4Text);

        // D4_25_QUICK_CLOSE: explicitly requested developer names can return zero.
        const d4ExplicitDeveloperLookup =
          !!d4CandidateMatch && d4PotentialName &&
          /\bdevelopers?\b/i.test(d4CandidateName) &&
          !/\b(?:projects?|villas?|apartments?|budget|under|below|aed)\b/i.test(d4CandidateName);

        // F213: route developer category recommendations through existing D4.
        const f213DeveloperDiscovery =
          route === "recommendation" &&
          /^(?:please\s+)?(?:recommend|suggest)\b/i.test(d4Text) &&
          /\bdevelopers?\b/i.test(d4Text) &&
          !/\bprojects?\b/i.test(d4Text);
        const d4DeveloperDiscovery =
          d4PreviewEnabled &&
          (f213DeveloperDiscovery || d4GenericDevelopers || d4NamedDeveloper || d4FacetedDevelopers || d4ExplicitDeveloperLookup);

        // BLOCK_D_D5_NAMED_DISTRICT_ROUTE_V3: typed entity intent only.
        // The frontend performs exact Registry verification; no names or
        // answers are embedded and no OpenAI call is added.
        const d5NamedDistrictIntent =
          d4PreviewEnabled &&
          /\b(?:district|area|community|neighbou?rhood)\b/i.test(d4Text) &&
          !/\b(?:districts|areas|communities|neighbou?rhoods|projects?|developers?|apartments?|villas?|townhouses?|compare|recommend|suggest|aed|budget)\b/i.test(d4Text) &&
          /^(?:please\s+)?(?:find|show(?:\s+me)?|explore|view|tell\s+me\s+about|look\s+up)\b/i.test(d4Text);


        /*
          E42_CONTEXTUAL_DISTRICT_PROJECT_SEARCH_V1

          Resolve explicit "projects in that district" requests
          using the active district identity.

          Only changes the query sent to Prima Search.
          Original user message and conversation context stay intact.
          Never invent a district from generic page context.
        */
        function resolveE42DistrictProjectQuery({
          message,
          route,
          context
        }) {
          const original = String(message || "").trim();

          const isDistrictProjectRequest =
            /^(?:show(?:\s+me)?|find|list)(?:\s+(?:some|all|available))?\s+projects\s+in\s+(?:that|this|the)\s+(?:district|area|neighbourhood|neighborhood|community)\s*[?.!]*$/i
              .test(original);

          if (
            route !== "property_search" ||
            !isDistrictProjectRequest
          ) {
            return original;
          }

          const references =
            context?.conversation?.dialogue_state
              ?.continuity_references || {};

          const persisted =
            context?.conversation?.state
              ?.continuity_references || {};

          const candidates = [
            context?.working_entity,
            references.current_entity,
            persisted.current_entity,
            context?.conversation_state
              ?.continuity_references?.current_entity,
            context?.state
              ?.continuity_references?.current_entity
          ];

          for (const entity of candidates) {
            const type = String(entity?.type || "");
            const slug = String(entity?.slug || "");

            if (
              type !== "district" ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
            ) {
              continue;
            }

            const verifiedName =
              String(entity?.name || "").trim();

            const name =
              verifiedName ||
              slug.split("-").map(part =>
                part.charAt(0).toUpperCase() +
                part.slice(1)
              ).join(" ");

            if (!name) continue;

            return `Show me projects in ${name}`;
          }

          return original;
        }

        const e42DistrictSearchQuery =
          resolveE42DistrictProjectQuery({
            message,
            route,
            context: contextEnvelope
          });

        const primaSearchRequest =
          d4PortfolioVerified
            ? {
                version: "PrimaToolRequestV1",
                tool: "prima_search",
                action: "search_projects",
                language: "en",
                entity_type: "project",
                query: e32PortfolioText,
                max_results: 10
              }
            : d4DeveloperDiscovery
              ? {
                version: "PrimaToolRequestV1",
                tool: "prima_search",
                action: "search_developers",
                language: "en",
                entity_type: "developer",
                query: String(message || "").trim(),
                max_results: f213DeveloperDiscovery ? 10 : 3
              }
            : d5NamedDistrictIntent
              ? {
                  version: "PrimaToolRequestV1",
                  tool: "prima_search",
                  action: "search_districts",
                  language: "en",
                  entity_type: "district",
                  query: d4Text,
                  max_results: 3
                }
              : searchDispatchAllowed
                ? buildPrimaSearchRequest({
                    route,
                    message: e42DistrictSearchQuery,
                    context: contextEnvelope
                  })
                : null;

        // E33_TOOL_CONTINUATION_DISPATCH_GUARD_V1
        // A tool continuation must consume its result,
        // never issue the same PrimaToolRequest again.
        if (
          primaSearchRequest &&
          turn?.phase !== "tool_continuation"
        ) {
          return json({
            ...primaSearchRequest,

            conversation_id:
              conversationId,

            turn,

            route,

            meta: {
              language:
                "en",

              used_openai:
                Boolean(personaA1?.used),

              used_database:
                Boolean(
                  !statelessFastPath
                ),

              used_search:
                false,
              persona_a1_total_tokens: personaA1?.usage?.total_tokens ?? null,
              persona_a1_usage_unknown: Boolean(personaA1?.usage_unknown),
              total_openai_tokens: personaA1?.usage?.total_tokens ?? 0,
              openai_calls_attempted: Number(Boolean(personaA1?.used))
            }
          });
        }


        const allowedTools =
          getToolIds(route);

        const needsSearchKnowledge =
          shouldResolveSearchCandidateKnowledge({
            route,
            context:
              contextEnvelope
          });

        const needsKnowledge =
          !interpreterClarification &&
          !needsSearchKnowledge &&
          !isGlobalNoKnowledgeGuard(
            message
          ) &&
          (
            canUseTool(
              route,
              "structured_lookup"
            ) ||
            canUseTool(
              route,
              "knowledge_retrieve"
            )
          );

        const knowledgeTask =
          needsKnowledge
            ? resolveKnowledge(
                env,
                knowledgeContextEnvelope,
                route,
                message
              )
            : Promise.resolve(
                emptyKnowledgePack(
                  route
                )
              );

        const searchKnowledgeTask =
          needsSearchKnowledge
            ? resolveSearchCandidateKnowledge(
                env,
                contextEnvelope
              )
            : Promise.resolve(
                null
              );

        const projectCardFactsTask =
          route === "property_search" &&
          contextEnvelope
            ?.search
            ?.state === "results"
            ? resolveProjectCardFacts(
                env,
                contextEnvelope
              )
            : Promise.resolve(
                null
              );

        let [
          knowledgePack,
          deferredMemoryBeforeTurn,
          searchCandidateKnowledge,
          projectCardFacts
        ] = await Promise.all([
          knowledgeTask,

          deferredCommercialMemoryTask ||
            Promise.resolve(null),

          searchKnowledgeTask,

          projectCardFactsTask
        ]);

        knowledgePack =
          mergeSearchCandidateKnowledge(
            knowledgePack,
            searchCandidateKnowledge
          );

        if (
          !projectCardFacts &&
          searchCandidateKnowledge
            ?.resolved
        ) {
          projectCardFacts =
            projectCardFactsFromSearchKnowledge(
              searchCandidateKnowledge
            );
        }

        if (
          deferredMemoryBeforeTurn !==
          null
        ) {
          activeMemory =
            mergeCurrentTurnMemory(
              deferredMemoryBeforeTurn,
              extractedFacts
            );

          contextEnvelope =
            buildLocalContextEnvelope(
              body,
              message,
              activeMemory
            );

          refreshConversationStateV1(
            contextEnvelope
          );
        }

        activeMemory =
          contextEnvelope
            ?.memory
            ?.active_facts ||
          activeMemory;

        // G19: Interpreter's viewing feasibility may incorrectly carry
        // explicit_request=true. Do not let that become a direct handoff.
        // Preserve the raw interpretation for all other capabilities.
        const g19FunnelInterpretation = h29Direct.direct_request
          ? {
              version:"RequestInterpreterV1", overall_confidence:1,
              primary_route:"contact_intent", tasks:[],
              commercial_signal:{intent:"specialist_contact",confidence:1,explicit_request:true}
            }
          : g19ViewingInformationOnly && resolvedInterpretation?.commercial_signal?.explicit_request
            ? {
                ...resolvedInterpretation,
                commercial_signal: {
                  ...resolvedInterpretation.commercial_signal,
                  explicit_request: false
                }
              }
            : resolvedInterpretation;

        // G42_RUNTIME_CONTEXT_BRIDGE_V1
        const g42CommercialContext =
          buildCommercialContextV1({
            interpretation: g19FunnelInterpretation,
            activeMemory,
            context: contextEnvelope,
            route
          });

        // P0: authorization check before Funnel AND ContactCapture. A model's
        // contact_intent classification alone is not consent. Persona does not
        // run commercial invitations by default; genuine handoffs still work.
        const p0Consent = inspectPersonaContactConsentV1({
          message, route, activeMemory
        });
        const p0EmptyFunnelDecision = () => ({
          response_type: null, answer_override: null,
          follow_up: null, lead_action: null, memory_facts: []
        });
        const p0OptOutDecision = () => ({
          response_type: "answer",
          answer_override: p0Consent.hasOtherTask ? null :
            "Understood. I won't suggest contacting a specialist unless you ask. We can continue here.",
          follow_up: null, lead_action: null,
          memory_facts: [{
            fact_key: "funnel_state",
            fact_value: {
              status: "contact_opted_out", cta_type: null,
              progress_score: Number(p0Consent.prior?.progress_score || 0)
            },
            confidence: 0.99
          }]
        });
        const p0RawFunnelDecision = p0Consent.refusal
          ? p0OptOutDecision()
          : p0Consent.suppress
            ? p0EmptyFunnelDecision()
            : evaluateFunnel({
                message, route, activeMemory,
                interpretation: g19FunnelInterpretation,
                commercialContext: g42CommercialContext,
                fullContext: !statelessFastPath && !interpreterClarification
              });
        // Even outside Persona, a false semantic handoff is not authorization.
        const h28AuthorizedFunnelDecision = !p0Consent.consent &&
          (p0RawFunnelDecision?.response_type === "lead_transition" ||
           p0RawFunnelDecision?.lead_action?.type === "request_contact")
            ? p0EmptyFunnelDecision() : p0RawFunnelDecision;

        // H28: personalize ONLY an authorized direct-contact request.
        // Keep G26/Funnel unchanged and preserve the selected channel in Memory.
        const funnelDecision = presentContactHandoffH28({
          message, route, consent: p0Consent,
          decision: h28AuthorizedFunnelDecision,
          activeMemory, currentFacts: extractedFacts,
          preferredChannel: h29Direct.direct_request ? h29Direct.preferred_channel : null
        });

        if (
          funnelDecision
            .memory_facts
            .length > 0
        ) {
          extractedFacts = [
            ...extractedFacts,
            ...funnelDecision
              .memory_facts
          ];
        }

        const contactDecision = p0Consent.suppress || !p0Consent.consent
          ? {
              captured: false, response_type: null, answer_override: null,
              follow_up: null, lead_action: null, memory_facts: [], event_data: null
            }
          : evaluateContactCapture({ message, activeMemory, currentFacts: extractedFacts, funnelDecision });
        i33Mark("contact_decision_ready");

        if (
          contactDecision.captured
        ) {
          /*
            contact_captured is the final
            funnel state for this turn.
            Avoid two same-turn funnel_state
            persistence rows.
          */
          extractedFacts =
            extractedFacts.filter(
              fact =>
                fact?.fact_key !==
                  "funnel_state"
            );

          extractedFacts = [
            ...extractedFacts,
            ...contactDecision
              .memory_facts
          ];
        }

        const answerContextEnvelope =
          (
            entityResolution
              ?.resolved &&
            conversationMove
              ?.reason !==
                "pending_clarification_answer"
          )
            ? buildKnowledgeContext(
                contextEnvelope,
                entityResolution
              )
            : contextEnvelope;


        // F213_MULTI_ENTITY_RECOMMENDATION_V1
        // Verified D4/D5 preview results passed by the existing tool continuation.
        const f213Raw = body?.recommendation_context;
        const f213EntityType = f213Raw?.entity_type;
        const f213Prefix = f213EntityType === "district" ? "/en/areas/" :
          f213EntityType === "developer" ? "/en/developers/" : null;
        const f213Recommendation = route === "recommendation" &&
          turn?.phase === "tool_continuation" && f213Prefix &&
          f213Raw?.version === "RecommendationEntityContextV1" &&
          f213Raw?.query === message &&
          f213Raw?.source === (f213EntityType === "district" ? "D5" : "D4") &&
          Number.isInteger(f213Raw.requested_count) &&
          f213Raw.requested_count >= 1 && f213Raw.requested_count <= 10 &&
          Array.isArray(f213Raw.results) &&
          f213Raw.results.length <= f213Raw.requested_count &&
          new Set(f213Raw.results.map(item => item?.slug)).size === f213Raw.results.length &&
          f213Raw.results.every(item => {
            const slug = String(item?.slug || "");
            return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
              item?.canonical_url === f213Prefix + slug + "/" &&
              typeof item?.title === "string" &&
              item.title.trim().length > 0 && item.title.length <= 120 &&
              !/[\x00-\x1f\x7f]/.test(item.title);
          })
          ? {
              version:"RecommendationEntityContextV1",
              entity_type:f213EntityType,
              requested_count:f213Raw.requested_count,
              source:f213Raw.source,
              search_mode:String(f213Raw.search_mode || "").slice(0,40),
              emirate:String(f213Raw.emirate || "").slice(0,50),
              criteria:Array.isArray(f213Raw.criteria)
                ? f213Raw.criteria.slice(0,8).map(s=>String(s).slice(0,35)) : [],
              results:f213Raw.results.map(item=>({slug:item.slug,
                title:item.title,canonical_url:item.canonical_url,
                matching_project_count:Number.isInteger(item.matching_project_count)
                  ? item.matching_project_count : null}))
            } : null;

        const evidencePack =
          buildEvidencePack({
            route,
            message,
            context: answerContextEnvelope,
            knowledgePack
          });

        if (f213Recommendation) evidencePack.f213_recommendation = f213Recommendation;

        // F24_RECOMMENDATION_CRITERIA_WORKER_HANDOFF_V1
        // F analyzes. C retains dialogue control.
        const f24RecommendationCriteria =
          route === "recommendation" &&
          contextEnvelope?.search?.entity_type === "project" &&
          contextEnvelope?.search?.state === "results"
            ? analyzeRecommendationCriteriaV1({
                route,
                known_constraints:
                  recommendationKnownConstraintsV1(
                    body?.search_context?.source === "prima_f1_verified_project_catalog_v1"
                      ? {
                          ...contextEnvelope,
                          search: {
                            ...contextEnvelope.search,
                            filters: {
                              ...contextEnvelope.search.filters,
                              budget: body.search_context.filters?.budget ||
                                contextEnvelope.search.filters?.budget
                            }
                          }
                        }
                      : contextEnvelope
                  ),
                candidates:
                  contextEnvelope.search.results,
                requested_count:
                  Number(
                    body?.search_context?.requested_count ??
                    contextEnvelope.search.requested_count ??
                    contextEnvelope.search.result_count
                  ) || 3
              })
            : null;

        if (f24RecommendationCriteria) {
          evidencePack.recommendation_criteria =
            f24RecommendationCriteria;
        }

        const searchRouteResponse =
          nextAction?.action === "REFERENCE"
            ? null
            : buildSearchRouteResponse({
            route,
            context:
              contextEnvelope
          });

        if (
          searchRouteResponse
            ?.cards
            ?.length
        ) {
          searchRouteResponse.cards =
            attachProjectCardFacts(
              searchRouteResponse.cards,
              projectCardFacts
            );
        }

        // F-V1 LIMITED LOCAL PRESENTATION: no new retrieval/ranking model.
        // Existing Search D returns the actual page. F only describes this
        // verified page, never invents buyer-fit or investment performance.
        const fV1VerifiedProjectPage =
          route === "recommendation" &&
          body?.search_context?.source === "prima_f1_verified_project_catalog_v1" &&
          contextEnvelope?.search?.entity_type === "project" &&
          ["results", "empty"].includes(contextEnvelope.search.state) &&
          Array.isArray(contextEnvelope.search.results) &&
          searchRouteResponse?.response_type === "search_results" &&
          Array.isArray(searchRouteResponse.cards);

        const fV1LocalRecommendationAnswer =
          f213Recommendation
            ? (() => {
                const rows = f213Recommendation.results;
                if (!rows.length) return "I couldn't find verified matches in the current directory. We can refine the criteria.";
                const kind = f213Recommendation.entity_type === "district" ? "districts" : "developers";
                const names = rows.map(row => row.title).join(", ");
                return `Here are ${rows.length} ${kind} to explore: ${names}. This is an unranked directory shortlist, not a verified comparison of quality, performance or personal suitability.`;
              })()
            : fV1VerifiedProjectPage
              ? (() => {
                  const page = searchRouteResponse.cards;
                  const count = page.length;
                  if (!count) return "I couldn't find an exact project match for those conditions. We can broaden one of the criteria and try again.";
                  const start = Number(searchRouteResponse.pagination?.current_offset || 0);
                  const total = Number(contextEnvelope.search.results.length);
                  const names = page.map(card => card.facts?.title || card.slug).filter(Boolean).join(", ");
                  const intro = start > 0
                    ? `Here ${count === 1 ? "is" : "are"} ${count} more ${count === 1 ? "project" : "projects"} from your existing results`
                    : `Here ${count === 1 ? "is" : "are"} ${count} matching ${count === 1 ? "project" : "projects"}${total > count ? ` from ${total} verified catalog matches` : ""}`;
                  return `${intro}: ${names}. These are catalog listings; starting prices do not confirm current unit availability or prices.`;
                })()
              : null;

        const localAnswer =
          (personaA1?.decision === "answer" ||
          (personaA1?.decision === "route" &&
            personaA1?.interpretation?.turn_kind === "profile_update"))
            ? personaA1.answer :
          fV1LocalRecommendationAnswer ? fV1LocalRecommendationAnswer :
          nextAction?.action ===
            "PROFILE_UPDATE"
            ? (resolvedTasks.length === 0 && extractedFacts.length > 0
                 ? "Understood — I'll take those preferences into account as we continue."
                 : null)
            : (
                // E22: E21 has already resolved a verified previous entity.
                // Do not re-run the generic follow-up resolver against the
                // current context, which can contradict the selected target.
                (route === "follow_up" && e21ReferenceOnly &&
                 conversationMove?.reason === "e21_verified_previous_entity" &&
                 conversationMove?.reference?.resolved === true &&
                 conversationMove.reference.type === e21ReferenceCandidate?.type &&
                 conversationMove.reference.slug === e21ReferenceCandidate?.slug
                  ? `You're referring to ${String(e21ReferenceCandidate.slug)
                      .split("-").filter(Boolean)
                      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                      .join(" ")}.`
                  : null) ||
                resumedContextReference
                  ?.answer ||
                searchRouteResponse
                  ?.answer ||
                interpreterClarification ||
                buildLocalRouteAnswer({
                  route,
                  message,
                  personaIntent:
                    directPersonaIntent ||
                    resolvedInterpretation?.persona_intent ||
                    null,
                  knowledgePack,
                  context:
                    answerContextEnvelope
                })
              );

        const structuredAnswer =
          !f213Recommendation && canUseTool(
            route,
            "structured_lookup"
          )
            ? buildStructuredAnswer({
                  message,
                  route,
                  knowledgePack,
                  evidencePack,
                  requestedFacts,
                  context:
                    answerContextEnvelope
                })
            : null;

        const verifiedProjectOverview =
          !localAnswer && !structuredAnswer
            ? buildVerifiedProjectOverview({
                message,
                route,
                nextAction: nextAction?.action || null,
                context: answerContextEnvelope,
                evidencePack,
                knowledgePack
              })
            : null;

        // G43_APPROVED_OFFER_ONLY_V1
        const g43ApprovedOffer =
          g42CommercialContext?.version === "CommercialContextV1" &&
          !interpreterClarification &&
          !g42CommercialContext?.buyer_context?.pending_clarification &&
          !contactDecision?.captured &&
          !contactDecision?.answer_override &&
          !funnelDecision?.answer_override &&
          !funnelDecision?.lead_action &&
          typeof funnelDecision?.follow_up === "string" &&
          funnelDecision.follow_up.trim().length > 0 &&
          ["page_question", "recommendation", "follow_up", "exact_fact"]
            .includes(route) &&
          Array.isArray(funnelDecision?.memory_facts) &&
          funnelDecision.memory_facts.some(fact =>
            fact?.fact_key === "funnel_state" &&
            fact?.fact_value?.status === "cta_offered"
          );

        const useOpenAI =
          !contactDecision
            .answer_override &&
          !funnelDecision
            .answer_override &&
          !localAnswer &&
          !structuredAnswer &&
          !verifiedProjectOverview &&
          (
            nextAction?.action ===
              "PROFILE_UPDATE" ||
            (f213Recommendation || shouldUseOpenAI({
              route,
              evidencePack,
              knowledgePack
            }))
          );

        const openAIResult =
          useOpenAI
            ? await generatePrimaAnswer({
                env,
                route,
                nextAction:
                    nextAction?.action ||
                    null,
                  evidencePack,
                  commercialDirective:
                    g43ApprovedOffer
                      ? {
                          decision: "offer_contact",
                          commercial_needs:
                            g42CommercialContext.commercial_needs,
                          project:
                            g42CommercialContext.buyer_context
                              ?.primary_project_slug || null,
                          known_requirements:
                            g42CommercialContext.buyer_context
                              ?.known_facts || {},
                          grounded_base_answer:
                            localAnswer ||
                            structuredAnswer?.answer ||
                            null
                        }
                      : null,

                deadlineMs:
                  5000
              })
            : null;

        // G43_GENERATED_CTA_VALIDATION_V1
        // Existing Funnel text remains a safe fallback.
        const g43GeneratedOffer =
          g43ApprovedOffer &&
          typeof openAIResult?.answer === "string" &&
          /\bPrimadom\b/i.test(openAIResult.answer) &&
          /\?/.test(openAIResult.answer) &&
          !/\b(?:phone number|whatsapp number|share your contact|send me your number)\b/i
            .test(openAIResult.answer) &&
          !/\b(?:I can't verify|I cannot verify|I don't know|I don't have)\b/i
            .test(openAIResult.answer)
            ? openAIResult.answer.trim()
            : null;

        const fallbackAnswer =
          !localAnswer &&
          !structuredAnswer &&
          !openAIResult?.answer
            ? buildGroundedFallback({
                  route,
                  nextAction:
                    nextAction?.action ||
                    null,
                  evidencePack,
                  knowledgePack,
                  interpretation:
                    resolvedInterpretation,
                  activeMemory
                })
            : null;

          const baseAnswer =
            contactDecision
              .answer_override ||
            funnelDecision
              .answer_override ||
            localAnswer ||
            structuredAnswer?.answer ||
            verifiedProjectOverview ||
            openAIResult?.answer ||
            fallbackAnswer ||
            `Prima routing preview: "${message}" → ${route}`;

          const nameKnownThisTurn =
            extractedFacts.some(
              fact =>
                fact?.fact_key ===
                  "user_name"
            );

          const shouldAppendNameOnboarding =
            body?.onboarding
              ?.first_user_turn === true &&
            !nameKnownThisTurn &&
            !contactDecision
              .follow_up &&
            !funnelDecision
              .follow_up &&
            searchRouteResponse
              ?.response_type !==
                "tool_request";

          // G27_SINGLE_COMMERCIAL_CTA_V1
          // The Funnel owns the commercial invitation.
          // Local answers provide context, never a second CTA.
          const g27CommercialLocalAnswer =
            typeof localAnswer === "string" &&
            (
              localAnswer.startsWith("Availability at ") ||
              localAnswer.startsWith("Current payment terms for ")
            );

          const g27InlineCTA =
            g27CommercialLocalAnswer &&
            !contactDecision?.answer_override &&
            !funnelDecision?.answer_override &&
            typeof funnelDecision?.follow_up === "string" &&
            funnelDecision.follow_up.trim().length > 0;

          // G29_PERSONALIZED_TWO_PARAGRAPH_CTA_V1
          // Read known identity/contact without repeating questions.
          const g29Facts = [
            ...(Array.isArray(activeMemory) ? activeMemory : []),
            ...(Array.isArray(extractedFacts) ? extractedFacts : [])
          ];

          const g29HasFact = key =>
            g29Facts.some(fact => {
              const value = fact?.fact_value ?? fact?.value;
              return (
                fact?.fact_key === key &&
                typeof value === "string" &&
                value.trim().length > 0
              );
            });

          const g29HasName =
            g29HasFact("user_name");

          const g29HasContact =
            g29HasFact("contact_phone") ||
            g29HasFact("contact_email");

          const g29Availability =
            typeof localAnswer === "string"
              ? localAnswer.match(
                  /^Availability at (.+?) can change as units are reserved or released; a current check is needed\.$/
                )?.[1] || null
              : null;

          const g29Payment =
            typeof localAnswer === "string"
              ? localAnswer.match(
                  /^Current payment terms for (.+?) should be confirmed against the latest project offer\.$/
                )?.[1] || null
              : null;

          const g29FirstParagraph =
            g29Availability
              ? `I can connect you with a Primadom specialist to confirm the latest availability at ${g29Availability} and help you explore suitable options.`
              : g29Payment
                ? `I can connect you with a Primadom specialist to confirm the latest payment terms for ${g29Payment} and discuss suitable options.`
                : null;

          const g29SecondParagraph =
            g29HasContact
              ? g29HasName
                ? "If you'd like me to arrange that, I can use the contact details you've already shared. You can also suggest a convenient time."
                : "If you'd like me to arrange that, may I ask your name? I can use the contact details you've already shared. You can also suggest a convenient time."
              : g29HasName
                ? "If you'd like me to arrange that, what's the best WhatsApp or phone number to reach you? You can also share a convenient time if you have a preference."
                : "If you'd like me to arrange that, may I ask your name and the best WhatsApp or phone number to reach you? You can also share a convenient time if you have a preference.";

          // G43_CONSENT_FIRST_V1
          // Contact questions start after accepted handoff.
          const g29Invitation = null;

          // Never bypass an ignored, declined, or opted-out CTA.
          const g29NonCTAAnswer =
            g29Availability
              ? `For ${g29Availability}, which unit type or bedroom count would you like to focus on?`
              : g29Payment
                ? `I do not have a verified payment plan for ${g29Payment} in the current project data. Upfront payment, installments and handover terms need confirmation against the latest developer offer.`
                : null;

          const answer =
            g29Invitation ||
            (
              g29NonCTAAnswer &&
              !funnelDecision?.follow_up &&
              !contactDecision?.answer_override &&
              !funnelDecision?.answer_override
            )
              ? (
                  g29Invitation ||
                  g29NonCTAAnswer
                )
              : shouldAppendNameOnboarding
                ? `${baseAnswer}\n\nBy the way, I’m Prima, your AI real estate advisor for the UAE. How should I address you?`
                : g27InlineCTA
                  ? `${baseAnswer}\n\n${funnelDecision.follow_up}`
                  : baseAnswer;

        const response = buildResponse({
          conversationId,
          route,
          answer: g43GeneratedOffer || answer
        });

        if (f213Recommendation) {
          response.response_type = "search_results";
          response.meta.recommendation_entity = {
            entity_type:f213Recommendation.entity_type,
            requested_count:f213Recommendation.requested_count,
            result_count:f213Recommendation.results.length
          };
        }

        // F2.4 advisory signal only.
        // Does not trigger questions, actions or writes.
        if (f24RecommendationCriteria) {
          response.meta.recommendation_criteria =
            f24RecommendationCriteria;
        }

        const compareStatus =
          route === "compare"
            ? knowledgePack
                ?.related_knowledge
                ?.comparison
                ?.status ||
              null
            : null;

        const clarificationWasUsed =
          Boolean(
            interpreterClarification &&
            baseAnswer ===
              interpreterClarification
          );

        if (
          clarificationWasUsed ||
          [
            "ambiguous",
            "target_missing",
            "other_not_found",
            "other_page_not_found"
          ].includes(
            compareStatus
          )
        ) {
          response.response_type =
            "clarification";
        }

        response.turn =
          turn;

        if (
          url.hostname === "localhost" ||
          url.hostname === "127.0.0.1"
        ) {
          response.meta.conversation_move =
            conversationMove;
        }

          response.meta.name_onboarding_requested =
            shouldAppendNameOnboarding;

        if (
          searchRouteResponse
            ?.response_type
        ) {
          response.response_type =
            searchRouteResponse
              .response_type;
        }

        response.cards =
          searchRouteResponse
            ?.cards ||
          [];

        response.single_project_ref =
          !searchRouteResponse &&
          entityResolution?.resolved === true &&
          entityResolution?.page?.page_type_id === "project_page" &&
          entityResolution?.page?.language_code === "en" &&
          response.response_type !== "clarification"
            ? {
                entity_type: "project",
                slug: entityResolution.page.primary_entity_slug,
                canonical_url: entityResolution.page.url_path
              }
            : null;

        response.search_pagination =
          searchRouteResponse
            ?.pagination ||
          null;

        if (
          contactDecision
            .response_type ||
          funnelDecision
            .response_type
        ) {
          response.response_type =
            contactDecision
              .response_type ||
            funnelDecision
              .response_type;
        }

        const finalNeedsClarification =
          Boolean(
            (!f213Recommendation && interpreterClarification) ||
            (
              route === "compare" &&
              [
                "ambiguous",
                "target_missing",
                "other_not_found",
                "other_page_not_found"
              ].includes(
                compareStatus
              )
            )
          );

        if (finalNeedsClarification) {
          response.response_type =
            "clarification";
        }

        // G37_PRIMARY_TASK_FIRST_CTA_GUARD_V1
        // A clarification is not a successful commercial task.
        // Explicit contact requests remain permitted.
        const g37UnresolvedPrimaryTask =
          response.response_type === "clarification" &&
          !contactDecision?.captured &&
          funnelDecision?.lead_action?.type !== "request_contact";

        if (g37UnresolvedPrimaryTask) {
          // Do not remember a CTA that was never shown.
          extractedFacts = extractedFacts.filter(
            fact =>
              !(
                fact?.fact_key === "funnel_state" &&
                fact?.fact_value?.status === "cta_offered"
              )
          );

          // G2.9 may have embedded an availability CTA in answer.
          if (g29Invitation) {
            response.answer = baseAnswer;
          }
        }

        response.follow_up =
          contactDecision.follow_up ||
          (
            !g43GeneratedOffer &&
            !g37UnresolvedPrimaryTask && !g27InlineCTA
              ? funnelDecision.follow_up
              : null
          ) ||
          null;

        // G39A_INLINE_COMMERCIAL_CTA_V1
        // Present an approved CTA as part of the assistant's answer.
        const g39OfferText =
          typeof funnelDecision?.follow_up === "string"
            ? funnelDecision.follow_up.trim()
            : "";

        const g39HasOfferState =
          Array.isArray(funnelDecision?.memory_facts) &&
          funnelDecision.memory_facts.some(fact =>
            fact?.fact_key === "funnel_state" &&
            fact?.fact_value?.status === "cta_offered"
          );

        // G25_SINGLE_CANONICAL_CTA_V1
        // A model may end its factual answer with a generic offer such as
        // "Would you like me to connect you with a property specialist?".
        // G39 historically noticed only "Primadom specialist/advisor" and
        // added the approved Funnel CTA a second time. Strip only a terminal
        // contact invitation from the actual model response; keep every
        // factual sentence and let the already authorized Funnel offer be
        // the SINGLE displayed CTA. No new lead consent and no model call.
        const g25CanonicalOfferApproved =
          g39HasOfferState &&
          !g37UnresolvedPrimaryTask &&
          !p0Consent.refusal &&
          p0Consent.prior?.status !== "contact_opted_out" &&
          typeof g39OfferText === "string" &&
          g39OfferText.length > 0;
        let g25StrippedModelInvitation = false;
        // The model can sometimes use the exact approved Funnel wording.
        // Do not additionally present that wording through follow_up.
        if (g25CanonicalOfferApproved &&
            typeof response.answer === "string" &&
            response.answer.includes(g39OfferText)) {
          response.follow_up = null;
        }
        if (
          g25CanonicalOfferApproved &&
          typeof openAIResult?.answer === "string" &&
          typeof response.answer === "string" &&
          !response.answer.includes(g39OfferText) &&
          response.answer.trim() === openAIResult.answer.trim()
        ) {
          // The invitation must be at the very end of the response and
          // explicitly involve contact/speaking/arranging; do not strip a
          // substantive clarification question or a factual statement.
          const g25Question =
            /(?:^|(?<=[.!?])\s+|\s*[-—]\s*)(?:Would|Could|Do)\s+you\s+(?:like|want|prefer)\s+(?:(?:(?:me|us)\s+to\s+|to\s+)?(?:connect|speak|talk|contact|arrange)\b|(?:a|an|the)\s+(?:(?:Primadom|property|real estate)\s+)?(?:specialist|advisor|agent)\b)[^\n?]{0,240}\?\s*$/i
              .exec(response.answer.trim()) ||
            /(?:^|(?<=[.!?])\s+)(?:You\s+(?:can|could|may|might|should)\s+(?:still\s+|also\s+)?(?:ask|contact|consult|reach\s+out\s+to|speak\s+(?:with|to)|talk\s+(?:with|to))\b[^\n.!?]{0,220}\b(?:specialist|advisor|agent|team)\b[^\n.!?]{0,160}|(?:A|The)\s+(?:(?:Primadom|property|real estate)\s+)?(?:specialist|advisor|agent|team)\s+(?:can|could|may|might|would)\s+(?:help\s+(?:you\s+)?(?:to\s+)?)?(?:check|verify|confirm|arrange|review|discuss)\b[^\n.!?]{0,220})[.!?]?\s*$/i
              .exec(response.answer.trim());
          if (g25Question) {
            const g25FactualAnswer = response.answer.trim()
              .slice(0, g25Question.index).trim();
            if (g25FactualAnswer.length > 0) {
              response.answer = g25FactualAnswer;
              g25StrippedModelInvitation = true;
            }
          }
        }

        const g39CanMerge =
          (!g43GeneratedOffer || g25StrippedModelInvitation) &&
          ["answer", "search_results"].includes(response.response_type) &&
          !g37UnresolvedPrimaryTask &&
          !g27InlineCTA &&
          !g29Invitation &&
          !contactDecision?.captured &&
          !contactDecision?.answer_override &&
          !funnelDecision?.answer_override &&
          !funnelDecision?.lead_action &&
          g39HasOfferState &&
          ["page_question", "recommendation", "follow_up", "exact_fact"]
            .includes(route) &&
          g39OfferText.length > 0 &&
          typeof response.answer === "string" &&
          response.answer.trim().length > 0 &&
          !response.answer.includes(g39OfferText) &&
          (!/\bPrimadom (?:specialist|advisor)\b/i.test(response.answer) ||
           g25StrippedModelInvitation);

        if (g39CanMerge) {
          const g39BaseAnswer = response.answer.trim();

          const g39Acknowledgment =
            /^You're referring to (.+?)\.$/u.exec(g39BaseAnswer);

          const g39ReadyToBuy =
            resolvedInterpretation?.commercial_signal?.intent ===
              "purchase_ready";

          if (g39Acknowledgment && g39ReadyToBuy) {
            const g39Project = g39Acknowledgment[1].trim();

            response.answer =
              `Since you're ready to move forward with ${g39Project}, ` +
              "I can connect you with a Primadom specialist to discuss " +
              "the next steps. Would you like me to arrange that?";

          } else if (g39Acknowledgment) {
            response.answer =
              `For ${g39Acknowledgment[1].trim()}, ` +
              g39OfferText[0].toLowerCase() +
              g39OfferText.slice(1);

          } else {
            // G V1.1: presentation belongs to Funnel, not the length of
            // the primary factual answer. Never glue a CTA to a fact.
            response.answer =
              g39BaseAnswer + "\n\n" + g39OfferText;
          }

          response.follow_up = null;
        }

        // G44_GENERATED_COMMERCIAL_CTA_PRESENTATION_V1
        // Final OpenAI may put the specialist question on the same line as
        // a useful advisory answer.  Funnel, not the model, authorizes CTA.
        // Preserve the substantive answer; only isolate an ENDING CTA question
        // if an offer was approved on this turn.  Never request contact here.
        if (
          typeof response.answer === "string" &&
          ["page_question", "recommendation", "follow_up", "exact_fact"]
            .includes(route) &&
          response.response_type === "answer"
        ) {
          const g44TrailingOffer =
            /^(?<main>[\s\S]*[.!?])\s+(?<offer>(?:Would|Could) you like\b[^\n]*\bPrimadom (?:specialist|advisor)\b[^\n]*\?)$/i
              .exec(response.answer.trim());
          if (g44TrailingOffer?.groups) {
            const approved =
              g39HasOfferState &&
              !g37UnresolvedPrimaryTask &&
              !p0Consent.refusal &&
              p0Consent.prior?.status !== "contact_opted_out";
            response.answer = approved
              ? `${g44TrailingOffer.groups.main.trim()}\n\n${g44TrailingOffer.groups.offer.trim()}`
              : g44TrailingOffer.groups.main.trim();
          }
        }

        // F26_RECOMMENDATION_OPTIONAL_FOLLOWUP_V1
        // F suggests a missing criterion.
        // Existing C action gates the optional question.
        // No pending_clarification or separate model call.
        const f26RecommendationQuestions = {
          budget:
            "What budget range should I focus on?",

          property_type:
            "Would you prefer an apartment, townhouse, or villa?",

          goal:
            "Are you buying mainly to live in or as an investment?",

          bedrooms:
            "How many bedrooms would you prefer?",

          district:
            "Do you have a preferred area or neighbourhood?",

          timeline:
            "Are you looking for a ready property or are you open to off-plan?"
        };

        const f26SuggestedCriterion =
          f24RecommendationCriteria
            ?.suggested_clarification
            ?.criterion ||
          null;

        if (
          route === "recommendation" &&
          nextAction?.action === "ADVISORY" &&
          response.response_type === "search_results" &&
          Array.isArray(response.cards) &&
          response.cards.length > 0 &&
          response.search_pagination?.current_offset === 0 &&
          !response.follow_up &&
          !shouldAppendNameOnboarding &&
          f26SuggestedCriterion
        ) {
          response.follow_up =
            f26RecommendationQuestions[
              f26SuggestedCriterion
            ] || null;
        }

        // F213: optional non-blocking advice, controlled by C's ADVISORY action.
        if (f213Recommendation && nextAction?.action === "ADVISORY" &&
            !response.follow_up && f213Recommendation.results.length &&
            !shouldAppendNameOnboarding) {
          const known = recommendationKnownConstraintsV1(contextEnvelope);
          response.follow_up = f213Recommendation.entity_type === "district"
            ? (known.budget
                ? "What matters most to you in an area—schools, lifestyle, or proximity to work?"
                : "What approximate property budget should I consider for these areas?")
            : (known.property_type
                ? "Do you have a preferred community or area?"
                : "Are you mainly interested in apartments, villas, or townhouses?");
        }

        response.lead_action =
          contactDecision
            .lead_action ||
          funnelDecision
            .lead_action ||
          null;

        // Final serialization guard. This is deliberately downstream of every
        // other response modifier and upstream of persistence, so neither a
        // model error nor a future handler may leak an unauthorized lead CTA.
        if (!p0Consent.consent &&
            (response.response_type === "lead_transition" ||
             response.lead_action?.type === "request_contact")) {
          response.response_type = "answer";
          response.lead_action = null;
          response.follow_up = null;
          response.answer = p0Consent.refusal
            ? "Understood. I won't suggest contacting a specialist unless you ask. We can continue here."
            : "I can continue helping you here. What would you like to know?";
        }

        response.meta.used_database =
          Boolean(
            knowledgePack
              .meta
              .used_database ||
            !statelessFastPath
          );

        response.meta.used_openai =
          Boolean(
            personaA1?.used || interpreterResult
              ?.meta
              ?.used_openai ||
            openAIResult?.used
          );

        response.meta.used_interpreter =
          Boolean(
            interpreterResult
              ?.meta
              ?.used_openai
          );

        response.meta.used_final_openai =
          Boolean((personaA1?.decision === "answer" && personaA1?.used) || openAIResult?.used);
        response.meta.used_semantic_gateway = Boolean(personaA1?.used);
        response.meta.persona_a1_decision = personaA1?.decision || null;
        response.meta.persona_a1_usage_unknown = Boolean(personaA1?.usage_unknown);
        response.meta.persona_a1_latency_ms = personaA1?.latency_ms || 0;
        response.meta.persona_a1_input_tokens = personaA1?.usage?.input_tokens ?? null;
        response.meta.persona_a1_output_tokens = personaA1?.usage?.output_tokens ?? null;
        response.meta.persona_a1_total_tokens = personaA1?.usage?.total_tokens ?? null;

        response.meta.interpreter_latency_ms =
          interpreterResult
            ?.meta
            ?.latency_ms ||
          0;

        response.meta.final_openai_latency_ms =
          openAIResult
            ?.latency_ms ||
          0;

                response.meta.final_openai_timed_out =
          Boolean(
            openAIResult
              ?.timed_out
          );

response.meta.interpreter_input_tokens =
          interpreterResult
            ?.meta
            ?.input_tokens ||
          0;

        response.meta.interpreter_output_tokens =
          interpreterResult
            ?.meta
            ?.output_tokens ||
          0;

        response.meta.final_input_tokens =
          openAIResult
            ?.usage
            ?.input_tokens ||
          0;

        response.meta.final_output_tokens =
          openAIResult
            ?.usage
            ?.output_tokens ||
          0;

        response.meta.total_openai_tokens =
          (personaA1?.usage?.total_tokens || 0) +
          (
            interpreterResult
              ?.meta
              ?.total_tokens ||
            0
          ) +
          (
            openAIResult
              ?.usage
              ?.total_tokens ||
            0
          );

        // Accounting: cached/reasoning are subdivisions, not extra tokens.
        response.meta.openai_calls_attempted =
           Number(Boolean(personaA1?.used)) +
           Number(interpreterCallAttempted) +
           Number(Boolean(useOpenAI));
        response.meta.openai_cached_tokens =
           (personaA1?.usage?.input_tokens_details?.cached_tokens || 0) +
           (interpreterResult?.meta?.cached_tokens || 0) +
           (openAIResult?.usage?.cached_tokens || 0);
        response.meta.openai_reasoning_tokens =
           (personaA1?.usage?.output_tokens_details?.reasoning_tokens || 0) +
           (interpreterResult?.meta?.reasoning_tokens || 0) +
           (openAIResult?.usage?.reasoning_tokens || 0);
        // Unknown usage must not be reported as a confirmed zero-cost turn.
        response.meta.openai_usage_unknown = Boolean(
           Boolean(personaA1?.used && personaA1?.usage_unknown) ||
           (interpreterCallAttempted && !interpreterResult?.meta?.used_openai) ||
           (useOpenAI && !openAIResult?.usage?.total_tokens)
         );

                if (debugEnabled) {
          response.meta.debug = {
            entity_resolution_status:
              entityResolution
                ?.status ||
              null,

            entity_resolution_type:
              entityResolution
                ?.page
                ?.primary_entity_type ||
              null,

            entity_resolution_slug:
              entityResolution
                ?.page
                ?.primary_entity_slug ||
              null,

            knowledge_page_id:
              knowledgePack
                ?.page
                ?.page_id ||
              null,

            knowledge_entity_type:
              knowledgePack
                ?.page
                ?.primary_entity_type ||
              null,

            knowledge_entity_slug:
              knowledgePack
                ?.page
                ?.primary_entity_slug ||
              null,

            knowledge_retrieval_mode:
              knowledgePack
                ?.meta
                ?.retrieval_mode ||
              null,

            knowledge_blocks_loaded:
              knowledgePack
                ?.meta
                ?.blocks_loaded ??
              (
                Array.isArray(
                  knowledgePack?.blocks
                )
                  ? knowledgePack
                      .blocks
                      .length
                  : 0
              ),

            knowledge_relations_loaded:
              knowledgePack
                ?.meta
                ?.relations_loaded ??
              (
                Array.isArray(
                  knowledgePack
                    ?.relations
                )
                  ? knowledgePack
                      .relations
                      .length
                  : 0
              ),

            requested_facts:
              requestedFacts
          };
        }

response.meta.used_search =
          Boolean(
            searchRouteResponse
              ?.used_search
          );

        response.meta.next_action =
          nextAction?.action ||
          null;

        response.meta.next_action_reason =
          nextAction?.reason ||
          null;

        if (
          nextAction?.action ===
            "PROFILE_UPDATE"
        ) {
          response.response_type =
            "answer";

          interpreterClarification =
            null;
        }

        const dialogueStateForPersistence =
          applyConversationMoveToStateV1(
            contextEnvelope,
            {
              route,
              move:
                conversationMove,
              response_type:
                response.response_type,
              consume_pending_clarification:
                (
                  conversationMove?.reason ===
                    "pending_clarification_answer" &&
                  Boolean(entityResolution?.resolved)
                ) ||
                (
                  conversationMove?.reason === "active_compare_decision" &&
                  response.response_type !== "clarification"
                ) ||
                (
                  conversationMove?.move_type === "resume" &&
                  conversationMove?.reason ===
                    "explicit_resume_to_suspended_thread"
                )
            }
          );

        // E21: attach only Registry-confirmed identities after C's reducer.
        // This preserves all C fields and never stores Knowledge/page JSON.
        const e21Confirmed = entityResolution?.resolved === true &&
          ["project", "developer", "district"].includes(
            entityResolution?.page?.primary_entity_type) &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(
            entityResolution?.page?.primary_entity_slug || "")) &&
          response.response_type !== "clarification";
        const e21Next = [...e21History];
        if (e21Confirmed) {
          const item = {type: entityResolution.page.primary_entity_type,
            slug: entityResolution.page.primary_entity_slug};
          const last = e21Next[e21Next.length - 1];
          if (last?.type !== item.type || last?.slug !== item.slug) e21Next.push(item);
        }
        if (e21Next.length) {
          dialogueStateForPersistence.e21_verified_entities = e21Next.slice(-5);
        }

        // Block C: reuse the exact state selected for durable persistence.
        // Local diagnostics must match the state submitted for persistence.
        if (
          url.hostname === "localhost" ||
          url.hostname === "127.0.0.1"
        ) {
          response.meta.conversation_state =
            dialogueStateForPersistence;
        }

        const conversationOrdering =
          buildConversationOrderingV1({
            conversationId,
            turn
          });

        const conversationPatch = {
          ...buildConversationPatch(
            body,
            route,
            dialogueStateForPersistence
          ),

          ...conversationOrdering.patch
        };

        i33Mark("state_write_start");
        if (conversationOrdering.guarded) {
          const conversationStateRows =
            await supabaseUpdateReturning(
              env,
              "conversations",
              conversationOrdering.query,
              conversationPatch
            );

          if (
            conversationStateRows.length === 0
          ) {
            console.log(
              "prima_conversation_state_write_skipped",
              JSON.stringify({
                conversation_id:
                  conversationId,

                turn_id:
                  conversationOrdering
                    .turn_id,

                turn_seq:
                  conversationOrdering
                    .turn_seq,

                reason:
                  "stale_or_duplicate_turn"
              })
            );
          }
        } else {
          await supabaseUpdate(
            env,
            "conversations",
            `conversation_id=eq.${conversationId}`,
            conversationPatch
          );
        }


        i33Mark("state_write_end");

        // H2_VERIFIED_CONTACT_PERSISTENCE_V1
        // Only contact turns wait for durable contact + lead writes.
        let hContactSaveConfirmed = false;

        const persistenceTask =
          (async () => {
            try {
              i33Mark("user_message_write_start");
              const userRows =
                await supabaseInsertIdempotentMessage(
                  env,
                  "messages",
                  {
                    conversation_id:
                      conversationId,

                    turn_id:
                      body?.turn?.turn_id || null,

                    turn_seq:
                      body?.turn?.turn_seq ?? null,

                    turn_phase:
                      body?.turn?.phase || null,

                    role: "user",
                    content: message,
                    route,

                    page_id:
                      body?.page?.page_id ||
                      null,

                    page_type:
                      body?.page?.page_type ||
                      null,

                    primary_entity_type:
                      body?.entity
                        ?.primary_type ||
                      null,

                    primary_entity_slug:
                      body?.entity
                        ?.primary_slug ||
                      null,

                    secondary_entity_type:
                      body?.entity
                        ?.secondary_type ||
                      null,

                    secondary_entity_slug:
                      body?.entity
                        ?.secondary_slug ||
                      null,

                    metadata: {
                      contract:
                        "ContextEnvelopeV1"
                    }
                  },
                  "message_id,created_at"
                );

              i33Mark("user_message_write_end");
              const userMessageId =
                userRows?.[0]
                  ?.message_id ||
                null;

              // H2: Critical contact writes complete before acknowledgement.
              if (contactDecision.captured) {
                const hContactFacts =
                  contactDecision.memory_facts || [];

                const hHasContact =
                  hContactFacts.some(fact =>
                    ["contact_phone", "contact_email"]
                      .includes(fact?.fact_key)
                  );

                if (!hHasContact) {
                  throw new Error("h_contact_fact_missing");
                }

                i33Mark("contact_memory_write_start");
                const hSavedFacts =
                  await persistMemoryFacts(
                    env,
                    {
                      conversationId,
                      visitorId: body?.visitor_id || null,
                      sourceMessageId: userMessageId,
                      facts: hContactFacts
                    }
                  );

                if (
                  !Array.isArray(hSavedFacts) ||
                  hSavedFacts.length !== hContactFacts.length
                ) {
                  throw new Error("h_contact_memory_unconfirmed");
                }

                i33Mark("contact_memory_write_end");
                i33Mark("lead_integration_start");
                const hLeadResult =
                  await persistPrimaLeadV1({
                    env,
                    conversationId,
                    body,
                    route,
                    context: contextEnvelope,
                    activeMemory,
                    currentFacts: extractedFacts,
                    contactDecision
                  });

                if (
                  !hLeadResult ||
                  hLeadResult?.ok === false ||
                  hLeadResult?.success === false ||
                  (Array.isArray(hLeadResult) && hLeadResult.length === 0)
                ) {
                  throw new Error("h_contact_lead_unconfirmed");
                }

                i33Mark("lead_integration_end");
                hContactSaveConfirmed = true;
              }

              i33Mark("ancillary_write_start");
              await Promise.all([
                contactDecision.captured
                  ? supabaseInsertIdempotentEvent(
                      env,
                      "conversation_events",
                      {
                        conversation_id:
                          conversationId,

                        message_id:
                          userMessageId,

                        event_name:
                          "lead_contact_captured",

                        event_data:
                          contactDecision
                            .event_data
                      },
                      "event_id"
                    )
                  : Promise.resolve(
                      null
                    ),

                // Lead already saved for contact turns above.
                Promise.resolve(null),

                persistMemoryFacts(
                  env,
                  {
                    conversationId,

                    visitorId:
                      body?.visitor_id ||
                      null,

                    sourceMessageId:
                      userMessageId,

                    facts:
                      contactDecision.captured
                        ? extractedFacts.filter(fact =>
                            !contactDecision.memory_facts.some(
                              savedFact =>
                                savedFact?.fact_key === fact?.fact_key
                            )
                          )
                        : extractedFacts
                  }
                ),

                supabaseInsertIdempotentMessage(
                  env,
                  "messages",
                  {
                    conversation_id:
                      conversationId,

                    turn_id:
                      body?.turn?.turn_id || null,

                    turn_seq:
                      body?.turn?.turn_seq ?? null,

                    turn_phase:
                      body?.turn?.phase || null,

                    role:
                      "assistant",

                    content:
                      response.answer,

                    route,

                    response_type:
                      response.response_type,

                    page_id:
                      body?.page?.page_id ||
                      null,

                    page_type:
                      body?.page?.page_type ||
                      null,

                    primary_entity_type:
                      body?.entity
                        ?.primary_type ||
                      null,

                    primary_entity_slug:
                      body?.entity
                        ?.primary_slug ||
                      null,

                    secondary_entity_type:
                      body?.entity
                        ?.secondary_type ||
                      null,

                    secondary_entity_slug:
                      body?.entity
                        ?.secondary_slug ||
                      null,

                    used_openai:
                      Boolean(personaA1?.used || interpreterCallAttempted || openAIResult?.used),

                    used_database:
                      knowledgePack
                        .meta
                        .used_database,

                    used_search:
                      false,

                    metadata: {
                      contract:
                        "ResponseContractV1",
                      // One canonical compact card snapshot in the message row.
                      // Excludes memory, contact PII and full answer payload.
                      restore_project_cards_v2:
                        primaRestoreProjectCardsV2(response.cards)
                    }
                  },
                  "message_id,created_at"
                ),

                supabaseInsertIdempotentEvent(
                  env,
                  "conversation_events",
                  {
                    conversation_id:
                      conversationId,

                    message_id:
                      userMessageId,

                    event_name:
                      "message_routed",

                    event_data: {
                      route,

                      allowed_tools:
                        allowedTools,

                      language:
                        body?.page
                          ?.language_code ||
                        "en"
                    }
                  },
                  "event_id"
                ),

                Promise.resolve(null)
              ]);
              i33Mark("ancillary_write_end");
            } catch (error) {
              console.error(
                "prima_background_persistence_failed",
                error
              );

              if (
                contactDecision.captured &&
                !hContactSaveConfirmed
              ) {
                throw error;
              }
            }
          })();

        if (contactDecision.captured) {
          try {
            await persistenceTask;
            i33Mark("contact_persistence_end");
          } catch (error) {
            return json({
              ...response,
              response_type: "answer",
              answer:
                "I’m sorry — I couldn’t complete your contact request just now. Please try again in a moment. We can continue exploring your options here.",
              follow_up: null,
              lead_action: null,
              cards: [],
              single_project_ref: null
            });
          }
        } else if (ctx?.waitUntil) {
          ctx.waitUntil(
            persistenceTask
          );
        } else {
          void persistenceTask;
        }

        const responsePayload = {
          ...response
        };

        if (debugEnabled) {
          responsePayload.debug = {
            persistence_mode:
              "state_sync_background_rest",

            persistence_queued:
              true,

            allowed_tools:
              allowedTools,

            current_turn_memory_facts:
              extractedFacts.length,

            // Never serialize active Memory, user messages or knowledge/evidence
            // in diagnostics: they may contain contact PII and private context.
            active_memory_fact_count:
              Array.isArray(activeMemory) ? activeMemory.length : 0,

            openai:
              openAIResult
                ? {
                    model:
                      openAIResult.model,

                    reasoning_effort:
                      openAIResult.reasoning_effort,

                    latency_ms:
                      openAIResult.latency_ms,

                    response_id:
                      openAIResult.response_id,

                    usage:
                      openAIResult.usage
                  }
                : null
          };
        }

        responsePayload.meta.worker_total_ms = Date.now() - workerTurnStartedAt;
        // I33: local-only console measurement. Strictly no PII, request text,
        // contact data, conversation IDs or object names in this record.
        if (contactDecision.captured && i33Perf) {
          const i33Duration = (start, end) =>
            Number.isFinite(i33Perf[start]) && Number.isFinite(i33Perf[end])
              ? Math.max(0, i33Perf[end] - i33Perf[start]) : null;
          console.info("PRIMA_I33_CONTACT_PERF", JSON.stringify({
            version: "I33_DIAGNOSTICS_ONLY",
            total_worker_ms: responsePayload.meta.worker_total_ms,
            context_load_ms: i33Duration("context_load_start", "context_load_end"),
            routing_after_context_ms: i33Duration("context_load_end", "state_write_start"),
            conversation_state_write_ms: i33Duration("state_write_start", "state_write_end"),
            user_message_write_ms: i33Duration("user_message_write_start", "user_message_write_end"),
            contact_memory_write_ms: i33Duration("contact_memory_write_start", "contact_memory_write_end"),
            lead_enrichment_and_rpc_ms: i33Duration("lead_integration_start", "lead_integration_end"),
            ancillary_writes_ms: i33Duration("ancillary_write_start", "ancillary_write_end"),
            total_contact_persistence_ms: i33Duration("state_write_end", "contact_persistence_end"),
            openai_calls_attempted: responsePayload?.meta?.openai_calls_attempted ?? null
          }));
        }
        responsePayload.meta.persona_a1_before_model_ms = a1StartedAt === null
          ? null : a1StartedAt - workerTurnStartedAt;
        responsePayload.meta.persona_a1_after_model_ms = a1FinishedAt === null
          ? null : Date.now() - a1FinishedAt;
        return json(responsePayload);
      } catch (error) {
        console.error(error);

        return json(
          {
            ok: false,
            error: "message_processing_failed",
            ...(debugEnabled
              ? {
                  detail:
                    error?.message ||
                    String(error)
                }
              : {})
          },
          500
        );
      }
    }

    return json(
      {
        ok: false,
        error: "not_found"
      },
      404
    );
  }
};
