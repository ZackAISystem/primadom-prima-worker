// RU-only deterministic route selection. Never translate the user's message
// into English or call an LLM to translate. Semantic downstream remains in Core.
import { interpretRussianRequest } from './ru-intent-v1.js';
import { routeIntent as routeIntentEN } from './router.js';

export function routeIntentRuV1(message = '', context = {}) {
  const original = String(message || '');
  const normalized = original.toLocaleLowerCase('ru-RU');
  const parsed = interpretRussianRequest(original);
  // A reference to an English-named project is valid in a Russian conversation.
  // Unknown Russian free text goes to Core semantic interpretation, not a fake search.
  const mapping = Object.freeze({
    property_search: 'property_search',
    developer_search: 'property_search',
    district_search: 'property_search',
    project_relation_search: 'property_search',
    compare: 'compare',
    contact_intent: 'contact_intent',
    contact_opt_out: 'follow_up',
    decision_shortlist: 'follow_up',
    decision_reject: 'follow_up',
    search_more: 'follow_up'
  });
  if (/(?:кто\s+ты|кто\s+такая\s+прима|что\s+такое\s+(?:prima|прима)|расскажи\s+о\s+(?:себе|prima|прима)|кто\s+создал\s+(?:prima|прима))/u.test(normalized)) {
    return 'persona_question';
  }
  if (/^(?:привет|здравствуйте|добрый\s+(?:день|вечер)|доброе\s+утро)[!?.\s]*$/u.test(normalized)) {
    return 'persona_question';
  }
  if (Object.hasOwn(mapping, parsed.intent)) return mapping[parsed.intent];
  // A pure Latin search can still be understood by the existing router,
  // while RU output language is fixed by the RU Worker/page contract.
  return routeIntentEN(original, context);
}
