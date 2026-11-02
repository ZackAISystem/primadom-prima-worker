
// D5_INTELLIGENT_SEARCH_V1
// Qualitative matching. No price, yield or ROI assumptions.

import { DISTRICT_INTELLIGENCE_V1 }
  from "./district-intelligence-v1.js";

import { DISTRICT_EMIRATES_V1 }
  from "./district-emirates-v1.js";

const norm = v => String(v || "").toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ").trim();

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

const traits = {
  family: /\b(family|families|children|child|kids|schools)\b/i,
  investment: /\b(invest|investment|investing|investors?|income)\b/i,
  waterfront: /\b(waterfront|beachfront|beach|coastal|seaside|island)\b/i,
  green: /\b(green|parks?|nature|landscaped)\b/i,
  quiet: /\b(quiet|calm|peaceful|tranquil)\b/i
};

const priceDependent =
  /\b(luxury|luxurious|premium|affordable|economy|economical|cheap|expensive|budget|aed|million|yield|roi|under|below|up to)\b/i;

const areaWords =
  /\b(districts?|areas?|neighbou?rhoods?|communities)\b/i;

const location =
  /\b(?:in|within)\s+(umm al quwain|ras al khaimah|abu dhabi|fujairah|sharjah|ajman|dubai|uaq|rak)\b/i;

export function parseDistrictIntelligenceQueryV1(query) {
  const q = String(query || "").trim();

  if (!q || q.length > 300 || !areaWords.test(q) ||
      priceDependent.test(q)) return null;

  const requested = Object.entries(traits)
    .filter(([, expression]) => expression.test(q))
    .map(([key]) => key);

  if (!requested.length) return null;

  const geo = q.match(location);

  return {
    version: "DistrictIntelligenceCriteriaV1",
    query: q,
    emirate: geo ? emirates[norm(geo[1])] || null : null,
    traits: requested
  };
}

function getEvidence(record, trait) {
  const family = String(record.family || "");
  const investment = String(record.investment || "");
  const bestFit = String(record.best_fit || "");

  const sources = [
    record.signals,
    record.lifestyle,
    record.profile,
    ...(Array.isArray(record.chips) ? record.chips : [])
  ].filter(Boolean).map(String);

  if (trait === "family") {
    const lens = norm(family);

    if (/\b(limited family focus|not family|low family focus)\b/
      .test(lens)) return null;

    if (!/\b(family oriented|family friendly|child friendly|schools nearby|spacious homes|family focused)\b/
      .test(lens)) return null;

    return [family,
      /\bfamilies\b/.test(norm(bestFit)) ? bestFit : ""
    ].filter(Boolean);
  }

  if (trait === "investment") {
    if (!/\binvestors?\b/.test(norm(bestFit)) ||
        !investment.trim() ||
        /\b(no investment focus|limited investment focus)\b/
          .test(norm(investment))) return null;

    return [investment, bestFit];
  }

  const patterns = {
    waterfront: /\b(waterfront|beachfront|beach|coastal|seaside|island)\b/,
    green: /\b(green|parks?|nature|landscaped)\b/,
    quiet: /\b(quiet|calm|peaceful|tranquil)\b/
  };

  const matches = sources.filter(
    x => patterns[trait]?.test(norm(x))
  );

  return matches.length ? matches.slice(0, 2) : null;
}

const display = slug => slug.split("-")
  .map(x => x.charAt(0).toUpperCase() + x.slice(1))
  .join(" ");

export function searchDistrictIntelligenceV1({
  query = "",
  offset = 0,
  batchSize = 3
} = {}) {
  const criteria = parseDistrictIntelligenceQueryV1(query);
  if (!criteria) return null;

  const start = Math.max(
    0, Math.min(1000, Math.trunc(Number(offset) || 0))
  );

  const size = Math.max(
    1, Math.min(10, Math.trunc(Number(batchSize) || 3))
  );

  const matches = [];

  for (const [slug, record] of
       Object.entries(DISTRICT_INTELLIGENCE_V1)) {
    const emirate = DISTRICT_EMIRATES_V1[slug];

    if (!emirate ||
        (criteria.emirate && emirate !== criteria.emirate)) {
      continue;
    }

    const evidence = {};
    let accepted = true;

    for (const trait of criteria.traits) {
      const facts = getEvidence(record, trait);

      if (!facts?.length) {
        accepted = false;
        break;
      }

      evidence[trait] = facts;
    }

    if (!accepted) continue;

    const score = criteria.traits.length * 10 +
      Object.values(evidence).reduce(
        (sum, facts) => sum + facts.length, 0
      );

    matches.push({
      entity_type: "district",
      slug,
      title: display(slug),
      canonical_url: `/en/areas/${slug}/`,
      emirate,
      evidence,
      score
    });
  }

  matches.sort((a, b) =>
    b.score - a.score ||
    a.title.localeCompare(b.title)
  );

  const results = matches.slice(start, start + size)
    .map((row, i) => ({
      ...row,
      rank: start + i + 1
    }));

  return {
    version: "DistrictDiscoveryV1",
    search_mode: "intelligent",
    language: "en",
    entity_type: "district",
    state: matches.length ? "results" : "empty",
    query: criteria.query,
    emirate: criteria.emirate,
    criteria: criteria.traits,
    evidence_status: "primadom_knowledge_descriptive",
    result_count: matches.length,
    current_batch_offset: start,
    results,
    has_more: start + results.length < matches.length
  };
}
