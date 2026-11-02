
// G42_COMMERCIAL_DECISION_V1
// Pure commercial policy. No generated text, no database writes.

const CONTACT_FACTS = new Set([
  "contact_phone",
  "contact_whatsapp",
  "whatsapp_phone"
]);

const CONTACT_COMPLETE = new Set([
  "contact_captured"
]);

const PREVIOUS_OFFER = new Set([
  "cta_offered",
  "cta_declined"
]);

function hasContact(activeMemory) {
  return Array.isArray(activeMemory) &&
    activeMemory.some(fact =>
      CONTACT_FACTS.has(fact?.fact_key) &&
      (
        typeof fact?.fact_value === "string"
          ? fact.fact_value.trim().length > 0
          : Boolean(fact?.fact_value)
      )
    );
}

export function decideCommercialNextStepV1({
  commercialContext = null,
  activeMemory = [],
  primaryTaskResolved = true,
  materialProgress = false
} = {}) {
  const context = commercialContext;
  const buyer = context?.buyer_context || {};
  const interaction = context?.interaction || {};

  const stage = buyer.stage_hint || "undetermined";
  const needs = Array.isArray(context?.commercial_needs)
    ? [...new Set(context.commercial_needs)]
    : [];

  const status = interaction.funnel_status || null;

  const contactKnown =
    hasContact(activeMemory) ||
    CONTACT_COMPLETE.has(status);

  const explicitRequest =
    interaction.explicit_specialist_request === true ||
    interaction.explicit_viewing_request === true;

  const base = {
    version: "CommercialDecisionV1",
    decision: "continue_advising",
    reason: "no_commercial_action",
    buyer_stage: stage,
    commercial_needs: needs,
    contact_already_known: contactKnown,
    reuse_existing_contact: false,
    request_new_contact: false,
    contact_permission: false
  };

  const result = (decision, reason, extra = {}) => ({
    ...base,
    decision,
    reason,
    ...extra
  });

  if (context?.version !== "CommercialContextV1") {
    return result("continue_advising", "no_valid_context");
  }

  // Block H owns an already accepted handoff.
  if (status === "handoff_accepted") {
    return result("continue_advising", "handoff_in_progress");
  }

  // Persistent opt-out, unless the customer explicitly asks again.
  if (
    (
      interaction.contact_opted_out === true ||
      status === "contact_opted_out"
    ) &&
    !explicitRequest
  ) {
    return result("continue_advising", "contact_opted_out");
  }

  // POST-CONTACT GUARD:
  // Never request the same contact or initiate another CTA.
  if (contactKnown) {
    if (explicitRequest) {
      return result(
        "direct_handoff",
        "explicit_recontact_using_existing_details",
        {
          reuse_existing_contact: true,
          contact_permission: true
        }
      );
    }

    return result(
      "continue_advising",
      "post_contact_consultation"
    );
  }

  // Answer the customer's primary question first.
  if (
    primaryTaskResolved !== true ||
    buyer.pending_clarification === true
  ) {
    return result(
      "continue_advising",
      "primary_task_first"
    );
  }

  // An explicit request is not a proactive CTA.
  if (explicitRequest) {
    return result("direct_handoff", "explicit_request", {
      request_new_contact: true,
      contact_permission: true
    });
  }

  const reliable =
    context.interpretation?.available === true &&
    Number(
      context.interpretation.overall_confidence
    ) >= 0.7;

  if (!reliable) {
    return result(
      "continue_advising",
      "insufficient_semantic_confidence"
    );
  }

  // Do not repeat an offer without material progress.
  if (
    PREVIOUS_OFFER.has(status) &&
    materialProgress !== true
  ) {
    return result(
      "continue_advising",
      "no_material_progress_since_last_cta"
    );
  }

  const concreteProject =
    Boolean(buyer.primary_project_slug) ||
    (
      Array.isArray(buyer.project_entities) &&
      buyer.project_entities.length > 0
    );

  const actionableNeed = needs.some(need =>
    [
      "availability",
      "payment_terms",
      "viewing",
      "shortlist_review"
    ].includes(need)
  );

  const advancedStage =
    stage === "decision" ||
    stage === "action";

  if (
    advancedStage ||
    (concreteProject && actionableNeed)
  ) {
    return result(
      "offer_contact",
      advancedStage
        ? "buyer_ready_for_next_step"
        : "specific_project_next_step"
    );
  }

  if (
    ["consideration", "evaluation"].includes(stage) ||
    needs.length > 0
  ) {
    return result(
      "guide_forward",
      "help_customer_progress"
    );
  }

  return result(
    "continue_advising",
    "exploration_no_contact_needed"
  );
}
