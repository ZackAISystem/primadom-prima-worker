import { isGenericScopeEntityV1 } from "./generic-scope-v1.js";
import { supabaseSelect } from "./supabase.js";


const PAGE_TYPE_BY_ENTITY =
  Object.freeze({
    project:
      "project_page",

    developer:
      "developer_page",

    district:
      "district_page",

    buyer_scenario:
      "buyer_scenario_page",

    budget:
      "budget_page",

    property_type:
      "property_type_page",

    origin:
      "origin_buyer_page"
  });


const RESOLVABLE_ROUTES =
  new Set([
    "exact_fact",
    "page_question",
    "market_question",
    "recommendation",
    "follow_up",
    "compare"
  ]);


function normalizeSlug(
  value = ""
) {
  return String(value || "")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function primaryEntity(
  interpretation = null
) {
  const entities =
    Array.isArray(
      interpretation?.entities
    )
      ? interpretation.entities
          .filter(
            item =>
              PAGE_TYPE_BY_ENTITY[
                item?.type
              ] &&
              (
                item?.slug ||
                item?.name
              )
          )
      : [];

  if (entities.length === 0) {
    return null;
  }

  const primary =
    entities.filter(
      item =>
        item?.role === "primary"
    );

  if (primary.length === 1) {
    return primary[0];
  }

  if (entities.length === 1) {
    return entities[0];
  }

  /*
    Multi-entity requests belong to Compare/Search.
    Never guess one entity here.
  */
  return null;
}


function fields() {
  return [
    "page_id",
    "page_type_id",
    "language_code",
    "url_path",
    "canonical_url_path",
    "primary_entity_type",
    "primary_entity_slug"
  ].join(",");
}


async function lookupExact(
  env,
  {
    entityType,
    pageType,
    language,
    slug
  }
) {
  return supabaseSelect(
    env,
    "knowledge_registry_v1",
    [
      `select=${fields()}`,
      `page_type_id=eq.${encodeURIComponent(pageType)}`,
      `language_code=eq.${encodeURIComponent(language)}`,
      `primary_entity_type=eq.${encodeURIComponent(entityType)}`,
      `primary_entity_slug=eq.${encodeURIComponent(slug)}`,
      "limit=3"
    ].join("&")
  );
}


async function lookupPrefix(
  env,
  {
    entityType,
    pageType,
    language,
    slug
  }
) {
  return supabaseSelect(
    env,
    "knowledge_registry_v1",
    [
      `select=${fields()}`,
      `page_type_id=eq.${encodeURIComponent(pageType)}`,
      `language_code=eq.${encodeURIComponent(language)}`,
      `primary_entity_type=eq.${encodeURIComponent(entityType)}`,
      `primary_entity_slug=ilike.${encodeURIComponent(slug + "*")}`,
      "order=primary_entity_slug.asc",
      "limit=6"
    ].join("&")
  );
}


// R2.2: A category concept is not a failed named-entity lookup.
// Preserve all named project/developer/district lookups and all requests
// for explicit structured facts. This helper only controls clarification.
// FIX02: Only an unresolved NAMED target can interrupt a knowledge or
// comparison answer. Broader geographic context and buyer-purpose concepts
// are optional evidence, not the object of Registry identity verification.
// This gate never creates a fact, resolves an alias, or authorizes Search.
export function requiresNamedEntityClarificationV1({
  action = null, interpretation = null, resolution = null, message = ""
} = {}) {
  if (!resolution || !["not_found", "ambiguous"].includes(resolution.status))
    return false;
  if (!["KNOWLEDGE_QA", "COMPARE", "ADVISORY"].includes(action))
    return true;
  const entities = Array.isArray(interpretation?.entities)
    ? interpretation.entities.filter(entity => entity && (entity.name || entity.slug)) : [];
  const facts = Array.isArray(interpretation?.tasks)
    ? interpretation.tasks.flatMap(task => Array.isArray(task?.requested_facts) ? task.requested_facts : []) : [];
  // ENTITY_QA_FIX01: target-aware clarification. Generic buyer/process questions
  // and budget updates are not requests to identify a unique Registry page.
  // No facts are inferred here and no Search or contact action is authorized.
  const eq1Text = String(message || "").trim();
  const eq1NamedTypes = entities.length > 0 && entities.some(e =>
    ["project", "developer"].includes(e.type));
  const eq1ExplicitVerification =
    /\b(?:exact|verified|official|current|live|latest|availability|handover date|registration number|certificate number|unit number|unit\s+\d+|specific price|price of|title deed for)\b/i.test(eq1Text);
  // PT-03: a district/buyer category can be CONTEXT rather than the identity
  // being verified. The user can ask for a general comparison, checks or
  // verification methodology without proving a Registry ID for JVC/JLT.
  // Never release a named project/developer or a specific current fact.
  const eq1ProceduralInquiry = /\b(?:what|which|how|should|could|would)\b[\s\S]{0,160}\b(?:documents?|authorities|verify|verification|evidence|due diligence|assumptions?|risks?|checklist|comparison|compare|change)\b/i.test(eq1Text);
  const eq1GenericDistrictScope = entities.length === 1 &&
    entities[0]?.type === "district" && !eq1NamedTypes &&
    !/\b(?:specific|named)\s+(?:project|building|property|unit)|\b(?:unit number|registration number|certificate number|title deed for|price of|availability of|handover date of)\b/i.test(eq1Text);
  const eq1SpecificFactQuestion = /\b(?:current|live|latest|availability|handover date|registration number|certificate number|unit number|unit\s+\d+|specific price|price of|title deed for|service charges? (?:of|for|in|at)|what (?:is|are) (?:the )?(?:service charges?|price|fees?))\b/i.test(eq1Text);
  const eq1NeedsActualVerifiedFact = eq1SpecificFactQuestion ||
    (eq1ExplicitVerification && !eq1ProceduralInquiry);
  if (eq1GenericDistrictScope &&
      ["COMPARE", "KNOWLEDGE_QA", "ADVISORY"].includes(action) &&
      !eq1NeedsActualVerifiedFact &&
      !interpretation?.tasks?.some(task => task?.needs_clarification === true)) {
    return false;
  }
  // Protect exact unit/project claims even when a model omitted requested_facts.
  if (eq1ExplicitVerification && !eq1ProceduralInquiry) return true;
  const eq1ConceptualQuestion =
    /\b(?:buy(?:ing)?\s+(?:versus|vs\.?|or|compared with)\s+rent(?:ing)?|rent(?:ing)?\s+(?:versus|vs\.?|or)\s+buy(?:ing)?)\b/i.test(eq1Text) ||
    /\b(?:service charges?\s+(?:in general|generally)|what (?:about|are) service charges?|how (?:do|are) service charges?)\b/i.test(eq1Text) ||
    /\b(?:what documents|which documents|what authorities|which authorities|how (?:can|would|do) (?:i|we) verify|what should (?:i|we) check|due diligence|risks? of buying|what risks?)\b/i.test(eq1Text) ||
    /\b(?:change|raise|lower|update|adjust|set|make)\s+(?:only\s+)?(?:my|the|our)?\s*(?:budget|ceiling|limit)\b/i.test(eq1Text);
  const eq1BudgetContext = entities.length > 0 && entities.every(e =>
    e.type === "budget") && /\b(?:budget|ceiling|limit|aed|million)\b/i.test(eq1Text);
  const eq1ConceptualContext = entities.length > 0 && entities.every(e =>
    ["district", "budget", "buyer_scenario", "origin", "property_type"].includes(e.type));
  if (!eq1NamedTypes && facts.length === 0 &&
      !interpretation?.tasks?.some(t => t?.needs_clarification === true) &&
      ((eq1ConceptualContext && eq1ConceptualQuestion) || eq1BudgetContext)) {
    return false;
  }

  // FIX39-05: An unresolved contextual district or buyer category must not
  // veto a general advisory/knowledge answer. Named projects/developers and
  // exact verified claims retain the Registry and evidence requirements.
  // This is answer-ownership only: it neither verifies the entity nor
  // authorizes Search, Contact or a specific factual assertion.
  const contextualEntity = entities.length === 1 ? entities[0] : null;
  const verificationRequested = facts.some(fact => {
    const value = typeof fact === "string" ? fact :
      String(fact?.key || fact?.fact_key || fact?.name || "");
    return /(?:exact|official|verified|current|live|availability|handover|price|fees?|charges?|title|deed|registration|ownership|certificate|unit|building|developer|legal|dispute)/i.test(value);
  });
  const unresolvedKnowledgeScope =
    ["KNOWLEDGE_QA", "ADVISORY"].includes(action) &&
    contextualEntity &&
    ["district", "property_type", "buyer_scenario", "origin"].includes(contextualEntity.type) &&
    !verificationRequested &&
    !interpretation?.tasks?.some(task => task?.needs_clarification === true);
  if (unresolvedKnowledgeScope) return false;
  // FIX09A — contextual entity must not veto a conceptual answer.
  // This grants no permission for live claims, Contact or Search.
  const f09aName = String(resolution.entity_name || "").trim();
  const f09aOnlyConceptual = facts.length === 0 && entities.length === 1;
  const f09aEntity = entities[0] || null;

  // A comparison between generic property categories is not a lookup
  // of a uniquely named property.
  const f09aPropertyCategoryComparison =
    f09aOnlyConceptual &&
    action === "COMPARE" &&
    f09aEntity?.type === "property_type" &&
    /^(?:apartments?|villas?|townhouses?|homes?|properties|residences?)$/i.test(f09aName) &&
    /\b(?:compare|comparing|comparison|versus|vs\.?|difference between)\b/i.test(message) &&
    !/\b(?:exact|verified|current price|live availability|official handover)\b/i.test(message);

  if (f09aPropertyCategoryComparison) return false;

  // A guarantee of school admission cannot be inferred from a district.
  // Answer the limitation conceptually; do not name or guarantee a school.
  const f09aSchoolAdmissionGuarantee =
    f09aOnlyConceptual &&
    action === "KNOWLEDGE_QA" &&
    f09aEntity?.type === "district" &&
    /\b(?:schools?|admission|admit|enrolment|enrollment)\b/i.test(message) &&
    /\b(?:guarantee|guaranteed|definitely|certainly|assured)\b/i.test(message) &&
    new RegExp("\\b(?:in|within)\\s+" +
      f09aName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\b", "i").test(message);

  if (f09aSchoolAdmissionGuarantee) return false;

  // FIX04A — when the only unresolved candidate is a buyer-purpose concept,
  // lack of a Registry page must not veto a semantic comparison or explanation.
  // Explicit named entities, other entity types, and verified project-fact
  // requests remain subject to normal resolution rules. This is NOT a fact source.
  if (entities.length === 1 &&
      ["buyer_scenario", "origin"].includes(entities[0].type) &&
      ["COMPARE", "ADVISORY", "KNOWLEDGE_QA"].includes(action)) {
    const verificationFacts = facts.some(fact => {
      const value = typeof fact === "string" ? fact :
        String(fact?.key || fact?.fact_key || fact?.name || "");
      return /(?:official|verified|current|live|availability|handover.date|price|registration|certificate|unit.id)/i.test(value);
    });
    if (!verificationFacts) return false;
  }
  // FIX05: generic unit-layout comparisons do not require a Registry
  // identity for buyer-purpose context. Exact verified facts remain gated.
  const f05VerifiedFacts = facts.some(fact => {
    const value = typeof fact === "string" ? fact :
      String(fact?.key || fact?.fact_key || fact?.name || "");
    return /(?:official|verified|current|live|availability|handover.date|price|registration|certificate|unit.id)/i.test(value);
  });

  const f05GenericUnitComparison =
    action === "COMPARE" &&
    !f05VerifiedFacts &&
    /\b(?:one|two|three|four|1|2|3|4)[ -]bed(?:room)?s?\b/i.test(message) &&
    /\b(?:versus|vs\.?|between|compare|compared|or)\b/i.test(message) &&
    !/\b(?:exact|live|current|verified|official|availability|handover date)\b/i.test(message) &&
    (
      /^(?:work(?:ing|s)? from home|remote work(?:ing)?|home office)$/i.test(
        String(resolution.entity_name || "").trim()
      ) ||
      (
        entities.length > 0 &&
        entities.every(entity =>
          ["buyer_scenario", "origin", "property_type"].includes(entity.type)
        )
      )
    );

  if (f05GenericUnitComparison) return false;

  // FIX06A: a generic criterion is not a named Registry target.
  // Requests for current or official property facts stay protected.
  const f06aVerifiedFacts = facts.some(fact => {
    const value = typeof fact === "string" ? fact :
      String(fact?.key || fact?.fact_key || fact?.name || "");
    return /(?:official|verified|current|live|availability|handover.date|price|registration|certificate|unit.id)/i.test(value);
  });

  if (
    !f06aVerifiedFacts &&
    isGenericScopeEntityV1({
      message,
      entityName: resolution.entity_name,
      action
    })
  ) return false;

  if (facts.length !== 0 || entities.length !== 1) return true;
  const entity = entities[0];
  // Category concepts never need an exact project page to be explained.
  if (entity.type === "property_type" && action === "KNOWLEDGE_QA") return false;
  // Buyer-purpose context is not a uniquely named project. Only apply this
  // to conceptual comparisons/advice without an explicit fact lookup.
  if (["buyer_scenario", "origin"].includes(entity.type) &&
      ["COMPARE", "ADVISORY", "KNOWLEDGE_QA"].includes(action)) return false;
  // A city/emirate used as a geographic modifier for general questions
  // does not require a particular Registry page to be disambiguated.
  // Preserve explicit fact requests and district-vs-district comparisons.
  const name = String(resolution.entity_name || entity.name || entity.slug || "")
    .trim().toLowerCase().replace(/\s+/g, " ");
  const generalEmirates = new Set([
    "dubai", "abu dhabi", "sharjah", "ajman", "fujairah",
    "ras al khaimah", "umm al quwain"
  ]);
  if (action === "KNOWLEDGE_QA" && generalEmirates.has(name)) {
    const q = String(message || "").toLowerCase();
    const city = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const genericModifier = new RegExp(
      "\\b" + city + "\\s+(?:property|real\\s+estate|housing|market|districts?|areas?|neighbou?rhoods?|properties|homes|investment|prices?)\\b", "i"
    );
    const broadScope = new RegExp(
      "\\b(?:in|across|throughout|within)\\s+" + city + "\\b", "i"
    );
    if (genericModifier.test(q) || broadScope.test(q)) return false;
  }
  return true;
}

export async function resolveNamedEntity({
  env,
  interpretation = null,
  candidate = null,
  context = {},
  route = null
} = {}) {
  if (
    (
      !interpretation &&
      !candidate
    ) ||
    !RESOLVABLE_ROUTES.has(route)
  ) {
    return {
      attempted: false,
      resolved: false,
      status: "not_required"
    };
  }

  const resolvedCandidate =
    candidate ||
    primaryEntity(
      interpretation
    );

  if (!resolvedCandidate) {
    return {
      attempted: false,
      resolved: false,
      status: "no_single_entity"
    };
  }

  const requestedType =
    PAGE_TYPE_BY_ENTITY[
      resolvedCandidate?.type
    ]
      ? resolvedCandidate.type
      : null;

  const requestedPageType =
    requestedType
      ? PAGE_TYPE_BY_ENTITY[
          requestedType
        ]
      : null;

  const language =
    context?.page
      ?.language_code ||
    "en";

  const candidateSlug =
    normalizeSlug(
      resolvedCandidate.slug ||
      resolvedCandidate.name
    );

  if (!candidateSlug) {
    return {
      attempted: false,
      resolved: false,
      status: "empty_entity"
    };
  }

  const currentType =
    context?.entity
      ?.primary_type ||
    null;

  const currentSlug =
    context?.entity
      ?.primary_slug ||
    null;

  /*
    Explicit entity is already the current entity.
    No DB resolution is needed.
  */
  if (
    currentSlug === candidateSlug &&
    (
      !requestedType ||
      currentType === requestedType
    )
  ) {
    return {
      attempted: false,
      resolved: false,
      status: "current_entity",

      entity_name:
        resolvedCandidate.name ||
        resolvedCandidate.slug ||
        candidateSlug
    };
  }

  /*
    Typed candidate:
      use existing exact canonical lookup.

    Untyped deterministic candidate:
      resolve across canonical entity page types only.
      This lets Registry identify whether a name is a
      project, developer, district, etc. without Luna.
  */
  let exact = [];

  if (
    requestedType &&
    requestedPageType
  ) {
    exact =
      await lookupExact(
        env,
        {
          entityType:
            requestedType,

          pageType:
            requestedPageType,

          language,

          slug:
            candidateSlug
        }
      );
  } else {
    const rows =
      await supabaseSelect(
        env,
        "knowledge_registry_v1",
        [
          `select=${fields()}`,
          `language_code=eq.${encodeURIComponent(language)}`,
          `primary_entity_slug=eq.${encodeURIComponent(candidateSlug)}`,
          "limit=12"
        ].join("&")
      );

    exact =
      (rows || []).filter(
        row =>
          PAGE_TYPE_BY_ENTITY[
            row?.primary_entity_type
          ] === row?.page_type_id
      );
  }

  if (exact.length === 1) {
    return {
      attempted: true,
      resolved: true,
      status: "exact",

      entity_name:
        resolvedCandidate.name ||
        resolvedCandidate.slug ||
        candidateSlug,

      page:
        exact[0]
    };
  }

  if (exact.length > 1) {
    return {
      attempted: true,
      resolved: false,
      status: "ambiguous",

      entity_name:
        resolvedCandidate.name ||
        resolvedCandidate.slug ||
        candidateSlug,

      candidates:
        exact
    };
  }

  /*
    Alias-like fallback.

    Only UNIQUE prefix resolves.
    Multiple canonical matches require clarification.
  */
  let prefix = [];

  if (
    requestedType &&
    requestedPageType
  ) {
    prefix =
      await lookupPrefix(
        env,
        {
          entityType:
            requestedType,

          pageType:
            requestedPageType,

          language,

          slug:
            candidateSlug
        }
      );
  } else {
    const rows =
      await supabaseSelect(
        env,
        "knowledge_registry_v1",
        [
          `select=${fields()}`,
          `language_code=eq.${encodeURIComponent(language)}`,
          `primary_entity_slug=ilike.${encodeURIComponent(candidateSlug + "*")}`,
          "order=primary_entity_slug.asc",
          "limit=12"
        ].join("&")
      );

    prefix =
      (rows || []).filter(
        row =>
          PAGE_TYPE_BY_ENTITY[
            row?.primary_entity_type
          ] === row?.page_type_id
      );
  }

  if (prefix.length === 1) {
    return {
      attempted: true,
      resolved: true,
      status: "unique_prefix",

      entity_name:
        resolvedCandidate.name ||
        resolvedCandidate.slug ||
        prefix[0]
          .primary_entity_slug,

      page:
        prefix[0]
    };
  }

  if (prefix.length > 1) {
    return {
      attempted: true,
      resolved: false,
      status: "ambiguous",

      entity_name:
        resolvedCandidate.name ||
        resolvedCandidate.slug ||
        candidateSlug,

      candidates:
        prefix
    };
  }

  return {
    attempted: true,
    resolved: false,
    status: "not_found",

    entity_name:
      resolvedCandidate.name ||
      resolvedCandidate.slug ||
      candidateSlug
  };
}

export function buildKnowledgeContext(
  context = {},
  resolution = null
) {
  if (
    !resolution?.resolved ||
    !resolution?.page
  ) {
    return context;
  }

  const row =
    resolution.page;

  /*
    Browser/current page remains ambient context.

    The resolved named entity becomes ONLY
    the Knowledge target for this request.
  */
  return {
    ...context,

    ambient_page:
      context?.page ||
      null,

    ambient_entity:
      context?.entity ||
      null,

    page: {
      ...(context?.page || {}),

      page_id:
        row.page_id,

      page_type:
        row.page_type_id,

      page_type_id:
        row.page_type_id,

      language_code:
        row.language_code ||
        context?.page
          ?.language_code ||
        "en",

      url_path:
        row.url_path,

      canonical_url_path:
        row.canonical_url_path
    },

    entity: {
      ...(context?.entity || {}),

      primary_type:
        row.primary_entity_type,

      primary_slug:
        row.primary_entity_slug,

      primary_name:
        resolution
          .entity_name ||
        null
    }
  };
}
