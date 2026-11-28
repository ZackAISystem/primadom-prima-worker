export const NEXT_ACTIONS_V1 =
  Object.freeze({
    EXACT_FACT: "EXACT_FACT",
    KNOWLEDGE_QA: "KNOWLEDGE_QA",
    SEARCH: "SEARCH",
    PAGE_MORE: "PAGE_MORE",
    MEMORY_RECALL: "MEMORY_RECALL",
    RESUME_SEARCH: "RESUME_SEARCH",
    COMPARE: "COMPARE",
    ADVISORY: "ADVISORY",
    PROFILE_UPDATE: "PROFILE_UPDATE",
    REFERENCE: "REFERENCE",
    CLARIFY: "CLARIFY",
    CONTACT: "CONTACT",
    PERSONA: "PERSONA",
    OFF_TOPIC: "OFF_TOPIC"
  });


// R2.5: canonical-route reconciliation is signal resolution, not execution.
// A completed, high-confidence Luna interpretation must not be downgraded
// by an earlier Router/fast-gate fallback. The typed Interpreter still owns
// recovery when Luna has low confidence, errors or delegates.
export function reconcileSemanticRouteV12({
  interpretedRoute = null,
  deterministicRoute = null,
  lunaRouteAuthoritative = false,
  pureProfileUpdate = false
} = {}) {
  const canonical = new Set([
    "exact_fact", "page_question", "market_question", "compare",
    "property_search", "recommendation", "follow_up", "contact_intent",
    "persona_question", "unsupported"
  ]);
  if (!canonical.has(interpretedRoute)) {
    return {route: deterministicRoute, clearClarification: false,
      reason: "no_canonical_interpretation"};
  }
  if (lunaRouteAuthoritative) {
    return {route: interpretedRoute, clearClarification: false,
      reason: "luna_semantic_route_authoritative"};
  }
  // Preserve legacy precedence: pure profile normalization historically
  // ran after (and could supersede) the in-domain unsupported fallback.
  if (pureProfileUpdate) {
    return {route: "recommendation", clearClarification: true,
      reason: "legacy_interpreter_profile_bridge"};
  }
  if (interpretedRoute === "unsupported" &&
      deterministicRoute !== "unsupported") {
    return {route: deterministicRoute, clearClarification: true,
      reason: "legacy_interpreter_domain_recovery"};
  }
  return {route: interpretedRoute, clearClarification: false,
    reason: "legacy_typed_interpreter"};
}

