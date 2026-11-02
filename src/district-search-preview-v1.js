
import { discoverDistrictsV1 } from "./district-discovery-v1.js";
import { searchDistrictIntelligenceV1 } from "./district-intelligence-search-v1.js";
import {
  parseDistrictBudgetQueryV1,
  searchDistrictBudgetV1,
  matchDistrictBudgetProjectV1
} from "./district-budget-search-v1.js";
import { parseDistrictCombinedQueryV1, searchDistrictCombinedV1 } from "./district-combined-search-v1.js";
import {
  parseDistrictDeveloperQueryV1,
  searchDistrictDeveloperV1,
  matchDistrictDeveloperProjectV1
} from "./district-developer-search-v1.js";

import { supabaseSelect, supabaseRpc } from "./supabase.js";

const norm = v => String(v || "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export async function handleD5DistrictPreview(request, env) {
  if (request.method !== "GET") {
    return Response.json({error:"method_not_allowed"},{status:405});
  }

  const u = new URL(request.url);
  const query = String(u.searchParams.get("q") || "").trim();
  const slug = String(u.searchParams.get("district") || "").trim();

  try {
    if (!slug) {
      if (query.length > 300) {
        return Response.json({error:"query_too_long"},{status:400});
      }

      // D5_EMIRATE_ROUTING_V1
      const geoMatch = query.match(
        /^(?:(?:show(?: me)?|find|list|browse)\s+)?(?:all\s+)?(?:the\s+)?(?:districts|areas|neighbou?rhoods|communities)\s+in\s+(dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|uaq|rak)\s*[.!?]?$/i
      );

      const geoNames = {
        "dubai": "Dubai",
        "abu dhabi": "Abu Dhabi",
        "sharjah": "Sharjah",
        "ajman": "Ajman",
        "ras al khaimah": "Ras Al Khaimah",
        "rak": "Ras Al Khaimah",
        "fujairah": "Fujairah",
        "umm al quwain": "Umm Al Quwain",
        "uaq": "Umm Al Quwain"
      };

      const emirate = geoMatch
        ? geoNames[geoMatch[1].toLowerCase()]
        : "";

      // D5_INTELLIGENCE_WORKER_V1
      // Qualitative intelligence search has priority only when
      // its strict criteria parser accepts the query.
      // Other queries continue through existing District Discovery.
      const intelligenceOffset = Math.max(
        0,
        Math.min(
          1000,
          Math.trunc(Number(u.searchParams.get("offset")) || 0)
        )
      );

      // D5_13_DEVELOPER_WORKER_ROUTE_V1
      // Cross-entity discovery: existing project projection ->
      // developer identity -> eligible districts.
      // D3 and D4 search engines are not modified.
      const developerCriteria =
        parseDistrictDeveloperQueryV1(query);

      if (developerCriteria) {
        const developerSource = await fetch(
          "https://primadom.ai/search/project-projections-v3/en.json",
          {cf:{cacheTtl:600,cacheEverything:true}}
        );

        if (!developerSource.ok) {
          throw new Error(
            "district_developer_projection_http_" +
            developerSource.status
          );
        }

        const developerCatalog = await developerSource.json();

        if (!Array.isArray(developerCatalog.projects)) {
          throw new Error("invalid_district_developer_catalog");
        }

        const developerResults = searchDistrictDeveloperV1({
          query,
          projects:developerCatalog.projects,
          offset:intelligenceOffset,
          batchSize:3
        });

        return Response.json(developerResults);
      }

      // D5_COMBINED_WORKER_V1
      // Intersect qualitative district traits with verified
      // Project Projection fields before simple budget routing.
      const combinedCriteria = parseDistrictCombinedQueryV1(query);

      if (combinedCriteria) {
        const combinedSource = await fetch(
          "https://primadom.ai/search/project-projections-v3/en.json",
          {cf:{cacheTtl:600,cacheEverything:true}}
        );

        if (!combinedSource.ok) {
          throw new Error(
            "district_combined_projection_http_" +
            combinedSource.status
          );
        }

        const combinedCatalog = await combinedSource.json();

        if (!Array.isArray(combinedCatalog.projects)) {
          throw new Error("invalid_district_combined_catalog");
        }

        const combinedResults = searchDistrictCombinedV1({
          query,
          projects: combinedCatalog.projects,
          offset: intelligenceOffset,
          batchSize: 3
        });

        return Response.json(combinedResults);
      }

      // D5_DISTRICT_BUDGET_WORKER_V1
      // Recognize structural budget queries before general discovery.
      // Read the existing catalog; do not persist or duplicate it.
      const budgetCriteria = parseDistrictBudgetQueryV1(query);

      if (budgetCriteria) {
        const catalogResponse = await fetch(
          "https://primadom.ai/search/project-projections-v3/en.json",
          {cf:{cacheTtl:600,cacheEverything:true}}
        );

        if (!catalogResponse.ok) {
          throw new Error(
            "district_budget_projection_http_" +
            catalogResponse.status
          );
        }

        const catalog = await catalogResponse.json();

        if (!Array.isArray(catalog.projects)) {
          throw new Error("invalid_district_budget_catalog");
        }

        const budgetResults = searchDistrictBudgetV1({
          query,
          projects:catalog.projects,
          offset:intelligenceOffset,
          batchSize:3
        });

        return Response.json(budgetResults);
      }

      const intelligence = searchDistrictIntelligenceV1({
        query,
        offset: intelligenceOffset,
        batchSize: 3
      });

      if (intelligence) {
        return Response.json(intelligence);
      }

      return Response.json(await discoverDistrictsV1({
        query,
        emirate,
        // D5_LIST_PAGINATION_FIX
        offset: Math.max(0, Math.min(1000,
          Math.trunc(Number(u.searchParams.get("offset")) || 0))),
        batchSize: 3,
        select:(table,q)=>supabaseSelect(env,table,q)
      }));
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return Response.json({error:"invalid_district"},{status:400});
    }

    const registry = await supabaseSelect(
      env,"knowledge_registry_v1",
      "select=page_id,primary_entity_slug,url_path,primary_entity_type" +
      "&language_code=eq.en&page_type_id=eq.district_page" +
      "&primary_entity_slug=eq." + encodeURIComponent(slug) + "&limit=2"
    );

    if (registry.length !== 1 ||
        registry[0].primary_entity_type !== "district" ||
        registry[0].url_path !== `/en/areas/${slug}/`) {
      return Response.json({error:"district_not_found"},{status:404});
    }


    // D5_CARD_PROFILE_V1 — read existing district Knowledge.
    if (u.searchParams.get("mode") === "profile") {
      let blocks = [];

      try {
        const bundle = await supabaseRpc(
          env,
          "resolve_knowledge_bundle_v2",
          {
            p_page_id: registry[0].page_id,
            p_project_slug: null,
            p_language_code: "en",
            p_current_families: [
              "hero",
              "short_summary",
              "area_facts"
            ],
            p_district_families: [],
            p_conversation_id: null
          }
        );

        blocks = Array.isArray(bundle?.current_blocks)
          ? bundle.current_blocks
          : [];
      } catch (error) {
        console.warn("d5_profile_bundle_unavailable", error);
      }

      const body = row => {
        const value = row?.final_block_json;

        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        }

        return value && typeof value === "object"
          ? value
          : {};
      };

      let hero = blocks
        .map(body)
        .find(b => b?.district_name);

      if (!hero) {
        try {
          const extra = await supabaseSelect(
            env,
            "knowledge_blocks_v1",
            "select=block_key,final_block_json" +
            "&page_id=eq." +
            encodeURIComponent(registry[0].page_id) +
            "&block_key=eq.block_03_hero&limit=1"
          );

          hero = extra
            .map(body)
            .find(b => b?.image?.src);
        } catch (error) {
          console.warn("d5_profile_hero_unavailable", error);
        }
      }

      const summary = blocks
        .map(body)
        .find(b => b?.body_text || b?.body_html) || {};


      // D5_PUBLIC_HERO_FALLBACK_V1
      // Knowledge first; canonical published district page second.
      const photo = String(hero?.image?.src || "");

      const allowedPhoto = value => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:" &&
            parsed.hostname === "imagedelivery.net" &&
            parsed.pathname.startsWith("/p1-SJXO2awSjvEV3gBSWEg/") &&
            /\/(?:desktop|mobile)$/.test(parsed.pathname);
        } catch {
          return false;
        }
      };

      let image = allowedPhoto(photo) ? photo : "";
      let imageSource = image ? "district_knowledge" : "none";

      if (!image) {
        try {
          const pageUrl =
            "https://primadom.ai" + registry[0].url_path;

          const page = await fetch(pageUrl, {
            cf: {cacheTtl:600,cacheEverything:true}
          });

          if (page.ok) {
            const html = await page.text();

            const imgTags =
              html.match(/<img\b[^>]*>/gi) || [];

            const mainImage = imgTags.find(tag =>
              /\balt\s*=\s*(?:"Main image\b|'Main image\b|Main image\b)/i
                .test(tag)
            );

            const attr = mainImage?.match(
              /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i
            );

            const candidate = String(
              attr?.[1] || attr?.[2] || attr?.[3] || ""
            ).replace(/&amp;/g, "&");

            if (allowedPhoto(candidate)) {
              image = candidate;
              imageSource = "published_district_page";
            }
          }
        } catch (error) {
          console.warn(
            "d5_public_hero_unavailable",
            String(error)
          );
        }
      }


      const trustedPhoto =
        /^https:\/\/imagedelivery\.net\//.test(photo) ||
        /^https:\/\/primadom\.ai\//.test(photo);

      return Response.json({
        version: "DistrictCardProfileV1",
        slug,
        image,
        image_source: imageSource,
        image_alt: String(hero?.image?.alt || ""),
        city: String(hero?.city || hero?.emirate || ""),
        subtitle: String(
          hero?.subtitle ||
          summary?.body_text ||
          ""
        )
      });
    }

    // D5_13_SHARED_DEVELOPER_PROJECT_MATCH_V1
    const developer = String(
      u.searchParams.get("developer") || ""
    ).trim();

    const type = String(u.searchParams.get("property_type") || "").toLowerCase();
    const rawBudget = u.searchParams.get("max_price");
    const budget = rawBudget === null ? null : Number(rawBudget);
    const mode = u.searchParams.get("mode") || "projects";

    if (!["projects","developers"].includes(mode) ||
        (type && !["villa","apartment","townhouse"].includes(type)) ||
        (developer && (
          developer.length > 80 ||
          !/^[a-z0-9][a-z0-9 .'&-]*$/i.test(developer)
        )) ||
        (budget !== null && (!Number.isFinite(budget) || budget <= 0))) {
      return Response.json({error:"invalid_filters"},{status:400});
    }

    const source = await fetch(
      "https://primadom.ai/search/project-projections-v3/en.json",
      {cf:{cacheTtl:600,cacheEverything:true}}
    );
    if (!source.ok) throw new Error("projection_http_" + source.status);

    const catalog = await source.json();
    if (!Array.isArray(catalog.projects)) {
      throw new Error("invalid_project_catalog");
    }

    // D5_SHARED_PROJECT_MATCH_V1
    // Budget-filtered project lists use the exact same eligibility
    // rule as the district-level project counters.
    const budgetSeen = new Set();
    const developerSeen = new Set();

    const matches = catalog.projects.filter(project => {
      // Developer-filtered lists and district counters use
      // exactly the same project eligibility rule.
      if (developer) {
        const eligible = matchDistrictDeveloperProjectV1(
          project, {
            developer,
            emirate:null,
            property_type:type || null,
            budget_max:budget
          }
        );

        if (eligible?.district?.slug !== slug) return false;

        const identity = slug + "|" + project.canonical_url;

        if (developerSeen.has(identity)) return false;
        developerSeen.add(identity);
        return true;
      }

      if (budget !== null) {
        const resolved = matchDistrictBudgetProjectV1(project, {
          emirate: null,
          property_type: type || null,
          max_price_aed: budget
        });

        if (resolved?.slug !== slug) return false;

        const identity = resolved.slug + "|" + project.canonical_url;

        if (budgetSeen.has(identity)) return false;
        budgetSeen.add(identity);
        return true;
      }

      // Existing non-budget searches remain unchanged.
      if (norm(project.machine_district || project.district) !== norm(slug)) return false;
      if (!project.slug || !project.canonical_url?.startsWith("/en/projects/")) return false;

      if (type && !String(project.machine_property_type || project.property_type || "")
        .toLowerCase().split(/[·,|/]/).some(t => {
          const value = t.trim();

          return value === type ||
            (type === "villa" &&
              /(?:^|\s)villas?$/.test(value));
        })) return false;
      // D5_VILLA_SUBTYPE_FIX_V2

      return true;
    });

    // D5_13_DEVELOPER_GEOGRAPHY_CONSISTENCY_V1
    // Use the SAME district / emirate eligibility as the
    // developer -> district -> projects search.
    if (mode === "developers") {
      const grouped = new Map();
      const seen = new Set();

      for (const project of matches) {
        const name = String(
          project.machine_developer ||
          project.developer ||
          ""
        ).trim();

        if (!name) continue;

        const eligible = matchDistrictDeveloperProjectV1(
          project, {
            developer:name,
            emirate:null,
            property_type:type || null,
            budget_max:budget
          }
        );

        if (eligible?.district?.slug !== slug) continue;

        const identity = slug + "|" + project.canonical_url;

        if (seen.has(identity)) continue;
        seen.add(identity);

        const key = norm(name);
        const current = grouped.get(key) || {
          name,
          project_count:0
        };

        current.project_count++;
        grouped.set(key,current);
      }

      return Response.json({
        version:"DistrictDevelopersV1",
        district:slug,
        result_count:grouped.size,
        results:[...grouped.values()].sort((a,b)=>
          b.project_count-a.project_count ||
          a.name.localeCompare(b.name))
      });
    }

    // D5_PROJECT_PAGINATION_V2
    const requestedOffset =
      Number(u.searchParams.get("offset") || 0);

    const projectOffset =
      Number.isSafeInteger(requestedOffset) &&
      requestedOffset >= 0
        ? Math.min(requestedOffset, matches.length)
        : 0;

    const projectBatch =
      matches.slice(projectOffset, projectOffset + 3);

    return Response.json({
      version:"SearchContextV1",
      source:"prima_worker_district_projects_v1",
      language:"en",
      entity_type:"project",
      query:query || "Projects in " + slug.replace(/-/g," "),
      state:matches.length ? "results" : "empty",
      result_count:matches.length,
      results_shown:projectBatch.length,
      current_batch_offset:projectOffset,
      has_more:projectOffset + projectBatch.length < matches.length,
      next_offset:projectOffset + projectBatch.length,
      filters:{
        developer:developer || null,
        district:slug,
        ...(type ? {property_type:type} : {}),
        ...(budget !== null ? {budget_max:budget} : {})
      },
      results:projectBatch.map((project,i)=>({
        ...project,rank:projectOffset+i+1,entity_type:"project"
      }))
    });
  } catch(error) {
    console.error("d5_district_preview_failed",error);
    return Response.json({error:"district_search_unavailable"},{status:503});
  }
}
