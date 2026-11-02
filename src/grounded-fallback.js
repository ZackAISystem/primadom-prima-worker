function sanitizeEvidenceValue(
  value
) {
  return String(value || "")
    .replace(
      /\bsrc_[a-z0-9_]+\b/gi,
      ""
    )
    .replace(
      /\s{2,}/g,
      " "
    )
    .trim();
}


function evidenceValues(
  evidencePack
) {
  return (
    evidencePack?.sources || []
  )
    .flatMap(
      source =>
        source?.items || []
    )
    .map(
      item =>
        sanitizeEvidenceValue(
          item?.value
        )
    )
    .filter(Boolean);
}


function getFact(
  evidencePack,
  label
) {
  const prefix =
    `${label}:`.toLowerCase();

  const value =
    evidenceValues(
      evidencePack
    ).find(
      item =>
        item
          .toLowerCase()
          .startsWith(prefix)
    );

  if (!value) {
    return null;
  }

  return value
    .slice(
      value.indexOf(":") + 1
    )
    .trim();
}


function getMemoryValue(
  evidencePack,
  key
) {
  return (
    evidencePack?.memory || []
  ).find(
    item =>
      item?.key === key
  )?.value ?? null;
}


function hasEvidence(
  evidencePack,
  pattern
) {
  return evidenceValues(
    evidencePack
  ).some(
    value =>
      pattern.test(value)
  );
}


function buildFamilyAnswer(
  evidencePack
) {
  const relation =
    evidencePack
      ?.selected_context
      ?.relation || {};

  const projectName =
    relation.project_name ||
    evidencePack
      ?.entity
      ?.primary_slug ||
    "This project";

  const districtName =
    relation.district_name ||
    null;

  const childrenCount =
    getMemoryValue(
      evidencePack,
      "children_count"
    );

  const units =
    getFact(
      evidencePack,
      "Units"
    );

  const status =
    getFact(
      evidencePack,
      "Status"
    );

  const handover =
    getFact(
      evidencePack,
      "Handover"
    );

  const primaryResidence =
    hasEvidence(
      evidencePack,
      /primary residence/i
    );

  const waterfront =
    hasEvidence(
      evidencePack,
      /waterfront|beachfront/i
    );

  const familyDistrict =
    hasEvidence(
      evidencePack,
      /family-oriented|families|spacious homes/i
    );

  const sentences = [];

  const familyText =
    childrenCount !== null
      ? `a family with ${childrenCount} children`
      : "a family";

  sentences.push(
    `${projectName} could suit ${familyText}.`
  );


  const fitSignals = [];

  if (primaryResidence) {
    fitSignals.push(
      "primary-residence use"
    );
  }

  if (waterfront) {
    fitSignals.push(
      "waterfront living"
    );
  }

  if (units) {
    const normalized =
      units.replace(
        /\s*\|\s*/g,
        ", "
      );

    sentences.push(
      `It offers ${normalized} options${
        fitSignals.length
          ? ` and is positioned for ${fitSignals.join(" and ")}`
          : ""
      }.`
    );
  } else if (
    fitSignals.length
  ) {
    sentences.push(
      `It is positioned for ${fitSignals.join(" and ")}.`
    );
  }


  if (
    districtName &&
    familyDistrict
  ) {
    sentences.push(
      `${districtName} also has family-oriented signals in the available district information.`
    );
  }


  if (
    status &&
    /off-plan/i.test(status)
  ) {
    if (handover) {
      sentences.push(
        `The main trade-off is that it is off-plan, with handover scheduled for ${handover}.`
      );
    } else {
      sentences.push(
        "The main trade-off is that it is off-plan."
      );
    }
  }


  return sentences
    .slice(0, 4)
    .join(" ");
}


function buildGenericAnswer(
  evidencePack
) {
  const values =
    evidenceValues(
      evidencePack
    )
      .filter(
        value =>
          value.length <= 260
      )
      .filter(
        value =>
          !/should be checked|should be confirmed|needs verification|verify before/i.test(
            value
          )
      )
      .slice(0, 3);

  if (values.length === 0) {
    return (
      "I don't have enough verified information " +
      "to answer that reliably."
    );
  }

  return values.join(" ");
}



