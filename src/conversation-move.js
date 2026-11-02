import {
  resolveFollowUpReference
} from "./follow-up.js";


function object(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function sameValue(a, b) {
  if (a === b) {
    return true;
  }

  if (
    a === null ||
    a === undefined
  ) {
    return (
      b === null ||
      b === undefined
    );
  }

  if (
    b === null ||
    b === undefined
  ) {
    return false;
  }

  return String(a) === String(b);
}


function requestStateChanges(
  previousState,
  currentState
) {
  const previous =
    object(
      previousState?.request_state
    );

  const current =
    object(
      currentState?.request_state
    );

  const previousBudget =
    object(previous.budget);

  const currentBudget =
    object(current.budget);

  const checks = [
    [
      "property_type",
      previous.property_type,
      current.property_type
    ],
    [
      "budget_min_aed",
      previousBudget.min_aed,
      currentBudget.min_aed
    ],
    [
      "budget_max_aed",
      previousBudget.max_aed,
      currentBudget.max_aed
    ],
    [
      "location",
      previous.location,
      current.location
    ],
    [
      "bedrooms",
      previous.bedrooms,
      current.bedrooms
    ],
    [
      "goal",
      previous.goal,
      current.goal
    ],
    [
      "timeline",
      previous.timeline,
      current.timeline
    ]
  ];

  return checks
    .filter(
      ([, before, after]) =>
        !sameValue(
          before,
          after
        )
    )
    .map(([field]) => field);
}


const TANGENT_ROUTES = new Set([
  "exact_fact",
  "page_question",
  "market_question",
  "persona_question"
]);


function hasExplicitSwitchCue(
  message = ""
) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  return (
    /\b(?:instead|switch to|change (?:the )?topic to|move on to)\b/i
      .test(q) ||
    /\bforget (?:that|this|the .+?)\b/i
      .test(q) ||
    /\blet'?s talk about\b/i
      .test(q) ||
    /\b(?:leave|drop|stop|set aside|put aside|move away from)\b[\s\S]{0,100}\b(?:for now|for the moment|instead)\b/i
      .test(q)
  );
}


function looksSelfContainedTurn(
  message = ""
) {
  const q =
    String(message || "")
      .trim();

  if (!q) {
    return false;
  }

  /*
    A self-contained question/request can be a tangent
    even when the capability Router cannot yet assign
    a supported semantic route.

    This deliberately does NOT encode topics.
  */
  const startsLikeQuestion =
    /^(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|tell me|explain|give me)\b/i
      .test(q);

  const hasQuestionMark =
    /\?\s*$/.test(q);

  return (
    startsLikeQuestion ||
    hasQuestionMark
  );
}


function hasExplicitResumeCue(
  message = ""
) {
  const q =
    String(message || "")
      .trim()
      .toLowerCase();

  return (
    /\b(?:back to|go back to|get back to|return to|resume)\b/i
      .test(q) ||
    /\bcontinue where we left off\b/i
      .test(q) ||
    /\bpick up where we left off\b/i
      .test(q)
  );
}


function suspendedTopic(
  state = null
) {
  const suspended =
    state
      ?.continuity_references
      ?.suspended_thread ||
    null;

  return (
    suspended
      ?.active_thread
      ?.active_topic ||
    suspended
      ?.active_topic ||
    suspended
      ?.route ||
    null
  );
}


