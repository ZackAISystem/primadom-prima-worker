export const TOOL_REGISTRY_V1 = Object.freeze({
  structured_lookup: Object.freeze({
    id: "structured_lookup",
    enabled: true,
    purpose: "Read exact structured facts from Primadom knowledge."
  }),

  knowledge_retrieve: Object.freeze({
    id: "knowledge_retrieve",
    enabled: true,
    purpose: "Retrieve relevant Primadom knowledge for reasoning."
  }),

  prima_search: Object.freeze({
    id: "prima_search",
    enabled: true,
    purpose: "Use the existing Primadom commercial property search layer."
  }),

  conversation_context: Object.freeze({
    id: "conversation_context",
    enabled: true,
    purpose: "Use recent conversation state and discussed entities."
  }),

  client_memory: Object.freeze({
    id: "client_memory",
    enabled: true,
    purpose: "Use approved reusable client memory facts."
  }),

  lead_start: Object.freeze({
    id: "lead_start",
    enabled: true,
    purpose: "Transition into the existing Primadom lead flow."
  })
});


const ROUTE_TOOLS = Object.freeze({
  exact_fact: [
    "structured_lookup"
  ],

  page_question: [
    "knowledge_retrieve"
  ],

  market_question: [
    "knowledge_retrieve"
  ],

  compare: [
    "knowledge_retrieve"
  ],

  property_search: [
    "prima_search"
  ],

  recommendation: [
    "knowledge_retrieve",
    "prima_search",
    "client_memory"
  ],

  follow_up: [
    "conversation_context",
    "client_memory"
  ],

  contact_intent: [
    "lead_start",
    "conversation_context"
  ],

  unsupported: []
});


export function getAllowedTools(route) {
  const ids =
    ROUTE_TOOLS[route] || [];

  return ids
    .map(id => TOOL_REGISTRY_V1[id])
    .filter(tool => tool?.enabled === true);
}


export function canUseTool(route, toolId) {
  return getAllowedTools(route)
    .some(tool => tool.id === toolId);
}


export function getToolIds(route) {
  return getAllowedTools(route)
    .map(tool => tool.id);
}
