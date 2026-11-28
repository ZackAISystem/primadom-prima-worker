// R2.2 Phase B2. Pure assembly only. No independent routing, DB calls,
// search execution, authorization changes, or external side effects.
const MAX_CARDS = 3;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function short(value, limit) {
  return typeof value === "string" ? value.trim().slice(0,limit) : "";
}
function validated(cards) {
  if (!Array.isArray(cards) || cards.length > MAX_CARDS) return null;
  const seen = new Set();
  const rows=[];
  for (const card of cards) {
    const slug = short(card?.slug, 140);
    if (card?.entity_type !== "project" || !SAFE_SLUG.test(slug) ||
      short(card?.canonical_url, 300) !== `/en/projects/${slug}/` &&
      short(card?.canonical_url, 300) !== `/en/projects/${slug}` ||
      seen.has(slug)) return null;
    seen.add(slug);
    rows.push({
      title:short(card?.facts?.title,120) || slug.replaceAll("-"," "),
      district:short(card?.facts?.district,100),
      developer:short(card?.facts?.developer,100),
      price:short(card?.facts?.price_display,70)
    });
  }
  return rows;
}
export function prepareVerifiedCompoundComparisonV1({message, evidencePack, search, cards}={}) {
  if (typeof message !== "string" || !message.trim() || message.length > 6000 ||
      !evidencePack || typeof evidencePack !== "object" ||
      search?.version !== "SearchContextV1" ||
      search?.language !== "en" || search?.entity_type !== "project" ||
      !["results","empty"].includes(search?.state) ||
      !Array.isArray(search?.results)) return null;
  const rows = validated(cards);
  if (!rows || (search.state === "empty" && rows.length) ||
    (search.state === "results" && !rows.length) ||
    cards.some(c => !search.results.some(r => r?.slug === c?.slug &&
      r?.entity_type === "project" && r?.canonical_url === c?.canonical_url))) return null;
  const items=rows.map(r=>({value:
    `Verified catalog project: ${r.title}.`+
    (r.district?` District: ${r.district}.`:"")+
    (r.developer?` Developer: ${r.developer}.`:"")+
    (r.price?` Catalog display price: ${r.price} (not live availability).`:"")
  }));
  return {
    ...evidencePack,
    question:message,
    route:"compare",
    sources:[...(Array.isArray(evidencePack.sources)?evidencePack.sources:[]).slice(0,6),
      {role:"verified_catalog_search",entity_type:"project",items}],
  };
}
export function combineVerifiedCompoundComparisonV1({comparisonAnswer,searchAnswer,cards}={}) {
  if (typeof comparisonAnswer !== "string") return null;
  const text=comparisonAnswer.trim();
  if (text.length < 45 || text.length > 5000 || !validated(cards)) return null;
  // The existing Search response retains full responsibility for pagination
  // and the verified cards. Append its status only; never synthesize cards.
  const footer=typeof searchAnswer === "string" ? searchAnswer.trim() : "";
  return footer ? `${text}\n\n${footer}` : text;
}
