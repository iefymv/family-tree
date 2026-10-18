-- 0011_add_relative.sql — «+» на дереве одной транзакцией: человек и его связи с якорем.
-- Семантика как в app/src/tree/mutate.ts:
--   parent  — новый → якорь; если у якоря уже один родитель (в раскладке) — новый становится его супругом;
--   spouse  — брак (from < to) с номером max+1;
--   child   — якорь → новый, плюс текущий (нерасторгнутый, с наибольшим номером) супруг якоря;
--   sibling — общие родители якоря; если родителей нет — сначала placeholder-родитель.
-- DEFINER обходит RLS, поэтому права проверяются явно (is_member). auth.uid() читается из JWT-claims
-- запроса и под DEFINER, поэтому created_by (stamp_insert) и actor в edits (audit_row) — вызывающий.

create function public.add_relative(anchor uuid, kind text, fields jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_allowed  constant text[] := array[
    'surname', 'given_name', 'patronymic', 'maiden_name', 'name_variants', 'sex',
    'birth_date_text', 'birth_date_from', 'birth_date_to', 'birth_place',
    'death_date_text', 'death_date_from', 'death_date_to', 'death_place',
    'is_placeholder', 'needs_check', 'notes', 'occupation', 'life_story'];
  v_kind     text := add_relative.kind;
  v_anchor   uuid := add_relative.anchor;
  v_fields   jsonb := coalesce(add_relative.fields, '{}'::jsonb);
  v_bad      text[];
  v_cols     text;
  v_parents  uuid[];
  v_spouse   uuid;
  v_person   public.people%rowtype;
  v_ph       public.people%rowtype;
  v_rel_ids  uuid[] := '{}';
  v_id       uuid;
  p          uuid;
begin
  if not private.is_member() then
    raise exception 'members only' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('parent', 'spouse', 'child', 'sibling') then
    raise exception 'kind % is not allowed', v_kind using errcode = '22023';
  end if;
  if jsonb_typeof(v_fields) <> 'object' then
    raise exception 'fields must be an object' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_bad from jsonb_object_keys(v_fields) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'fields not allowed: %', array_to_string(v_bad, ', ') using errcode = '22023';
  end if;

  -- Якорь живой; блокировка сериализует параллельные «+» у одного человека.
  perform 1 from public.people where id = v_anchor and deleted_at is null for update;
  if not found then
    raise exception 'person % not found', v_anchor using errcode = 'P0002';
  end if;

  select coalesce(array_agg(r.from_person order by r.created_at), '{}') into v_parents
    from public.relations_live r
    where r.kind = 'parent' and r.to_person = v_anchor and r.parent_type in ('biological', 'adoptive', 'unknown');

  if v_kind = 'parent' and cardinality(v_parents) >= 2 then
    raise exception 'person already has two parents' using errcode = '23514';
  end if;

  -- placeholder-родитель для брата/сестры без известных родителей
  if v_kind = 'sibling' and cardinality(v_parents) = 0 then
    insert into public.people (is_placeholder, sex) values (true, 'u') returning * into v_ph;
    insert into public.relations (kind, from_person, to_person, parent_type)
      values ('parent', v_ph.id, v_anchor, 'biological') returning id into v_id;
    v_rel_ids := v_rel_ids || v_id;
    v_parents := array[v_ph.id];
  end if;

  -- Новый человек: только переданные поля из белого списка, остальное — значения по умолчанию.
  if v_fields = '{}'::jsonb then
    insert into public.people default values returning * into v_person;
  else
    select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v_fields) k;
    execute format(
      'insert into public.people (%1$s) select %1$s from jsonb_populate_record(null::public.people, $1) returning *', v_cols
    ) into v_person using v_fields;
  end if;

  if v_kind = 'spouse' then
    v_rel_ids := v_rel_ids || private.add_spouse(v_anchor, v_person.id);
  elsif v_kind = 'child' then
    insert into public.relations (kind, from_person, to_person, parent_type)
      values ('parent', v_anchor, v_person.id, 'biological') returning id into v_id;
    v_rel_ids := v_rel_ids || v_id;
    select case when r.from_person = v_anchor then r.to_person else r.from_person end into v_spouse
      from public.relations_live r
      where r.kind = 'spouse' and v_anchor in (r.from_person, r.to_person) and r.end_text is null
      order by r.spouse_order desc nulls last, r.created_at desc
      limit 1;
    if v_spouse is not null then
      insert into public.relations (kind, from_person, to_person, parent_type)
        values ('parent', v_spouse, v_person.id, 'biological') returning id into v_id;
      v_rel_ids := v_rel_ids || v_id;
    end if;
  elsif v_kind = 'parent' then
    insert into public.relations (kind, from_person, to_person, parent_type)
      values ('parent', v_person.id, v_anchor, 'biological') returning id into v_id;
    v_rel_ids := v_rel_ids || v_id;
    if cardinality(v_parents) = 1 then
      v_rel_ids := v_rel_ids || private.add_spouse(v_parents[1], v_person.id);
    end if;
  else  -- sibling
    foreach p in array v_parents loop
      insert into public.relations (kind, from_person, to_person, parent_type)
        values ('parent', p, v_person.id, 'biological') returning id into v_id;
      v_rel_ids := v_rel_ids || v_id;
    end loop;
  end if;

  return jsonb_build_object(
    'person', to_jsonb(v_person),
    'placeholder', case when v_ph.id is null then null else to_jsonb(v_ph) end,
    'relation_ids', to_jsonb(v_rel_ids));
end;
$$;

-- Брак a–b: упорядоченная пара (CHECK from < to), номер = max номеров браков a + 1.
-- Вызывается только из add_relative (под его владельцем), поэтому не DEFINER и никому не выдана.
create function private.add_spouse(a uuid, b uuid) returns uuid
language plpgsql set search_path = ''
as $$
declare
  v_order int;
  v_id    uuid;
begin
  select coalesce(max(r.spouse_order), 0) + 1 into v_order
    from public.relations_live r
    where r.kind = 'spouse' and a in (r.from_person, r.to_person);
  insert into public.relations (kind, from_person, to_person, spouse_order)
    values ('spouse', least(a, b), greatest(a, b), v_order) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.add_spouse(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.add_relative(uuid, text, jsonb) from public, anon;
grant execute on function public.add_relative(uuid, text, jsonb) to authenticated;
