export const NEXT_ACTIONS_V1 =
  Object.freeze({
    EXACT_FACT: "EXACT_FACT",
    KNOWLEDGE_QA: "KNOWLEDGE_QA",
    SEARCH: "SEARCH",
    COMPARE: "COMPARE",
    ADVISORY: "ADVISORY",
    PROFILE_UPDATE: "PROFILE_UPDATE",
    REFERENCE: "REFERENCE",
    CLARIFY: "CLARIFY",
    CONTACT: "CONTACT",
    PERSONA: "PERSONA",
    OFF_TOPIC: "OFF_TOPIC"
  });


export function decideNextActionV1({
  route,
  conversationMove = null,
  interpretation = null,
  clarification = null
} = {}) {
  if (route === "persona_question") {
    return {
      version: "DecisionPolicyV1",
      action: NEXT_ACTIONS_V1.PERSONA,
      reason: "explicit_persona_route"
    };
  }

  // Only a verified, resolved follow-up reference can select REFERENCE.
  // Never let contextual references hijack Search / Compare / Contact.
  if (
    route === "follow_up" &&
    conversationMove?.version === "ConversationMoveV1" &&
    conversationMove?.move_type === "reference" &&
    conversationMove?.effective_route === "follow_up" &&
    conversationMove?.reference?.resolved === true &&
    typeof conversationMove?.reference?.slug === "string" &&
    conversationMove.reference.slug.trim().length > 0 &&
    Number(conversationMove?.confidence) >= 0.95
  ) {
    return {
      version: "DecisionPolicyV1",
      action:
        NEXT_ACTIONS_V1.REFERENCE,
      reason:
        "conversation_reference"
    };
  }

  // Memory is a side effect, NOT permission to replace an actionable route.
  // A1/Interpreter own intent classification; no second semantic router here.
  const semanticMemoryUpdate =
    Array.isArray(interpretation?.memory_candidates) &&
    interpretation.memory_candidates.some(item =>
      typeof item?.key === "string" && item.key.trim() &&
      item?.value !== null && item?.value !== undefined &&
      String(item.value).trim() &&
      Number(item?.confidence) >= 0.8 &&
      Number(item?.confidence) <= 1
    );

  const semanticTasks = Array.isArray(interpretation?.tasks)
    ? interpretation.tasks : [];

  // No new external profile route. PROFILE_UPDATE is only a *pure*
  // memory update; mixed/actionable tasks retain their actual capability.
  // The installed index.js has a local acknowledgment for pure updates.
  if (
    semanticMemoryUpdate &&
    interpretation?.turn_kind === "profile_update" &&
    semanticTasks.length === 0 &&
    ["recommendation", "persona_question", "unsupported"].includes(route)
  ) {
    return {
      version: "DecisionPolicyV1",
      action: NEXT_ACTIONS_V1.PROFILE_UPDATE,
      reason: "pure_semantic_profile_update"
    };
  }

  // A real clarification for an unresolved route must not be OFF_TOPIC.
  // Known executable capabilities still attempt existing Registry/Knowledge.
  if (route === "unsupported" &&
      typeof clarification === "string" && clarification.trim()) {
    return {
      version: "DecisionPolicyV1",
      action: NEXT_ACTIONS_V1.CLARIFY,
      reason: "unresolved_request_clarification"
    };
  }

  switch (route) {
    case "exact_fact":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.EXACT_FACT,
        reason: "verified_fact_route"
      };

    case "property_search":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.SEARCH,
        reason: "property_search_route"
      };

    case "compare":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.COMPARE,
        reason: "comparison_route"
      };

    case "recommendation":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.ADVISORY,
        reason: "advisory_route"
      };

    case "contact_intent":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.CONTACT,
        reason: "contact_route"
      };

    case "unsupported":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.OFF_TOPIC,
        reason: "unsupported_route"
      };

    case "page_question":
    case "market_question":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.KNOWLEDGE_QA,
        reason: "knowledge_question_route"
      };

    case "follow_up":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.ADVISORY,
        reason: "open_conversation_follow_up"
      };

    case "clarification":
    case "clarify":
      return {
        version: "DecisionPolicyV1",
        action: NEXT_ACTIONS_V1.CLARIFY,
        reason: "clarification_route"
      };
  }

  if (clarification) {
    return {
      version: "DecisionPolicyV1",
      action: NEXT_ACTIONS_V1.CLARIFY,
      reason: "no_actionable_route"
    };
  }

  // Unknown routes must not become an unsolicited Recommendation/Composer.
  return {
    version: "DecisionPolicyV1",
    action: NEXT_ACTIONS_V1.OFF_TOPIC,
    reason: "unknown_route_safe_fallback"
  };
}

export function routeForNextActionV1(
  nextAction,
  currentRoute
) {
  switch (nextAction?.action) {
    case NEXT_ACTIONS_V1.PERSONA:
      return "persona_question";

    case NEXT_ACTIONS_V1.EXACT_FACT:
      return "exact_fact";

    case NEXT_ACTIONS_V1.KNOWLEDGE_QA:
      return [
        "page_question",
        "market_question"
      ].includes(currentRoute)
        ? currentRoute
        : "page_question";

    case NEXT_ACTIONS_V1.SEARCH:
      return "property_search";

    case NEXT_ACTIONS_V1.COMPARE:
      return "compare";

    case NEXT_ACTIONS_V1.ADVISORY:
      return [
        "recommendation",
        "follow_up"
      ].includes(currentRoute)
        ? currentRoute
        : "recommendation";

    case NEXT_ACTIONS_V1.PROFILE_UPDATE:
      // Reuse an existing zero-tool route for acknowledging pure memory.
      // Do not relabel a profile update as Recommendation/Search/Funnel.
      return "persona_question";

    case NEXT_ACTIONS_V1.CONTACT:
      return "contact_intent";

    case NEXT_ACTIONS_V1.OFF_TOPIC:
      return "unsupported";

    case NEXT_ACTIONS_V1.REFERENCE:
    case NEXT_ACTIONS_V1.CLARIFY:
    default:
      return currentRoute;
  }
}
