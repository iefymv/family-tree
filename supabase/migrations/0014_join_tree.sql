-- 0014_join_tree.sql — «присоединиться к дереву»: человек входит семейным паролем, получает
-- свою карточку без связей, а потом сам показывает на дереве, кто ему кто (link_relative).
-- Поиск родственника и самодобавление со связью при входе (0013, family_self_add) больше не нужны.

drop function public.family_self_add(uuid, uuid, text, jsonb, text, text);

-- ---------------------------------------------------------------- карточка без связей + вход
-- Одной транзакцией: человек и вход family_login. Автор карточки — новый пользователь,
-- подпись в истории — его display_name. Учётку в auth создаёт Edge Function и удаляет при сбое.
create function public.family_self_create(p_user uuid, p_fields jsonb, p_login text, p_display text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_allowed constant text[] := array['surname', 'given_name', 'sex', 'birth_date_text', 'birth_date_from', 'birth_date_to'];
  v_fields  jsonb := coalesce(p_fields, '{}'::jsonb);
  v_bad     text[];
  v_cols    text;
  v_person  uuid;
  v_claims  text := current_setting('request.jwt.claims', true);
  v_sub     text := current_setting('request.jwt.claim.sub', true);
begin
  if jsonb_typeof(v_fields) <> 'object' or coalesce(v_fields ->> 'given_name', '') = '' or coalesce(v_fields ->> 'surname', '') = '' then
    raise exception 'given_name and surname are required' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_bad from jsonb_object_keys(v_fields) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'fields not allowed: %', array_to_string(v_bad, ', ') using errcode = '22023';
  end if;
  -- auth.uid() внутри триггеров stamp_insert/audit_row читает эти claims.
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v_fields) k;
  execute format(
    'insert into public.people (%1$s) select %1$s from jsonb_populate_record(null::public.people, $1) returning id', v_cols
  ) into v_person using v_fields;
  insert into public.members (user_id, person_id, login, display_name, role, family_login)
    values (p_user, v_person, p_login, p_display, 'relative', true);
  -- audit_row писал правку до появления строки members и подписал её 'unknown'.
  update public.edits set actor_label = p_display where actor = p_user and actor_label = 'unknown';
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_person;
end;
$$;
revoke execute on function public.family_self_create(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.family_self_create(uuid, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------- связь между УЖЕ существующими людьми
-- kind — кто other для self: parent (other — родитель self), child, spouse, sibling.
-- Семантика как у add_relative_core: у человека не больше двух родителей; второй родитель становится
-- супругом первого; ребёнку достаётся и текущий супруг; брат/сестра получает родителей other
-- (если их нет — placeholder-родитель). Вызывает участник за свою карточку или админ.
-- auth.uid() — вызывающий, поэтому created_by и actor в edits — он.
create function public.link_relative(self_person uuid, other_person uuid, kind text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_kind    text := link_relative.kind;
  v_self    uuid := link_relative.self_person;
  v_other   uuid := link_relative.other_person;
  v_parents uuid[];
  v_ph      uuid;
  v_spouse  uuid;
  v_rel_ids uuid[] := '{}';
  v_id      uuid;
  p         uuid;
  parents_of constant text := 'select coalesce(array_agg(r.from_person order by r.created_at), ''{}'') from public.relations_live r
    where r.kind = ''parent'' and r.to_person = $1 and r.parent_type in (''biological'', ''adoptive'', ''unknown'')';
begin
  if not private.is_member() then
    raise exception 'members only' using errcode = '42501';
  end if;
  if not private.is_admin() and not exists (
    select 1 from public.members m where m.user_id = (select auth.uid()) and m.person_id = v_self and not m.disabled
  ) then
    raise exception 'only for your own card' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('parent', 'spouse', 'child', 'sibling') then
    raise exception 'kind % is not allowed', v_kind using errcode = '22023';
  end if;
  if v_self is null or v_other is null or v_self = v_other then
    raise exception 'two different people are required' using errcode = '22023';
  end if;
  -- Оба живые и настоящие; блокировка в порядке id — без взаимных блокировок.
  perform 1 from public.people where id in (v_self, v_other) and deleted_at is null and not is_placeholder
    order by id for update;
  if (select count(*) from public.people where id in (v_self, v_other) and deleted_at is null and not is_placeholder) <> 2 then
    raise exception 'person not found' using errcode = 'P0002';
  end if;

  if v_kind = 'spouse' then
    if exists (select 1 from public.relations_live r where r.kind = 'spouse'
               and r.from_person = least(v_self, v_other) and r.to_person = greatest(v_self, v_other)) then
      raise exception 'already linked' using errcode = '23505';
    end if;
    v_rel_ids := v_rel_ids || private.add_spouse(v_self, v_other);

  elsif v_kind = 'parent' then
    execute parents_of into v_parents using v_self;
    if v_other = any (v_parents) then raise exception 'already linked' using errcode = '23505'; end if;
    if cardinality(v_parents) >= 2 then raise exception 'person already has two parents' using errcode = '23514'; end if;
    insert into public.relations (kind, from_person, to_person, parent_type)
      values ('parent', v_other, v_self, 'biological') returning id into v_id;
    v_rel_ids := v_rel_ids || v_id;
    if cardinality(v_parents) = 1 and not exists (select 1 from public.relations_live r where r.kind = 'spouse'
         and r.from_person = least(v_parents[1], v_other) and r.to_person = greatest(v_parents[1], v_other)) then
      v_rel_ids := v_rel_ids || private.add_spouse(v_parents[1], v_other);
    end if;

  elsif v_kind = 'child' then
    execute parents_of into v_parents using v_other;
    if v_self = any (v_parents) then raise exception 'already linked' using errcode = '23505'; end if;
    if cardinality(v_parents) >= 2 then raise exception 'person already has two parents' using errcode = '23514'; end if;
    insert into public.relations (kind, from_person, to_person, parent_type)
      values ('parent', v_self, v_other, 'biological') returning id into v_id;
    v_rel_ids := v_rel_ids || v_id;
    if cardinality(v_parents) = 0 then
      select case when r.from_person = v_self then r.to_person else r.from_person end into v_spouse
        from public.relations_live r
        where r.kind = 'spouse' and v_self in (r.from_person, r.to_person) and r.end_text is null
        order by r.spouse_order desc nulls last, r.created_at desc
        limit 1;
      if v_spouse is not null and v_spouse <> v_other then
        insert into public.relations (kind, from_person, to_person, parent_type)
          values ('parent', v_spouse, v_other, 'biological') returning id into v_id;
        v_rel_ids := v_rel_ids || v_id;
      end if;
    end if;

  else  -- sibling: self получает родителей other
    execute parents_of into v_parents using v_self;
    if cardinality(v_parents) > 0 then
      raise exception 'person already has parents' using errcode = '23514';
    end if;
    execute parents_of into v_parents using v_other;
    if cardinality(v_parents) = 0 then
      insert into public.people (is_placeholder, sex) values (true, 'u') returning id into v_ph;
      insert into public.relations (kind, from_person, to_person, parent_type)
        values ('parent', v_ph, v_other, 'biological') returning id into v_id;
      v_rel_ids := v_rel_ids || v_id;
      v_parents := array[v_ph];
    end if;
    foreach p in array v_parents loop
      insert into public.relations (kind, from_person, to_person, parent_type)
        values ('parent', p, v_self, 'biological') returning id into v_id;
      v_rel_ids := v_rel_ids || v_id;
    end loop;
  end if;

  return jsonb_build_object('relation_ids', to_jsonb(v_rel_ids), 'placeholder_id', v_ph);
end;
$$;
revoke execute on function public.link_relative(uuid, uuid, text) from public, anon;
grant execute on function public.link_relative(uuid, uuid, text) to authenticated;
