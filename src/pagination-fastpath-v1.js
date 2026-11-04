import { buildSearchRouteResponse } from "./search-response.js";

// Only an already-known local Search V3 batch qualifies. D5 remote pages
// have different continuation semantics and must stay on their D5 path.
// This module neither queries nor ranks the catalog; it only pages a
// canonical, bounded batch already supplied by the existing search bridge.
export function prepareFastProjectPaginationV1({message,context,original,turn}={}) {
  if (message !== "Show 3 more" ||
      turn?.version !== "ConversationTurnV1" ||
      turn?.phase !== "initial" ||
      !Number.isInteger(turn.turn_seq) || turn.turn_seq < 2 ||
      !/^[0-9a-f-]{20,}$/i.test(String(turn.turn_id || "")) ||
      original?.version !== "SearchContextV1" ||
      original?.source !== "primadom_project_search_v3" ||
      original?.entity_type !== "project" ||
      original?.language !== "en" ||
      original?.state !== "results" ||
      context?.version !== "SearchContextV1" ||
      context?.source !== "primadom_project_search_v3" ||
      context?.state !== "results" ||
      !Array.isArray(context.results) ||
      context.results.length < 4 || context.results.length > 10 ||
      !context.query ||
      !Number.isInteger(original.current_batch_offset) ||
      ![3,6,9].includes(original.current_batch_offset) ||
      original.current_batch_offset >= context.results.length ||
      original.current_batch_offset !== context.current_batch_offset ||
      context.results.some(item =>
        item.entity_type !== "project" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
        item.canonical_url !== "/en/projects/" + item.slug + "/"
      ) ||
      new Set(context.results.map(item=>item.slug)).size !== context.results.length
  ) return null;

  const result = buildSearchRouteResponse({
    route:"property_search",context:{search:context}
  });
  if (result?.response_type !== "search_results" ||
      result.pagination?.current_offset !== original.current_batch_offset ||
      !Array.isArray(result.cards) || !result.cards.length ||
      result.cards.length > 3 ||
      result.cards.some(item=>
        item.entity_type !== "project" ||
        item.canonical_url !== "/en/projects/"+item.slug+"/"
      )) return null;
  return result;
}
