/*
  MEM19 — Canonical, fail-closed location text normalization.
  Property-location phrases can carry a separate numeric budget suffix,
  e.g. "Dubai Marina under AED 5 million". The location fact is ONLY
  the location; budget remains in budget_max_aed. No dictionary guesses,
  inference from different conversations, database writes or model calls.
*/
export function normalizePreferredLocationTextV1(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/g, '').replace(/\s+/g, ' ');
  if (!text || text.length > 100) return null;

  // Remove ONLY a trailing, explicit numeric price constraint.
  text = text.replace(
    /\s+(?:under|below|up\s+to|at\s+most|no\s+more\s+than|with\s+(?:a\s+)?(?:max(?:imum)?\s+)?budget(?:\s+of)?)\s+(?:(?:AED|DHS?|DH)\s*)?[\d,]+(?:\.\d+)?\s*(?:millions?|m|thousands?|k)?\s*$/i,
    ''
  ).trim();

  // Fail closed when a location is still entangled with a price/filter.
  if (text.length < 2 || text.length > 80 ||
      !/^[\p{L}][\p{L}\p{N} '.-]*$/u.test(text) ||
      /\b(?:under|below|up\s+to|at\s+most|no\s+more\s+than|budget|AED|DHS?|millions?|thousands?|bedrooms?)\b/i.test(text) ||
      /\b\d{5,}\b/.test(text) ||
      /\b(?:show|find|recommend|compare|book|search|looking|apartment|villa|property|project)s?\b/i.test(text) ||
      /^(?:something|anything|it|this|that|this project|that project)$/i.test(text)) {
    return null;
  }
  return text;
}
