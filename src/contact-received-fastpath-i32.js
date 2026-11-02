/*
 * PRIMA I32 — Expected Contact Fast Path, EN, read-only preflight.
 * No storage or authorization is performed here. The existing H ContactCapture,
 * P0 consent, Memory and I31 Lead RPC remain the authorities downstream.
 */

const EMAIL_ONLY = /^(?:(?:(?:my\s+)?e-?mail(?:\s+address)?\s*(?:(?:is)\s+|:\s*)|please\s+use\s+))?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63})\s*[.!]?\s*$/i;
const PHONE_ONLY = /^(?:(?:(?:my\s+)?(?:phone|whats\s*app|whatsapp|mobile|number)(?:\s+number)?\s*(?:(?:is)\s+|:\s*)|please\s+use\s+))?((?:\+\s*|00\s*)\d[\d\s().-]{5,}\d)\s*[.!]?\s*$/i;

function lastFactValue(facts, key) {
  if (!Array.isArray(facts)) return null;
  for (let i = facts.length - 1; i >= 0; i--) {
    if (facts[i]?.fact_key === key) return facts[i]?.fact_value ?? null;
  }
  return null;
}

/**
 * This helper can only IDENTIFY a candidate for a fast path.
 * The caller must additionally invoke the unchanged H ContactCapture preflight
 * and require captured=true. For phone, H verifies libphonenumber validity.
 */
export function expectedContactOnlyI32({
  message = '', activeMemory = [], recentMessages = [],
  turn = null, languageCode = 'en'
} = {}) {
  if (languageCode !== 'en' || turn?.phase === 'tool_continuation' ||
      !Number.isInteger(turn?.turn_seq) || turn.turn_seq < 2) return false;

  const state = lastFactValue(activeMemory, 'funnel_state');
  if (state?.status !== 'handoff_accepted') return false;

  // Require a recent, persisted contact-request response from THIS conversation,
  // not merely an old funnel flag or arbitrary frontend-supplied state.
  if (!Array.isArray(recentMessages) || recentMessages.length < 2) return false;
  const last = [...recentMessages].reverse().find(row =>
    row && (row.role === 'assistant' || row.role === 'user'));
  if (last?.role !== 'assistant' || last.route !== 'contact_intent' ||
      last.response_type !== 'lead_transition') return false;

  const s = String(message || '').trim();
  if (!s || s.length > 190 || /[\r\n]/.test(s)) return false;
  // No new buyer task, disclaimer, questions, contact cancellation or opt-out
  // can slip into a deterministic contact-only confirmation.
  if (/[?]/.test(s) || /\b(?:don't|do not|never|stop|cancel|unsubscribe|no contact|no calls|don't call|don't email)\b/i.test(s)) return false;

  const isEmail = EMAIL_ONLY.test(s);
  const isPhone = PHONE_ONLY.test(s);
  if (Number(isEmail) + Number(isPhone) !== 1) return false;

  const preferred = lastFactValue(activeMemory, 'preferred_contact_channel');
  if (preferred === 'email' && !isEmail) return false;
  if (['phone', 'whatsapp'].includes(preferred) && !isPhone) return false;
  return true;
}
