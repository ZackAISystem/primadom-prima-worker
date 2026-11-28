import { extractMemoryFacts } from "./memory.js";

// PT12: bounded, self-declared buyer preference fragments only. This is not
// a general intent classifier or a Search/Contact/Consent authority.
const PROFILE_FACTS = new Set([
  "bedrooms", "property_type", "preferred_location_text"
]);
const PREFERENCE_SENTENCE = /^(?:(?:i|we)\s+)?prefer\s+(?:(?:an?|the)\s+)?(?:\d{1,2}\s*[- ]?\s*(?:bedrooms?|beds?|br)|studio|apartment|villa|townhouse|penthouse|duplex)(?:\s+(?:apartment|villa|townhouse|penthouse|duplex))?(?:\s+(?:in|near|around)\s+[A-Za-z][A-Za-z0-9 .'-]{1,55})?\.?$/i;

export function classifyEllipticalBuyerPreferencePT12(message = "", languageCode = "en") {
  const text = String(message || "").trim().replaceAll("’", "'");
  if (languageCode !== "en" || !text || text.length > 160 ||
      /[?\n\r;]/.test(text) ||
      /\b(?:and|but|also|please|call|contact|message|email|whatsapp|send|schedule|book|agent|advisor|broker|appointment|viewing|search|list|show|compare|recommend|suggest|find|why|how|what|which|should|until|unless)\b/i.test(text) ||
      !PREFERENCE_SENTENCE.test(text)) return null;
  const normalized = /^(?:i|we)\s+prefer\b/i.test(text)
    ? text : `I ${text}`;
  const facts = extractMemoryFacts(normalized).filter(f =>
    PROFILE_FACTS.has(f?.fact_key) &&
    f?.fact_value !== null && f?.fact_value !== undefined &&
    String(f.fact_value).trim() !== "" &&
    Number(f?.confidence) >= 0.7
  );
  if (facts.length === 0 || facts.length > 3 ||
      new Set(facts.map(f => f.fact_key)).size !== facts.length ||
      facts.some(f => f.fact_key === "bedrooms" &&
        (!Number.isInteger(Number(f.fact_value)) || Number(f.fact_value) < 1 || Number(f.fact_value) > 20))) return null;
  return {
    version: "EllipticalBuyerPreferencePT12",
    facts: facts.map(f => ({...f, source:"pt12_explicit_preference_fallback"}))
  };
}
