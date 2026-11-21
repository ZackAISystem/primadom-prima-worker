import { normalizePreferredLocationTextV1 } from "./preferred-location-v1.js";
import { extractProjectComparisonTarget } from "./compare.js";


// V1.2: a single, evidence-bound delta applied to the existing request_state.
// No raw model output is directly trusted or written to Supabase.
const LUNA_SLOTS_V12 = new Set([
  "property_type", "location", "budget_min_aed", "budget_max_aed",
  "bedrooms", "goal", "timeline"
]);
const LUNA_MEMORY_KEYS_V12 = {
  property_type:"property_type", location:"preferred_location_text",
  budget_min_aed:"budget_min_aed", budget_max_aed:"budget_max_aed",
  bedrooms:"bedrooms", goal:"buyer_goal", timeline:"timeline"
};
const LUNA_MOVES_V12 = new Set([
  "new_thread", "continuation", "refinement", "temporary_tangent", "resume", "reference"
]);
const LUNA_ACTIONS_V12 = new Set([
  "PERSONA", "ADVISORY", "SEARCH", "EXACT_FACT", "KNOWLEDGE_QA",
  "COMPARE", "CLARIFY", "CONTACT", "PROFILE_UPDATE", "REFERENCE",
  "PAGE_MORE", "MEMORY_RECALL", "RESUME_SEARCH"
]);

function normalizeLunaSlotV12(field, raw) {
  const value=typeof raw==="string" ? raw.trim() : "";
  if(!value || value.length>120 || /[<>\r\n]/.test(value)) return null;
  if(field==="property_type") {
    const type=value.toLowerCase();
    return ["apartment","villa","townhouse","penthouse","duplex","studio","plot"]
      .includes(type) ? type : null;
  }
  if(field==="location") return normalizePreferredLocationTextV1(value);
  if(field==="budget_min_aed" || field==="budget_max_aed") {
    const n=Number(value.replace(/,/g,""));
    return Number.isSafeInteger(n) && n>=10_000 && n<=10_000_000_000 ? n : null;
  }
  if(field==="bedrooms") {
    const n=Number(value);
    return Number.isInteger(n) && n>=0 && n<=20 ? n : null;
  }
  return value;
}

// Pending changes are written only into the existing authorized conversation
// row before the frontend completes the existing two-pass Search contract.
// No model output or user message is copied into this pending control record.
export function lunaMemoryFactsFromStateChangesV12(changes) {
  return (Array.isArray(changes) ? changes : []).slice(0,7)
    .filter(item=>LUNA_SLOTS_V12.has(item?.field) && item.operation==="set" &&
      normalizeLunaSlotV12(item.field,String(item?.value ?? ""))!==null)
    .map(item=>({fact_key:LUNA_MEMORY_KEYS_V12[item.field],
      fact_value:normalizeLunaSlotV12(item.field,String(item.value)),
      confidence:0.91,source:"luna_explicit_evidence_v12"}));
}

// A durable cancellation masks an older active Memory value without deleting
// canonical Memory rows. The mask lives only in the existing ConversationStateV1.
export function maskClearedConversationMemoryV12(facts, context, currentChanges=[]) {
  const request=context?.conversation?.dialogue_state?.request_state || {};
  const blocked=new Set(Array.isArray(request.cleared_fields_v12) ? request.cleared_fields_v12 : []);
  for(const item of (Array.isArray(currentChanges)?currentChanges:[])) {
    if(item?.operation==="clear") blocked.add(item.field);
    if(item?.operation==="set") blocked.delete(item.field);
  }
  const keys={property_type:"property_type",location:"preferred_location_text",
    budget_min_aed:"budget_min_aed",budget_max_aed:"budget_max_aed",
    bedrooms:"bedrooms",goal:"buyer_goal",timeline:"timeline"};
  const memoryBlocked=new Set([...blocked].map(field=>keys[field]).filter(Boolean));
  return (Array.isArray(facts)?facts:[]).filter(f=>!memoryBlocked.has(f?.fact_key));
}

