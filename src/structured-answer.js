function getKeyFacts(
  knowledgePack
) {
  const block =
    (
      knowledgePack?.blocks ||
      []
    ).find(
      item =>
        item?.block_family ===
        "key_facts"
    );

  const facts =
    block
      ?.final_block_json
      ?.key_facts;

  return Array.isArray(facts)
    ? facts
    : [];
}


function findFact(
  knowledgePack,
  keys = []
) {
  const wanted =
    new Set(
      keys.map(
        key =>
          String(key)
            .toLowerCase()
      )
    );

  return getKeyFacts(
    knowledgePack
  ).find(
    fact =>
      wanted.has(
        String(
          fact?.key ||
          ""
        ).toLowerCase()
      )
  ) || null;
}


function valueOf(
  fact
) {
  const value =
    fact?.value;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .trim();

  if (
    !text ||
    text === "—" ||
    /^(n\/a|na|null|unknown|tbc|tbd)$/i
      .test(text)
  ) {
    return null;
  }

  return text;
}


function humanizeSlug(
  value = ""
) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(
      part =>
        part.charAt(0)
          .toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}


function subjectName(
  knowledgePack,
  context = null
) {
  const explicit =
    context
      ?.entity
      ?.primary_name;

  if (explicit) {
    return explicit;
  }

  const slug =
    knowledgePack
      ?.page
      ?.primary_entity_slug ||
    context
      ?.entity
      ?.primary_slug ||
    null;

  return slug
    ? humanizeSlug(slug)
    : "This property";
}


const FACT_SPECS =
  Object.freeze({
    price: {
      keys: [
        "price_from"
      ],

      render:
        (name, value) =>
          `${name} starts from ${value}.`
    },

    handover: {
      keys: [
        "handover"
      ],

      render:
        (name, value) =>
          `The recorded handover for ${name} is ${value}.`
    },

    developer: {
      keys: [
        "developer"
      ],

      render:
        (name, value) =>
          `${name} is developed by ${value}.`
    },

    location: {
      keys: [
        "district",
        "location"
      ],

      render:
        (name, value) =>
          `${name} is located in ${value}.`
    },

    status: {
      keys: [
        "status"
      ],

      render:
        (name, value) =>
          `${name} is currently recorded as ${value}.`
    },

    bedrooms: {
      keys: [
        "units",
        "bedrooms"
      ],

      render:
        (name, value) =>
          `${name} currently lists ${value}.`
    },

    payment_plan: {
      keys: [
        "payment_plan",
        "payment_plan_summary",
        "payment_schedule"
      ],

      render:
        (name, value) =>
          `The recorded payment plan for ${name} is ${value}.`
    },

    service_charges: {
      keys: [
        "service_charge",
        "service_charges"
      ],

      render:
        (name, value) =>
          `The recorded service charge for ${name} is ${value}.`
    },

    unit_size: {
      keys: [
        "size_from",
        "unit_size",
        "size"
      ],

      render:
        (name, value) =>
          `${name} starts from ${value} in size.`
    }
  });


function fallbackFacts(
  message = ""
) {
  const q =
    String(message || "")
      .toLowerCase();

  const result = [];

  if (
    /\b(price|cost|how much|starting from|start from)\b/i
      .test(q)
  ) {
    result.push("price");
  }

  if (
    /\b(handover|completion|complete|completed)\b/i
      .test(q)
  ) {
    result.push("handover");
  }

  if (
    /\b(developer|who develops|who developed)\b/i
      .test(q)
  ) {
    result.push("developer");
  }

  if (
    /\b(location|where is|located|district|community)\b/i
      .test(q)
  ) {
    result.push("location");
  }

  if (
    /\b(status|off[- ]?plan|ready)\b/i
      .test(q)
  ) {
    result.push("status");
  }

  if (
    /\b(bedrooms?|unit types?|[1-9]br)\b/i
      .test(q)
  ) {
    result.push("bedrooms");
  }

  if (
    /\b(payment plan|payment schedule|installments?|instalments?)\b/i
      .test(q)
  ) {
    result.push("payment_plan");
  }

  if (
    /\b(service charge|service charges)\b/i
      .test(q)
  ) {
    result.push(
      "service_charges"
    );
  }

  if (
    /\b(size|square feet|sq ?ft|sqft)\b/i
      .test(q)
  ) {
    result.push(
      "unit_size"
    );
  }

  return [
    ...new Set(result)
  ];
}


