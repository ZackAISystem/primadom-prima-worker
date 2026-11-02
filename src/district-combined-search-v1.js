
// D5_COMBINED_SEARCH_V1
// Intersects existing Knowledge and Project Projection results.
// No copied catalog, generated prices or inferred unit availability.

import {
  parseDistrictBudgetQueryV1,
  searchDistrictBudgetV1
} from "./district-budget-search-v1.js";

import {
  parseDistrictIntelligenceQueryV1,
  searchDistrictIntelligenceV1
} from "./district-intelligence-search-v1.js";

const priceClause =
  /\b(?:under|below|up to|within|maximum|max)\s+(?:aed\s*)?[\d,.]+\s*(?:million|thousand|m|k)?\s*(?:aed)?\b/gi;

const propertyClause =
  /\b(?:with\s+)?(?:villas?|apartments?|townhouses?|projects?)\b/gi;

const traitWords =
  /\b(?:family[- ]friendly|family|families|children|child|kids|schools|investment|investors?|investing|invest|income|waterfront|beachfront|beach|coastal|seaside|island|green|parks?|nature|landscaped|quiet|calm|peaceful|tranquil)\b/gi;

const compact = text =>
  String(text || "").replace(/\s+/g, " ").trim();

export function parseDistrictCombinedQueryV1(query) {
  const original = compact(query);
  if (!original || original.length > 300) return null;

  const qualitativeQuery = compact(
    original
      .replace(priceClause, " ")
      .replace(propertyClause, " ")
  );

  const budgetQuery = compact(
    original.replace(traitWords, " ")
  );

  const intelligence =
    parseDistrictIntelligenceQueryV1(qualitativeQuery);

  const budget =
    parseDistrictBudgetQueryV1(budgetQuery);

  if (!intelligence || !budget) return null;

  if (
    intelligence.emirate &&
    budget.emirate &&
    intelligence.emirate !== budget.emirate
  ) return null;

  return {
    version: "DistrictCombinedCriteriaV1",
    query: original,
    qualitative_query: qualitativeQuery,
    budget_query: budgetQuery,
    emirate: intelligence.emirate || budget.emirate,
    traits: intelligence.traits,
    property_type: budget.property_type,
    max_price_aed: budget.max_price_aed
  };
}

function collectPages(search, argumentsBase) {
  const first = search({
    ...argumentsBase,
    offset: 0,
    batchSize: 10
  });

  if (!first || !Number.isInteger(first.result_count) ||
      first.result_count < 0 ||
      first.result_count > 301) {
    throw new Error("Invalid district search contract");
  }

  const rows = [...first.results];

  for (let offset = 10; offset < first.result_count; offset += 10) {
    const page = search({
      ...argumentsBase,
      offset,
      batchSize: 10
    });

    if (!page || !Array.isArray(page.results)) {
      throw new Error("Invalid district search page");
    }

    rows.push(...page.results);
  }

  if (rows.length !== first.result_count) {
    throw new Error("Incomplete district search pagination");
  }

  return rows;
}

export function searchDistrictCombinedV1({
  query = "",
  projects = [],
  offset = 0,
  batchSize = 3
} = {}) {
  const criteria = parseDistrictCombinedQueryV1(query);
  if (!criteria) return null;

  const qualitative = collectPages(
    searchDistrictIntelligenceV1,
    {query: criteria.qualitative_query}
  );

  const allowed = new Map(
    qualitative.map(area => [area.slug, area])
  );

  const budget = collectPages(
    searchDistrictBudgetV1,
    {
      query: criteria.budget_query,
      projects
    }
  );

  const matches = budget
    .filter(area => allowed.has(area.slug))
    .map(area => ({
      ...area,
      evidence: allowed.get(area.slug).evidence,
      evidence_status: "primadom_knowledge_descriptive"
    }));

  matches.sort((a, b) =>
    b.matching_project_count - a.matching_project_count ||
    a.title.localeCompare(b.title)
  );

  const start = Math.max(
    0,
    Math.min(matches.length, Math.trunc(Number(offset) || 0))
  );

  const size = Math.max(
    1,
    Math.min(10, Math.trunc(Number(batchSize) || 3))
  );

  const results = matches
    .slice(start, start + size)
    .map((area, i) => ({
      ...area,
      rank: start + i + 1
    }));

  return {
    version: "DistrictDiscoveryV1",
    search_mode: "combined",
    entity_type: "district",
    language: "en",
    query: criteria.query,
    state: matches.length ? "results" : "empty",
    emirate: criteria.emirate,
    criteria: criteria.traits,
    filters: {
      property_type: criteria.property_type,
      budget_max: criteria.max_price_aed
    },
    price_basis: "project_catalog_price_amount",
    price_warning:
      "Catalog project prices are not verified unit quotes or live availability.",
    result_count: matches.length,
    matching_project_count_total: matches.reduce(
      (sum, area) => sum + area.matching_project_count,
      0
    ),
    current_batch_offset: start,
    has_more: start + results.length < matches.length,
    results
  };
}
