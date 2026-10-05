-- Prima AI Day 2 runtime database objects
-- Snapshot generated from live Supabase definitions on 2026-10-05.
-- Includes Day 2 RPCs, least-privilege execute grants, and lookup index.
-- Persona is intentionally NOT part of this migration.

begin;

-- ============================================================
-- prima.persist_memory_fact_v2
-- ============================================================
CREATE OR REPLACE FUNCTION prima.persist_memory_fact_v2(p_conversation_id uuid, p_visitor_id uuid, p_source_message_id uuid, p_fact_key text, p_fact_value jsonb, p_confidence numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
    v_current prima.memory_facts%rowtype;
    v_new     prima.memory_facts%rowtype;
begin
    if p_conversation_id is null then
        raise exception 'conversation_id_required';
    end if;

    if nullif(trim(p_fact_key), '') is null then
        raise exception 'fact_key_required';
    end if;

    /*
      Serialize writes for one conversation + fact key.
      Prevents two concurrent background tasks from
      creating competing active rows.
    */
    perform pg_advisory_xact_lock(
        hashtext(
            p_conversation_id::text
            || ':'
            || p_fact_key
        )::bigint
    );

    select *
    into v_current
    from prima.memory_facts
    where conversation_id = p_conversation_id
      and fact_key = p_fact_key
      and status = 'active'
    order by updated_at desc
    limit 1
    for update;

    /*
      Same fact again:
      keep the same active row.
      No duplicate memory history row.
    */
    if found
       and v_current.fact_value = p_fact_value
    then
        update prima.memory_facts
        set
            confidence = greatest(
                coalesce(confidence, 0),
                coalesce(p_confidence, 0)
            ),
            visitor_id = coalesce(
                visitor_id,
                p_visitor_id
            ),
            updated_at = now()
        where memory_id = v_current.memory_id
        returning *
        into v_current;

        return jsonb_build_object(
            'action', 'confirmed',
            'memory_id', v_current.memory_id,
            'fact_key', v_current.fact_key,
            'fact_value', v_current.fact_value,
            'confidence', v_current.confidence
        );
    end if;

    /*
      Different/new value:
      supersede old + insert new
      inside ONE database transaction.
    */
    update prima.memory_facts
    set
        status = 'superseded',
        updated_at = now()
    where conversation_id = p_conversation_id
      and fact_key = p_fact_key
      and status = 'active';

    insert into prima.memory_facts (
        conversation_id,
        visitor_id,
        fact_key,
        fact_value,
        confidence,
        source_message_id,
        status
    )
    values (
        p_conversation_id,
        p_visitor_id,
        p_fact_key,
        p_fact_value,
        p_confidence,
        p_source_message_id,
        'active'
    )
    returning *
    into v_new;

    return jsonb_build_object(
        'action',
        case
            when v_current.memory_id is null
                then 'inserted'
            else 'replaced'
        end,
        'memory_id', v_new.memory_id,
        'fact_key', v_new.fact_key,
        'fact_value', v_new.fact_value,
        'confidence', v_new.confidence
    );
end;
$function$;

revoke all on function prima.persist_memory_fact_v2(uuid, uuid, uuid, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function prima.persist_memory_fact_v2(uuid, uuid, uuid, text, jsonb, numeric) to service_role;

-- ============================================================
-- prima.resolve_cross_page_candidates_v1
-- ============================================================
CREATE OR REPLACE FUNCTION prima.resolve_cross_page_candidates_v1(p_project_slug text, p_language_code text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with rel as (
    select
        project_id,
        project_slug,
        project_name,
        developer_id,
        developer_slug,
        developer_name,
        district_id,
        district_slug,
        district_name,
        developer_relation_status,
        district_relation_status
    from prima.knowledge_project_relations_v1
    where project_slug = p_project_slug
    limit 1
),

district_page as (
    select
        r.page_id,
        r.page_type_id,
        r.language_code,
        r.url_path,
        r.canonical_url_path,
        r.primary_entity_type,
        r.primary_entity_id,
        r.primary_entity_slug
    from prima.knowledge_registry_v1 r
    join rel
      on r.primary_entity_slug = rel.district_slug
    where r.language_code = p_language_code
      and r.page_type_id = 'district_page'
    limit 1
),

buyer_scenarios as (
    select
        r.page_id,
        r.page_type_id,
        r.url_path,

        r.metadata->>'scenario_name'
            as scenario_name,

        r.metadata->>'buyer_goal'
            as buyer_goal,

        r.metadata->>'buyer_persona'
            as buyer_persona,

        r.metadata->>'scenario_group'
            as scenario_group,

        r.metadata->>'property_type_focus'
            as property_type_focus,

        case
          when coalesce(
            r.metadata->>'scenario_fit_score',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'
          then
            (r.metadata->>'scenario_fit_score')::numeric
          else 0
        end as scenario_fit_score,

        case
          when coalesce(
            r.metadata->>'budget_min_aed',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'
          then
            (r.metadata->>'budget_min_aed')::numeric
          else null
        end as budget_min_aed,

        case
          when coalesce(
            r.metadata->>'budget_max_aed',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'
          then
            (r.metadata->>'budget_max_aed')::numeric
          else null
        end as budget_max_aed

    from prima.knowledge_registry_v1 r
    join rel
      on r.primary_entity_slug = rel.district_slug

    where r.language_code = p_language_code
      and r.page_type_id = 'buyer_scenario_page'

    limit 50
)

select jsonb_build_object(
    'resolved',
    exists(select 1 from rel),

    'relation',
    coalesce(
      (select to_jsonb(x) from rel x),
      'null'::jsonb
    ),

    'district_page',
    coalesce(
      (select to_jsonb(x) from district_page x),
      'null'::jsonb
    ),

    'buyer_scenarios',
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from buyer_scenarios x
      ),
      '[]'::jsonb
    )
);
$function$;

revoke all on function prima.resolve_cross_page_candidates_v1(text, text) from public, anon, authenticated;
grant execute on function prima.resolve_cross_page_candidates_v1(text, text) to service_role;

-- ============================================================
-- prima.resolve_knowledge_bundle_v1
-- ============================================================
CREATE OR REPLACE FUNCTION prima.resolve_knowledge_bundle_v1(p_page_id text, p_project_slug text, p_language_code text DEFAULT 'en'::text, p_current_families text[] DEFAULT ARRAY[]::text[], p_district_families text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$

with rel as (
    select
        project_id,
        project_slug,
        project_name,

        developer_id,
        developer_slug,
        developer_name,

        district_id,
        district_slug,
        district_name,

        developer_relation_status,
        district_relation_status

    from prima.knowledge_project_relations_v1

    where project_slug = p_project_slug

    limit 1
),


current_blocks as (
    select
        b.page_id,
        b.block_key,
        b.block_index,
        b.block_family,
        b.final_block_json,
        b.content_version_id

    from prima.knowledge_blocks_v1 b

    where b.page_id = p_page_id

      and b.block_family = any(
        coalesce(
          p_current_families,
          array[]::text[]
        )
      )

    order by b.block_index asc

    limit 12
),


district_page as (
    select
        r.page_id,
        r.page_type_id,
        r.language_code,
        r.url_path,
        r.canonical_url_path,

        r.primary_entity_type,
        r.primary_entity_id,
        r.primary_entity_slug

    from prima.knowledge_registry_v1 r

    join rel
      on r.primary_entity_slug =
         rel.district_slug

    where r.language_code =
          p_language_code

      and r.page_type_id =
          'district_page'

    limit 1
),


district_blocks as (
    select
        b.page_id,
        b.block_key,
        b.block_index,
        b.block_family,
        b.final_block_json,
        b.content_version_id

    from prima.knowledge_blocks_v1 b

    join district_page d
      on d.page_id = b.page_id

    where b.block_family = any(
      coalesce(
        p_district_families,
        array[]::text[]
      )
    )

    order by b.block_index asc

    limit 12
),


buyer_scenarios as (
    select
        r.page_id,
        r.page_type_id,
        r.url_path,

        r.metadata->>'scenario_name'
          as scenario_name,

        r.metadata->>'buyer_goal'
          as buyer_goal,

        r.metadata->>'buyer_persona'
          as buyer_persona,

        r.metadata->>'scenario_group'
          as scenario_group,

        r.metadata->>'property_type_focus'
          as property_type_focus,

        case
          when coalesce(
            r.metadata->>'scenario_fit_score',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'

          then
            (
              r.metadata
                ->>'scenario_fit_score'
            )::numeric

          else 0
        end as scenario_fit_score,

        case
          when coalesce(
            r.metadata->>'budget_min_aed',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'

          then
            (
              r.metadata
                ->>'budget_min_aed'
            )::numeric

          else null
        end as budget_min_aed,

        case
          when coalesce(
            r.metadata->>'budget_max_aed',
            ''
          ) ~ '^[0-9]+([.][0-9]+)?$'

          then
            (
              r.metadata
                ->>'budget_max_aed'
            )::numeric

          else null
        end as budget_max_aed

    from prima.knowledge_registry_v1 r

    join rel
      on r.primary_entity_slug =
         rel.district_slug

    where r.language_code =
          p_language_code

      and r.page_type_id =
          'buyer_scenario_page'

    limit 50
)


select jsonb_build_object(

    'resolved',
    exists(
      select 1
      from current_blocks
    ),


    'current_blocks',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(x)
          order by x.block_index
        )

        from current_blocks x
      ),
      '[]'::jsonb
    ),


    'relation',
    coalesce(
      (
        select to_jsonb(x)
        from rel x
      ),
      'null'::jsonb
    ),


    'district_page',
    coalesce(
      (
        select to_jsonb(x)
        from district_page x
      ),
      'null'::jsonb
    ),


    'district_blocks',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(x)
          order by x.block_index
        )

        from district_blocks x
      ),
      '[]'::jsonb
    ),


    'buyer_scenarios',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(x)
        )

        from buyer_scenarios x
      ),
      '[]'::jsonb
    )

);