function relationValueForFact({
  requestedFact,
  evidencePack,
  knowledgePack
}) {
  const keysByFact = {
    developer: [
      "developer_name",
      "developer"
    ],

    location: [
      "district_name",
      "location_name",
      "area_name",
      "community_name",
      "district",
      "location"
    ]
  };

  const keys =
    keysByFact[
      requestedFact
    ] || [];

  if (keys.length === 0) {
    return null;
  }

  /*
    Do not use a simple `a || b || c` chain here.

    An empty relation object is truthy in JavaScript and
    can mask a later verified relation containing the
    requested fact.

    Search every available verified relation candidate
    and return only the requested canonical fact.
  */
  const candidates = [
    evidencePack
      ?.selected_context
      ?.relation,

    ...(Array.isArray(
      knowledgePack?.relations
    )
      ? knowledgePack.relations
      : []),

    ...(Array.isArray(
      knowledgePack
        ?.related_knowledge
        ?.relations
    )
      ? knowledgePack
          .related_knowledge
          .relations
      : []),

    knowledgePack
      ?.related_knowledge
      ?.relation,

    ...(Array.isArray(
      knowledgePack
        ?.cross_page
        ?.relations
    )
      ? knowledgePack
          .cross_page
          .relations
      : [])
  ].filter(
    item =>
      item &&
      typeof item === "object"
  );

  for (const relation of candidates) {
    for (const key of keys) {
      const value =
        relation?.[key];

      if (
        value !== null &&
        value !== undefined &&
        String(value).trim()
      ) {
        return String(value).trim();
      }
    }
  }

  return null;
}

function humanFactLabel(
  fact = ""
) {
  return String(fact || "")
    .replace(/_/g, " ")
    .trim();
}


export function buildStructuredAnswer({
  message,
  route,
  knowledgePack,
  evidencePack = null,
  requestedFacts = [],
  context = null
}) {
  if (
    route !== "exact_fact" ||
    !knowledgePack?.resolved
  ) {
    return null;
  }

  const requested =
    (
      Array.isArray(
        requestedFacts
      ) &&
      requestedFacts.length > 0
    )
      ? [
          ...new Set(
            requestedFacts
          )
        ]
      : fallbackFacts(
          message
        );

  const name =
    subjectName(
      knowledgePack,
      context
    );

  const answers = [];
  const usedKeys = [];

  for (
    const requestedFact
    of requested
  ) {

    /*
      Never infer live availability
      from static content.
    */
    if (
      requestedFact ===
      "availability"
    ) {
      continue;
    }

    const spec =
      FACT_SPECS[
        requestedFact
      ];

    if (!spec) {
      continue;
    }

    const fact =
      findFact(
        knowledgePack,
        spec.keys
      );

    const structuredValue =
      valueOf(
        fact
      );

    const relationValue =
      structuredValue
        ? null
        : relationValueForFact({
            requestedFact,
            evidencePack,
            knowledgePack
          });

    const value =
      structuredValue ||
      relationValue;

    if (!value) {
      continue;
    }

    answers.push(
      spec.render(
        name,
        value
      )
    );

    usedKeys.push(
      fact?.key ||
      `relation:${requestedFact}`
    );
  }

  if (answers.length === 0) {
    const missingFact =
      requested[0] ||
      null;

    if (!missingFact) {
      return null;
    }

    return {
      response_type:
        "answer",

      answer:
        `I don't have a verified ${humanFactLabel(
          missingFact
        )} for ${name} in the available Primadom data.`,

      source: {
        type:
          "structured_missing",

        requested_fact:
          missingFact
      }
    };
  }

  return {
    response_type:
      "answer",

    answer:
      answers.join(" "),

    source: {
      type:
        "structured",

      block_family:
        "key_facts",

      fact_keys:
        usedKeys
    }
  };
}