export function decideNextActionV1({
  route,
  conversationMove = null,
  interpretation = null,
  clarification = null,
  lunaDecision = null,
  lunaInterpretation = null,
  contactAuthorization = null,
  informationalContactInquiry = false
} = {}) {
  const planned=lunaDecision?.next_action;
  // V1.2 S3.1: the model's *validated semantic route* is authoritative for
  // action selection. The old Router route is a recovery hint, not a veto.
  // This does not grant the model authority over Contact, Registry identity,
  // consent, verified facts, or any executor. Those stay in the Worker.
  const routeActions={
    property_search:new Set(["SEARCH","CLARIFY","PAGE_MORE","RESUME_SEARCH"]),
    recommendation:new Set(["ADVISORY","SEARCH","CLARIFY","PAGE_MORE","MEMORY_RECALL","RESUME_SEARCH"]),
    compare:new Set(["COMPARE","CLARIFY"]),
    exact_fact:new Set(["EXACT_FACT","KNOWLEDGE_QA","CLARIFY"]),
    page_question:new Set(["KNOWLEDGE_QA","ADVISORY","CLARIFY"]),
    market_question:new Set(["KNOWLEDGE_QA","ADVISORY","CLARIFY"]),
    persona_question:new Set(["PERSONA","CLARIFY"]),
    follow_up:new Set(["ADVISORY","CLARIFY","PAGE_MORE","MEMORY_RECALL","RESUME_SEARCH"]),
    unsupported:new Set(["CLARIFY"])
  };
  // Consent is a separate authorization gate, not an interpretation.
  // Calls that supply explicit false may never turn route words into CONTACT.
  if (route === "contact_intent" && contactAuthorization === false) {
    return { version:"DecisionPolicyV1", action:NEXT_ACTIONS_V1.CLARIFY,
      reason:"contact_not_authorized_routing_qa" };
  }
  const authoritativeInterpretation=lunaInterpretation || interpretation;
  const isPureProfile=planned==="PROFILE_UPDATE" &&
    authoritativeInterpretation?.turn_kind==="profile_update" &&
    Array.isArray(authoritativeInterpretation?.tasks) && authoritativeInterpretation.tasks.length===0 &&
    (Array.isArray(authoritativeInterpretation?.memory_candidates) &&
      authoritativeInterpretation.memory_candidates.length>0 ||
     Array.isArray(lunaDecision?.changes) && lunaDecision.changes.length>0);
  // Do not let a model decision override explicit contact routing, including
  // a contact route promoted by the Consent gate downstream of interpretation.
  // REFERENCE is deliberately excluded: verified references have their own path.
  const semanticRoute=lunaInterpretation?.primary_route;
  // A *verified informational inquiry* about contact can be recovered when
  // Luna suggested an informational action but mislabelled it unsupported.
  // This cannot authorize CONTACT and is intentionally scoped to the already
  // reconciled market_question route, not arbitrary unsupported requests.
  if (informationalContactInquiry === true &&
      contactAuthorization === false && route === "market_question" &&
      semanticRoute === "unsupported" && planned === "KNOWLEDGE_QA" &&
      Number(lunaDecision?.confidence) >= 0.70) {
    return {version:"DecisionPolicyV1", action:NEXT_ACTIONS_V1.KNOWLEDGE_QA,
      reason:"verified_informational_contact_knowledge_r21"};
  }
  const safeSemanticChoice=
    Number(lunaDecision?.confidence)>=0.70 &&
    route!=="contact_intent" &&
    semanticRoute!=="contact_intent" &&
    Object.prototype.hasOwnProperty.call(routeActions,semanticRoute) &&
    (routeActions[semanticRoute].has(planned) || isPureProfile);
  if(safeSemanticChoice) {
    return {version:"DecisionPolicyV1",action:planned,
      reason:"luna_validated_semantic_action_v12"};
  }
  // R2.1: A typed Luna decision may fail semantic-route/action validation,
  // but it must never silently become an unrelated legacy Router action.
  // Fail closed for this turn instead; preserve existing contact/consent gates.
  // Legacy fallback remains unchanged when there is no eligible Luna plan.
  const hasRejectedTypedLunaAction =
    Number(lunaDecision?.confidence) >= 0.70 &&
    route !== "contact_intent" &&
    semanticRoute !== "contact_intent" &&
    Object.prototype.hasOwnProperty.call(routeActions, semanticRoute) &&
    Object.values(NEXT_ACTIONS_V1).includes(planned) &&
    !safeSemanticChoice;
  if (hasRejectedTypedLunaAction) {
    return {
      version: "DecisionPolicyV1",
      action: NEXT_ACTIONS_V1.CLARIFY,
      reason: "luna_action_route_mismatch_r21"
    };
  }
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
        action: NEXT_ACTIONS_V1.CLARIFY,
        reason: "semantic_request_unresolved"
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

// R2.7: single permission boundary for Prima Search V3 tool dispatch.
// This does not interpret text or select an entity adapter. The caller
// must still verify Registry evidence and SearchContext independently.
// A Search continuation consumes existing results; never re-dispatch it.
export function authorizePrimaSearchV12({
  decision = null, route = null, phase = null
} = {}) {
  if (phase !== "initial") return false;
  if (decision?.action === NEXT_ACTIONS_V1.SEARCH) return true;
  // Compatibility: legacy recommendation cards historically use Search V3.
  // Authoritative Luna ADVISORY alone is not Search authorization.
  return decision?.action === NEXT_ACTIONS_V1.ADVISORY &&
    route === "recommendation" &&
    decision?.reason !== "luna_validated_semantic_action_v12";
}

// R2.3: final action validation belongs to Decision Policy, not index.js.
// Behavioral parity with the existing D2.1 guard is intentional. This helper
// does not classify requests, authorize contact, or dispatch any tool.
export function finalizeNextActionV12({
  decision,
  personaDecision = null,
  lunaMaySteer = false,
  explicitContactRequest = false,
  phase = null,
  lunaInterpretation = null,
  verifiedCompoundSearch = false
} = {}) {
  const nonSearchAction = personaDecision === "route" &&
    lunaMaySteer && !explicitContactRequest && phase === "initial" &&
    ["PAGE_MORE", "RESUME_SEARCH", "MEMORY_RECALL"].includes(
      lunaInterpretation?.luna_decision?.next_action
    ) ? lunaInterpretation.luna_decision.next_action : null;
  if (nonSearchAction && decision?.action !== nonSearchAction &&
      decision?.action === "SEARCH") {
    return {version:"DecisionPolicyV1", action:"CLARIFY",
      reason:"semantic_action_not_accepted"};
  }
  // R2.4: a verified two-part relationship is executable as a single
  // SEARCH plan, but only when a compatible *legacy* action was selected.
  // A validated Luna non-search choice, consent/Contact, clarification or
  // unsafe fallback is never silently rewritten into a catalog search.
  // Continuation still cannot issue another tool request (E33 guard).
  if (verifiedCompoundSearch &&
      !explicitContactRequest &&
      ["EXACT_FACT", "KNOWLEDGE_QA", "ADVISORY"].includes(decision?.action) &&
      decision?.reason !== "luna_validated_semantic_action_v12") {
    return {version:"DecisionPolicyV1", action:"SEARCH",
      reason:"verified_compound_relationship_search_r24"};
  }
  return decision;
}
// END_R23_SINGLE_POLICY_FINALIZER

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

    case NEXT_ACTIONS_V1.PAGE_MORE:
    case NEXT_ACTIONS_V1.RESUME_SEARCH:
      // Pagination/restoration are executed through the verified SearchContext batch.
      // Without it the worker must not create a new catalog query.
      return "follow_up";

    case NEXT_ACTIONS_V1.COMPARE:
      return "compare";

    case NEXT_ACTIONS_V1.ADVISORY:
      return [
        "recommendation",
        "follow_up"
      ].includes(currentRoute)
        ? currentRoute
        : "recommendation";

    case NEXT_ACTIONS_V1.MEMORY_RECALL:
      // Personal memory recap is not an entity reference or catalog search.
      return "follow_up";

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