$function$;

revoke all on function prima.resolve_knowledge_bundle_v1(text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function prima.resolve_knowledge_bundle_v1(text, text, text, text[], text[]) to service_role;

-- ============================================================
-- prima.resolve_knowledge_bundle_v2
-- ============================================================
CREATE OR REPLACE FUNCTION prima.resolve_knowledge_bundle_v2(p_page_id text, p_project_slug text, p_language_code text DEFAULT 'en'::text, p_current_families text[] DEFAULT ARRAY[]::text[], p_district_families text[] DEFAULT ARRAY[]::text[], p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$

with base as (
    select prima.resolve_knowledge_bundle_v1(
        p_page_id,
        p_project_slug,
        p_language_code,
        p_current_families,
        p_district_families
    ) as j
),

active_memory as (
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'fact_key', mf.fact_key,
                'fact_value', mf.fact_value,
                'confidence', mf.confidence,
                'updated_at', mf.updated_at
            )
            order by mf.updated_at asc
        ),
        '[]'::jsonb
    ) as items

    from prima.memory_facts mf

    where p_conversation_id is not null
      and mf.conversation_id = p_conversation_id
      and mf.status = 'active'
)

select
    coalesce(
        (select j from base),
        '{}'::jsonb
    )
    ||
    jsonb_build_object(
        'active_memory',
        (select items from active_memory)
    );

