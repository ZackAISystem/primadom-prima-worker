// Additive, pure helpers for future locale integrations. Does not change EN Worker.
export const SUPPORTED_TRANSLATION_LANGUAGES = Object.freeze(['ru','hi','zh','es','fr','de','ar']);
export const LOCALE_META = Object.freeze({
  ru:Object.freeze({tag:'ru-RU',dir:'ltr'}),
  hi:Object.freeze({tag:'hi-IN',dir:'ltr'}),
  zh:Object.freeze({tag:'zh-CN',dir:'ltr'}),
  es:Object.freeze({tag:'es-ES',dir:'ltr'}),
  fr:Object.freeze({tag:'fr-FR',dir:'ltr'}),
  de:Object.freeze({tag:'de-DE',dir:'ltr'}),
  ar:Object.freeze({tag:'ar-AE',dir:'rtl'})
});
export function pageLanguage(pathname) {
  const m = String(pathname || '').match(/^\/(ru|hi|zh|es|fr|de|ar)(?:\/|$)/i);
  return m ? m[1].toLowerCase() : 'en';
}
export function requireSupportedLocale(code) {
  const normalized=String(code||'').trim().toLowerCase();
  if (!SUPPORTED_TRANSLATION_LANGUAGES.includes(normalized)) throw new Error('unsupported_locale');
  return normalized;
}
export function requireEnabled(manifest) {
  if (!manifest || manifest.is_enabled !== true || !SUPPORTED_TRANSLATION_LANGUAGES.includes(manifest.code)) {
    throw new Error('locale_not_enabled');
  }
  if (!manifest.api_origin || !manifest.search_bridge_origin) throw new Error('locale_runtime_not_configured');
  return manifest;
}
