-- 0006_audit.sql — история правок пишет триггер в той же транзакции, что и правка.

create function private.audit_row() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb;
  v_op      text;
  v_changed text[];
  v_actor   uuid := auth.uid();
  v_label   text;
  v_reverts bigint;
  v_is_revert boolean := coalesce(current_setting('app.audit_op', true), '') = 'revert';
begin
  if tg_op = 'INSERT' then
    v_op := 'insert';
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) k
      where k not in ('created_by', 'created_at', 'updated_by', 'updated_at', 'uploaded_by')
        and v_new -> k <> 'null'::jsonb;
  else
    v_old := to_jsonb(old);
    select array_agg(e.key order by e.key) into v_changed
      from jsonb_each(v_new) e
      where e.key not in ('updated_by', 'updated_at')
        and e.value is distinct from (v_old -> e.key);
    -- Пустой PATCH (ничего не изменилось) историю не засоряет; откат пишется всегда.
    if v_changed is null and not v_is_revert then
      return null;
    end if;
    if (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_op := 'soft_delete';
    elsif (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_op := 'restore';
    else
      v_op := 'update';
    end if;
    if v_is_revert then
      v_op := 'revert';
      v_reverts := nullif(current_setting('app.reverts_edit', true), '')::bigint;
    end if;
  end if;

  if v_actor is not null then
    select m.display_name into v_label from public.members m where m.user_id = v_actor;
    v_label := coalesce(v_label, 'unknown');
  elsif auth.role() = 'service_role' then
    v_label := 'seed';
  else
    v_label := 'system';
  end if;

  insert into public.edits (actor, actor_label, table_name, row_id, op, old, new, changed_fields, reverts_edit)
  values (v_actor, v_label, tg_table_name, (v_new ->> 'id')::uuid, v_op, v_old, v_new, coalesce(v_changed, '{}'), v_reverts);
  return null;
end;
$$;

create trigger audit_row after insert or update on public.people    for each row execute function private.audit_row();
create trigger audit_row after insert or update on public.relations for each row execute function private.audit_row();
create trigger audit_row after insert or update on public.facts     for each row execute function private.audit_row();
create trigger audit_row after insert or update on public.documents for each row execute function private.audit_row();

revoke all on function private.audit_row() from public, anon, authenticated;
