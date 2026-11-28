// R2.2 typed task authorization; no lexical router and no side effects.
// A plan is derived exclusively from the already validated Luna tasks.
const ROUTES = new Set(["compare", "property_search", "market_question",
  "page_question", "exact_fact", "recommendation", "follow_up"]);

export function buildTypedTaskPlanV1({interpretation = null, phase = "initial"} = {}) {
  const raw = Array.isArray(interpretation?.tasks) ? interpretation.tasks : [];
  const tasks = raw.filter(task => task && ROUTES.has(task.route))
    .slice(0, 4).map((task, index) => ({
      id: index + 1, route: task.route,
      needs_clarification: task.needs_clarification === true
    }));
  const routes = new Set(tasks.map(task => task.route));
  const mixedCompareSearch = phase === "initial" &&
    interpretation?.primary_route === "compare" &&
    tasks.length >= 2 && tasks.length === raw.length &&
    routes.has("compare") && routes.has("property_search") &&
    !tasks.some(task => task.needs_clarification);
  return Object.freeze({
    version: "TypedTaskPlanV1",
    mode: mixedCompareSearch ? "compare_and_search" : "single_or_other",
    tasks,
    requires_comparison: routes.has("compare"),
    requires_search: routes.has("property_search"),
    fully_completed: false
  });
}

// A quoted instruction is not permission to execute it. This guard may only
// narrow authorization; Luna/Policy are still the primary decision makers.
export function hasExplicitNoSearchV1(message = "") {
  const text = String(message || "");
  return /\b(?:do\s+not|don't|dont|without|no)\s+(?:want\s+(?:you\s+)?to\s+|need\s+(?:you\s+)?to\s+|ask\s+(?:you\s+)?to\s+|(?:you\s+)?to\s+)?(?:run\s+(?:the\s+|a\s+)?|perform\s+(?:the\s+|a\s+)?|execute\s+(?:the\s+|a\s+)?|make\s+(?:the\s+|a\s+)?)?(?:search|look\s+up|browse)\b/i.test(text) ||
    /\b(?:cancel|stop|skip)\s+(?:the\s+|that\s+|any\s+)?search\b/i.test(text) ||
    /\b(?:do\s+not|don't|dont)\s+want\s+(?:any\s+|property\s+)?(?:listings|search\s+results)\b/i.test(text);
}
