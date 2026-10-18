-- rls.test.sql — матрица прав раздела 4: anon, relative, disabled relative, не-участник, admin.
begin;
\ir _helpers.psql
select plan(41);

-- Эталонные количества (как postgres, мимо RLS)
create temp table expected as
  select (select count(*) from public.people) as people,
         (select count(*) from public.relations) as relations,
         (select count(*) from public.facts) as facts,
         (select count(*) from public.documents) as documents,
         (select count(*) from public.members) as members;
grant select on expected to anon, authenticated;

-- ---------------------------------------------------------------- anon: ни одной строки (доступ запрещён)
select tests.as_anon();
select throws_ok($$ select count(*) from public.people $$,         '42501', null, 'anon: people закрыта');
select throws_ok($$ select count(*) from public.relations $$,      '42501', null, 'anon: relations закрыта');
select throws_ok($$ select count(*) from public.facts $$,          '42501', null, 'anon: facts закрыта');
select throws_ok($$ select count(*) from public.documents $$,      '42501', null, 'anon: documents закрыта');
select throws_ok($$ select count(*) from public.members $$,        '42501', null, 'anon: members закрыта');
select throws_ok($$ select count(*) from public.edits $$,          '42501', null, 'anon: edits закрыта');
select throws_ok($$ select count(*) from public.client_errors $$,  '42501', null, 'anon: client_errors закрыта');
select throws_ok($$ select count(*) from public.people_live $$,    '42501', null, 'anon: people_live закрыто');
select throws_ok($$ select count(*) from public.relations_live $$, '42501', null, 'anon: relations_live закрыто');
select throws_ok($$ select count(*) from public.facts_live $$,     '42501', null, 'anon: facts_live закрыто');
select throws_ok($$ select count(*) from public.documents_live $$, '42501', null, 'anon: documents_live закрыто');
select throws_ok($$ insert into public.people (surname) values ('Петров') $$, '42501', null, 'anon: insert в people запрещён');

-- ---------------------------------------------------------------- relative
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select is((select count(*) from public.people),    (select people from expected),    'relative видит всех людей (включая удалённых)');
select is((select count(*) from public.relations), (select relations from expected), 'relative видит все связи');
select is((select count(*) from public.facts),     (select facts from expected),     'relative видит все факты');
select is((select count(*) from public.documents), (select documents from expected), 'relative видит все документы');
select is((select count(*) from public.members m where m.display_name is not null), (select members from expected),
  'relative видит участников (разрешённые колонки)');
select ok((select count(*) from public.edits) > 0, 'relative читает историю');

select lives_ok($$ insert into public.people (id, surname, given_name) values ('11111111-0000-4000-8000-0000000000a1', 'Петрова', 'Нина') $$,
  'relative добавляет человека');
select lives_ok($$ update public.people set notes = 'правка' where id = '11111111-0000-4000-8000-000000000004' $$,
  'relative правит человека');
select is(tests.affected($$ delete from public.people where id = '11111111-0000-4000-8000-0000000000a1' $$), -1,
  'relative не удаляет человека DELETE-ом');
select is(tests.affected($$ delete from public.facts where id = '33333333-0000-4000-8000-000000000001' $$), -1,
  'relative не удаляет факт DELETE-ом');
select lives_ok($$ insert into public.facts (person_id, kind, value) values ('11111111-0000-4000-8000-000000000004', 'note', 'Петровы жили у реки') $$,
  'relative добавляет факт');
select lives_ok($$ insert into public.relations (kind, from_person, to_person, parent_type)
                   values ('parent', '11111111-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000005', 'biological') $$,
  'relative добавляет связь');

-- documents: uploaded_by ставит сервер, менять можно только подпись/источник
select lives_ok($$ insert into public.documents (id, person_id, storage_path, uploaded_by)
                   values ('44444444-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000005',
                           'people/11111111-0000-4000-8000-000000000005/a.jpg', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'relative добавляет документ');
select lives_ok($$ update public.documents set caption = 'Фото у дома' where id = '44444444-0000-4000-8000-0000000000a1' $$,
  'relative меняет подпись документа');
select throws_ok($$ update public.documents set storage_path = 'people/11111111-0000-4000-8000-000000000005/b.jpg'
                    where id = '44444444-0000-4000-8000-0000000000a1' $$, '42501', null, 'relative не меняет storage_path');

-- members, edits, client_errors
select throws_ok($$ select login from public.members $$, '42501', null, 'relative не читает login');
select throws_ok($$ insert into public.members (user_id, person_id, login, display_name)
                    values ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000005', 'дарья петрова', 'Дарья') $$,
  '42501', null, 'relative не создаёт участников');
select throws_ok($$ update public.members set role = 'admin' where user_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  '42501', null, 'relative не повышает себе роль');
select throws_ok($$ insert into public.edits (table_name, row_id, op) values ('people', gen_random_uuid(), 'update') $$,
  '42501', null, 'relative не пишет в edits');
select throws_ok($$ delete from public.edits $$, '42501', null, 'relative не удаляет историю');
select lives_ok($$ insert into public.client_errors (message, url) values ('TypeError', '#/tree') $$, 'relative пишет client_errors');
select throws_ok($$ select count(*) from public.client_errors $$, '42501', null, 'relative не читает client_errors');
select throws_ok($$ insert into public.client_errors (user_id, message) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'relative не подделывает user_id в client_errors');

-- ---------------------------------------------------------------- disabled relative: 0 строк
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select is((select count(*)::int from public.people) + (select count(*)::int from public.relations)
        + (select count(*)::int from public.facts) + (select count(*)::int from public.documents)
        + (select count(*)::int from public.members) + (select count(*)::int from public.edits), 0,
  'disabled relative: 0 строк в таблицах');
select is((select count(*)::int from public.people_live) + (select count(*)::int from public.relations_live)
        + (select count(*)::int from public.facts_live) + (select count(*)::int from public.documents_live), 0,
  'disabled relative: 0 строк в представлениях');
select throws_ok($$ insert into public.people (surname) values ('Петров') $$, '42501', null, 'disabled relative не добавляет людей');
select is(tests.affected($$ update public.people set notes = 'x' $$), 0, 'disabled relative ничего не правит');

-- ---------------------------------------------------------------- авторизован, но не участник
select tests.login('aaaaaaaa-0000-4000-8000-000000000004');
select is((select count(*)::int from public.people) + (select count(*)::int from public.members)
        + (select count(*)::int from public.edits), 0, 'не-участник: 0 строк');

-- ---------------------------------------------------------------- admin
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select is((select count(*) from public.people), (select people from expected) + 1, 'admin видит всех людей');

select * from finish();
rollback;
