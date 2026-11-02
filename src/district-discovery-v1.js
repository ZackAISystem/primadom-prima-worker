
// D5_EMIRATE_ROUTING_V1
import { DISTRICT_EMIRATES_V1 } from "./district-emirates-v1.js";

const FIELDS =
  "page_id,page_type_id,language_code,url_path,primary_entity_type,primary_entity_slug";

const normalize = value =>
  String(value || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim();

const display = slug =>
  String(slug || "").split("-")
    .map(x => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");

function queryTarget(query) {
  return normalize(
    String(query || "")
      .replace(/^(?:please\s+)?(?:find|show(?:\s+me)?|list|tell\s+me\s+about|what\s+is|explore)\s+/i, "")
      .replace(/^(?:the|all)\s+/i, "")
      .replace(/\b(?:districts?|areas?|neighbou?rhoods?|communities)\b/gi, "")
      .replace(/[.!?]+$/, "")
  );
}

export async function discoverDistrictsV1({
  query = "",
  emirate = "",
  select,
  offset = 0,
  batchSize = 3
} = {}) {
  if (typeof select !== "function") {
    throw new Error("district_select_missing");
  }

  const target = emirate ? "" : queryTarget(query);

  const raw = await select(
    "knowledge_registry_v1",
    `select=${FIELDS}&language_code=eq.en&page_type_id=eq.district_page&order=primary_entity_slug.asc&limit=1000`
  );

  if (!Array.isArray(raw)) {
    throw new Error("district_registry_invalid");
  }

  const unique = new Map();

  for (const r of raw) {
    const slug = String(r?.primary_entity_slug || "");
    const url = String(r?.url_path || "");

    if (
      r?.primary_entity_type === "district" &&
      r?.page_type_id === "district_page" &&
      r?.language_code === "en" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
      url === `/en/areas/${slug}/` &&
      !unique.has(slug)
    ) {
      unique.set(slug, r);
    }
  }

  const scored = [...unique.values()]
    .filter(r =>
      !emirate ||
      DISTRICT_EMIRATES_V1[r.primary_entity_slug] === emirate
    )
    .map(r => {
      const name = normalize(r.primary_entity_slug);
      const score = !target ? 0
        : name === target ? 400
        : name.startsWith(target + " ") ? 300
        : name.includes(target) ? 100
        : -1;

      return { r, score };
    })
    .filter(x => x.score >= 0)
    .sort((a, b) =>
      b.score - a.score ||
      a.r.primary_entity_slug.localeCompare(b.r.primary_entity_slug)
    );

  const best = scored[0]?.score ?? -1;
  const matching = best >= 300
    ? scored.filter(x => x.score === best)
    : scored;

  const start = Math.max(0, Math.min(1000, Math.trunc(Number(offset) || 0)));
  const size = Math.max(1, Math.min(10, Math.trunc(Number(batchSize) || 3)));

  const results = matching.slice(start, start + size)
    .map(({ r }, i) => ({
      rank: start + i + 1,
      entity_type: "district",
      page_id: r.page_id,
      slug: r.primary_entity_slug,
      title: display(r.primary_entity_slug),
      canonical_url: r.url_path
    }));

  return {
    version: "DistrictDiscoveryV1",
    language: "en",
    entity_type: "district",
    state: results.length ? "results" : "empty",
    query,
    emirate: emirate || null,
    result_count: matching.length,
    current_batch_offset: start,
    results,
    has_more: start + results.length < matching.length
  };
}
