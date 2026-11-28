export const TOOL_REGISTRY_V1 = Object.freeze({
  structured_lookup: Object.freeze({
    id: "structured_lookup",
    enabled: true,
    purpose: "Получить точные структурированные факты из базы знаний Primadom."
  }),

  knowledge_retrieve: Object.freeze({
    id: "knowledge_retrieve",
    enabled: true,
    purpose: "Получить релевантные знания Primadom для анализа."
  }),

  prima_search: Object.freeze({
    id: "prima_search",
    enabled: true,
    purpose: "Использовать существующий коммерческий поиск недвижимости Primadom."
  }),

  conversation_context: Object.freeze({
    id: "conversation_context",
    enabled: true,
    purpose: "Использовать недавнее состояние диалога и обсуждённые сущности."
  }),

  client_memory: Object.freeze({
    id: "client_memory",
    enabled: true,
    purpose: "Использовать утверждённые повторно применимые факты памяти клиента."
  }),

  lead_start: Object.freeze({
    id: "lead_start",
    enabled: true,
    purpose: "Перейти в существующий процесс обработки лида Primadom."
  })
});


const ROUTE_TOOLS = Object.freeze({
  exact_fact: [
    "structured_lookup"
  ],

  page_question: [
    "knowledge_retrieve"
  ],

  // Current market claims require a verified/live source.
  // Until that source is connected, market questions use
  // the deterministic Market Guard and no retrieval/LLM.
  market_question: [],

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
    "knowledge_retrieve",
    "conversation_context",
    "client_memory"
  ],

  contact_intent: [
    "lead_start",
    "conversation_context"
  ],

  persona_question: [],

  unsupported: []
});


export function getAllowedTools(route) {
  // Only own, declared routes have tool permissions. Arbitrary values such as
  // "constructor" must not resolve inherited Object.prototype properties.
  // Unknown Persona/semantic routes fail closed without throwing.
  const ids =
    typeof route === "string" &&
    Object.prototype.hasOwnProperty.call(ROUTE_TOOLS, route)
      ? ROUTE_TOOLS[route]
      : [];

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
