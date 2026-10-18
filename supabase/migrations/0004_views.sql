-- 0004_views.sql — живые представления для клиента (security_invoker: RLS вызывающего).
-- Удаление человека «каскадно» прячет его связи, факты и документы без изменения этих строк.

create view public.people_live with (security_invoker = on) as
  select p.* from public.people p
  where p.deleted_at is null;

create view public.relations_live with (security_invoker = on) as
  select r.* from public.relations r
  where r.deleted_at is null
    and exists (select 1 from public.people a where a.id = r.from_person and a.deleted_at is null)
    and exists (select 1 from public.people b where b.id = r.to_person and b.deleted_at is null);

create view public.facts_live with (security_invoker = on) as
  select f.* from public.facts f
  where f.deleted_at is null
    and exists (select 1 from public.people p where p.id = f.person_id and p.deleted_at is null);

create view public.documents_live with (security_invoker = on) as
  select d.* from public.documents d
  where d.deleted_at is null
    and exists (select 1 from public.people p where p.id = d.person_id and p.deleted_at is null);

revoke all on public.people_live, public.relations_live, public.facts_live, public.documents_live from anon, authenticated;
grant select on public.people_live, public.relations_live, public.facts_live, public.documents_live to authenticated;

-- Логины участников видит только админ.
create function public.admin_list_members()
returns table (user_id uuid, person_id uuid, login text, display_name text, role text, disabled boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.person_id, m.login, m.display_name, m.role, m.disabled, m.created_at
    from public.members m
    order by m.created_at;
end;
$$;
revoke execute on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;
