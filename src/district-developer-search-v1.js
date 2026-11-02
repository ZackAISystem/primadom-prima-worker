
// D5_13_DEVELOPER_DISTRICT_SEARCH_V1
// Developer x District x Project filters.
// Read-only projection matching; no duplicate catalog storage.

import { DISTRICT_EMIRATES_V1 }
  from "./district-emirates-v1.js";

import {
  parseDistrictBudgetQueryV1,
  matchDistrictBudgetProjectV1
} from "./district-budget-search-v1.js";

import {
  searchDistrictIntelligenceV1,
  parseDistrictIntelligenceQueryV1
} from "./district-intelligence-search-v1.js";

const norm = value => String(value || "").toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const developerKey = value => norm(value)
  // Remove successive legal/company suffixes, not meaningful
  // brand words. Emaar and Emaar South remain distinct.
  .replace(
    /(?:\s+(?:properties|property|developments?|group|holdings?|llc|pjsc|plc|ltd|limited))+$/g,
    ""
  )
  .trim();

const locations = {
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

const emiratePattern =
  /\bin\s+(umm al quwain|ras al khaimah|abu dhabi|fujairah|sharjah|ajman|dubai|uaq|rak)\b/i;

const propertyPlural = {
  villa: "villas",
  apartment: "apartments",
  townhouse: "townhouses"
};

const districtLookup = new Map();

for (const [slug, emirate] of Object.entries(
  DISTRICT_EMIRATES_V1
)) {
  const key = norm(slug);
  const rows = districtLookup.get(key) || [];
  rows.push({slug, emirate});
  districtLookup.set(key, rows);
}

const title = slug => slug.split("-")
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(" ");

function propertyName(value) {
  const text = norm(value).replace(/s$/, "");
  return ["villa", "apartment", "townhouse"].includes(text)
    ? text
    : null;
}

function resolveDistrict(project, emirate) {
  const key = norm(project.machine_district || project.district);
  const candidates = districtLookup.get(key) || [];

  const projectEmirate = norm(
    project.machine_emirate || project.emirate
  );

  const matches = candidates.filter(row =>
    (!emirate || row.emirate === emirate) &&
    (!projectEmirate || norm(row.emirate) === projectEmirate)
  );

  return matches.length === 1 ? matches[0] : null;
}

function exactProperty(project, requested) {
  if (!requested) return true;

  const raw = String(
    project.machine_property_type ||
    project.property_type ||
    ""
  );

  const values = raw.split(/[·,|/]/)
    .map(propertyName)
    .filter(Boolean);

  // Do not attribute a mixed-type project's price to
  // one specific type.
  return values.length === 1 && values[0] === requested;
}

// D5_13_SHARED_DEVELOPER_PROJECT_MATCH_V1
// One eligibility rule for district counts and opened projects.
export function matchDistrictDeveloperProjectV1(
  project,
  criteria = {}
) {
  if (!project || typeof project !== "object") return null;

  const developer = String(criteria.developer || "").trim();
  const developer_key = developerKey(developer);
  if (!developer_key) return null;

  const actualDeveloper = String(
    project.machine_developer ||
    project.developer ||
    ""
  ).trim();

  if (developerKey(actualDeveloper) !== developer_key) {
    return null;
  }

  if (
    !project.slug ||
    !/^\/en\/projects\/[a-z0-9-]+\/$/.test(
      String(project.canonical_url || "")
    )
  ) return null;

  const propertyType = criteria.property_type || null;

  if (!exactProperty(project, propertyType)) {
    return null;
  }

  const budget = criteria.budget_max ?? null;
  const emirate = criteria.emirate || null;

  const district = budget !== null
    ? matchDistrictBudgetProjectV1(project, {
        emirate,
        property_type:propertyType,
        max_price_aed:budget
      })
    : resolveDistrict(project, emirate);

  return district ? {district, actualDeveloper} : null;
}

function collectQualitative(query) {
  const first = searchDistrictIntelligenceV1({
    query, offset:0, batchSize:10
  });

  if (!first || first.result_count > 301) {
    throw new Error("Invalid intelligence criteria");
  }

  const results = [...first.results];

  for (let offset=10; offset<first.result_count; offset+=10) {
    const batch = searchDistrictIntelligenceV1({
      query, offset, batchSize:10
    });
    results.push(...batch.results);
  }

  if (results.length !== first.result_count) {
    throw new Error("Incomplete intelligence results");
  }

  return new Map(results.map(area => [area.slug,area]));
}

export function parseDistrictDeveloperQueryV1(query) {
  const q = String(query || "").trim()
    .replace(/[.!?]+$/, "").trim();

  if (!q || q.length > 300 ||
      !/\b(districts?|areas?|communities|neighbou?rhoods?)\b/i.test(q)) {
    return null;
  }

  // These requests belong to other routes.
  if (/\b(?:from|above|over|at least|starting at)\s+(?:aed|\d)/i.test(q)) {
    return null;
  }

  const priceClause = q.match(
    /\b(?:under|below|up to|within|max|maximum)\s+(?:AED\s*)?[\d,.]+\s*(?:million|thousand|m|k)?\s*(?:AED)?$/i
  );

  if (/\baed\b/i.test(q) && !priceClause) return null;

  const withoutPrice = priceClause
    ? q.slice(0, priceClause.index).trim()
    : q;

  // "Waterfront districts with projects by Nakheel"
  // "Districts in Dubai with villas by Emaar"
  const byMatch = withoutPrice.match(
    /\b(?:projects?|villas?|apartments?|townhouses?)\s+by\s+([a-z][a-z0-9 &'.,-]{1,80})$/i
  );

  // "Districts in Dubai with Emaar villas"
  // "Which districts have Aldar projects"
  const withMatch = !byMatch && withoutPrice.match(
    /\b(?:with|have|has)\s+([a-z][a-z0-9 &'.,-]{1,80}?)\s+(projects?|villas?|apartments?|townhouses?)$/i
  );

  if (!byMatch && !withMatch) return null;

  const developer = String(
    byMatch?.[1] || withMatch?.[1] || ""
  ).trim();

  const kind = byMatch
    ? withoutPrice.slice(byMatch.index)
        .match(/^(projects?|villas?|apartments?|townhouses?)/i)?.[1]
    : withMatch?.[2];

  if (!developer || !developerKey(developer) ||
      developer.length > 80) return null;

  const propertyType = propertyName(kind);
  const geoMatch = q.match(emiratePattern);
  const emirate = geoMatch
    ? locations[norm(geoMatch[1])] || null
    : null;

  const matchedPhrase = byMatch || withMatch;

  const qualitativeQuery =
    withoutPrice.slice(0, matchedPhrase.index).trim();

  const parsedTraits =
    parseDistrictIntelligenceQueryV1(qualitativeQuery);

  let maxPrice = null;

  if (priceClause) {
    const sample =
      "Districts" +
      (emirate ? " in " + emirate : "") +
      " with " +
      (propertyType ? propertyPlural[propertyType] : "projects") +
      " " + priceClause[0];

    const budget = parseDistrictBudgetQueryV1(sample);

    if (!budget) return null;
    maxPrice = budget.max_price_aed;
  }

  return {
    version:"DistrictDeveloperCriteriaV1",
    query:q,
    developer,
    developer_key:developerKey(developer),
    emirate,
    property_type:propertyType,
    budget_max:maxPrice,
    traits:parsedTraits?.traits || [],
    qualitative_query:parsedTraits ? qualitativeQuery : null
  };
}

export function searchDistrictDeveloperV1({
  query="",
  projects=[],
  offset=0,
  batchSize=3
} = {}) {
  const criteria = parseDistrictDeveloperQueryV1(query);
  if (!criteria) return null;

  if (!Array.isArray(projects)) {
    throw new TypeError("Invalid Project Projection");
  }

  const qualitative = criteria.qualitative_query
    ? collectQualitative(criteria.qualitative_query)
    : null;

  const groups = new Map();
  const seen = new Set();

  for (const project of projects) {
    const eligible = matchDistrictDeveloperProjectV1(
      project, criteria
    );

    if (!eligible) continue;

    const {district, actualDeveloper} = eligible;

    if (qualitative && !qualitative.has(district.slug)) {
      continue;
    }

    const identity =
      district.slug + "|" + project.canonical_url;

    if (seen.has(identity)) continue;
    seen.add(identity);

    const current = groups.get(district.slug) || {
      entity_type:"district",
      slug:district.slug,
      title:title(district.slug),
      canonical_url:`/en/areas/${district.slug}/`,
      emirate:district.emirate,
      matching_project_count:0,
      matched_developer:actualDeveloper,
      evidence:qualitative?.get(district.slug)?.evidence || {}
    };

    current.matching_project_count++;
    groups.set(district.slug,current);
  }

  const matching = [...groups.values()].sort((a,b) =>
    b.matching_project_count-a.matching_project_count ||
    a.title.localeCompare(b.title)
  );

  const start = Math.max(
    0,Math.min(matching.length,Math.trunc(Number(offset)||0))
  );
  const size = Math.max(
    1,Math.min(10,Math.trunc(Number(batchSize)||3))
  );

  const results = matching.slice(start,start+size)
    .map((row,i) => ({...row,rank:start+i+1}));

  return {
    version:"DistrictDiscoveryV1",
    search_mode:"developer_district",
    entity_type:"district",
    language:"en",
    state:matching.length ? "results" : "empty",
    query:criteria.query,
    emirate:criteria.emirate,
    developer:criteria.developer,
    criteria:criteria.traits,
    filters:{
      developer:criteria.developer,
      property_type:criteria.property_type,
      budget_max:criteria.budget_max
    },
    result_count:matching.length,
    matching_project_count_total:matching.reduce(
      (sum,row)=>sum+row.matching_project_count,0
    ),
    current_batch_offset:start,
    has_more:start+results.length<matching.length,
    results
  };
}