function getRoleFact(
  evidencePack,
  role,
  labels = []
) {
  const patterns =
    labels.map(
      label =>
        new RegExp(
          `^${label}\\s*:\\s*(.+)$`,
          "i"
        )
    );

  for (
    const source
    of evidencePack?.sources || []
  ) {
    if (
      source?.role !== role
    ) {
      continue;
    }

    for (
      const item
      of source?.items || []
    ) {
      const value =
        String(
          item?.value || ""
        ).trim();

      for (
        const pattern
        of patterns
      ) {
        const match =
          value.match(pattern);

        if (match?.[1]) {
          return match[1].trim();
        }
      }
    }
  }

  return null;
}


function buildProjectCompareAnswer(
  evidencePack,
  knowledgePack
) {
  const comparison =
    knowledgePack
      ?.related_knowledge
      ?.comparison ||
    {};

  if (
    comparison.status !==
    "resolved"
  ) {
    return null;
  }

  const currentName =
    comparison
      ?.current_project
      ?.project_name ||
    "The current project";

  const otherName =
    comparison
      ?.other_project
      ?.project_name ||
    "The other project";

  const currentRelation =
    comparison
      ?.current_relation ||
    {};

  const otherRelation =
    comparison
      ?.other_relation ||
    {};


  function describe(
    name,
    relation,
    role
  ) {
    const parts = [];

    if (
      relation?.developer_name
    ) {
      parts.push(
        `by ${relation.developer_name}`
      );
    }

    if (
      relation?.district_name
    ) {
      parts.push(
        `in ${relation.district_name}`
      );
    }

    const price =
      getRoleFact(
        evidencePack,
        role,
        [
          "Price from",
          "Starting price",
          "Price"
        ]
      );

    const status =
      getRoleFact(
        evidencePack,
        role,
        ["Status"]
      );

    const handover =
      getRoleFact(
        evidencePack,
        role,
        [
          "Handover",
          "Completion",
          "Completion date"
        ]
      );

    if (price) {
      parts.push(
        `recorded starting price ${price}`
      );
    }

    if (status) {
      parts.push(
        `status ${status}`
      );
    }

    if (handover) {
      parts.push(
        `handover ${handover}`
      );
    }

    if (!parts.length) {
      return `${name}: verified project information is available, but the main comparable facts are limited.`;
    }

    return (
      `${name}: ` +
      `${parts.join(", ")}.`
    );
  }


  const topics =
    knowledgePack
      ?.planner
      ?.topics || [];

  const comparisonClosing =
    topics.includes("investment")
      ? (
          "For investment, the verified data here supports a trade-off rather " +
          "than a definitive return ranking. Entry price and handover timing " +
          "are verified, but I do not have enough verified rental, resale or " +
          "yield data here to rank expected returns reliably."
        )
      : (
          "If you tell me whether your priority is investment, " +
          "family living, budget or timing, I can compare them " +
          "on that specific criterion."
        );

  return [
    describe(
      currentName,
      currentRelation,
      "current_page"
    ),

    describe(
      otherName,
      otherRelation,
      "comparison_target"
    ),

    comparisonClosing
  ].join(" ");
}


function profileMemoryValue({
  interpretation = null,
  activeMemory = [],
  key
}) {
  const candidates =
    Array.isArray(
      interpretation?.memory_candidates
    )
      ? interpretation.memory_candidates
      : [];

  for (
    let i = candidates.length - 1;
    i >= 0;
    i -= 1
  ) {
    const item = candidates[i];

    if (
      item?.key === key &&
      item?.value &&
      Number(item?.confidence) >= 0.8
    ) {
      return item.value;
    }
  }

  for (
    let i = activeMemory.length - 1;
    i >= 0;
    i -= 1
  ) {
    const item = activeMemory[i];

    const itemKey =
      item?.fact_key ||
      item?.key ||
      item?.memory_key ||
      null;

    if (itemKey !== key) {
      continue;
    }

    const value =
      item?.fact_value ??
      item?.value ??
      item?.memory_value ??
      null;

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}


function formatAedBudget(value) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return String(value || "");
  }

  if (
    numeric >= 1000000 &&
    numeric % 1000000 === 0
  ) {
    return (
      "AED " +
      String(numeric / 1000000) +
      " million"
    );
  }

  return (
    "AED " +
    numeric.toLocaleString("en-US")
  );
}


