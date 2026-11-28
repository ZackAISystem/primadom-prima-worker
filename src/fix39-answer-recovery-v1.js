// FIX39-08 — Conservative answer recovery; not an entity resolver or authorizer.
// Factual claims always remain unverified unless the existing evidence pipeline validates them.
export function buildFix39AnswerRecoveryV1({
  message = "", route = "", action = "", resolution = null,
  interpretation = null, semanticContact = false,
  contactBlocked = false, leadPending = false
} = {}) {
  if (contactBlocked || leadPending) return null;
  const q = String(message || "").trim();
  if (!q || q.length > 1200) return null;
  const tasks = Array.isArray(interpretation?.tasks) ? interpretation.tasks : [];
  const entities = Array.isArray(interpretation?.entities) ? interpretation.entities : [];
  const identified = entities.find(e => e?.role === "primary") || (entities.length === 1 ? entities[0] : null);
  const unresolved = ["not_found", "ambiguous"].includes(resolution?.status);
  const topic = String(resolution?.entity_name || identified?.name || "that listing").trim().slice(0, 110);
  const asksMethod = /\b(?:how|which steps|what steps|what process|what is the process|what checks|what documents|what should i check)\b/i.test(q) &&
    /\b(?:verify|confirm|identify|authenticate|establish|check|validate)\b/i.test(q);
  // Methodology can be explained without asserting the named project exists.
  if (unresolved && action === "KNOWLEDGE_QA" && ["page_question", "market_question"].includes(route) &&
      identified?.type === "project" && asksMethod && tasks.length <= 2) {
    return `To identify which project the listing refers to, compare the advertised name with its full address, developer, building or phase and official registration details. Check those identifiers against the developer's documents and the relevant land-registry records; ask the listing agent for the registered project name or project number. I haven't independently verified that ${topic} matches a specific registered project, so I wouldn't assume a match from the marketing name alone.`;
  }
  // District-level identity never proves a particular building's liabilities.
  const liabilityClaim = /\b(?:service[ -]?charges?|liabilit(?:y|ies)|outstanding dues?|arrears|debt|no dues?)\b/i.test(q);
  if (["CLARIFY", "EXACT_FACT"].includes(action) && route === "exact_fact" &&
      identified?.type === "district" && liabilityClaim &&
      /\b(?:building|tower|property|unit)\b/i.test(q)) {
    return "A district name does not identify a particular building or prove that it has no outstanding service-charge liabilities. I can't certify any building as debt-free from the information available here. Please identify the building and obtain an up-to-date service-charge statement or clearance from the authorized management body, then verify it with the appropriate official records before relying on the claim.";
  }
  // A missing property identifier is not a reason to pretend that a current fact was checked.
  const missingNamedTarget = /\b(?:haven't|have not|hasn't|has not|didn't|did not|not yet|without|unnamed|unspecified)\b[\s\S]{0,45}\b(?:named|identified|specified|provided|project|property|building|name)\b/i.test(q);
  const asksWhatIsMissing = /\b(?:which|what)\s+(?:detail|information|identifier|name|item)\b/i.test(q);
  if (action === "CLARIFY" && route === "exact_fact" && (missingNamedTarget || asksWhatIsMissing) &&
      /\b(?:project|property|building|development)\b/i.test(q) &&
      /\b(?:fees?|charges?|costs?|price|handover|availability|registration)\b/i.test(q)) {
    return "I need the specific project name first, and, where relevant, the building or phase. Only then can I check which fees apply against current official or developer documentation. I can't verify project-specific charges from an unnamed project.";
  }
  // Contact answers preserve the requested channel/scope without ever authorizing a lead.
  if (semanticContact && route === "contact_intent" && action === "CLARIFY") {
    const wantsProcess = /\b(?:how|process|steps|procedure|what happens|handoff|works?)\b/i.test(q) &&
      /\b(?:advis(?:er|or)|specialist|contact|handoff|speak|call|referral)\b/i.test(q);
    if (wantsProcess) return "A specialist handoff starts by confirming the property or question you want help with and your preferred contact method. Before any request is submitted, your contact details and permission must be verified. The team can then follow up about that specific request; I haven't initiated a handoff. Which property or topic should the discussion cover?";
    const channel = /\bemail\b/i.test(q) ? "email" : /\bwhatsapp\b/i.test(q) ? "WhatsApp" : /\b(?:phone|callback|call)\b/i.test(q) ? "phone" : null;
    const viewingOnly = /\b(?:only|solely|just)\b[\s\S]{0,55}\bviewing\b|\bviewing\b[\s\S]{0,55}\b(?:only|solely|just)\b/i.test(q);
    const channelText = channel ? `You've specified ${channel} as your preferred contact channel. ` : "";
    const scopeText = viewingOnly ? "I'll keep the request scoped to the viewing, not general marketing. " : "";
    return `I can help with a property-specific follow-up. ${channelText}${scopeText}Which project or topic is this about? I won't submit a contact request without the required details and verified authorization.`;
  }
  return null;
}
