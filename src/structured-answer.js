function getBlockByFamily(knowledgePack, family) {
  return (
    knowledgePack?.blocks || []
  ).find(
    block => block?.block_family === family
  ) || null;
}


function getKeyFacts(knowledgePack) {
  const block =
    getBlockByFamily(
      knowledgePack,
      "key_facts"
    );

  const facts =
    block?.final_block_json?.key_facts;

  return Array.isArray(facts)
    ? facts
    : [];
}


function findFact(knowledgePack, key) {
  return getKeyFacts(
    knowledgePack
  ).find(
    fact => fact?.key === key
  ) || null;
}


export function buildStructuredAnswer({
  message,
  route,
  knowledgePack
}) {
  if (
    route !== "exact_fact" ||
    !knowledgePack?.resolved
  ) {
    return null;
  }


  const q =
    String(message || "")
      .toLowerCase();


  // -------------------------------------------------------
  // HANDOVER
  // -------------------------------------------------------

  if (
    q.includes("handover") ||
    q.includes("completion") ||
    q.includes("completed") ||
    q.includes("complete")
  ) {
    const fact =
      findFact(
        knowledgePack,
        "handover"
      );

    if (
      fact?.value &&
      fact.value !== "—"
    ) {
      return {
        response_type: "answer",

        answer:
          `The recorded handover for ${
            knowledgePack?.page
              ?.primary_entity_slug === "passo"
              ? "Passo"
              : "this project"
          } is ${fact.value}.`,

        source: {
          type: "structured",
          block_family: "key_facts",
          fact_key: "handover"
        }
      };
    }
  }


  // -------------------------------------------------------
  // STARTING PRICE
  // -------------------------------------------------------

  if (
    q.includes("price") ||
    q.includes("cost") ||
    q.includes("starting from")
  ) {
    const fact =
      findFact(
        knowledgePack,
        "price_from"
      );

    if (
      fact?.value &&
      fact.value !== "—"
    ) {
      return {
        response_type: "answer",

        answer:
          `The recorded starting price is ${fact.value}.`,

        source: {
          type: "structured",
          block_family: "key_facts",
          fact_key: "price_from"
        }
      };
    }
  }


  return null;
}
