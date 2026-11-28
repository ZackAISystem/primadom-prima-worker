import { requireSupportedLocale } from './locale-registry.mjs';
// Same original-language message; NO intermediate LLM translation.
export function localizedSearchEnvelope({locale, originalText, filters={}, canonicalEntities=[]}) {
  const language_code=requireSupportedLocale(locale);
  if(typeof originalText!=='string' || !originalText.trim())throw new Error('empty_query');
  if(typeof filters!=='object' || filters===null || Array.isArray(filters))throw new Error('invalid_filters');
  return {language_code,original_query:originalText,canonical_entities:canonicalEntities,filters};
}
// URLs come from Page Factory registry, never synthesized from a guessed slug.
export function localizedEntityUrl(registryRows, locale, canonicalGroupKey) {
  requireSupportedLocale(locale);
  const match=(registryRows||[]).find(r=>r.language_code===locale && r.canonical_group_key===canonicalGroupKey && typeof r.url_path==='string' && r.url_path.startsWith('/'+locale+'/'));
  return match?.url_path||null;
}
