function key(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function groupDeveloperProjectMatchesV1({
  matchedProjects = [],
  registryDevelopers = [],
  offset = 0,
  batchSize = 3
} = {}) {
  const registry = new Map();
  const ambiguous = new Set();

  for (const row of registryDevelopers) {
    if (
      row?.page_type_id !== "developer_page" ||
      row?.language_code !== "en" ||
      row?.primary_entity_type !== "developer"
    ) continue;

    const slug = String(row.primary_entity_slug || "");
    const k = key(slug);

    if (!k) continue;

    if (registry.has(k)) {
      ambiguous.add(k);
    } else {
      registry.set(k, row);
    }
  }

  for (const k of ambiguous) registry.delete(k);

  const groups = new Map();
  let unmatched = 0;

  for (const project of matchedProjects) {
    const projectSlug = String(project?.slug || "");
    const developerName = String(
      project?.machine_developer ||
      project?.developer ||
      ""
    );

    const k = key(developerName);
    const developer = registry.get(k);

    if (!projectSlug || !developer) {
      unmatched++;
      continue;
    }

    if (!groups.has(k)) {
      groups.set(k, {
        developer,
        name: developerName,
        projectSlugs: new Set(),
        emirates: new Set(),
        districts: new Set()
      });
    }

    const group = groups.get(k);

    if (group.projectSlugs.has(projectSlug)) {
      continue;
    }

    group.projectSlugs.add(projectSlug);

    if (project.machine_emirate) {
      group.emirates.add(
        String(project.machine_emirate)
      );
    }

    if (project.machine_district) {
      group.districts.add(
        String(project.machine_district)
      );
    }
  }

  const ranked = [...groups.values()]
    .sort((a, b) =>
      b.projectSlugs.size - a.projectSlugs.size ||
      a.name.localeCompare(b.name)
    );

  const start = Math.max(
    0, Math.trunc(Number(offset) || 0)
  );

  const size = Math.max(
    1, Math.min(10, Math.trunc(Number(batchSize) || 3))
  );

  const results = ranked
    .slice(start, start + size)
    .map((group, i) => ({
      rank: start + i + 1,
      entity_type: "developer",
      slug: group.developer.primary_entity_slug,
      page_id: group.developer.page_id,
      title: group.name,
      canonical_url:
        group.developer.canonical_url_path ||
        group.developer.url_path,
      matching_project_count: group.projectSlugs.size,
      emirates: [...group.emirates].sort(),
      districts: [...group.districts].sort()
    }));

  return {
    version: "DeveloperProjectGroupsV1",
    entity_type: "developer",
    state: results.length ? "results" : "empty",
    result_count: ranked.length,
    current_batch_offset: start,
    results,
    has_more: start + results.length < ranked.length,
    unmatched_project_count: unmatched
  };
}
