const FIELDS =
  "page_id,page_type_id,language_code,url_path,primary_entity_type,primary_entity_slug";

const normalize = value =>
  String(value || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();

const title = slug =>
  String(slug).split("-")
    .map(x => x[0]?.toUpperCase() + x.slice(1))
    .join(" ");

function queryTarget(query) {
  const q = String(query || "").trim()
    // D4 only: remove a trailing request for the developer profile,
    // without changing the verified developer name being looked up.
    .replace(
      /\s+(?:and\s+)?(?:show|give)\s+(?:me\s+)?(?:its|their|the)\s+(?:developer\s+)?(?:profile|overview|details)\s*[.!?]*$/i,
      ""
    );

  const hasFacets =
    /\b(?:in|across|within)\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|uae)\b/i.test(q) ||
    /\b(?:under|below|over|above|aed|budget|apartments?|villas?|bedrooms?|waterfront|payment plan|with projects)\b/i.test(q);

  return {
    pending: hasFacets,
    name: normalize(
      q.replace(
        /\b(?:show|find|list|me|all|the|developers?|companies|builders?|please|about|tell)\b/gi,
        " "
      )
    )
  };
}

export async function discoverDevelopersV1({
  query = "",
  select,
  offset = 0,
  batchSize = 3
} = {}) {
  if (typeof select !== "function") {
    throw new Error("developer_select_missing");
  }

  const target = queryTarget(query);

  if (target.pending) {
    return {
      version: "DeveloperDiscoveryV1",
      entity_type: "developer",
      state: "filters_pending",
      query,
      result_count: 0,
      results: [],
      has_more: false
    };
  }

  const raw = await select(
    "knowledge_registry_v1",
    `select=${FIELDS}&language_code=eq.en&page_type_id=eq.developer_page&order=primary_entity_slug.asc&limit=1000`
  );

  if (!Array.isArray(raw)) {
    throw new Error("developer_registry_invalid");
  }

  const bySlug = new Map();

  for (const r of raw) {
    const slug = String(r?.primary_entity_slug || "");
    const url = String(r?.url_path || "");

    if (
      r?.primary_entity_type === "developer" &&
      r?.page_type_id === "developer_page" &&
      r?.language_code === "en" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
      url === `/en/developers/${slug}/` &&
      !bySlug.has(slug)
    ) {
      bySlug.set(slug, r);
    }
  }

  // D4-24A: Prefer verified exact registry names over partial matches.
  // Generic company suffixes may be omitted from the canonical registry slug.
  const alias = target.name
    .replace(/(?:\s+(?:properties|property|realty|developers?|developments?|group|pjsc|llc|ltd|limited))+$/g, "")
    .trim();

  const scored = [...bySlug.values()]
    .map(r => {
      const name = normalize(r.primary_entity_slug);
      const score = !target.name ? 0
        : name === target.name ? 400
        : name.startsWith(target.name + " ") ? 300
        : alias !== target.name && alias.length >= 3 && name === alias ? 250
        : name.includes(target.name) ? 100
        : -1;

      return { r, score };
    })
    .filter(x => x.score >= 0)
    .sort((a, b) =>
      b.score - a.score ||
      a.r.primary_entity_slug.localeCompare(b.r.primary_entity_slug)
    );

  // An exact name, canonical prefix or unambiguous suffix alias takes priority.
  // Preserve broad listings and partial search when none of these exists.
  const bestScore = scored[0]?.score ?? -1;
  const matching = bestScore >= 250
    ? scored.filter(x => x.score === bestScore)
    : scored;

  const start = Math.max(
    0, Math.min(1000, Math.trunc(Number(offset) || 0))
  );
  const size = Math.max(
    1, Math.min(10, Math.trunc(Number(batchSize) || 3))
  );

  const results = matching
    .slice(start, start + size)
    .map(({ r }, i) => ({
      rank: start + i + 1,
      entity_type: "developer",
      slug: r.primary_entity_slug,
      page_id: r.page_id,
      title: title(r.primary_entity_slug),
      canonical_url: r.url_path
    }));

  return {
    version: "DeveloperDiscoveryV1",
    entity_type: "developer",
    state: results.length ? "results" : "empty",
    query,
    result_count: matching.length,
    current_batch_offset: start,
    results,
    has_more: start + results.length < matching.length
  };
}
