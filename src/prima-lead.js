import {
  supabasePublicRpc
} from "./supabase.js";
import { loadActiveMemory } from "./memory-store.js";
import { normalizePreferredLocationTextV1 } from "./preferred-location-v1.js";
import { prepareLeadHandoffContextI31 } from "./prima-lead-handoff-i31.js";


const REQUIREMENT_KEYS =
  Object.freeze([
    "buyer_goal",
    "budget_min_aed",
    "budget_max_aed",
    "bedrooms",
    "property_type",
    "preferred_location_text",
    "purchase_timeline_text",
    "timeline",
    "investment_priority",
    "financing",
    "lifestyle_preferences"
  ]);


function factMap(
  activeMemory = [],
  currentFacts = []
) {
  const map =
    new Map();

  for (const fact of [
    ...(activeMemory || []),
    ...(currentFacts || [])
  ]) {
    if (!fact?.fact_key) {
      continue;
    }

    map.set(
      fact.fact_key,
      fact.fact_value
    );
  }

  return map;
}


function text(
  value,
  limit = 500
) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const cleaned =
    String(value)
      .trim()
      .slice(0, limit);

  return cleaned || null;
}


function uuid(
  value
) {
  const candidate =
    text(value, 80);

  if (
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(candidate)
  ) {
    return null;
  }

  return candidate;
}


function requirementValue(
  value
) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 10)
      .filter(
        item =>
          typeof item === "string" ||
          typeof item === "number"
      );
  }

  return null;
}


function buildRequirements(
  facts
) {
  const requirements = {};

  for (
    const key of
    REQUIREMENT_KEYS
  ) {
    // MEM20B: lead output must use the same safe, canonical location
    // normalization as Search/Recommendations. Never copy mixed
    // location+budget text into the CRM handoff.
    const value =
      key === "preferred_location_text"
        ? normalizePreferredLocationTextV1(
            facts.get(key)
          )
        : requirementValue(
            facts.get(key)
          );

    if (
      value !== null &&
      typeof value !==
        "undefined"
    ) {
      requirements[key] =
        value;
    }
  }

  return requirements;
}


function buildProjectDecisions(
  facts
) {
  const decisions = [];

  for (
    const [key, value] of
    facts.entries()
  ) {
    if (
      !String(key)
        .startsWith(
          "project_decision:"
        ) ||
      !value ||
      typeof value !== "object"
    ) {
      continue;
    }

    const slug =
      text(
        value.entity_slug,
        200
      );

    const status =
      text(
        value.status,
        50
      );

    if (!slug || !status) {
      continue;
    }

    // Decision reason is a client preference, never a verified project fact.
    // Avoid duplicating contact PII in analytics.leads.interest_context.
    const reason = text(value.reason, 500);
    const safeReason = reason
      ? reason
          .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
          .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone redacted]")
      : null;

    decisions.push({
      entity_type:
        "project",

      entity_slug:
        slug,

      status,
      ...(safeReason && status === "rejected"
        ? { reason: safeReason }
        : {})
    });

    if (
      decisions.length >= 10
    ) {
      break;
    }
  }

  return decisions;
}


function buildSearchProjects(
  context
) {
  const results =
    context
      ?.search
      ?.results;

  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .slice(0, 3)
    .map(
      item =>
        text(
          item?.slug,
          200
        )
    )
    .filter(Boolean);
}


function buildFunnelContext(
  facts
) {
  const state =
    facts.get(
      "funnel_state"
    );

  if (
    !state ||
    typeof state !== "object"
  ) {
    return null;
  }

  return {
    status:
      text(
        state.status,
        80
      ),

    cta_type:
      text(
        state.cta_type,
        100
      ),

    progress_score:
      Number.isFinite(
        Number(
          state.progress_score
        )
      )
        ? Number(
            state.progress_score
          )
        : null,

    contact_channel:
      text(
        state.contact_channel,
        50
      )
  };
}