export function applyLunaDecisionToContextV12(context, message, decision) {
  if(!context || !decision || typeof decision!=="object") return null;
  const input=String(message || "").normalize("NFKC").toLowerCase();
  const result=[];
  const seen=new Set();
  for(const item of (Array.isArray(decision.state_changes) ? decision.state_changes : []).slice(0,7)) {
    const field=String(item?.field || "");
    const operation=item?.operation;
    const evidence=String(item?.evidence || "").trim();
    const confidence=Number(item?.confidence);
    if(!LUNA_SLOTS_V12.has(field) || seen.has(field) ||
       !["set","clear"].includes(operation) ||
       !Number.isFinite(confidence) || confidence < (operation==="clear" ? 0.9 : 0.8) ||
       evidence.length<2 || evidence.length>200 ||
       !input.includes(evidence.normalize("NFKC").toLowerCase())) continue;
    const value=operation==="clear" ? null : normalizeLunaSlotV12(field,item?.value);
    if(operation==="set" && value===null) continue;
    seen.add(field);
    result.push({field,operation,value});
  }
  const confidence=Number(decision.confidence);
  const authorized=Number.isFinite(confidence) && confidence>=0.70;
  if(!authorized) result.length=0;
  context.luna_decision_v12={
    changes:result,
    conversation_move:authorized && LUNA_MOVES_V12.has(decision.conversation_move)
      ? decision.conversation_move : null,
    next_action:authorized && LUNA_ACTIONS_V12.has(decision.next_action)
      ? decision.next_action : null,
    confidence:Number.isFinite(confidence)?confidence:0
  };
  refreshConversationStateV1(context);
  return {
    changes:result,
    memory_facts:lunaMemoryFactsFromStateChangesV12(result)
  };
}

function applyLunaSlotsToStateV12(state,context,{verifiedSearch=false}={}) {
  const request=state.request_state;
  const prior=context?.conversation?.dialogue_state?.request_state || {};
  const decision=context?.luna_decision_v12;
  const previousTopic=context?.conversation?.dialogue_state?.active_thread?.active_topic;
  const refine=decision?.conversation_move==="refinement" &&
    ["property_search","recommendation"].includes(previousTopic);
  if(refine) {
    // In a refinement, SearchContext may omit unchanged filters. The client's
    // earlier requirements remain canonical, never replaced with null.
    request.property_type=prior.property_type ?? null;
    request.location=prior.location ?? null;
    request.budget={min_aed:prior.budget?.min_aed ?? null,
      max_aed:prior.budget?.max_aed ?? null};
    request.bedrooms=prior.bedrooms ?? null;
    request.goal=prior.goal ?? null;
    request.timeline=prior.timeline ?? null;
  }
  // Explicit cancellations are durable even when old Memory is active or
  // the two-pass Search returns filters containing an outdated value.
  const cleared=new Set(
    (Array.isArray(prior.cleared_fields_v12) ? prior.cleared_fields_v12 : [])
      .filter(field=>LUNA_SLOTS_V12.has(field)));
  const locate=field=> field==="budget_min_aed" ? [request.budget,"min_aed"] :
    field==="budget_max_aed" ? [request.budget,"max_aed"] :
    [request,field];
  for(const field of cleared) {
    const [obj,key]=locate(field);
    obj[key]=null;
  }
  for(const change of (context?.luna_decision_v12?.changes || [])) {
    const [obj,key]=locate(change.field);
    obj[key]=change.operation==="clear" ? null : change.value;
    if(change.operation==="clear") cleared.add(change.field);
    else cleared.delete(change.field);
  }
  request.cleared_fields_v12=[...cleared];
  return state;
}

const ROUTE_GOALS = Object.freeze({
  property_search: "find_property",
  recommendation: "choose_option",
  compare: "compare_options",
  page_question: "understand_entity",
  exact_fact: "get_verified_fact",
  market_question: "understand_market",
  contact_intent: "contact_advisor",
  persona_question: "understand_prima",
  follow_up: "continue_current_thread"
});


const ROUTE_STAGES = Object.freeze({
  property_search: "discovery",
  recommendation: "evaluation",
  compare: "comparison",
  page_question: "research",
  exact_fact: "research",
  market_question: "research",
  contact_intent: "handoff",
  persona_question: "orientation",
  follow_up: "continuation"
});


const THREAD_ROUTES = new Set([
  "property_search",
  "recommendation",
  "compare",
  "page_question",
  "exact_fact",
  "market_question"
]);


function activeFacts(context = {}) {
  return Array.isArray(
    context?.memory?.active_facts
  )
    ? context.memory.active_facts
    : [];
}


