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
