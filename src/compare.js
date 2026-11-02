function normalizePhrase(value = "") {
  return String(value)
    .trim()
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\s+/g, " ");
}


function slugToName(slug = "") {
  return String(slug)
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();
}


function cleanSide(value = "") {
  return normalizePhrase(value)
    .replace(
      /^(compare|comparison of|difference between)\s+/i,
      ""
    )
    .replace(
      /^(which is better[,]?\s*)/i,
      ""
    )
    .trim();
}


export function extractProjectComparisonPair(
  message = ""
) {
  const raw =
    normalizePhrase(message);

  const parts =
    raw.split(
      /\s+(?:vs\.?|versus|with)\s+/i
    );

  if (parts.length < 2) {
    return null;
  }

  const primary =
    cleanSide(parts[0]);

  const target =
    cleanSide(
      parts.slice(1).join(" ")
    );

  if (!primary || !target) {
    return null;
  }

  return {
    primary,
    target
  };
}


export function extractProjectComparisonTarget(
  message = "",
  currentProjectSlug = ""
) {
  const pair =
    extractProjectComparisonPair(
      message
    );

  if (!pair) {
    return null;
  }

  const left =
    pair.primary;

  const right =
    pair.target;

  const current =
    slugToName(
      currentProjectSlug
    );

  const leftNorm =
    left.toLowerCase();

  const rightNorm =
    right.toLowerCase();

  if (
    current &&
    (
      leftNorm === current ||
      leftNorm.endsWith(
        ` ${current}`
      )
    )
  ) {
    return right;
  }

  if (
    current &&
    (
      rightNorm === current ||
      rightNorm.endsWith(
        ` ${current}`
      )
    )
  ) {
    return left;
  }

  return right;
}
