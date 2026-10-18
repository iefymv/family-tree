-- softdelete.test.sql — мягкое удаление только через RPC, права по таблицам, каскадное скрытие,
-- уникальность живых связей.
begin;
\ir _helpers.psql
select plan(34);

-- ---------------------------------------------------------------- relative: факты и связи
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select lives_ok($$ select public.soft_delete('facts', '33333333-0000-4000-8000-000000000001') $$, 'relative мягко удаляет факт');
select is((select count(*)::int from public.facts_live where id = '33333333-0000-4000-8000-000000000001'), 0, 'факт исчез из facts_live');
select isnt((select deleted_at from public.facts where id = '33333333-0000-4000-8000-000000000001'), null, 'строка факта осталась с deleted_at');
select lives_ok($$ select public.soft_delete('relations', '22222222-0000-4000-8000-000000000001') $$, 'relative мягко удаляет связь');
select is((select count(*)::int from public.relations_live where id = '22222222-0000-4000-8000-000000000001'), 0, 'связь исчезла из relations_live');
select throws_ok($$ select public.soft_delete('facts', '33333333-0000-4000-8000-000000000001') $$, 'P0002', null, 'повторное удаление — ошибка');

-- запреты для relative
select throws_ok($$ select public.soft_delete('people', '11111111-0000-4000-8000-000000000005') $$, '42501', null, 'relative не может soft_delete(people)');
select throws_ok($$ select public.restore('people', '11111111-0000-4000-8000-000000000005') $$, '42501', null, 'relative не может restore(people)');
select throws_ok($$ select public.soft_delete('documents', '44444444-0000-4000-8000-000000000001') $$, '42501', null, 'relative не может soft_delete(documents)');
select throws_ok($$ update public.facts set deleted_at = null where id = '33333333-0000-4000-8000-000000000001' $$, '42501', null, 'relative: прямой UPDATE deleted_at запрещён');
select throws_ok($$ update public.people set deleted_at = now() where id = '11111111-0000-4000-8000-000000000005' $$, '42501', null, 'relative: прямое удаление человека UPDATE-ом запрещено');
select throws_ok($$ insert into public.facts (person_id, kind, deleted_at) values ('11111111-0000-4000-8000-000000000005', 'x', now()) $$, '42501', null, 'insert с deleted_at запрещён');

-- белый список таблиц
select throws_ok($$ select public.soft_delete('members', 'aaaaaaaa-0000-4000-8000-000000000002') $$, '22023', null, 'soft_delete(members) — не в белом списке');
select throws_ok($$ select public.soft_delete('edits', gen_random_uuid()) $$, '22023', null, 'soft_delete(edits) — не в белом списке');
select throws_ok($$ select public.soft_delete('people; drop table public.edits; --', gen_random_uuid()) $$, '22023', null, 'инъекция в имя таблицы отклонена');

-- admin откатывает удаление факта и связи через историю
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok($$ select public.revert_edit((select max(id) from public.edits where table_name = 'facts' and row_id = '33333333-0000-4000-8000-000000000001' and op = 'soft_delete')) $$,
  'admin откатывает удаление факта');
select lives_ok($$ select public.revert_edit((select max(id) from public.edits where table_name = 'relations' and row_id = '22222222-0000-4000-8000-000000000001' and op = 'soft_delete')) $$,
  'admin откатывает удаление связи');
select is((select count(*)::int from public.facts_live where id = '33333333-0000-4000-8000-000000000001'), 1, 'факт вернулся');
select is((select count(*)::int from public.relations_live where id = '22222222-0000-4000-8000-000000000001'), 1, 'связь вернулась');

-- прямой UPDATE deleted_at запрещён даже админу
select throws_ok($$ update public.people set deleted_at = now() where id = '11111111-0000-4000-8000-000000000004' $$, '42501', null, 'admin: прямой UPDATE deleted_at запрещён');

-- admin удаляет человека → его связи, факты, документы пропадают из *_live; восстановление возвращает
select lives_ok($$ select public.soft_delete('people', '11111111-0000-4000-8000-000000000004') $$, 'admin мягко удаляет человека');
select is((select count(*)::int from public.people_live where id = '11111111-0000-4000-8000-000000000004'), 0, 'человек исчез из people_live');
select is((select count(*)::int from public.relations_live
           where '11111111-0000-4000-8000-000000000004' in (from_person, to_person)), 0, 'его связи скрыты');
select is((select count(*)::int from public.facts_live where person_id = '11111111-0000-4000-8000-000000000004'), 0, 'его факты скрыты');
select is((select count(*)::int from public.documents_live where person_id = '11111111-0000-4000-8000-000000000004'), 0, 'его документы скрыты');
select is((select count(*)::int from public.relations where deleted_at is null
           and '11111111-0000-4000-8000-000000000004' in (from_person, to_person)), 2, 'строки связей не тронуты');
select lives_ok($$ select public.restore('people', '11111111-0000-4000-8000-000000000004') $$, 'admin восстанавливает человека');
select is((select count(*)::int from public.relations_live where '11111111-0000-4000-8000-000000000004' in (from_person, to_person))
        + (select count(*)::int from public.facts_live where person_id = '11111111-0000-4000-8000-000000000004')
        + (select count(*)::int from public.documents_live where person_id = '11111111-0000-4000-8000-000000000004'), 4,
  'восстановление вернуло связи, факт и документ');

-- disabled relative не удаляет
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select throws_ok($$ select public.soft_delete('facts', '33333333-0000-4000-8000-000000000001') $$, '42501', null, 'disabled relative не удаляет факты');

-- ---------------------------------------------------------------- уникальность и CHECK связей
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ insert into public.relations (kind, from_person, to_person, parent_type)
                    values ('parent', '11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000005', 'biological') $$,
  '23505', null, 'повторная живая связь — unique violation');
select public.soft_delete('relations', '22222222-0000-4000-8000-000000000001');
select lives_ok($$ insert into public.relations (kind, from_person, to_person, parent_type)
                   values ('parent', '11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000005', 'biological') $$,
  'после мягкого удаления та же связь добавляется снова');
select throws_ok($$ insert into public.relations (kind, from_person, to_person)
                    values ('spouse', '11111111-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000004') $$,
  '23514', null, 'супруги с from > to отклоняются CHECK');
select throws_ok($$ insert into public.relations (kind, from_person, to_person)
                    values ('parent', '11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000006') $$,
  '23514', null, 'parent без parent_type отклоняется CHECK');
select throws_ok($$ insert into public.relations (kind, from_person, to_person, parent_type)
                    values ('parent', '11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000004', 'biological') $$,
  '23514', null, 'связь человека с самим собой отклоняется CHECK');

select * from finish();
rollback;
