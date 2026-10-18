-- 0007_revert.sql — откат одной записи истории (только админ).
-- Пишет ровно одну строку edits с op='revert' (через app.audit_op / app.reverts_edit).
-- Конфликт: поле с тех пор менялось → {"conflict": [...]}, без изменений, если не p_force.

create function public.revert_edit(p_edit_id bigint, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e          public.edits%rowtype;
  v_cur      jsonb;
  v_fields   text[];
  v_target   jsonb := '{}'::jsonb;  -- что записать
  v_expected jsonb := '{}'::jsonb;  -- что должно стоять сейчас, если с тех пор не правили
  v_conflict text[];
  v_set      text;
  f          text;
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into e from public.edits where id = p_edit_id;
  if not found then
    raise exception 'edit % not found', p_edit_id using errcode = 'P0002';
  end if;
  if e.table_name not in ('people', 'relations', 'facts', 'documents') then
    raise exception 'table % is not allowed', e.table_name using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', e.table_name)
    into v_cur using e.row_id;
  if v_cur is null then
    raise exception 'row % not found', e.row_id using errcode = 'P0002';
  end if;

  if e.op = 'insert' then
    -- Откат добавления = мягкое удаление.
    v_fields   := array['deleted_at'];
    v_target   := jsonb_build_object('deleted_at', now());
    v_expected := jsonb_build_object('deleted_at', null);
  elsif e.op in ('soft_delete', 'restore') then
    v_fields   := array['deleted_at'];
    v_target   := jsonb_build_object('deleted_at', e.old -> 'deleted_at');
    v_expected := jsonb_build_object('deleted_at', e.new -> 'deleted_at');
  else  -- update, revert
    select array_agg(x order by x) into v_fields
      from unnest(e.changed_fields) x
      where x not in ('id', 'created_by', 'created_at', 'uploaded_by', 'updated_by', 'updated_at', 'storage_path')
        and v_cur ? x;
    if v_fields is null then
      raise exception 'edit % has nothing to revert', p_edit_id using errcode = '22023';
    end if;
    foreach f in array v_fields loop
      v_target   := v_target   || jsonb_build_object(f, coalesce(e.old -> f, 'null'::jsonb));
      v_expected := v_expected || jsonb_build_object(f, coalesce(e.new -> f, 'null'::jsonb));
    end loop;
  end if;

  select array_agg(x order by x) into v_conflict
    from unnest(v_fields) x
    where (v_cur -> x) is distinct from (v_expected -> x);
  if v_conflict is not null and not p_force then
    return jsonb_build_object('conflict', to_jsonb(v_conflict));
  end if;

  select string_agg(format('%I = r.%I', x, x), ', ') into v_set from unnest(v_fields) x;

  perform set_config('app.allow_deleted_at', 'on', true);
  perform set_config('app.audit_op', 'revert', true);
  perform set_config('app.reverts_edit', p_edit_id::text, true);
  execute format(
    'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2',
    e.table_name, v_set
  ) using v_target, e.row_id;
  perform set_config('app.allow_deleted_at', '', true);
  perform set_config('app.audit_op', '', true);
  perform set_config('app.reverts_edit', '', true);

  return jsonb_build_object('ok', true, 'fields', to_jsonb(v_fields), 'forced', v_conflict is not null);
end;
$$;

revoke execute on function public.revert_edit(bigint, boolean) from public, anon;
grant execute on function public.revert_edit(bigint, boolean) to authenticated;
