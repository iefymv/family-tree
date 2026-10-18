-- join_tree.test.sql — link_relative: связь между существующими людьми «за свою карточку» (или админом).
begin;
\ir _helpers.psql
select plan(32);

-- Дополнительные вымышленные люди без связей.
insert into public.people (id, surname, given_name, sex) values
  ('11111111-0000-4000-8000-000000000007', 'Петрова', 'Нина', 'f'),
  ('11111111-0000-4000-8000-000000000008', 'Петров',  'Пров', 'm'),
  ('11111111-0000-4000-8000-00000000000a', 'Петров',  'Ян',   'm');
insert into public.people (id, is_placeholder) values ('11111111-0000-4000-8000-00000000000b', true);

create function tests.parents(p_child uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(from_person order by from_person), '{}') from public.relations_live
  where kind = 'parent' and to_person = p_child $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------- права
select ok(not has_function_privilege('anon', 'public.link_relative(uuid, uuid, text)', 'EXECUTE'), 'anon: нет execute');
select ok(has_function_privilege('authenticated', 'public.link_relative(uuid, uuid, text)', 'EXECUTE'), 'authenticated: есть execute');

select tests.as_anon();
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 'parent') $$,
  '42501', null, 'anon отклонён');
select tests.login('aaaaaaaa-0000-4000-8000-000000000004');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 'parent') $$,
  '42501', 'members only', 'не участник отклонён');
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000004', 'parent') $$,
  '42501', 'members only', 'отключённый отклонён');
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000007', 'parent') $$,
  '42501', 'only for your own card', 'родственник — только за свою карточку');

-- ---------------------------------------------------------------- ошибки ввода
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'parent') $$,
  '22023', null, 'сам с собой — 22023');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 'cousin') $$,
  '22023', null, 'неизвестный вид — 22023');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-00000000000b', 'parent') $$,
  'P0002', null, 'placeholder — P0002');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', gen_random_uuid(), 'parent') $$,
  'P0002', null, 'нет человека — P0002');

-- ---------------------------------------------------------------- parent (Борис за себя)
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 'parent') $$,
  'Глеб — отец Бориса');
select is(tests.parents('11111111-0000-4000-8000-000000000002'), array['11111111-0000-4000-8000-000000000004']::uuid[], 'один родитель');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 'parent') $$,
  '23505', null, 'повтор — 23505');
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000007', 'parent') $$,
  'Нина — второй родитель');
select is(cardinality(tests.parents('11111111-0000-4000-8000-000000000002')), 2, 'два родителя');
select is((select count(*)::int from public.relations_live where kind = 'spouse'
           and from_person = '11111111-0000-4000-8000-000000000004' and to_person = '11111111-0000-4000-8000-000000000007'),
  1, 'второй родитель стал супругом первого (упорядоченная пара)');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000008', 'parent') $$,
  '23514', 'person already has two parents', 'третий родитель — 23514');
select ok((select bool_and(actor = 'aaaaaaaa-0000-4000-8000-000000000002' and actor_label = 'Борис') from public.edits
           where table_name = 'relations' and row_id in (select id from public.relations_live where to_person = '11111111-0000-4000-8000-000000000002')),
  'автор правок — вызывающий (Борис)');
select is((select created_by from public.relations_live where to_person = '11111111-0000-4000-8000-000000000002' limit 1),
  'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'created_by — вызывающий');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000005', 'sibling') $$,
  '23514', 'person already has parents', 'брат/сестра при уже известных родителях — 23514');

-- ---------------------------------------------------------------- sibling, child, spouse (админ)
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000005', 'sibling') $$,
  'Вера — сестра Дарьи');
select is(tests.parents('11111111-0000-4000-8000-000000000003'), tests.parents('11111111-0000-4000-8000-000000000005'), 'общие родители');
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000008', '11111111-0000-4000-8000-00000000000a', 'sibling') $$,
  'брат без родителей');
select ok((select is_placeholder from public.people where id = (tests.parents('11111111-0000-4000-8000-000000000008'))[1]),
  'создан placeholder-родитель');
select is(tests.parents('11111111-0000-4000-8000-000000000008'), tests.parents('11111111-0000-4000-8000-00000000000a'), 'родитель общий');

-- child: у ребёнка нет родителей — добавляется и текущий (последний) супруг Глеба — Нина (брак № 2 выше)
insert into public.people (id, surname, given_name) values ('11111111-0000-4000-8000-00000000000c', 'Петрова', 'Ия');
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-00000000000c', 'child') $$,
  'Ия — дочь Глеба');
select is(tests.parents('11111111-0000-4000-8000-00000000000c'),
  array['11111111-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000007']::uuid[], 'родители — Глеб и его текущая супруга Нина');
-- child: у ребёнка уже один родитель — только связь с self
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000008', 'child') $$,
  'Пров — сын Олега (второй родитель)');
select is(cardinality(tests.parents('11111111-0000-4000-8000-000000000008')), 2, 'у Прова двое родителей');

-- spouse
select lives_ok($$ select public.link_relative('11111111-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000007', 'spouse') $$,
  'брак');
select ok((select from_person < to_person from public.relations_live where kind = 'spouse'
           and '11111111-0000-4000-8000-00000000000a' in (from_person, to_person)), 'пара упорядочена');
select throws_ok($$ select public.link_relative('11111111-0000-4000-8000-000000000007', '11111111-0000-4000-8000-00000000000a', 'spouse') $$,
  '23505', null, 'повторный брак — 23505');

select * from finish();
rollback;
