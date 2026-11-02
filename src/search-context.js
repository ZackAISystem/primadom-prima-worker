const MAX_RESULTS = 10;

function text(value, limit = 180) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, limit);
}

function number(value) {
  if (
    value === null ||
    value === "" ||
    typeof value === "undefined"
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function list(value, limit = 10) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, limit)
    .map(item => text(item, 100))
    .filter(Boolean);
}

function budget(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const out = {};

  for (const key of [
    "min",
    "max",
    "preferredMin",
    "preferredMax"
  ]) {
    const parsed = number(value[key]);

    if (parsed !== null) {
      out[key] = parsed;
    }
  }

  const kind = text(value.kind, 40);

  if (kind) {
    out.kind = kind;
  }

  return Object.keys(out).length
    ? out
    : null;
}

function result(item, index) {
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return null;
  }

  const slug = text(item.slug, 160);

  if (!slug) {
    return null;
  }

  const url = text(
    item.canonical_url,
    300
  );

  return {
    rank: index + 1,
    score: number(item.score) ?? 0,
    entity_type: "project",
    slug,
    canonical_url:
      url.startsWith("/en/")
        ? url
        : "",

    gallery_1: (() => {
      const value =
        text(
          item.gallery_1,
          1000
        );

      return value.startsWith(
        "https://"
      )
        ? value
        : "";
    })(),

    image_alt:
      text(
        item.image_alt,
        300
      ),

    title: text(item.title),
    district: text(item.district, 140),
    developer: text(item.developer, 140),
    price_display:
      text(item.price_display, 100),
    price_amount:
      number(item.price_amount),
    property_type:
      text(item.property_type, 100),
    units: text(item.units, 120),
    handover: text(item.handover, 100),
    payment_plan:
      text(item.payment_plan, 160),
    status: text(item.status, 80),
    size_from: text(item.size_from, 100)
  };
}


/*
  E24_MULTI_ENTITY_SEARCH_NORMALIZATION_V1

  Accept D4 developer / D5 district UI batches
  containing Registry-verified canonical identities.

  The original project normalization path below
  remains byte-for-byte unchanged.

  Reject incomplete, inconsistent or oversized
  batches instead of guessing missing identities.
*/
function normalizeE24EntitySearchContextV1(raw) {
  if (
    !raw ||
    raw.version !== "SearchContextV1" ||
    raw.language !== "en" ||
    raw.state !== "results" ||
    !["developer", "district"].includes(
      raw.entity_type
    )
  ) {
    return null;
  }

  const type = raw.entity_type;
  const prefix = type === "developer"
    ? "/en/developers/"
    : "/en/areas/";

  const rows = raw.results;
  const offset = raw.current_batch_offset;
  const query = String(raw.query || "").trim();

  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > 90 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= rows.length ||
    !query ||
    query.length > 500
  ) {
    return null;
  }

  const results = [];

  for (const item of rows) {
    const slug = String(item?.slug || "");
    const canonical = String(
      item?.canonical_url || ""
    );
    const title = String(item?.title || "").trim();

    if (
      item?.entity_type !== type ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      canonical !== prefix + slug + "/" ||
      !title ||
      title.length > 200
    ) {
      return null;
    }

    results.push({
      entity_type: type,
      slug,
      title,
      canonical_url: canonical,
      rank: results.length + 1
    });
  }

  const suppliedCount = Number(raw.result_count);

  const resultCount =
    Number.isFinite(suppliedCount) &&
    suppliedCount >= results.length
      ? suppliedCount
      : results.length;

  return {
    version: "SearchContextV1",
    source: "prima_ui_verified_entity_batch_v1",
    language: "en",
    entity_type: type,
    query,
    state: "results",
    result_count: resultCount,
    results_shown: Math.min(
      3, results.length - offset
    ),
    current_batch_offset: offset,
    filters: {},
    results
  };
}

