-- privileges.test.sql — RLS везде, привилегии anon/authenticated, search_path у функций, ping.
begin;
\ir _helpers.psql
select plan(26);

-- RLS включён на всех таблицах public
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1),
  '{}'::text[], 'RLS включён на всех таблицах public');

-- Все представления public — security_invoker
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
          and not coalesce(c.reloptions @> array['security_invoker=on'], false) order by 1),
  '{}'::text[], 'все представления public — security_invoker');

-- anon не имеет ни одной привилегии ни на одной таблице/представлении public
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
          and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') order by 1),
  '{}'::text[], 'anon: ноль привилегий на таблицах и представлениях public');

-- anon не имеет колоночных привилегий (column grants) ни на одной таблице public
select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC')),
  0, 'anon/PUBLIC: нет колоночных привилегий в public');

-- DELETE и TRUNCATE ни у authenticated, ни у anon
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('authenticated', c.oid, 'DELETE,TRUNCATE') order by 1),
  '{}'::text[], 'authenticated: DELETE/TRUNCATE нет ни на одной таблице');

-- edits и members: authenticated не пишет
select ok(not has_table_privilege('authenticated', 'public.edits', 'INSERT,UPDATE,DELETE'), 'authenticated не пишет в edits');
select ok(not has_table_privilege('authenticated', 'public.members', 'INSERT,UPDATE,DELETE'), 'authenticated не пишет в members');
select ok(not has_any_column_privilege('authenticated', 'public.members', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.members', 'UPDATE'),
          'authenticated: нет колоночных INSERT/UPDATE на members');
select ok(not has_column_privilege('authenticated', 'public.members', 'login', 'SELECT'), 'members.login не выдан authenticated');

-- schema private: anon не видит, хелперы anon не выполняет
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon: нет usage на schema private');
select ok(not has_function_privilege('anon', 'private.is_member()', 'EXECUTE'), 'anon: нет execute на private.is_member');
select ok(not has_function_privilege('anon', 'private.is_admin()', 'EXECUTE'), 'anon: нет execute на private.is_admin');
select ok(not has_function_privilege('authenticated', 'private.audit_row()', 'EXECUTE'), 'authenticated: нет execute на триггерной audit_row');

-- anon выполняет из public только ping
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1),
  array['ping'], 'anon выполняет в public только ping');
select ok(not has_function_privilege('anon', 'public.soft_delete(text, uuid)', 'EXECUTE'), 'anon: нет soft_delete');
select ok(not has_function_privilege('anon', 'public.restore(text, uuid)', 'EXECUTE'), 'anon: нет restore');
select ok(not has_function_privilege('anon', 'public.revert_edit(bigint, boolean)', 'EXECUTE'), 'anon: нет revert_edit');
select ok(not has_function_privilege('anon', 'public.admin_list_members()', 'EXECUTE'), 'anon: нет admin_list_members');

-- search_path = '' у всех SECURITY DEFINER (и вообще у всех наших функций) в public и private
select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and not coalesce(p.proconfig @> array['search_path=""'], false) order by 1),
  '{}'::text[], 'все DEFINER-функции public/private: search_path=''''');
select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and not coalesce(p.proconfig @> array['search_path=""'], false) order by 1),
  '{}'::text[], 'все функции public/private: search_path=''''');

-- ping
select tests.as_anon();
select is(public.ping(), true, 'ping под anon возвращает true');
select throws_ok($$ select public.soft_delete('facts', '33333333-0000-4000-8000-000000000001') $$, '42501', null, 'rpc soft_delete от anon отклонён');
select throws_ok($$ select * from public.admin_list_members() $$, '42501', null, 'admin_list_members от anon отклонён');

-- admin_list_members: relative — ошибка, admin — видит логины
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.admin_list_members() $$, '42501', 'admin only', 'admin_list_members от relative отклонён');
select throws_ok($$ select login from public.members $$, '42501', null, 'relative не читает members.login');
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select ok((select count(*) from public.admin_list_members() where login = 'борис петров') = 1, 'admin видит логины через admin_list_members');

select * from finish();
rollback;
