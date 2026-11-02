-- Prima AI Day 3 — Search Knowledge V1
-- Search already selected the projects.
-- This RPC only hydrates verified Knowledge for top 3.

begin;

CREATE OR REPLACE FUNCTION prima.resolve_search_project_knowledge_v1(
  p_project_slugs text[],
  p_language_code text DEFAULT 'en'::text,
  p_families text[] DEFAULT ARRAY[
    'key_facts'::text,
    'buyer_fit'::text,
    'project_logic'::text
  ]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'prima'
AS $function$

with requested as (
  select
    lower(trim(x.slug)) as project_slug,
    x.ordinality::int as candidate_rank
  from unnest(
    coalesce(
      p_project_slugs,
      array[]::text[]
    )
  ) with ordinality as x(slug, ordinality)
  where x.ordinality <= 3
    and nullif(trim(x.slug), '') is not null
),

resolved_pages as (
  select
    q.candidate_rank,
    q.project_slug,
    r.page_id,
    coalesce(
      rel.project_name,
      q.project_slug
    ) as entity_name
  from requested q
  join prima.knowledge_registry_v1 r
    on r.primary_entity_slug = q.project_slug
   and r.primary_entity_type = 'project'
   and r.page_type_id = 'project_page'
   and r.language_code = p_language_code
  left join prima.knowledge_project_relations_v1 rel
    on rel.project_slug = q.project_slug
),

selected_blocks as (
  select
    p.candidate_rank,
    p.project_slug,
    p.entity_name,
    p.page_id,
    b.block_key,
    b.block_index,
    b.block_family,
    b.final_block_json,
    b.content_version_id
  from resolved_pages p
  join prima.knowledge_blocks_v1 b
    on b.page_id = p.page_id
  where b.block_family = any(
    coalesce(
      p_families,
      array[]::text[]
    )
  )
)

select jsonb_build_object(
  'version',
  'SearchKnowledgeBundleV1',

  'resolved',
  exists(
    select 1
    from resolved_pages
  ),

  'candidate_count',
  (
    select count(*)
    from resolved_pages
  ),

  'blocks',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'entity_type', 'project',
          'entity_slug', project_slug,
          'entity_name', entity_name,
          'candidate_rank', candidate_rank,
          'page_id', page_id,
          'block_key', block_key,
          'block_index', block_index,
          'block_family', block_family,
          'final_block_json', final_block_json,
          'content_version_id', content_version_id
        )
        order by
          candidate_rank,
          block_index
      )
      from selected_blocks
    ),
    '[]'::jsonb
  )
);

$function$;

revoke all on function
  prima.resolve_search_project_knowledge_v1(
    text[],
    text,
    text[]
  )
from public, anon, authenticated;

grant execute on function
  prima.resolve_search_project_knowledge_v1(
    text[],
    text,
    text[]
  )
to service_role;

commit;