function buildRequestSummary(
  requirements,
  projectDecisions
) {
  const parts = [];

  if (requirements.buyer_goal) {
    parts.push(
      `Goal: ${requirements.buyer_goal}`
    );
  }

  if (
    requirements.budget_min_aed ||
    requirements.budget_max_aed
  ) {
    const min =
      requirements
        .budget_min_aed ||
      "any";

    const max =
      requirements
        .budget_max_aed ||
      "any";

    parts.push(
      `Budget: AED ${min}–${max}`
    );
  }

  if (requirements.bedrooms) {
    parts.push(
      `Bedrooms: ${requirements.bedrooms}`
    );
  }

  if (requirements.property_type) {
    parts.push(
      `Property type: ${requirements.property_type}`
    );
  }

  if (
    requirements
      .preferred_location_text
  ) {
    parts.push(
      `Location: ${requirements.preferred_location_text}`
    );
  }

  if (
    projectDecisions.length
  ) {
    parts.push(
      "Projects: " +
      projectDecisions
        .map(
          item =>
            `${item.entity_slug} (${item.status})`
        )
        .join(", ")
    );
  }

  return parts.length
    ? parts.join("; ").slice(
        0,
        5000
      )
    : null;
}


export function buildPrimaLeadRpcPayload({
  conversationId,
  body = {},
  route = null,
  context = null,
  activeMemory = [],
  currentFacts = [],
  contactDecision = null,
  handoffContext = null
} = {}) {
  const facts =
    factMap(
      activeMemory,
      currentFacts
    );

  const name =
    text(
      facts.get(
        "user_name"
      ),
      500
    );

  const phone =
    text(
      facts.get(
        "contact_phone"
      ),
      200
    );

  const email =
    text(
      facts.get(
        "contact_email"
      ),
      500
    );

  if (
    !phone &&
    !email
  ) {
    return null;
  }

  const requirements =
    buildRequirements(
      facts
    );

  const projectDecisions =
    buildProjectDecisions(
      facts
    );

  const searchProjects =
    buildSearchProjects(
      context
    );

  const funnel =
    buildFunnelContext(
      facts
    );

  // I-BOUNDARY-V1: preserve a direct client's reason for contacting us,
  // without copying the raw user message (which may contain phone/email).
  const userRequest = String(body?.user?.message || "");
  const requestedService = /\b(?:viewing|view|visit|tour|show\s*unit)\b/i.test(userRequest)
    ? "viewing"
    : /\b(?:availability|available|unit\s+stock)\b/i.test(userRequest)
      ? "availability_check"
      : /\b(?:payment\s+plan|purchase\s+terms)\b/i.test(userRequest)
        ? "purchase_terms"
        : /\b(?:investment|invest|returns?|roi)\b/i.test(userRequest)
          ? "investment_consultation"
          : "general_contact";
  const verifiedEntity = context?.conversation?.dialogue_state
    ?.continuity_references?.current_entity;
  const verifiedEntityList = context?.conversation?.dialogue_state
    ?.e21_verified_entities || [];
  const trustedResolvedEntity =
    verifiedEntity?.type === "project" &&
    typeof verifiedEntity.slug === "string" &&
    verifiedEntityList.some(e => e?.type === "project" && e?.slug === verifiedEntity.slug)
      ? verifiedEntity : null;

  const preferredChannel =
    text(
      facts.get(
        "preferred_contact_channel"
      ),
      100
    ) ||
    text(
      contactDecision
        ?.lead_action
        ?.contact_channel,
      100
    ) ||
    (
      phone
        ? "phone"
        : "email"
    );

  const interestContext = {
    version:
      "PrimaLeadContextV1",

    origin:
      "prima_dialog",

    conversation_id:
      text(
        conversationId,
        100
      ),

    route:
      text(
        route,
        100
      ),

    requirements,

    project_decisions:
      projectDecisions,

    search_projects:
      searchProjects,

    funnel,
    requested_service: handoffContext?.requested_service || requestedService,
    contact_origin: text(contactDecision?.event_data?.source, 40),
    // Explicit service request is NOT blanket marketing consent.
    ...(handoffContext?.contact_request_evidence
      ? {contact_request_evidence: handoffContext.contact_request_evidence} : {}),
    ...(handoffContext?.verified_subject
      ? {requested_subject: handoffContext.verified_subject} : {})
  };

  const inputMethod =
    [
      "text",
      "voice",
      "mixed",
      "unknown"
    ].includes(
      body?.user
        ?.input_method
    )
      ? body.user.input_method
      : "text";

  return {
    p_visitor_id:
      uuid(
        body?.visitor_id
      ),

    p_session_id:
      uuid(
        body?.session_id
      ),

    p_pageview_id:
      uuid(
        body?.pageview_id
      ),

    p_page_id:
      text(
        body?.page
          ?.page_id,
        500
      ),

    p_source_id:
      null,

    p_language_code:
      "en",

    p_country_code:
      null,

    p_page_type:
      text(
        body?.page
          ?.page_type,
        100
      ),

    p_url_path:
      text(
        body?.page
          ?.url_path,
        2000
      ),

    p_canonical_url_path:
      text(
        body?.page
          ?.canonical_url_path,
        2000
      ),

    p_conversion_type:
      "prima_dialog",

    p_request_type:
      "prima_handoff",

    p_cta_type:
      text(
        funnel?.cta_type,
        200
      ) ||
      "prima_contact",

    p_primary_entity_type:
      text(
        body?.entity
          ?.primary_type || trustedResolvedEntity?.type || handoffContext?.verified_subject?.entity_type,
        200
      ),

    p_primary_entity_id:
      text(
        body?.entity
          ?.primary_id,
        500
      ),

    p_primary_entity_slug:
      text(
        body?.entity
          ?.primary_slug || trustedResolvedEntity?.slug || handoffContext?.verified_subject?.entity_slug,
        1000
      ),

    p_interest_context:
      interestContext,

    p_name:
      name,

    p_phone:
      phone,

    p_email:
      email,

    p_request_text:
      buildRequestSummary(
        requirements,
        projectDecisions
      ) || `Client requested ${(handoffContext?.requested_service || requestedService).replace(/_/g, " ")}` ,

    p_request_input_method:
      inputMethod,

    p_preferred_contact_channel:
      preferredChannel,

    p_consent_given:
      null,

    p_consent_text_version:
      null,

    p_consent_at:
      null,

    p_idempotency_key:
      `prima:${conversationId}`
  };
}


