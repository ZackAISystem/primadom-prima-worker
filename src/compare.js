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


export function extractProjectComparisonTarget(
  message = "",
  currentProjectSlug = ""
) {
  const raw =
    normalizePhrase(message);

  const current =
    slugToName(
      currentProjectSlug
    );

  const parts =
    raw.split(
      /\s+(?:vs\.?|versus|with)\s+/i
    );

  if (parts.length >= 2) {
    const left =
      cleanSide(parts[0]);

    const right =
      cleanSide(
        parts.slice(1).join(" ")
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
      ) &&
      right
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
      ) &&
      left
    ) {
      return left;
    }

    if (right) {
      return right;
    }
  }

  return null;
}