export function normalizeSearchContextV1(
  raw
) {
  if (
    raw?.version === "SearchContextV1" &&
    ["developer", "district"].includes(
      raw?.entity_type
    )
  ) {
    return normalizeE24EntitySearchContextV1(raw);
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.version !== "SearchContextV1" ||
    raw.language !== "en" ||
    raw.entity_type !== "project"
  ) {
    return null;
  }

  const results =
    (
      Array.isArray(raw.results)
        ? raw.results
        : []
    )
      .slice(0, MAX_RESULTS)
      .map(result)
      .filter(Boolean);

  const filters =
    raw.filters &&
    typeof raw.filters === "object" &&
    !Array.isArray(raw.filters)
      ? raw.filters
      : {};

  const rawCount =
    number(raw.result_count);

  return {
    version: "SearchContextV1",
    source: "primadom_project_search_v3",
    language: "en",
    entity_type: "project",
    query: text(raw.query, 500),

    state:
      [
        "discovery",
        "results",
        "empty"
      ].includes(raw.state)
        ? raw.state
        : (
            results.length
              ? "results"
              : "empty"
          ),

    filters: {
      emirates:
        list(filters.emirates, 4),

      developer:
        text(
          filters.developer,
          140
        ) || null,

      district:
        text(
          filters.district,
          140
        ) || null,

      property_types:
        list(
          Array.isArray(filters.property_types)
            ? filters.property_types
            : (typeof filters.property_type === "string" && filters.property_type.trim()
                ? [filters.property_type] : []),
          8
        ),

      bedrooms:
        Array.isArray(
          filters.bedrooms
        )
          ? filters.bedrooms
              .slice(0, 10)
              .map(Number)
              .filter(
                value =>
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 20
              )
          : [],

      budget:
        budget(filters.budget) ||
        (() => {
          const maximum = number(filters.budget_max);
          return maximum !== null && maximum > 0
            ? {max: maximum}
            : null;
        })(),

      handover_years:
        list(
          filters.handover_years,
          10
        ),

      payment_plan_required:
        Boolean(
          filters.payment_plan_required
        )
    },

    result_count:
      rawCount === null
        ? results.length
        : Math.max(
            results.length,
            Math.min(
              100000,
              Math.trunc(rawCount)
            )
          ),

    results_shown:
      results.length,

    current_batch_offset:
      (() => {
        const value =
          number(
            raw.current_batch_offset
          );

        if (value === null) {
          return 0;
        }

        return Math.max(
          0,
          Math.min(
            MAX_RESULTS - 1,
            Math.trunc(value)
          )
        );
      })(),

    // C_D_D5_REMOTE_PAGINATION_V9
    // The verified D5 endpoint owns continuation, not the in-memory
    // three-row SearchContext. Carry only a validated pagination hint;
    // all other Search V3 contexts keep their existing pagination path.
    verified_d5_page: (() => {
      const n = Number(raw.result_count);
      const offset = raw.current_batch_offset;
      const next = raw.next_offset;
      const rows = raw.results;
      const district = String(filters.district || "");
      if (
        raw.source !== "prima_worker_district_projects_v1" ||
        raw.state !== "results" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(district) ||
        !Array.isArray(rows) ||
        rows.length < 1 || rows.length > MAX_RESULTS ||
        !Number.isSafeInteger(n) || n < rows.length || n > 100000 ||
        !Number.isInteger(offset) || offset < 0 ||
        (offset !== 0 && offset !== 3 && offset !== 6) ||
        // Offset > 0 is permitted only for a contiguous, accumulated
        // D5 batch: first 3, then next 3. No arbitrary remote offsets.
        rows.length !== offset + Math.min(3, n - offset) ||
        !Number.isInteger(next) || next !== rows.length ||
        typeof raw.has_more !== "boolean" ||
        raw.has_more !== (next < n) ||
        rows.some(item =>
          item?.entity_type !== "project" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug || "")) ||
          item.canonical_url !== "/en/projects/" + item.slug + "/"
        )
      ) return null;
      return {has_more: raw.has_more, next_offset: next};
    })(),

    results
  };
}
