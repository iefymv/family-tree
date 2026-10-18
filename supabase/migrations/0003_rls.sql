-- 0003_rls.sql — RLS. Все политики только для authenticated; anon получает 0 строк.

alter table public.people        enable row level security;
alter table public.relations     enable row level security;
alter table public.facts         enable row level security;
alter table public.documents     enable row level security;
alter table public.members       enable row level security;
alter table public.edits         enable row level security;
alter table public.client_errors enable row level security;

-- people, relations, facts: SELECT (включая удалённые — для истории), INSERT, UPDATE. DELETE — нет политики.
create policy people_select on public.people for select to authenticated using ((select private.is_member()));
create policy people_insert on public.people for insert to authenticated with check ((select private.is_member()));
create policy people_update on public.people for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

create policy relations_select on public.relations for select to authenticated using ((select private.is_member()));
create policy relations_insert on public.relations for insert to authenticated with check ((select private.is_member()));
create policy relations_update on public.relations for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

create policy facts_select on public.facts for select to authenticated using ((select private.is_member()));
create policy facts_insert on public.facts for insert to authenticated with check ((select private.is_member()));
create policy facts_update on public.facts for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

-- documents
create policy documents_select on public.documents for select to authenticated using ((select private.is_member()));
create policy documents_insert on public.documents for insert to authenticated
  with check ((select private.is_member()) and uploaded_by = (select auth.uid()));
create policy documents_update on public.documents for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

-- members: чтение разрешённых колонок участникам
create policy members_select on public.members for select to authenticated using ((select private.is_member()));

-- edits: чтение участникам
create policy edits_select on public.edits for select to authenticated using ((select private.is_member()));

-- client_errors: только вставка своей строки
create policy client_errors_insert on public.client_errors for insert to authenticated
  with check ((select private.is_member()) and user_id = (select auth.uid()));
