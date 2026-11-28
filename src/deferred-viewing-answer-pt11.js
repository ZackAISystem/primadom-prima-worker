import { isDeferredContactSubmissionV1 } from './contact-routing-safety-v1.js';
/*
 * PT11: answers questions about a deferred viewing workflow using only
 * evidence the buyer has provided in recent conversation messages.
 * Never infers authorization, starts Contact/Search, or makes a market claim.
 */
function userHistory(recent) {
  return (Array.isArray(recent) ? recent : [])
    .filter(row => row?.role === 'user' && typeof row.content === 'string')
    .map(row => row.content.trim()).filter(Boolean).slice(-12);
}
function hasViewingContext(items) {
  return items.some(s => /\b(?:viewing|property visit|site visit|property tour|tour a property|see a property)\b/i.test(s));
}
function deferredEarlier(items) {
  return items.some(isDeferredContactSubmissionV1);
}
function safeArea(items, facts) {
  // Prefer the most recent explicit viewing area over unrelated saved areas.
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i];
    if (!/\b(?:viewing|visit|tour)\b/i.test(s)) continue;
    const m = s.match(/\b(?:in|around|near)\s+([A-Z][A-Z0-9]{1,9})(?=[\s.,!?]|$)/);
    if (m) return m[1];
  }
  const fromMemory = [...(Array.isArray(facts) ? facts : [])].reverse()
    .find(f => f?.fact_key === 'preferred_location_text')?.fact_value;
  if (typeof fromMemory === 'string' && /^[\p{L}0-9][\p{L}0-9 &'’-]{1,65}$/u.test(fromMemory)) return fromMemory;
  return null;
}
function preferredWhatsAppQuestion(s) {
  const preference = /\b(?:i|we)\s+(?:would\s+)?prefer\s+whats\s*app\b/i.test(s);
  const asksStatus = /\b(?:can|could)\s+you\s+(?:confirm|summari[sz]e|tell me)\b|\bwhat\s+(?:you|we)\s+have\b/i.test(s);
  const asksMissing = /\b(?:missing|still\s+need|don't\s+have|do\s+not\s+have)\b/i.test(s);
  return preference && asksStatus && asksMissing;
}
function safeFactExists(facts, key) {
  return (Array.isArray(facts) ? facts : []).some(f =>
    f?.fact_key === key && typeof f.fact_value === 'string' && f.fact_value.trim());
}
// A prior explicit hold remains binding on follow-up questions and channel
// updates. Only a later *explicit* final-details approval plus send instruction
// can clear it. This is a consent restriction, never a new authorization.
export function hasDeferredViewingHoldPT11({message = '', recentMessages = []} = {}) {
  const history = userHistory(recentMessages);
  if (!hasViewingContext(history)) return false;
  const current = String(message || '').trim().replace(/[’]/g, "'");
  const finalApproval = text =>
    /\b(?:i|we)\s+(?:explicitly\s+)?approv(?:e|ed)\s+(?:the\s+)?final\s+details\b/i.test(text) &&
    /\b(?:send|submit|forward)\s+(?:the|this|my|our)?\s*(?:viewing\s+)?(?:request|details|form)\b/i.test(text) &&
    !isDeferredContactSubmissionV1(text);
  // Current instruction always wins over previous approval.
  if (isDeferredContactSubmissionV1(current)) return true;
  if (finalApproval(current)) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    if (finalApproval(history[i])) return false;
    if (isDeferredContactSubmissionV1(history[i])) return true;
  }
  return false;
}
export function extractViewingChannelFactPT11({message = '', recentMessages = []} = {}) {
  const text=String(message || '').trim();
  const history=userHistory(recentMessages);
  if (!hasViewingContext(history) || !deferredEarlier(history) ||
      !preferredWhatsAppQuestion(text)) return null;
  // A stated communication preference is not a contact request or consent.
  return {fact_key:'preferred_contact_channel',fact_value:'whatsapp',
    confidence:0.99,source:'pt11_explicit_channel_preference'};
}
export function recoverDeferredViewingAnswerPT11({
  message = '', language = 'en', recentMessages = [], activeFacts = [],
  action = null, authorizedContact = false, searchPending = false,
  contactCaptured = false, leadPending = false
} = {}) {
  const text=String(message || '').trim().replace(/[’]/g,"'");
  if (language !== 'en' || !text || text.length > 500 ||
      authorizedContact || searchPending || contactCaptured || leadPending ||
      ['SEARCH','PAGE_MORE','RESUME_SEARCH','CONTACT','CONTACT_HANDOFF'].includes(action)) return null;
  const history=userHistory(recentMessages);
  if (!hasViewingContext(history)) return null;
  if (preferredWhatsAppQuestion(text) && deferredEarlier(history)) {
    const area=safeArea(history,activeFacts);
    const hasNumber=safeFactExists(activeFacts,'contact_phone');
    const location=area ? ` around ${area}` : '';
    const missingNumber=hasNumber ? '' : ' and the WhatsApp number you want us to use';
    return {kind:'deferred_viewing_details',answer:
      `From our conversation, you are considering a viewing${location}, and you prefer WhatsApp. `+
      `We still need to confirm the exact property or unit and your preferred date and time${missingNumber}. `+
      `This remains a draft: I won't submit a request or share your details without your explicit approval of the final details.`};
  }
  if (isDeferredContactSubmissionV1(text) &&
      /\b(?:approv(?:e|al)|confirm|authori[sz]e)\b/i.test(text)) {
    return {kind:'explicit_no_send',answer:
      "Understood. I won't send or submit a viewing request, or share your details, until you explicitly approve the final details. We can continue preparing them here."};
  }
  return null;
}