export function recognizeConversationMove({
  message = "",
  route = "unsupported",
  context = {}
} = {}) {
  const currentState =
    context?.state ||
    null;

  const persistedState =
    context
      ?.conversation
      ?.dialogue_state ||
    null;

  const activeTopic =
    currentState
      ?.active_thread
      ?.active_topic ||
    persistedState
      ?.active_thread
      ?.active_topic ||
    null;

  const changedFields =
    requestStateChanges(
      persistedState,
      currentState
    );

    const pendingClarification =
      currentState
        ?.dialogue_mechanics
        ?.pending_clarification ||
      persistedState
        ?.dialogue_mechanics
        ?.pending_clarification ||
      null;

    const clarificationSelection =
      typeof message === "string" &&
      message.trim().length > 0 &&
      message.trim().split(/\s+/).length <= 8 &&
      !/[?]/.test(message) &&
      !/^(?:what|which|why|how|when|where|who|show|find|compare|tell|give|is|are|do|does|can|could|would|should)\b/i
        .test(
          message.trim()
        );

    if (
      pendingClarification
        ?.route === "compare" &&
      clarificationSelection &&
      [
        "compare",
        "page_question",
        "unsupported",
        "follow_up"
      ].includes(route)
    ) {
      return {
        version:
          "ConversationMoveV1",

        move_type:
          "continuation",

        effective_route:
          "compare",

        confidence:
          1,

        reason:
          "pending_clarification_answer",

        changed_fields:
          []
      };
    }


  /*
    High-confidence reference V1.

    Existing follow-up resolver remains the
    single source of truth for:
    - ordinal SearchContext references
    - current entity references
    - recent entity references

    No entity identity is guessed here.
  */
  /*
    E1_FACT_REFERENCE_SECOND_PASS_V1

    An explicit factual question with a conversational
    reference must survive both ConversationMove passes.

    Ordinary named facts and open-ended follow-ups
    keep their existing routes.
  */
  const e1FactReferenceSecondPassV1 =
    /\b(?:that one|this one|that project|this project|that developer|this developer|that district|this district|it|its)\b/i
      .test(String(message || "")) &&
    /^(?:who\s+(?:is|was)\b[\s\S]{0,100}\bdeveloper\b|what(?:'s|\s+is)\b[\s\S]{0,100}\b(?:developer|price|handover|completion|location|district|status)\b|when\b[\s\S]{0,100}\b(?:handover|completion)\b|where\b[\s\S]{0,100}\b(?:located|location)\b)/i
      .test(String(message || "").trim());

  if (
    route === "follow_up" ||
    (
      e1FactReferenceSecondPassV1 &&
      (
        route === "exact_fact" ||
        route === "page_question"
      )
    )
  ) {
    const reference =
      resolveFollowUpReference({
        message,
        context
      });

    if (reference?.resolved) {
      /*
        E1_FACT_REFERENCE_ROUTE_V1
        Reference identifies the entity.
        The factual question keeps exact_fact semantics.
      */
      const isExplicitFactReference =
        e1FactReferenceSecondPassV1;
      return {
        version:
          "ConversationMoveV1",

        move_type:
          isExplicitFactReference
            ? "continuation"
            : "reference",

        effective_route:
          isExplicitFactReference
            ? "exact_fact"
            : "follow_up",

        confidence:
          1,

        reason:
          isExplicitFactReference
            ? "resolved_reference_fact_request"
            : "deterministic_reference_resolved",

        reference,

        changed_fields: []
      };
    }
  }

  /*
    High-confidence refinement V1.

    Existing active property search +
    current turn changed structured request
    constraints = refinement of that search.

    No LLM required.
  */
  if (
    activeTopic === "property_search" &&
    route === "property_search" &&
    changedFields.length > 0
  ) {
    return {
      version:
        "ConversationMoveV1",

      move_type:
        "refinement",

      effective_route:
        "property_search",

      confidence:
        1,

      reason:
        "property_search_request_state_changed",

      changed_fields:
        changedFields
    };
  }

  /*
    An explicit new search command while a
    property-search thread is active is normally
    a reformulation/refinement of that thread.
  */
  if (
    activeTopic === "property_search" &&
    route === "property_search"
  ) {
    return {
      version:
        "ConversationMoveV1",

      move_type:
        "refinement",

      effective_route:
        "property_search",

      confidence:
        0.98,

      reason:
        "property_search_requery",

      changed_fields: []
    };
  }

  /*
    Explicit resume V1.

    Recognition only.
    The suspended thread itself is created/restored
    by Conversation State Update (G), not here.
  */
  const resumeTopic =
    suspendedTopic(currentState) ||
    suspendedTopic(persistedState);

  if (
    activeTopic &&
    resumeTopic &&
    hasExplicitResumeCue(message)
  ) {
    return {
      version:
        "ConversationMoveV1",

      move_type:
        "resume",

      effective_route:
        resumeTopic,

      confidence:
        1,

      reason:
        "explicit_resume_to_suspended_thread",

      source_topic:
        activeTopic,

      target_topic:
        resumeTopic,

      changed_fields: []
    };
  }

  /*
    Explicit switch V1.

    A same-goal property search change has already
    been captured above as refinement.

    Therefore "instead" only becomes a switch when
    the canonical destination route is actually
    different from the active thread.
  */
  if (
    activeTopic &&
    route &&
    route !== activeTopic &&
    hasExplicitSwitchCue(message)
  ) {
    return {
      version:
        "ConversationMoveV1",

      move_type:
        "switch",

      effective_route:
        route,

      confidence:
        0.98,

      reason:
        "explicit_thread_replacement",

      source_topic:
        activeTopic,

      target_topic:
        route,

      changed_fields: []
    };
  }

  /*
    Temporary tangent V1.

    A short informational request can temporarily
    leave an active task thread without replacing it.

    G will later decide how to snapshot/preserve
    that active thread.
  */
  if (
    activeTopic &&
    route &&
    route !== activeTopic &&
    (
      TANGENT_ROUTES.has(route) ||
      (
        route === "unsupported" &&
        looksSelfContainedTurn(message)
      )
    )
  ) {
    return {
      version:
        "ConversationMoveV1",

      move_type:
        "temporary_tangent",

      effective_route:
        route,

      confidence:
        0.98,

      reason:
        "temporary_informational_detour",

      source_topic:
        activeTopic,

      target_topic:
        route,

      changed_fields: []
    };
  }


  return {
    version:
      "ConversationMoveV1",

    move_type:
      activeTopic
        ? "continuation"
        : "new_thread",

    effective_route:
      route,

    confidence:
      activeTopic
        ? 0.5
        : 1,

    reason:
      activeTopic
        ? "no_high_confidence_move_override"
        : "no_active_thread",

    changed_fields: []
  };
}
