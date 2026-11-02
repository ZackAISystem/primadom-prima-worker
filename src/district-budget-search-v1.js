
// D5_DISTRICT_BUDGET_SEARCH_V1
// Uses the existing Project Projection passed by the Worker.
// Never treats a project starting price as a verified unit quotation.

import { DISTRICT_EMIRATES_V1 }
  from "./district-emirates-v1.js";

const norm = value => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const emirates = {
  "dubai": "Dubai",
  "abu dhabi": "Abu Dhabi",
  "sharjah": "Sharjah",
  "ajman": "Ajman",
  "ras al khaimah": "Ras Al Khaimah",
  "rak": "Ras Al Khaimah",
  "fujairah": "Fujairah",
  "umm al quwain": "Umm Al Quwain",
  "uaq": "Umm Al Quwain"
};

const locationPattern =
  /\b(?:in|within)\s+(umm al quwain|ras al khaimah|abu dhabi|fujairah|sharjah|ajman|dubai|uaq|rak)\b/i;

const propertyPattern =
  /\b(villas?|apartments?|townhouses?)\b/i;

const unsupported =
  /\b(families|family|kids|children|schools|waterfront|beachfront|green|quiet|calm|investment|investors?|luxury|premium|affordable|cheap|roi|yield|bedrooms?|br)\b/i;

const maxPattern =
  /\b(under|below|up to|within|maximum|max)\s+(?:aed\s*)?([\d,.]+)\s*(million|thousand|m|k)?\s*(?:aed)?\b/i;

const districtNames = new Map();

for (const [slug, emirate] of Object.entries(
  DISTRICT_EMIRATES_V1
)) {
  const key = norm(slug);
  const candidates = districtNames.get(key) || [];
  candidates.push({slug, emirate});
  districtNames.set(key, candidates);
}

const title = slug => slug.split("-")
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(" ");

export function parseDistrictBudgetQueryV1(query) {
  const q = String(query || "").trim();

  if (!q || q.length > 300) return null;

  if (!/\b(districts?|areas?|communities|neighbou?rhoods?)\b/i.test(q)) {
    return null;
  }

  // Compound lifestyle + budget criteria are handled in D5-12B.
  if (unsupported.test(q)) return null;

  // Minimum-price queries require their own semantics.
  if (/\b(from|over|above|at least|starting at)\b/i.test(q)) {
    return null;
  }

  if (!/\baed\b/i.test(q)) return null;

  const priceMatch = q.match(maxPattern);
  if (!priceMatch) return null;

  const amount = Number(priceMatch[2].replace(/,/g, ""));

  const multiplier = {
    million: 1000000,
    m: 1000000,
    thousand: 1000,
    k: 1000
  }[String(priceMatch[3] || "").toLowerCase()] || 1;

  const maxPrice = amount * multiplier;

  if (!Number.isFinite(maxPrice) ||
      maxPrice <= 0 ||
      maxPrice > 1000000000) return null;

  const geo = q.match(locationPattern);

  const property = q.match(propertyPattern);
  const propertyType = property
    ? norm(property[1]).replace(/s$/, "")
    : null;

  return {
    version: "DistrictBudgetCriteriaV1",
    query: q,
    emirate: geo ? emirates[norm(geo[1])] || null : null,
    property_type: propertyType,
    max_price_aed: maxPrice
  };
}

function resolveDistrict(project, requestedEmirate) {
  const raw = project.machine_district || project.district;
  const candidates = districtNames.get(norm(raw)) || [];

  const projectEmirate = norm(
    project.machine_emirate || project.emirate || ""
  );

  const filtered = candidates.filter(row => {
    if (requestedEmirate &&
        row.emirate !== requestedEmirate) return false;

    if (projectEmirate &&
        norm(row.emirate) !== projectEmirate) return false;

    return true;
  });

  // Never guess which district is intended.
  return filtered.length === 1 ? filtered[0] : null;
}

function exactPropertyType(project, requested) {
  if (!requested) return true;

  const source = String(
    project.machine_property_type ||
    project.property_type ||
    ""
  );

  const types = source.split(/[·,|/]/)
    .map(value => norm(value).replace(/s$/, ""))
    .filter(Boolean);

  // Mixed-type project starting prices are not unit-specific.
  return types.length === 1 && types[0] === requested;
}

// D5_SHARED_PROJECT_MATCH_V1
// Canonical matching rule for budget-based district/project searches.
export function matchDistrictBudgetProjectV1(project, criteria) {
  if (!project || typeof project !== "object") return null;

  if (!project.slug ||
      !String(project.canonical_url || "")
        .startsWith("/en/projects/")) return null;

  const price = Number(project.price_amount);
  const maximum = Number(criteria?.max_price_aed);

  if (!Number.isFinite(maximum) ||
      maximum <= 0 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      price > maximum) return null;

  if (!exactPropertyType(
    project,
    criteria?.property_type || null
  )) return null;

  return resolveDistrict(project, criteria?.emirate || null);
}

export function searchDistrictBudgetV1({
  query = "",
  projects = [],
  offset = 0,
  batchSize = 3
} = {}) {
  const criteria = parseDistrictBudgetQueryV1(query);
  if (!criteria) return null;

  if (!Array.isArray(projects)) {
    throw new TypeError("Project Projection must be an array");
  }

  const groups = new Map();
  const seen = new Set();

  for (const project of projects) {
    const district = matchDistrictBudgetProjectV1(project, criteria);
    if (!district) continue;

    const price = Number(project.price_amount);

    const identity = district.slug + "|" + project.canonical_url;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const current = groups.get(district.slug) || {
      entity_type: "district",
      slug: district.slug,
      title: title(district.slug),
      emirate: district.emirate,
      canonical_url: `/en/areas/${district.slug}/`,
      matching_project_count: 0,
      lowest_catalog_price_aed: price
    };

    current.matching_project_count++;
    current.lowest_catalog_price_aed = Math.min(
      current.lowest_catalog_price_aed, price
    );

    groups.set(district.slug, current);
  }

  const matches = [...groups.values()].sort((a, b) =>
    b.matching_project_count - a.matching_project_count ||
    a.lowest_catalog_price_aed - b.lowest_catalog_price_aed ||
    a.title.localeCompare(b.title)
  );

  const start = Math.max(
    0, Math.min(matches.length, Math.trunc(Number(offset) || 0))
  );

  const size = Math.max(
    1, Math.min(10, Math.trunc(Number(batchSize) || 3))
  );

  const results = matches.slice(start, start + size)
    .map((row, i) => ({
      ...row,
      rank: start + i + 1
    }));

  return {
    version: "DistrictDiscoveryV1",
    search_mode: "budget",
    language: "en",
    entity_type: "district",
    query: criteria.query,
    state: matches.length ? "results" : "empty",
    emirate: criteria.emirate,
    filters: {
      property_type: criteria.property_type,
      budget_max: criteria.max_price_aed
    },
    price_basis: "project_catalog_price_amount",
    price_warning: "Project-level catalog price is not a verified unit quote or live availability.",
    result_count: matches.length,
    matching_project_count_total: matches.reduce(
      (sum, row) => sum + row.matching_project_count, 0
    ),
    current_batch_offset: start,
    has_more: start + results.length < matches.length,
    results
  };
}
