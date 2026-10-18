-- audit.test.sql — история пишется триггером: все op на 4 таблицах, changed_fields, автор из JWT,
-- seed под service_role, откат (одна строка op='revert'), конфликт/force, откат отката, отсутствие протечки.
begin;
\ir _helpers.psql
select plan(39);

-- ---------------------------------------------------------------- insert: автор из JWT, created_by не от клиента
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');  -- relative «Борис»
insert into public.people (id, surname, given_name, maiden_name, created_by, created_at)
values ('11111111-0000-4000-8000-0000000000b1', 'Петрова', 'Лидия', 'Сидорова',
        'aaaaaaaa-0000-4000-8000-000000000001', '2000-01-01');
select is((select created_by from public.people where id = '11111111-0000-4000-8000-0000000000b1'),
          'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'created_by берётся из JWT, а не от клиента');
select isnt((select created_at from public.people where id = '11111111-0000-4000-8000-0000000000b1'),
          '2000-01-01'::timestamptz, 'created_at ставит сервер');
select results_eq(
  $$ select op, actor, actor_label from public.edits where table_name = 'people' and row_id = '11111111-0000-4000-8000-0000000000b1' $$,
  $$ values ('insert'::text, 'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'Борис'::text) $$,
  'insert записан с автором из JWT и именем участника');

-- ---------------------------------------------------------------- update: changed_fields, old/new
update public.people set maiden_name = 'Кузнецова' where id = '11111111-0000-4000-8000-0000000000b1';
select results_eq(
  $$ select op, changed_fields, old ->> 'maiden_name', new ->> 'maiden_name' from public.edits
     where row_id = '11111111-0000-4000-8000-0000000000b1' order by id desc limit 1 $$,
  $$ values ('update'::text, array['maiden_name']::text[], 'Сидорова'::text, 'Кузнецова'::text) $$,
  'update: changed_fields только изменённое поле, обе версии');
select is((select updated_by from public.people where id = '11111111-0000-4000-8000-0000000000b1'),
          'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'updated_by ставит сервер');
select throws_ok($$ update public.people set created_by = 'aaaaaaaa-0000-4000-8000-000000000001' where id = '11111111-0000-4000-8000-0000000000b1' $$,
  '42501', null, 'created_by неизменен');

-- пустой update историю не пишет
select is(tests.affected($$ update public.people set maiden_name = 'Кузнецова' where id = '11111111-0000-4000-8000-0000000000b1' $$), 1, 'пустой update проходит');
select is((select count(*)::int from public.edits where row_id = '11111111-0000-4000-8000-0000000000b1'), 2, 'пустой update не добавляет строку истории');

-- ---------------------------------------------------------------- все op на 4 таблицах
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
insert into public.relations (id, kind, from_person, to_person, parent_type)
  values ('22222222-0000-4000-8000-0000000000b1', 'parent', '11111111-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000005', 'step');
update public.relations set certainty = 'probable' where id = '22222222-0000-4000-8000-0000000000b1';
insert into public.facts (id, person_id, kind, value) values ('33333333-0000-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000005', 'occupation', 'Врач');
update public.facts set value = 'Фельдшер' where id = '33333333-0000-4000-8000-0000000000b1';
insert into public.documents (id, person_id, storage_path) values
  ('44444444-0000-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000005', 'people/11111111-0000-4000-8000-000000000005/b1.jpg');
update public.documents set caption = 'Диплом' where id = '44444444-0000-4000-8000-0000000000b1';
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');  -- admin «Олег»
select public.soft_delete('people',    '11111111-0000-4000-8000-0000000000b1');
select public.restore    ('people',    '11111111-0000-4000-8000-0000000000b1');
select public.soft_delete('relations', '22222222-0000-4000-8000-0000000000b1');
select public.restore    ('relations', '22222222-0000-4000-8000-0000000000b1');
select public.soft_delete('facts',     '33333333-0000-4000-8000-0000000000b1');
select public.restore    ('facts',     '33333333-0000-4000-8000-0000000000b1');
select public.soft_delete('documents', '44444444-0000-4000-8000-0000000000b1');
select public.restore    ('documents', '44444444-0000-4000-8000-0000000000b1');

select set_eq(
  $$ select table_name || ':' || op from public.edits
     where row_id in ('11111111-0000-4000-8000-0000000000b1', '22222222-0000-4000-8000-0000000000b1',
                      '33333333-0000-4000-8000-0000000000b1', '44444444-0000-4000-8000-0000000000b1') $$,
  $$ select t || ':' || o from unnest(array['people', 'relations', 'facts', 'documents']) t,
                              unnest(array['insert', 'update', 'soft_delete', 'restore']) o $$,
  'insert/update/soft_delete/restore записаны на всех 4 таблицах');
select results_eq(
  $$ select changed_fields, actor_label from public.edits where table_name = 'facts' and row_id = '33333333-0000-4000-8000-0000000000b1' and op = 'soft_delete' $$,
  $$ values (array['deleted_at']::text[], 'Олег'::text) $$,
  'soft_delete: changed_fields = deleted_at, автор — админ');
select is((select changed_fields from public.edits where table_name = 'documents' and row_id = '44444444-0000-4000-8000-0000000000b1' and op = 'update'),
  array['caption']::text[], 'documents update: changed_fields = caption');

-- ---------------------------------------------------------------- автор seed / system
select tests.as_service();
insert into public.people (id, surname) values ('11111111-0000-4000-8000-0000000000b2', 'Петров');
select results_eq(
  $$ select actor, actor_label from public.edits where row_id = '11111111-0000-4000-8000-0000000000b2' $$,
  $$ values (null::uuid, 'seed'::text) $$, 'под service_role автор = seed');
select tests.as_postgres();
insert into public.people (id, surname) values ('11111111-0000-4000-8000-0000000000b3', 'Петров');
select is((select actor_label from public.edits where row_id = '11111111-0000-4000-8000-0000000000b3'), 'system', 'без JWT автор = system');

-- ---------------------------------------------------------------- откат update: ровно одна строка op='revert'
select tests.as_postgres();
create temp table ids (name text primary key, id bigint);
grant all on ids to authenticated;
insert into ids select 'e_update', max(id) from public.edits where row_id = '11111111-0000-4000-8000-0000000000b1' and op = 'update';
insert into ids select 'before', count(*) from public.edits;
insert into ids select 'before_updates', count(*) from public.edits where op = 'update';

-- revert_edit: права
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok(format('select public.revert_edit(%s)', (select id from ids where name = 'e_update')),
  '42501', 'admin only', 'revert_edit от relative — ошибка');
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select throws_ok(format('select public.revert_edit(%s)', (select id from ids where name = 'e_update')),
  '42501', 'admin only', 'revert_edit от disabled — ошибка');

select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select is(public.revert_edit((select id from ids where name = 'e_update')) ->> 'ok', 'true', 'откат update выполнен');
select is((select maiden_name from public.people where id = '11111111-0000-4000-8000-0000000000b1'), 'Сидорова', 'значение вернулось');
select is((select count(*) from public.edits) - (select id from ids where name = 'before'), 1::bigint, 'откат дал ровно одну строку истории');
select is((select count(*) from public.edits where op = 'update'), (select id from ids where name = 'before_updates'), 'строки op=update откат не добавил');
select results_eq(
  $$ select op, reverts_edit, changed_fields, actor_label from public.edits order by id desc limit 1 $$,
  format($$ values ('revert'::text, %s::bigint, array['maiden_name']::text[], 'Олег'::text) $$, (select id from ids where name = 'e_update')),
  'строка op=revert со ссылкой reverts_edit');

-- настройка не протекла: следующий обычный UPDATE пишется как update
select is(coalesce(current_setting('app.audit_op', true), ''), '', 'app.audit_op сброшен после отката');
select is(coalesce(current_setting('app.allow_deleted_at', true), ''), '', 'app.allow_deleted_at сброшен после отката');
update public.people set notes = 'после отката' where id = '11111111-0000-4000-8000-0000000000b1';
select results_eq($$ select op, reverts_edit from public.edits order by id desc limit 1 $$,
  $$ values ('update'::text, null::bigint) $$, 'следующий UPDATE записан как update');
select throws_ok($$ update public.people set deleted_at = now() where id = '11111111-0000-4000-8000-0000000000b1' $$,
  '42501', null, 'после отката прямой UPDATE deleted_at снова запрещён');

-- ---------------------------------------------------------------- откат отката
insert into ids select 'e_revert', max(id) from public.edits where op = 'revert' and row_id = '11111111-0000-4000-8000-0000000000b1';
insert into ids select 'before2', count(*) from public.edits;
select is(public.revert_edit((select id from ids where name = 'e_revert')) ->> 'ok', 'true', 'откат отката выполнен');
select is((select maiden_name from public.people where id = '11111111-0000-4000-8000-0000000000b1'), 'Кузнецова', 'откат отката вернул значение до отката');
select is((select count(*) from public.edits) - (select id from ids where name = 'before2'), 1::bigint, 'откат отката — ровно одна строка');
select results_eq($$ select op, reverts_edit from public.edits order by id desc limit 1 $$,
  format($$ values ('revert'::text, %s::bigint) $$, (select id from ids where name = 'e_revert')), 'откат отката: op=revert, ссылка на откат');

-- ---------------------------------------------------------------- конфликт и force
update public.people set given_name = 'Лида' where id = '11111111-0000-4000-8000-0000000000b1';
insert into ids select 'e_given1', max(id) from public.edits where row_id = '11111111-0000-4000-8000-0000000000b1' and op = 'update';
update public.people set given_name = 'Лидия Ивановна' where id = '11111111-0000-4000-8000-0000000000b1';
insert into ids select 'before3', count(*) from public.edits;
select is(public.revert_edit((select id from ids where name = 'e_given1')), '{"conflict": ["given_name"]}'::jsonb, 'поле менялось после правки → conflict');
select is((select given_name from public.people where id = '11111111-0000-4000-8000-0000000000b1'), 'Лидия Ивановна', 'при конфликте ничего не изменено');
select is((select count(*) from public.edits) - (select id from ids where name = 'before3'), 0::bigint, 'при конфликте история не пишется');
select is(public.revert_edit((select id from ids where name = 'e_given1'), true) ->> 'forced', 'true', 'force откатывает несмотря на конфликт');
select is((select given_name from public.people where id = '11111111-0000-4000-8000-0000000000b1'), 'Лидия', 'force вернул значение до правки');

-- ---------------------------------------------------------------- откат insert и soft_delete
select public.revert_edit((select id from public.edits where row_id = '33333333-0000-4000-8000-0000000000b1' and op = 'insert'));
select is((select count(*)::int from public.facts_live where id = '33333333-0000-4000-8000-0000000000b1'), 0, 'откат добавления = мягкое удаление');
select public.revert_edit((select max(id) from public.edits where row_id = '22222222-0000-4000-8000-0000000000b1' and op = 'soft_delete'), true);
select is((select deleted_at from public.relations where id = '22222222-0000-4000-8000-0000000000b1'), null, 'откат удаления (force) восстанавливает');
select throws_ok($$ select public.revert_edit(999999999) $$, 'P0002', null, 'несуществующая запись истории — ошибка');

-- ---------------------------------------------------------------- members: ограничения
select tests.as_postgres();
select throws_ok($$ insert into public.members (user_id, person_id, login, display_name)
                    values ('aaaaaaaa-0000-4000-8000-000000000004', null, 'зоя петрова', 'Зоя') $$, '23502', null, 'members.person_id NULL отклоняется');
select throws_ok($$ insert into public.members (user_id, person_id, login, display_name)
                    values ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000006', 'Зоя  Петрова', 'Зоя') $$, '23514', null, 'ненормализованный login отклоняется');
select throws_ok($$ insert into public.members (user_id, person_id, login, display_name)
                    values ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000006', 'борис петров', 'Зоя') $$, '23505', null, 'дубль login отклоняется (тёзку различает админ)');

select * from finish();
rollback;
