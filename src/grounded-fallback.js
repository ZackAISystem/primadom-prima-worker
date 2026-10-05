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
        String(
          item?.value || ""
        ).trim()
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

    (
      "If you tell me whether your priority is investment, " +
      "family living, budget or timing, I can compare them " +
      "on that specific criterion."
    )
  ].join(" ");
}


export function buildGroundedFallback({
  route,
  evidencePack,
  knowledgePack
}) {
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
