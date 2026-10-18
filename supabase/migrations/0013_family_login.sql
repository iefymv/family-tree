-- 0013_family_login.sql — вход родственника по семейному паролю (Edge Function family-login).
-- members.family_login = true — учётка создана семейным входом и живёт на семейном пароле;
-- только такие учётки можно открыть семейным паролем (админ и входы со своим паролем — нет).
-- Счётчик неудачных попыток — в непубличной схеме private; функция ходит к нему через RPC под service_role.

-- ---------------------------------------------------------------- members.family_login
alter table public.members add column family_login boolean not null default false;

-- ---------------------------------------------------------------- счётчик попыток
create table private.family_login_attempts (
  id bigint generated always as identity primary key,
  ip text not null check (length(ip) between 1 and 100),
  at timestamptz not null default now()
);
create index family_login_attempts_ip_at on private.family_login_attempts (ip, at);
create index family_login_attempts_at on private.family_login_attempts (at);
alter table private.family_login_attempts enable row level security;
revoke all on private.family_login_attempts from public, anon, authenticated;

-- Неудачных попыток за 15 минут: с этого ip и всего (общий потолок — на случай подмены заголовка ip).
create function public.family_login_fails(p_ip text) returns table (ip_fails int, all_fails int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::int from private.family_login_attempts a where a.ip = p_ip and a.at > now() - interval '15 minutes'),
    (select count(*)::int from private.family_login_attempts a where a.at > now() - interval '15 minutes');
$$;

-- Записать неудачную попытку; заодно выбросить записи старше суток.
create function public.family_login_fail(p_ip text) returns void
language sql security definer set search_path = ''
as $$
  delete from private.family_login_attempts where at < now() - interval '1 day';
  insert into private.family_login_attempts (ip) values (p_ip);
$$;

-- ---------------------------------------------------------------- add_relative без проверки прав
-- Тело public.add_relative (0011) вынесено в private.add_relative_core, чтобы семейный вход
-- добавлял человека той же логикой. Права проверяют обёртки: add_relative — is_member(),
-- family_self_add выдана только service_role.
create function private.add_relative_core(anchor uuid, kind text, fields jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
#variable_conflict use_column
declare
  v_allowed  constant text[] := array[
    'surname', 'given_name', 'patronymic', 'maiden_name', 'name_variants', 'sex',
    'birth_date_text', 'birth_date_from', 'birth_date_to', 'birth_place',
    'death_date_text', 'death_date_from', 'death_date_to', 'death_place',
    'is_placeholder', 'needs_check', 'notes', 'occupation', 'life_story'];
  v_kind     text := add_relative_core.kind;
  v_anchor   uuid := add_relative_core.anchor;
  v_fields   jsonb := coalesce(add_relative_core.fields, '{}'::jsonb);
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
revoke all on function private.add_relative_core(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.add_relative(anchor uuid, kind text, fields jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_member() then
    raise exception 'members only' using errcode = '42501';
  end if;
  return private.add_relative_core(anchor, kind, fields);
end;
$$;

-- ---------------------------------------------------------------- самодобавление семейным входом
-- Одной транзакцией: человек и связи с якорем (как add_relative), затем вход family_login.
-- Автор строк (created_by, edits.actor) — новый пользователь, подпись в истории — его display_name.
-- Учётку в auth создаёт Edge Function до вызова и удаляет, если вызов упал.
create function public.family_self_add(
  p_user uuid, p_anchor uuid, p_kind text, p_fields jsonb, p_login text, p_display text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_res    jsonb;
  v_person uuid;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  -- auth.uid() внутри триггеров stamp_insert/audit_row читает эти claims.
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_res := private.add_relative_core(p_anchor, p_kind, p_fields);
  v_person := (v_res -> 'person' ->> 'id')::uuid;
  insert into public.members (user_id, person_id, login, display_name, role, family_login)
    values (p_user, v_person, p_login, p_display, 'relative', true);
  -- audit_row писал правки до появления строки members и подписал их 'unknown' (пользователь новый —
  -- все его правки из этой транзакции).
  update public.edits set actor_label = p_display where actor = p_user and actor_label = 'unknown';
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_person;
end;
$$;

revoke execute on function public.family_login_fails(text), public.family_login_fail(text),
  public.family_self_add(uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.family_login_fails(text), public.family_login_fail(text),
  public.family_self_add(uuid, uuid, text, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------- админка видит family_login
drop function public.admin_list_members();
create function public.admin_list_members()
returns table (user_id uuid, person_id uuid, login text, display_name text, role text, disabled boolean,
               created_at timestamptz, family_login boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.person_id, m.login, m.display_name, m.role, m.disabled, m.created_at, m.family_login
    from public.members m
    order by m.created_at;
end;
$$;
revoke execute on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;