function buildProfileUpdateFallback({
  interpretation = null,
  activeMemory = []
} = {}) {
  const get =
    key =>
      profileMemoryValue({
        interpretation,
        activeMemory,
        key
      });

  const budgetMax =
    get("budget_max_aed");

  const goal =
    get("buyer_goal");

  const horizon =
    get("investment_horizon");

  const location =
    get("preferred_location_text");

  const offPlan =
    get("off_plan_preference");

  const handoverTolerance =
    get("handover_tolerance");

  const profileParts = [];

  if (budgetMax) {
    profileParts.push(
      `a budget up to ${formatAedBudget(
        budgetMax
      )}`
    );
  }

  if (goal) {
    profileParts.push(
      `a goal of ${goal}`
    );
  }

  if (horizon) {
    profileParts.push(
      `an investment horizon of ${horizon}`
    );
  }

  if (location) {
    profileParts.push(
      `location preference: ${location}`
    );
  }

  if (offPlan) {
    profileParts.push(
      `off-plan preference: ${offPlan}`
    );
  }

  if (handoverTolerance) {
    profileParts.push(
      `handover preference: ${handoverTolerance}`
    );
  }

  let acknowledgement = null;

  if (
    String(goal || "")
      .trim()
      .toLowerCase() ===
        "investment" &&
    budgetMax &&
    horizon
  ) {
    acknowledgement =
      `With ${formatAedBudget(
        budgetMax
      )} and an investment horizon of ${horizon}, ` +
      "we already have enough to narrow the field meaningfully. " +
      "I’d focus on how entry price, handover timing and the eventual exit window work together.";
  } else if (profileParts.length) {
    acknowledgement =
      "That gives me a useful starting point. " +
      "I can narrow the options around " +
      profileParts
        .slice(0, 3)
        .join(", ") +
      ".";
  } else {
    acknowledgement =
      "That helps narrow the direction.";
  }

  let question = null;

  if (
    String(goal || "")
      .trim()
      .toLowerCase() ===
        "investment"
  ) {
    question =
      "Within investment, are you more focused on rental income, capital growth, or a balance of both?";
  } else if (!location) {
    question =
      "Are you open to Dubai, Abu Dhabi, or either?";
  } else if (!offPlan) {
    question =
      "Are you open to off-plan, or do you prefer ready property?";
  } else if (
    !handoverTolerance
  ) {
    question =
      "How long are you comfortable waiting for handover?";
  }

  return question
    ? `${acknowledgement}

${question}`
    : acknowledgement;
}


export function buildGroundedFallback({
  route,
  nextAction = null,
  evidencePack,
  knowledgePack,
  interpretation = null,
  activeMemory = []
}) {
  if (
    nextAction ===
      "PROFILE_UPDATE"
  ) {
    return buildProfileUpdateFallback({
      interpretation,
      activeMemory
    });
  }
  if (route === "compare") {
    const comparisonAnswer =
      buildProjectCompareAnswer(
        evidencePack,
        knowledgePack
      );

    if (comparisonAnswer) {
      return comparisonAnswer;
    }
  }


  const topics =
    evidencePack
      ?.planner
      ?.topics || [];

  if (
    route === "page_question" &&
    topics.includes(
      "family_living"
    )
  ) {
    return buildFamilyAnswer(
      evidencePack
    );
  }

  return buildGenericAnswer(
    evidencePack
  );
}


// Fast path for a verified single-project overview.
// Complex queries remain on the existing reasoning route.
export function buildVerifiedProjectOverview({
  message = "",
  route = null,
  nextAction = null,
  context = null,
  evidencePack = null,
  knowledgePack = null
} = {}) {
  const slug = context?.entity?.primary_slug;

  if (
    route !== "page_question" ||
    nextAction !== "KNOWLEDGE_QA" ||
    context?.entity?.primary_type !== "project" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || "")) ||
    !(Number(evidencePack?.meta?.source_count) > 0)
  ) return null;

  const subject = slug.replace(/-/g, " ");
  const query = String(message || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();

  if (!new Set([
    `tell me about ${subject}`,
    `tell me more about ${subject}`,
    `give me an overview of ${subject}`
  ]).has(query)) return null;

  const answer = buildGroundedFallback({
    route,
    nextAction,
    evidencePack,
    knowledgePack
  });

  if (
    typeof answer !== "string" ||
    answer.length < 25 ||
    /I don't have enough verified information/i.test(answer) ||
    !answer.toLowerCase().includes(subject)
  ) return null;

  return answer;
}
