-- 0005_soft_delete.sql — штампы автора/времени, запрет прямой смены deleted_at,
-- мягкое удаление и восстановление только через RPC.

-- BEFORE INSERT: автор и время ставит сервер, значения клиента игнорируются.
-- Ключи, которых нет в типе строки (uploaded_by у people и т.п.), jsonb_populate_record пропускает.
create function private.stamp_insert() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if (to_jsonb(new) ->> 'deleted_at') is not null then
    raise exception 'deleted_at cannot be set on insert' using errcode = '42501';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(
    'created_by',  v_uid,
    'uploaded_by', v_uid,
    'created_at',  now(),
    'updated_by',  null,
    'updated_at',  null
  ));
  return new;
end;
$$;

-- BEFORE UPDATE: deleted_at меняется только из RPC (app.allow_deleted_at = on),
-- автор/время создания и путь файла неизменны, updated_by/updated_at ставит сервер.
create function private.guard_update() returns trigger
language plpgsql set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  f text;
begin
  if (n -> 'deleted_at') is distinct from (o -> 'deleted_at')
     and coalesce(current_setting('app.allow_deleted_at', true), '') <> 'on' then
    raise exception 'deleted_at can only be changed via soft_delete/restore' using errcode = '42501';
  end if;
  foreach f in array array['id', 'created_by', 'created_at', 'uploaded_by', 'storage_path', 'person_id'] loop
    -- person_id неизменен только у documents (путь файла привязан к человеку)
    continue when f = 'person_id' and tg_table_name <> 'documents';
    if (n -> f) is distinct from (o -> f) then
      raise exception 'column % is immutable', f using errcode = '42501';
    end if;
  end loop;
  new := jsonb_populate_record(new, jsonb_build_object(
    'updated_by', auth.uid(),
    'updated_at', now()
  ));
  return new;
end;
$$;

create trigger stamp_insert before insert on public.people    for each row execute function private.stamp_insert();
create trigger stamp_insert before insert on public.relations for each row execute function private.stamp_insert();
create trigger stamp_insert before insert on public.facts     for each row execute function private.stamp_insert();
create trigger stamp_insert before insert on public.documents for each row execute function private.stamp_insert();

create trigger guard_update before update on public.people    for each row execute function private.guard_update();
create trigger guard_update before update on public.relations for each row execute function private.guard_update();
create trigger guard_update before update on public.facts     for each row execute function private.guard_update();
create trigger guard_update before update on public.documents for each row execute function private.guard_update();

-- Общая проверка прав на мягкое удаление/восстановление.
create function private.check_soft_delete_access(p_table text) returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_table is null or p_table not in ('people', 'relations', 'facts', 'documents') then
    raise exception 'table % is not allowed', p_table using errcode = '22023';
  end if;
  if p_table in ('people', 'documents') then
    if not private.is_admin() then
      raise exception 'only admin can delete or restore %', p_table using errcode = '42501';
    end if;
  elsif not private.is_member() then
    raise exception 'members only' using errcode = '42501';
  end if;
end;
$$;

create function public.soft_delete(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
begin
  perform private.check_soft_delete_access(p_table);
  perform set_config('app.allow_deleted_at', 'on', true);
  execute format('update public.%I set deleted_at = now() where id = $1 and deleted_at is null', p_table)
    using p_id;
  get diagnostics v_n = row_count;
  perform set_config('app.allow_deleted_at', '', true);
  if v_n = 0 then
    raise exception 'row not found or already deleted' using errcode = 'P0002';
  end if;
end;
$$;

create function public.restore(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
begin
  perform private.check_soft_delete_access(p_table);
  perform set_config('app.allow_deleted_at', 'on', true);
  execute format('update public.%I set deleted_at = null where id = $1 and deleted_at is not null', p_table)
    using p_id;
  get diagnostics v_n = row_count;
  perform set_config('app.allow_deleted_at', '', true);
  if v_n = 0 then
    raise exception 'row not found or not deleted' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.stamp_insert(), private.guard_update(), private.check_soft_delete_access(text) from public, anon, authenticated;
revoke execute on function public.soft_delete(text, uuid), public.restore(text, uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid), public.restore(text, uuid) to authenticated;