function memoryValue(context, key) {
  const slot={preferred_location_text:"location", buyer_goal:"goal",
    property_type:"property_type",budget_min_aed:"budget_min_aed",
    budget_max_aed:"budget_max_aed",bedrooms:"bedrooms", timeline:"timeline"}[key];
  const cleared=persistedState(context)?.request_state?.cleared_fields_v12;
  if(slot && Array.isArray(cleared) && cleared.includes(slot)) return null;
  // Latest verified Memory fact wins; never resurrect an older value.
  const facts=activeFacts(context);
  for(let i=facts.length-1;i>=0;i--){
    if(facts[i]?.fact_key===key) return facts[i].fact_value ?? null;
  }
  return null;
}


function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numeric =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}


function persistedState(context = {}) {
  const state =
    context
      ?.conversation
      ?.dialogue_state;

  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !==
      "ConversationStateV1"
  ) {
    return null;
  }

  return state;
}


function recentMessages(context = {}) {
  return Array.isArray(
    context
      ?.conversation
      ?.recent_messages
  )
    ? context.conversation.recent_messages
    : [];
}


function latestMessage(
  context,
  predicate
) {
  const messages =
    recentMessages(context);

  for (
    let i = messages.length - 1;
    i >= 0;
    i--
  ) {
    if (predicate(messages[i])) {
      return messages[i];
    }
  }

  return null;
}


function currentEntity(context = {}) {
  const workingEntity =
    context?.working_entity ||
    null;

  if (
    workingEntity?.type ||
    workingEntity?.slug
  ) {
    return {
      type:
        workingEntity.type ||
        null,

      slug:
        workingEntity.slug ||
        null
    };
  }

  const type =
    context?.entity?.primary_type ||
    null;

  const slug =
    context?.entity?.primary_slug ||
    null;

  if (type || slug) {
    return {
      type,
      slug
    };
  }

  return (
    persistedState(context)
      ?.continuity_references
      ?.current_entity ||
    null
  );
}


function comparisonTarget(
  context = {},
  options = {}
) {
  const workingTarget =
    context
      ?.working_comparison_target ||
    null;

  if (
    typeof workingTarget ===
      "string" &&
    workingTarget.trim()
  ) {
    return workingTarget.trim();
  }

  if (
    workingTarget &&
    typeof workingTarget ===
      "object" &&
    !Array.isArray(
      workingTarget
    )
  ) {
    const value =
      workingTarget.name ||
      workingTarget.slug ||
      null;

    if (value) {
      return value;
    }
  }

  const persisted =
    persistedState(context)
      ?.continuity_references
      ?.comparison_target ||
    null;

  if (options?.route !== "compare") {
    return persisted;
  }

  const entity =
    currentEntity(context);

  const target =
    extractProjectComparisonTarget(
      context?.user?.message || "",
      entity?.slug || ""
    );

  return target || persisted;
}


function currentSearch(context = {}) {
  const search =
    context?.search;

  return (
    search &&
    search.version ===
      "SearchContextV1"
  )
    ? search
    : null;
}


function activeSearchContext(
  context = {}
) {
  const search =
    currentSearch(context);

  if (!search) {
    return (
      persistedState(context)
        ?.continuity_references
        ?.active_search_context ||
      null
    );
  }

  return {
    state:
      search.state || null,

    query:
      search.query || null,

    result_count:
      Number.isFinite(
        search.result_count
      )
        ? search.result_count
        : null,

    current_batch_offset:
      Number.isInteger(
        search.current_batch_offset
      )
        ? search.current_batch_offset
        : 0
  };
}


function searchPropertyType(
  context = {}
) {
  const values =
    currentSearch(context)
      ?.filters
      ?.property_types;

  return (
    Array.isArray(values) &&
    values.length > 0
  )
    ? values[0]
    : null;
}


function searchLocation(
  context = {}
) {
  const filters =
    currentSearch(context)
      ?.filters;

  if (!filters) {
    return null;
  }

  if (filters.district) {
    return filters.district;
  }

  if (
    Array.isArray(filters.emirates) &&
    filters.emirates.length > 0
  ) {
    return filters.emirates[0];
  }

  return null;
}


function searchBedrooms(
  context = {}
) {
  const values =
    currentSearch(context)
      ?.filters
      ?.bedrooms;

  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return null;
  }

  return numberOrNull(values[0]);
}