$function$;

revoke all on function prima.resolve_knowledge_bundle_v2(text, text, text, text[], text[], uuid) from public, anon, authenticated;
grant execute on function prima.resolve_knowledge_bundle_v2(text, text, text, text[], text[], uuid) to service_role;

-- ============================================================
-- prima.resolve_project_compare_bundle_v1
-- ============================================================
CREATE OR REPLACE FUNCTION prima.resolve_project_compare_bundle_v1(p_current_project_slug text, p_other_query text, p_language_code text DEFAULT 'en'::text, p_families text[] DEFAULT ARRAY['short_answer'::text, 'key_facts'::text, 'buyer_fit'::text, 'project_logic'::text, 'location'::text, 'decision_cards'::text], p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'prima', 'entities', 'pages', 'content'
AS $function$

with
normalized as (
    select
        lower(trim(coalesce(p_other_query, ''))) as other_name,
        lower(
            replace(
                trim(coalesce(p_other_query, '')),
                ' ',
                '-'
            )
        ) as other_slug
),

current_project as (
    select
        p.project_id,
        p.project_slug,
        p.project_name
    from entities.projects p
    where p.project_slug = p_current_project_slug
    limit 1
),

other_matches as (
    select
        p.project_id,
        p.project_slug,
        p.project_name,

        case
            when lower(p.project_name) = n.other_name
              or lower(p.project_slug) = n.other_slug
                then 0

            when lower(p.project_name)
                 like n.other_name || '%'
              or lower(p.project_slug)
                 like n.other_slug || '%'
                then 1

            else 2
        end as match_score

    from entities.projects p
    cross join normalized n

    where
        lower(p.project_name)
            like '%' || n.other_name || '%'

        or

        lower(p.project_slug)
            like '%' || n.other_slug || '%'
),

best_match_score as (
    select min(match_score) as score
    from other_matches
),

other_candidates as (
    select
        m.project_id,
        m.project_slug,
        m.project_name
    from other_matches m
    join best_match_score b
      on b.score = m.match_score
    order by m.project_name
    limit 10
),

candidate_count as (
    select count(*)::int as n
    from other_candidates
),

selected_other as (
    select *
    from other_candidates
    where (
        select n
        from candidate_count
    ) = 1
    limit 1
),

resolved_gate as (
    select (
        exists(
            select 1
            from current_project
        )
        and
        (
            select n
            from candidate_count
        ) = 1
    ) as can_load
),

current_page as (
    select
        r.page_id,
        r.page_type_id,
        r.language_code,
        r.url_path,
        r.canonical_url_path,
        r.primary_entity_id,
        r.primary_entity_slug
    from prima.knowledge_registry_v1 r
    join current_project p
      on p.project_slug = r.primary_entity_slug
    cross join resolved_gate g
    where g.can_load
      and r.language_code = p_language_code
      and r.page_type_id = 'project_page'
    limit 1
),

other_page as (
    select
        r.page_id,
        r.page_type_id,
        r.language_code,
        r.url_path,
        r.canonical_url_path,
        r.primary_entity_id,
        r.primary_entity_slug
    from prima.knowledge_registry_v1 r
    join selected_other p
      on p.project_slug = r.primary_entity_slug
    cross join resolved_gate g
    where g.can_load
      and r.language_code = p_language_code
      and r.page_type_id = 'project_page'
    limit 1
),

current_relation as (
    select
        r.project_id,
        r.project_slug,
        r.project_name,
        r.developer_id,
        r.developer_slug,
        r.developer_name,
        r.district_id,
        r.district_slug,
        r.district_name,
        r.developer_relation_status,
        r.district_relation_status
    from prima.knowledge_project_relations_v1 r
    join current_project p
      on p.project_slug = r.project_slug
    cross join resolved_gate g
    where g.can_load
    limit 1
),

other_relation as (
    select
        r.project_id,
        r.project_slug,
        r.project_name,
        r.developer_id,
        r.developer_slug,
        r.developer_name,
        r.district_id,
        r.district_slug,
        r.district_name,
        r.developer_relation_status,
        r.district_relation_status
    from prima.knowledge_project_relations_v1 r
    join selected_other p
      on p.project_slug = r.project_slug
    cross join resolved_gate g
    where g.can_load
    limit 1
),

current_blocks as (
    select
        b.page_id,
        b.block_key,
        b.block_index,
        b.block_family,
        b.final_block_json,
        b.content_version_id
    from prima.knowledge_blocks_v1 b
    join current_page p
      on p.page_id = b.page_id
    where b.block_family = any(
        coalesce(
            p_families,
            array[]::text[]
        )
    )
    order by b.block_index
    limit 12
),

other_blocks as (
    select
        b.page_id,
        b.block_key,
        b.block_index,
        b.block_family,
        b.final_block_json,
        b.content_version_id
    from prima.knowledge_blocks_v1 b
    join other_page p
      on p.page_id = b.page_id
    where b.block_family = any(
        coalesce(
            p_families,
            array[]::text[]
        )
    )
    order by b.block_index
    limit 12
),

active_memory as (
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'fact_key', mf.fact_key,
                'fact_value', mf.fact_value,
                'confidence', mf.confidence,
                'updated_at', mf.updated_at
            )
            order by mf.updated_at asc
        ),
        '[]'::jsonb
    ) as items

    from prima.memory_facts mf
    cross join resolved_gate g

    where g.can_load
      and p_conversation_id is not null
      and mf.conversation_id = p_conversation_id
      and mf.status = 'active'
)

