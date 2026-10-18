-- family_login.test.sql — семейный вход: members.family_login, счётчик попыток, карточка без связей, права.
begin;
\ir _helpers.psql
select plan(29);

-- ---------------------------------------------------------------- схема
select has_column('public', 'members', 'family_login', 'members.family_login есть');
select col_default_is('public', 'members', 'family_login', 'false', 'по умолчанию false');
select col_not_null('public', 'members', 'family_login', 'not null');
select is((select family_login from public.members where user_id = 'aaaaaaaa-0000-4000-8000-000000000002'), false,
  'существующие входы — не семейные');
select ok(not has_column_privilege('authenticated', 'public.members', 'family_login', 'SELECT'), 'family_login не выдан authenticated');

-- ---------------------------------------------------------------- права
select ok((select relrowsecurity from pg_class where oid = 'private.family_login_attempts'::regclass), 'RLS на счётчике попыток');
select ok(not has_table_privilege('anon', 'private.family_login_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'anon: нет прав на счётчик');
select ok(not has_table_privilege('authenticated', 'private.family_login_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated: нет прав на счётчик');
select ok(not has_function_privilege('anon', 'public.family_login_fails(text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.family_login_fails(text)', 'EXECUTE'), 'family_login_fails: не anon/authenticated');
select ok(not has_function_privilege('anon', 'public.family_login_fail(text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.family_login_fail(text)', 'EXECUTE'), 'family_login_fail: не anon/authenticated');
select ok(not has_function_privilege('anon', 'public.family_self_create(uuid, jsonb, text, text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.family_self_create(uuid, jsonb, text, text)', 'EXECUTE'),
  'family_self_create: не anon/authenticated');
select ok(has_function_privilege('service_role', 'public.family_self_create(uuid, jsonb, text, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.family_login_fail(text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.family_login_fails(text)', 'EXECUTE'), 'service_role выполняет все три');
select hasnt_function('public', 'family_self_add', 'family_self_add (0013) удалена');
select ok(not has_function_privilege('authenticated', 'private.add_relative_core(uuid, text, jsonb)', 'EXECUTE'), 'add_relative_core не выдан authenticated');

select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ select public.family_self_create('aaaaaaaa-0000-4000-8000-000000000004',
  '{"given_name": "Кто", "surname": "То"}', 'кто то', 'Кто') $$, '42501', null, 'участник не вызывает family_self_create');
select throws_ok($$ select public.family_login_fail('1.2.3.4') $$, '42501', null, 'участник не пишет в счётчик');

-- ---------------------------------------------------------------- счётчик
select tests.as_service();
select is((select ip_fails from public.family_login_fails('203.0.113.7')), 0, 'попыток нет');
select public.family_login_fail('203.0.113.7');
select public.family_login_fail('203.0.113.7');
select public.family_login_fail('203.0.113.8');
select is((select ip_fails from public.family_login_fails('203.0.113.7')), 2, 'две попытки с ip');
select ok((select all_fails from public.family_login_fails('203.0.113.7')) >= 3, 'общий счётчик видит все');
select tests.as_postgres();
update private.family_login_attempts set at = now() - interval '16 minutes' where ip = '203.0.113.7';
select tests.as_service();
select is((select ip_fails from public.family_login_fails('203.0.113.7')), 0, 'старше 15 минут не считаются');

-- ---------------------------------------------------------------- карточка без связей
select tests.as_postgres();
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000009', 'lev.petrov@family.invalid', 'authenticated', 'authenticated');
select tests.as_service();
select lives_ok($$ select public.family_self_create('aaaaaaaa-0000-4000-8000-000000000009',
  '{"given_name": "Лев", "surname": "Петров", "birth_date_text": "1990", "birth_date_from": "1990-01-01", "birth_date_to": "1990-12-31"}',
  'лев петров', 'Лев') $$, 'карточка и вход созданы');
select tests.as_postgres();
select is((select m.family_login::text || ' ' || m.role || ' ' || p.given_name || ' ' || p.surname || ' ' || p.birth_date_text
           from public.members m join public.people p on p.id = m.person_id
           where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000009'), 'true relative Лев Петров 1990', 'вход family_login привязан к новой карточке');
select is((select count(*)::int from public.relations r join public.members m on m.person_id in (r.from_person, r.to_person)
           where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000009'), 0, 'связей нет');
select is((select p.created_by from public.people p join public.members m on m.person_id = p.id
           where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000009'), 'aaaaaaaa-0000-4000-8000-000000000009'::uuid, 'автор карточки — новый пользователь');
select is((select array_agg(distinct actor_label) from public.edits where actor = 'aaaaaaaa-0000-4000-8000-000000000009'),
  array['Лев'], 'подпись в истории — имя нового человека');
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select is((select family_login from public.admin_list_members() where user_id = 'aaaaaaaa-0000-4000-8000-000000000009'), true,
  'admin_list_members отдаёт family_login');

-- без фамилии / лишнее поле — отказ, ничего не остаётся
select tests.as_service();
select throws_ok($$ select public.family_self_create('aaaaaaaa-0000-4000-8000-000000000004', '{"given_name": "Ян"}', 'ян', 'Ян') $$,
  '22023', null, 'без фамилии — 22023');
select throws_ok($$ select public.family_self_create('aaaaaaaa-0000-4000-8000-000000000004',
  '{"given_name": "Ян", "surname": "Петров", "notes": "x"}', 'ян петров', 'Ян') $$, '22023', null, 'поле не из списка — 22023');
select tests.as_postgres();
select is((select count(*)::int from public.members where user_id = 'aaaaaaaa-0000-4000-8000-000000000004'), 0, 'строки members нет после отказа');

select * from finish();
rollback;