function searchBudgetValue(
  context,
  side
) {
  const budget =
    currentSearch(context)
      ?.filters
      ?.budget;

  if (
    !budget ||
    typeof budget !== "object" ||
    Array.isArray(budget)
  ) {
    return null;
  }

  const keys =
    side === "min"
      ? [
          "min_aed",
          "min",
          "from"
        ]
      : [
          "max_aed",
          "max",
          "to"
        ];

  for (const key of keys) {
    const value =
      numberOrNull(
        budget[key]
      );

    if (value !== null) {
      return value;
    }
  }

  return null;
}


function threadRoute(route) {
  return (
    typeof route === "string" &&
    THREAD_ROUTES.has(route)
  );
}


export function buildConversationStateV1(
  context = {},
  options = {}
) {
  const persisted =
    persistedState(context);

  const persistedIntent =
    context
      ?.conversation
      ?.current_intent ||
    null;

  const lastUser =
    latestMessage(
      context,
      item =>
        item?.role === "user"
    );

  const lastAssistant =
    latestMessage(
      context,
      item =>
        item?.role === "assistant"
    );

  const lastRouted =
    latestMessage(
      context,
      item =>
        Boolean(item?.route)
    );

  const routeOverride =
    threadRoute(options?.route)
      ? options.route
      : null;

  const persistedTopic =
    persisted
      ?.active_thread
      ?.active_topic ||
    null;

  const contextualThread =
    [
      persistedIntent,
      lastUser?.route,
      lastRouted?.route
    ].find(threadRoute) ||
    null;

  const activeTopic =
    routeOverride ||
    persistedTopic ||
    contextualThread ||
    persistedIntent ||
    lastUser?.route ||
    lastRouted?.route ||
    null;

  const persistedRequest =
    persisted
      ?.request_state ||
    {};

  // D3_VERIFIED_SEARCH_STATE_SCOPE_V7
  // The completed, verified project SearchContext is authoritative for
  // Search slot values, including intentionally absent filters. Old memory
  // remains intact for normal conversation and other routes.
  const verifiedProjectSearch =
    options?.route === "property_search" &&
    context?.turn?.phase === "tool_continuation" &&
    context?.search?.version === "SearchContextV1" &&
    context?.search?.language === "en" &&
    context?.search?.entity_type === "project" &&
    ["results","empty"].includes(context?.search?.state) &&
    Array.isArray(context.search.results) &&
    Boolean(context.search.filters);

  const buyerGoal =
    memoryValue(
      context,
      "buyer_goal"
    ) ??
    persistedRequest.goal ??
    null;

  const budgetMin = verifiedProjectSearch
    ? searchBudgetValue(context, "min")
    : (
      numberOrNull(
        memoryValue(
          context,
          "budget_min_aed"
        )
      ) ??
      searchBudgetValue(
        context,
        "min"
      ) ??
      numberOrNull(
        persistedRequest
          ?.budget
          ?.min_aed
      )
    );

  const budgetMax = verifiedProjectSearch
    ? searchBudgetValue(context, "max")
    : (
      numberOrNull(
        memoryValue(
          context,
          "budget_max_aed"
        )
      ) ??
      searchBudgetValue(
        context,
        "max"
      ) ??
      numberOrNull(
        persistedRequest
          ?.budget
          ?.max_aed
      )
    );

  const propertyType = verifiedProjectSearch
    ? searchPropertyType(context)
    : (
      memoryValue(
        context,
        "property_type"
      ) ??
      searchPropertyType(
        context
      ) ??
      persistedRequest
        .property_type ??
      null
    );

  const location = verifiedProjectSearch
    ? normalizePreferredLocationTextV1(searchLocation(context))
    : (
      normalizePreferredLocationTextV1(memoryValue(context, "preferred_location_text")) ??
      normalizePreferredLocationTextV1(searchLocation(context)) ??
      normalizePreferredLocationTextV1(persistedRequest.location)
    );

  const bedrooms = verifiedProjectSearch
    ? searchBedrooms(context)
    : (
      numberOrNull(
        memoryValue(
          context,
          "bedrooms"
        )
      ) ??
      searchBedrooms(
        context
      ) ??
      numberOrNull(
        persistedRequest
          .bedrooms
      )
    );

  const timeline =
    memoryValue(
      context,
      "purchase_timeline_text"
    ) ??
    memoryValue(
      context,
      "purchase_timeline"
    ) ??
    memoryValue(
      context,
      "timeline"
    ) ??
    persistedRequest
      .timeline ??
    null;

  const persistedMechanics =
    persisted
      ?.dialogue_mechanics ||
    {};

  const currentResponseType =
    typeof options?.response_type ===
      "string"
      ? options.response_type
      : null;

  const consumePendingClarification =
    options
      ?.consume_pending_clarification ===
        true;

  const pendingClarification =
    consumePendingClarification
      ? null
      : currentResponseType ===
          "clarification"
        ? {
            source:
              "current_response",

            route:
              options?.route ||
              persistedMechanics
                .last_route ||
              null
          }
        : lastAssistant
            ?.response_type ===
              "clarification"
          ? {
              source:
                "last_assistant",

              route:
                persistedMechanics
                  ?.pending_clarification
                  ?.route ||
                lastAssistant?.route ||
                persistedMechanics
                  .last_route ||
                null
            }
          : (
              persistedMechanics
                .pending_clarification ||
              null
            );

  const nextState = {
    version:
      "ConversationStateV1",

    active_thread: {
      active_topic:
        activeTopic,

      active_goal:
        buyerGoal ||
        ROUTE_GOALS[activeTopic] ||
        persisted
          ?.active_thread
          ?.active_goal ||
        null,

      current_stage:
        ROUTE_STAGES[activeTopic] ||
        persisted
          ?.active_thread
          ?.current_stage ||
        null
    },

    request_state: {
      property_type:
        propertyType,

      budget: {
        min_aed:
          budgetMin,

        max_aed:
          budgetMax
      },

      location,

      bedrooms,

      goal:
        buyerGoal,

      timeline
    },

    dialogue_mechanics: {
      pending_clarification:
        pendingClarification,

      last_user_intent:
        (
          typeof options?.route === "string" &&
          options.route
        )
          ? options.route
          : (
              lastUser?.route ||
              persistedMechanics
                .last_user_intent ||
              persistedIntent ||
              null
            ),

      last_route:
        (
          typeof options?.route === "string" &&
          options.route
        )
          ? options.route
          : (
              lastRouted?.route ||
              persistedMechanics
                .last_route ||
              persistedIntent ||
              null
            ),

      last_result_type:
        (
          typeof options?.response_type === "string" &&
          options.response_type
        )
          ? options.response_type
          : (
              lastAssistant
                ?.response_type ||
              persistedMechanics
                .last_result_type ||
              null
            )
    },

    continuity_references: {
      active_search_context:
        activeSearchContext(
          context
        ),

      current_entity:
        verifiedProjectSearch
          ? (() => {
              const district = String(
                context.search.filters?.district || ""
              ).trim();
              if (!district) return null;
              const slug = district.toLowerCase()
                .replace(/&/g, " and ")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
              return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
                ? {type: "district", slug}
                : null;
            })()
          : currentEntity(context),

      comparison_target:
        comparisonTarget(
          context,
          options
        ),

      suspended_thread:
        persisted
          ?.continuity_references
          ?.suspended_thread ||
        null
    }
  };
  return applyLunaSlotsToStateV12(nextState,context,{verifiedSearch:verifiedProjectSearch});
}



function cloneStateValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}


function snapshotActiveThread(
  state = null
) {
  if (
    !state
      ?.active_thread
      ?.active_topic
  ) {
    return null;
  }

  return {
    version:
      "SuspendedThreadV1",

    active_thread:
      cloneStateValue(
        state.active_thread
      ),

    request_state:
      cloneStateValue(
        state.request_state
      ),

    continuity_references: {
      active_search_context:
        cloneStateValue(
          state
            ?.continuity_references
            ?.active_search_context
        ),

      current_entity:
        cloneStateValue(
          state
            ?.continuity_references
            ?.current_entity
        ),

      comparison_target:
        cloneStateValue(
          state
            ?.continuity_references
            ?.comparison_target
        )
    }
  };
}


function restoreSuspendedThread(
  candidate,
  suspended
) {
  if (
    !suspended
      ?.active_thread
      ?.active_topic
  ) {
    return candidate;
  }

  return {
    ...candidate,

    active_thread:
      cloneStateValue(
        suspended.active_thread
      ),

    request_state:
      cloneStateValue(
        suspended.request_state ||
        candidate.request_state
      ),

    continuity_references: {
      ...candidate
        .continuity_references,

      active_search_context:
        cloneStateValue(
          suspended
            ?.continuity_references
            ?.active_search_context ??
          candidate
            ?.continuity_references
            ?.active_search_context
        ),

      current_entity:
        cloneStateValue(
          suspended
            ?.continuity_references
            ?.current_entity ??
          candidate
            ?.continuity_references
            ?.current_entity
        ),

      comparison_target:
        cloneStateValue(
          suspended
            ?.continuity_references
            ?.comparison_target ??
          candidate
            ?.continuity_references
            ?.comparison_target
        ),

      suspended_thread:
        null
    }
  };
}