select jsonb_build_object(

    'status',
    case
        when not exists(
            select 1
            from current_project
        )
            then 'current_not_found'

        when (
            select n
            from candidate_count
        ) = 0
            then 'other_not_found'

        when (
            select n
            from candidate_count
        ) > 1
            then 'ambiguous'

        when not exists(
            select 1
            from other_page
        )
            then 'other_page_not_found'

        else 'resolved'
    end,

    'candidates',
    coalesce(
        (
            select jsonb_agg(
                to_jsonb(x)
                order by x.project_name
            )
            from other_candidates x
        ),
        '[]'::jsonb
    ),

    'current_project',
    coalesce(
        (
            select to_jsonb(x)
            from current_project x
        ),
        'null'::jsonb
    ),

    'other_project',
    coalesce(
        (
            select to_jsonb(x)
            from selected_other x
        ),
        'null'::jsonb
    ),

    'current_page',
    coalesce(
        (
            select to_jsonb(x)
            from current_page x
        ),
        'null'::jsonb
    ),

    'other_page',
    coalesce(
        (
            select to_jsonb(x)
            from other_page x
        ),
        'null'::jsonb
    ),

    'current_relation',
    coalesce(
        (
            select to_jsonb(x)
            from current_relation x
        ),
        'null'::jsonb
    ),

    'other_relation',
    coalesce(
        (
            select to_jsonb(x)
            from other_relation x
        ),
        'null'::jsonb
    ),

    'current_blocks',
    coalesce(
        (
            select jsonb_agg(
                to_jsonb(x)
                order by x.block_index
            )
            from current_blocks x
        ),
        '[]'::jsonb
    ),

    'other_blocks',
    coalesce(
        (
            select jsonb_agg(
                to_jsonb(x)
                order by x.block_index
            )
            from other_blocks x
        ),
        '[]'::jsonb
    ),

    'active_memory',
    coalesce(
        (
            select items
            from active_memory
        ),
        '[]'::jsonb
    )
);

$function$;

revoke all on function prima.resolve_project_compare_bundle_v1(text, text, text, text[], uuid) from public, anon, authenticated;
grant execute on function prima.resolve_project_compare_bundle_v1(text, text, text, text[], uuid) to service_role;

-- ============================================================
-- Prima page/entity lookup index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_page_index_prima_entity_lookup_v1 ON pages.page_index USING btree (page_type_id, language_code, primary_entity_slug) WHERE ((metadata ->> 'archived_by'::text) IS NULL);

commit;
