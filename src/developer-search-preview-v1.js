import { groupDeveloperProjectMatchesV1 } from "./developer-project-groups-v1.js";
import { supabaseSelect, supabaseRpc } from "./supabase.js";
import { discoverDevelopersV1 } from "./developer-discovery-v1.js";

export async function handleD4DeveloperPreview(request, env) {

  // D4 grouping preview. Not a production search endpoint.
  if (request.method === "POST") {
    let payload;

    try {
      const type = request.headers.get("content-type") || "";

      if (!type.includes("application/json")) {
        return Response.json(
          { error: "json_required" },
          { status: 415 }
        );
      }

      const raw = await request.text();

      if (raw.length > 1500000) {
        return Response.json(
          { error: "payload_too_large" },
          { status: 413 }
        );
      }

      payload = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "invalid_json" },
        { status: 400 }
      );
    }

    if (
      payload?.version !== "DeveloperProjectMatchesV1" ||
      payload?.language !== "en" ||
      !Array.isArray(payload?.matched_projects) ||
      payload.matched_projects.length > 3000 ||
      typeof payload.query !== "string" ||
      payload.query.length > 500 ||
      payload.total_matching_projects !==
        payload.matched_projects.length
    ) {
      return Response.json(
        { error: "invalid_matches_contract" },
        { status: 400 }
      );
    }

    try {
      const registry = await supabaseSelect(
        env,
        "knowledge_registry_v1",
        "select=page_id,page_type_id,language_code,url_path,canonical_url_path,primary_entity_type,primary_entity_slug" +
        "&language_code=eq.en" +
        "&page_type_id=eq.developer_page" +
        "&limit=1000"
      );

      const result = groupDeveloperProjectMatchesV1({
        matchedProjects: payload.matched_projects,
        registryDevelopers: registry,
        offset: Math.max(0, Math.min(1000, Math.trunc(Number(payload.offset) || 0))),
        batchSize: 3
      });

      return Response.json({
        ...result,
        query: payload.query,
        language: "en",
        preview_only: true
      });
    } catch (error) {
      console.error("d4_grouping_preview_failed", error);

      return Response.json(
        { error: "developer_grouping_unavailable" },
        { status: 503 }
      );
    }
  }

  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405 }
    );
  }

  const url = new URL(request.url);

  // DeveloperPortfolioProjectsV1 — isolated portfolio lookup.
  if (url.searchParams.has("project_developer")) {
    const slug = String(url.searchParams.get("project_developer") || "");

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
      return Response.json({error:"invalid_developer"}, {status:400});
    }

    // D4_25_QUICK_CLOSE: optional named portfolio filters.
    const propertyType = String(url.searchParams.get("property_type") || "").toLowerCase();
    const maxPriceRaw = url.searchParams.get("max_price");
    const maxPrice = maxPriceRaw === null ? null : Number(maxPriceRaw);
    if ((propertyType && propertyType !== "villa") ||
        (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice <= 0))) {
      return Response.json({error:"invalid_portfolio_filter"}, {status:400});
    }

    try {
      // D4_20_PORTFOLIO_ALIASES — exact registry slug first; unique one-word alias second.
      let registry = await supabaseSelect(
        env, "knowledge_registry_v1",
        "select=page_id,primary_entity_slug" +
        "&language_code=eq.en&page_type_id=eq.developer_page" +
        "&primary_entity_slug=eq." + encodeURIComponent(slug) +
        "&limit=2"
      );

      if (Array.isArray(registry) && registry.length === 0 && !slug.includes("-")) {
        const alias = await supabaseSelect(
          env, "knowledge_registry_v1",
          "select=page_id,primary_entity_slug" +
          "&language_code=eq.en&page_type_id=eq.developer_page" +
          "&primary_entity_slug=like." + encodeURIComponent(slug + "-*") +
          "&limit=5"
        );
        if (Array.isArray(alias) && alias.length === 1) registry = alias;
      }

      if (!Array.isArray(registry) || registry.length !== 1) {
        return Response.json({error:"developer_not_found"}, {status:404});
      }
      const canonicalDeveloperSlug = String(registry[0].primary_entity_slug || "")
        .replace(/-(?:pjsc|pjsc|jsc|psc|plc|llc|ltd|limited)$/i, "");

      const source = await fetch(
        "https://primadom.ai/search/project-projections-v3/en.json",
        {cf:{cacheTtl:600,cacheEverything:true}}
      );

      if (!source.ok) throw new Error("projection_" + source.status);

      const catalog = await source.json();
      if (!Array.isArray(catalog.projects)) {
        throw new Error("invalid_project_catalog");
      }

      const key = x => String(x || "").toLowerCase()
        .replace(/&/g," and ")
        .replace(/[^a-z0-9]+/g,"-")
        .replace(/^-+|-+$/g,"");

      const matches = catalog.projects.filter(p =>
        // D4_22_ALDAR_PORTFOLIO_MATCH — normalize legal suffix on both sides;
        // allow exact verified Aldar brand alias used in the project projection.
        (() => {
          const projectKey = key(p.machine_developer || p.developer)
            .replace(/-(?:pjsc|jsc|psc|plc|llc|ltd|limited)$/i, "");
          return projectKey === canonicalDeveloperSlug ||
            (canonicalDeveloperSlug === "aldar-properties" && projectKey === "aldar");
        })() &&
        p.slug && p.canonical_url?.startsWith("/en/projects/") &&
        (!propertyType || String(p.machine_property_type || p.property_type || "")
          .toLowerCase().split(/[·,|/]/).some(t => t.trim() === propertyType)) &&
        (maxPrice === null || (Number(p.price_amount) > 0 &&
          Number(p.price_amount) <= maxPrice))
      );

      const results = matches.slice(0,10).map((p,i) => ({
        ...p,
        rank:i+1,
        score:0,
        entity_type:"project"
      }));

      return Response.json({
        version:"SearchContextV1",
        source:"prima_worker_developer_portfolio_v1",
        language:"en",
        entity_type:"project",
        query:slug.replace(/-/g," ") + " projects",
        state:matches.length ? "results" : "empty",
        result_count:matches.length,
        results_shown:results.length,
        current_batch_offset:0,
        filters:{
          developer:matches[0]?.machine_developer || null,
          ...(propertyType ? {property_type:propertyType} : {}),
          ...(maxPrice !== null ? {budget_max:maxPrice} : {})
        },
        results
      });
    } catch (error) {
      console.error("developer_portfolio_failed",error);
      return Response.json({error:"portfolio_unavailable"},{status:503});
    }
  }

  const query = (url.searchParams.get("q") || "").trim();

  if (query.length > 500) {
    return Response.json(
      { error: "query_too_long" },
      { status: 400 }
    );
  }

  const offset = Math.max(
    0,
    Math.min(1000, Number(url.searchParams.get("offset")) || 0)
  );


  // d4DirectFacetsV1: Worker-only; no site page or iframe.
  const faceted = /\bdevelopers?\b/i.test(query) &&
    /\b(?:abu dhabi|dubai|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|in|with|under|below|aed|villas?|apartments?|townhouses?)\b/i.test(query);

  if (faceted) {
    try {
      const source = await fetch(
        "https://primadom.ai/search/project-projections-v3/en.json",
        { cf: { cacheTtl: 600, cacheEverything: true } }
      );
      if (!source.ok) throw new Error("projection_http_" + source.status);
      const projection = await source.json();
      const projects = projection?.projects;
      if (!Array.isArray(projects) || projects.length < 1 || projects.length > 4000)
        throw new Error("invalid_projection");

      const city = query.match(/\b(ras al khaimah|umm al quwain|abu dhabi|dubai|sharjah|ajman|fujairah)\b/i)?.[1]?.toLowerCase();
      const type = /\bvillas?\b/i.test(query) ? "villa" :
        /\bapartments?\b/i.test(query) ? "apartment" :
        /\btownhouses?\b/i.test(query) ? "townhouse" : null;
      const budget = query.match(/\b(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?\b/i);
      const amount = budget ? Number(budget[1].replace(/,/g, "")) : null;
      const unit = (budget?.[2] || "").toLowerCase();
      const maxPrice = amount === null ? null :
        amount * (["million","m"].includes(unit) ? 1000000 :
        ["thousand","k"].includes(unit) ? 1000 : 1);

      const matches = projects.filter(p => {
        if (city && String(p.machine_emirate || "").toLowerCase() !== city) return false;
        if (type && !String(p.machine_property_type || "").toLowerCase().includes(type)) return false;
        if (maxPrice !== null) {
          const price = Number(p.price_amount);
          if (!Number.isFinite(price) || price <= 0 || price > maxPrice) return false;
        }
        return true;
      });

      const registry = await supabaseSelect(env, "knowledge_registry_v1",
        "select=page_id,page_type_id,language_code,url_path,primary_entity_type,primary_entity_slug" +
        "&language_code=eq.en&page_type_id=eq.developer_page&limit=1000");

      const grouped = groupDeveloperProjectMatchesV1({
        matchedProjects: matches,
        registryDevelopers: registry,
        offset,
        batchSize: 3
      });

      return Response.json({
        ...grouped,
        query,
        language: "en",
        source: "prima_worker_direct_projection"
      });
    } catch (error) {
      console.error("d4_direct_filter_failed", error);
      return Response.json({ error: "developer_filters_unavailable" }, { status: 503 });
    }
  }

  try {
    const result = await discoverDevelopersV1({
      query,
      offset,
      batchSize: 3,
      select: (table, params) =>
        supabaseSelect(env, table, params)
    });

    // D4 local-only: inspect existing developer Knowledge.
    if (
      url.searchParams.get("knowledge_probe") === "1" &&
      result.results.length > 0
    ) {
      const developer = result.results[0];

      const bundle = await supabaseRpc(
        env,
        "resolve_knowledge_bundle_v2",
        {
          p_page_id: developer.page_id,
          p_project_slug: null,
          p_language_code: "en",
          p_current_families: [
            "short_summary",
            "developer_facts",
            "projects_portfolio",
            "districts_segment"
          ],
          p_district_families: [],
          p_conversation_id: null
        }
      );

      const blocks = Array.isArray(bundle?.current_blocks)
        ? bundle.current_blocks
        : [];

      return Response.json({
        version: "DeveloperKnowledgeProbeV1",
        developer,
        block_count: blocks.length,
        blocks: blocks.map(block => ({
          keys: Object.keys(block),
          sample: JSON.stringify(block).slice(0, 1200)
        }))
      });
    }

    let profile = null;
    if (result.result_count === 1 && result.results.length === 1 && offset === 0) {
      try {
        const bundle = await supabaseRpc(env, "resolve_knowledge_bundle_v2", {
          p_page_id: result.results[0].page_id,
          p_project_slug: null,
          p_language_code: "en",
          p_current_families: ["short_summary","developer_facts","projects_portfolio","districts_segment"],
          p_district_families: [],
          p_conversation_id: null
        });
        const b = Object.fromEntries((bundle?.current_blocks || []).map(x => [x.block_family, x.final_block_json || {}]));
        const fact = key => (b.developer_facts?.items || []).find(x => x.label === key)?.value || null;
        const count = Number(b.projects_portfolio?.total_project_count);
        profile = {
          founded: fact("Founded"),
          market: fact("Market"),
          summary: b.short_summary?.body_text || "",
          focus: (b.districts_segment?.segment_profile?.tags || []).slice(0, 2),
          areas: (b.districts_segment?.districts?.items || []).filter(x => String(x.href || "").startsWith("/en/areas/")).map(x => x.label).slice(0, 2),
          linked_projects: Number.isInteger(count) && count > 0 ? count : null
        };
      } catch (e) {
        console.warn("d4_profile_unavailable", e);
      }
    }
    return Response.json({
      ...result,
      developer_profile: profile,
      language: "en"
    });
  } catch (error) {
    console.error("d4_developer_preview_failed", error);

    return Response.json(
      { error: "developer_search_unavailable" },
      { status: 503 }
    );
  }
}