/*
  Conversation State transition reducer.

  ConversationMoveV1 recognizes WHAT the user did.
  This reducer decides HOW ConversationStateV1 changes.

  No persistence and no ordering logic lives here.
*/
export function applyConversationMoveToStateV1(
  context = {},
  options = {}
) {
  const route =
    options?.route ||
    null;

  const move =
    options?.move ||
    null;

  const previous =
    persistedState(context);

  const candidate =
    buildConversationStateV1(
      context,
      {
        route,
        response_type:
          options?.response_type ||
          null,

        consume_pending_clarification:
          options
            ?.consume_pending_clarification ===
              true
      }
    );

  if (
    !move ||
    move.version !==
      "ConversationMoveV1"
  ) {
    return candidate;
  }

  const moveType =
    move.move_type ||
    null;

  if (
    moveType ===
      "temporary_tangent"
  ) {
    /*
      Preserve the ORIGINAL suspended thread if we
      enter another tangent while already inside one.

      Never replace:
        property_search
          → tangent A
          → tangent B

      with tangent A as the resumable thread.
    */
    const existingSuspended =
      previous
        ?.continuity_references
        ?.suspended_thread ||
      null;

    const suspended =
      existingSuspended ||
      snapshotActiveThread(
        previous
      );

    return {
      ...candidate,

      continuity_references: {
        ...candidate
          .continuity_references,

        suspended_thread:
          suspended
      }
    };
  }

  if (
    moveType ===
      "resume"
  ) {
    const suspended =
      previous
        ?.continuity_references
        ?.suspended_thread ||
      null;
    const restored = restoreSuspendedThread(candidate, suspended);

    // C_D_RESUME_VERIFIED_D5_V10: the suspended search is the identity
    // authority, but an already verified D5 next batch is the offset
    // authority. Never modify a normal resume, Compare or non-search turn.
    const search = currentSearch(context);
    const saved = suspended?.continuity_references?.active_search_context;
    const savedDistrict = String(suspended?.request_state?.location || "")
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const incomingDistrict = String(search?.filters?.district || "")
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const verifiedNextPage =
      route === "property_search" &&
      options?.move?.reason === "explicit_resume_to_suspended_thread" &&
      context?.turn?.phase === "tool_continuation" &&
      suspended?.active_thread?.active_topic === "property_search" &&
      search?.entity_type === "project" && search?.state === "results" &&
      search?.verified_d5_page &&
      Number.isInteger(search.current_batch_offset) &&
      search.current_batch_offset > 0 &&
      search.current_batch_offset === Number(saved?.current_batch_offset || 0) + 3 &&
      search.results?.length > search.current_batch_offset &&
      search.result_count === saved?.result_count &&
      savedDistrict && savedDistrict === incomingDistrict &&
      Boolean(search.filters?.developer);
    if (!verifiedNextPage) return restored;
    return {
      ...restored,
      continuity_references: {
        ...restored.continuity_references,
        active_search_context:
          cloneStateValue(candidate.continuity_references.active_search_context)
      }
    };
  }

  if (
    moveType ===
      "switch"
  ) {
    /*
      Explicit switch abandons the old resumable thread.

      If the new destination is a supported thread route,
      buildConversationStateV1 already made it active.

      If capability routing is still unsupported, do not
      falsely keep the previous task active.
    */
    const nextActiveThread =
      threadRoute(route)
        ? candidate.active_thread
        : {
            active_topic: null,
            active_goal: null,
            current_stage: null
          };

    return {
      ...candidate,

      active_thread:
        nextActiveThread,

      continuity_references: {
        ...candidate
          .continuity_references,

        suspended_thread:
          null
      }
    };
  }

  /*
    refinement / reference / continuation / new_thread:
    normal candidate state is sufficient.
  */
  return candidate;
}


export function refreshConversationStateV1(
  context = {},
  options = {}
) {
  if (
    !context ||
    typeof context !== "object"
  ) {
    return null;
  }

  const state =
    buildConversationStateV1(
      context,
      options
    );

  context.state =
    state;

  return state;
}