export async function persistPrimaLeadV1({
  env,
  ...input
} = {}) {
  // I31 reads only this already-authorized conversation on a captured contact turn.
  // No additional Lead RPC, no modification to C/G/Search/Persona.
  const handoffContext = input?.contactDecision?.captured
    ? await prepareLeadHandoffContextI31({
        env,
        conversationId: input.conversationId,
        currentMessage: input?.body?.user?.message,
        context: input.context
      })
    : null;

  // Contact fast-path can have only current-turn memory. Read canonical
  // active facts after contact facts were durably persisted in index.js.
  // Do not create a partially-enriched lead if this scoped read fails.
  // Incoming currentFacts still override the persisted snapshot for this turn.
  const canonicalMemory = input?.contactDecision?.captured
    ? await loadActiveMemory(env, input.conversationId)
    : [];

  const payload =
    buildPrimaLeadRpcPayload({
      ...input,
      activeMemory: [
        ...(Array.isArray(input.activeMemory) ? input.activeMemory : []),
        ...canonicalMemory
      ],
      handoffContext
    });

  if (!payload) {
    return null;
  }

  try {
    return await supabasePublicRpc(
      env,
      "create_lead_v1",
      payload
    );
  } catch (error) {
    const message =
      String(
        error?.message ||
        error ||
        ""
      );

    const isIdempotencyRace =
      message.includes("23505") &&
      message.includes(
        "leads_idempotency_key_key"
      );

    if (!isIdempotencyRace) {
      throw error;
    }

    console.log(
      "prima_lead_idempotency_race_retry",
      JSON.stringify({
        conversation_id:
          input?.conversationId ||
          null,

        idempotency_key:
          payload
            ?.p_idempotency_key ||
          null
      })
    );

    /*
      The unique index remains the DB authority.

      A concurrent INSERT loser receives 23505 only
      after the winning transaction has resolved.
      Re-running the same idempotent RPC once now lets
      create_lead_v1 return its normal existing-lead /
      duplicate result instead of surfacing an error.
    */
    return supabasePublicRpc(
      env,
      "create_lead_v1",
      payload
    );
  }
}
