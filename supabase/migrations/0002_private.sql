-- 0002_private.sql — неопубликованная схема private с хелперами прав и привилегии таблиц.

create schema if not exists private;
revoke all on schema private from public, anon;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create function private.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and not m.disabled
  );
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and not m.disabled and m.role = 'admin'
  );
$$;

revoke all on function private.is_member(), private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_member(), private.is_admin() to authenticated;

-- ---------------------------------------------------------------- привилегии таблиц
-- anon не получает ничего ни на одной таблице.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Данные дерева: читать, добавлять, править; DELETE нет ни у кого (только мягкое удаление через RPC).
revoke all on public.people, public.relations, public.facts, public.documents from authenticated;
grant select, insert, update on public.people, public.relations, public.facts to authenticated;
-- documents: правятся только подпись и источник.
grant select, insert on public.documents to authenticated;
grant update (caption, source) on public.documents to authenticated;

-- members: login скрыт column grants, запись — только Edge Function (service_role).
revoke all on public.members from authenticated;
grant select (user_id, person_id, display_name, role) on public.members to authenticated;

-- edits: только чтение, пишет триггер-владелец.
revoke all on public.edits from authenticated;
grant select on public.edits to authenticated;

-- client_errors: только вставка, без чтения.
revoke all on public.client_errors from authenticated;
grant insert (message, stack, url) on public.client_errors to authenticated;
