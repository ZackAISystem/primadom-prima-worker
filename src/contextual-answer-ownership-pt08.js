/*
 * PT08 — Registry identity is evidence, not a substitute for answering the
 * user's independent question. This helper is intentionally *post-policy*:
 * it cannot change Search, Contact, fact verification, entity identity or DB.
 * It handles only a previous Registry-generated missing-name clarification.
 */
export function recoverContextualAnswerPT08({
  message = '', action = null, resolution = null, clarification = null
} = {}) {
  const text = String(message || '').trim();
  const rejected = String(clarification || '');
  if (!text || text.length > 500 || resolution?.status !== 'not_found' ||
      typeof resolution?.entity_name !== 'string' ||
      !rejected.startsWith(`I couldn't match ${resolution.entity_name} to the Primadom knowledge base.`) ||
      ['SEARCH', 'PAGE_MORE', 'RESUME_SEARCH', 'CONTACT', 'CONTACT_HANDOFF'].includes(action)) {
    return null;
  }

  // Deferred coordination is never authorization to send personal details.
  const processRequest = /\b(?:viewing|visit|appointment|handoff|property tour)\b/i.test(text);
  const withheldConsent = /\b(?:do not|don't|never|not yet)\b[^.!?]{0,100}\b(?:send|submit|share|forward|contact|dispatch)\b|\b(?:send|submit|share|forward|contact|dispatch)\b[^.!?]{0,65}\b(?:until|before)\s+(?:i|we)\s+(?:approve|confirm|authori[sz]e)\b/i.test(text);
  if (processRequest && withheldConsent) {
    return {
      kind: 'deferred_process',
      answer: "I can help you prepare for a viewing and clarify the property, preferred time and contact method. I won't send a request or share your details now. You can review the details first, and nothing will be submitted without your explicit approval."
    };
  }

  // A question about the evidence available in *this conversation* is not a
  // request for an invented verification of an unknown listing or project.
  const sourceLimited = /\b(?:from|based\s+(?:only|solely)?\s*on)\s+(?:this|the|our)\s+(?:chat|conversation|messages|listing|brochure)(?:\s+alone|\s+only)?\b/i.test(text);
  const asksAbilityToConfirm = /\b(?:can|could|would)\s+(?:you|we)\s+(?:confirm|verify|validate|establish)|\b(?:possible|enough|sufficient)\s+to\s+(?:confirm|verify)\b/i.test(text);
  if (sourceLimited && asksAbilityToConfirm) {
    return {
      kind: 'source_limit',
      answer: "No. I can't confirm a project-specific payment plan or other official terms from this conversation alone. We would need the exact project's current developer documentation and the relevant reservation agreement or SPA. A location or marketing description is not sufficient verification."
    };
  }

  const retrospectiveVerification = /^(?:did|have|has|was|were)\s+(?:we|you|the\s+(?:project|listing|identity|developer))\b[^?]{0,130}\b(?:verif(?:y|ied)|confirm(?:ed)?|establish(?:ed)?|identif(?:y|ied)|match(?:ed)?)\b/i.test(text);
  const identityQuestion = /\b(?:registered|unique|identit(?:y|ies)|projects?|developers?|registration|official record)\b/i.test(text);
  if (retrospectiveVerification && identityQuestion) {
    return {
      kind: 'verification_status',
      answer: "No unique registered project has been verified from the information available in this conversation. The listing name or nearby area alone is not proof of identity; we'd need an official project identifier or matching developer documentation before treating it as verified."
    };
  }

  // A quoted location clue is context, not a project identity.
  const listingCue = /\b(?:listing|advert(?:isement)?|brochure|description|marketing material|agent's message)\b[^.!?]{0,130}\b(?:says?|states?|claims?|mentions?|lists?)\b[^.!?]{0,130}\b(?:near|around|close to|next to|by|in the vicinity of)\b/i.test(text);
  if (listingCue && !/[?]/.test(text)) {
    return {
      kind: 'listing_location_clue',
      answer: "That is only a location clue from the listing. 'Near' an area does not establish the property's registered project identity, developer or exact address. We should request an official project or building identifier before making that match."
    };
  }

  // Preference statements should not become Registry project lookups or an
  // unrequested property Search. This doesn't itself persist a user fact.
  const statedPreference = /^(?:prefer\b|(?:i|we)(?:'d|\s+would)?\s+prefer\b|(?:my|our)\s+(?:preference|preferred)\b)/i.test(text);
  const propertyCriterion = /\b(?:\d+[- ]?bed(?:room)?s?|studio|apartments?|villas?|townhouses?|penthouses?|homes?|budget|location|area|district|community)\b|\b(?:in|near|around)\s+[A-Z][A-Za-z]+/i.test(text);
  const requestForSpecificFactOrSearch = /[?]|\b(?:find|search|show|list|recommend|compare|verify|confirm|registered|official|live|availability|price|payment plan|service charge|fees?|handover|title deed)\b/i.test(text);
  if (statedPreference && propertyCriterion && !requestForSpecificFactOrSearch) {
    return {
      kind: 'preference_context',
      answer: "Noted — I'll treat that as a property and location preference, not as the identity of a verified project. I won't start a property search unless you ask for one."
    };
  }
  return null;
}
