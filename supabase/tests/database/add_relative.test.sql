-- add_relative.test.sql — «+» одной транзакцией: каждый вид, права, белый список полей,
-- откат при сбое, автор правок = вызывающий (а не владелец DEFINER-функции).
begin;
\ir _helpers.psql
select plan(42);

create table tests.out (k text primary key, v jsonb);
grant all on tests.out to authenticated;
create function tests.pid(p_k text) returns uuid language sql as $$ select (v -> 'person' ->> 'id')::uuid from tests.out where k = p_k $$;
create function tests.parents(p_child uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(from_person order by from_person), '{}') from public.relations_live
  where kind = 'parent' and to_person = p_child and parent_type in ('biological', 'adoptive', 'unknown') $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------- права
select ok(not has_function_privilege('anon', 'public.add_relative(uuid, text, jsonb)', 'EXECUTE'), 'anon: нет execute на add_relative');
select ok(has_function_privilege('authenticated', 'public.add_relative(uuid, text, jsonb)', 'EXECUTE'), 'authenticated: есть execute');
select ok(not has_function_privilege('authenticated', 'private.add_spouse(uuid, uuid)', 'EXECUTE'), 'authenticated: нет execute на private.add_spouse');

select tests.as_anon();
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{}') $$, '42501', null, 'anon отклонён');
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{}') $$, '42501', 'members only', 'отключённый участник отклонён');
select tests.login('aaaaaaaa-0000-4000-8000-000000000004');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{}') $$, '42501', 'members only', 'не участник отклонён');

-- ---------------------------------------------------------------- relative Борис: все виды
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');

-- sibling без родителей → placeholder
select lives_ok($$ insert into tests.out select 'sib', public.add_relative('11111111-0000-4000-8000-000000000002', 'sibling',
  '{"given_name": "Вика", "surname": "Петрова", "sex": "f"}') $$, 'sibling без родителей');
select ok((select (v -> 'placeholder' ->> 'is_placeholder')::boolean from tests.out where k = 'sib'), 'создан placeholder-родитель');
select is(tests.parents('11111111-0000-4000-8000-000000000002'),
  array[(select (v -> 'placeholder' ->> 'id')::uuid from tests.out where k = 'sib')], 'у якоря родитель — placeholder');
select is(tests.parents(tests.pid('sib')), tests.parents('11111111-0000-4000-8000-000000000002'), 'у брата/сестры те же родители');
select is((select jsonb_array_length(v -> 'relation_ids') from tests.out where k = 'sib'), 2, 'две связи: placeholder→якорь, placeholder→новый');
select is((select given_name || ' ' || surname || ' ' || sex from public.people_live where id = tests.pid('sib')), 'Вика Петрова f', 'поля записаны');

-- sibling при известных родителях → без нового placeholder
select lives_ok($$ insert into tests.out select 'sib2', public.add_relative('11111111-0000-4000-8000-000000000002', 'sibling', '{"given_name": "Лев"}') $$, 'второй sibling');
select ok((select v -> 'placeholder' = 'null'::jsonb from tests.out where k = 'sib2'), 'нового placeholder нет');
select is(tests.parents(tests.pid('sib2')), tests.parents('11111111-0000-4000-8000-000000000002'), 'общие родители');

-- parent: второй родитель становится супругом первого
select lives_ok($$ insert into tests.out select 'par', public.add_relative('11111111-0000-4000-8000-000000000002', 'parent', '{"given_name": "Пётр", "sex": "m"}') $$, 'parent');
select is(cardinality(tests.parents('11111111-0000-4000-8000-000000000002')), 2, 'у якоря двое родителей');
select is((select count(*)::int from public.relations_live where kind = 'spouse'
           and from_person = least(tests.pid('par'), (select (v -> 'placeholder' ->> 'id')::uuid from tests.out where k = 'sib'))
           and to_person = greatest(tests.pid('par'), (select (v -> 'placeholder' ->> 'id')::uuid from tests.out where k = 'sib'))),
  1, 'новый родитель — супруг первого');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'parent', '{}') $$, '23514', 'person already has two parents', 'третий родитель отклонён');

-- spouse: упорядоченная пара, номера 1, 2
select lives_ok($$ insert into tests.out select 'sp1', public.add_relative('11111111-0000-4000-8000-000000000002', 'spouse', '{"given_name": "Нина", "sex": "f"}') $$, 'spouse');
select is((select spouse_order from public.relations_live where kind = 'spouse' and tests.pid('sp1') in (from_person, to_person)), 1, 'первый брак — номер 1');
select ok((select from_person < to_person from public.relations_live where kind = 'spouse' and tests.pid('sp1') in (from_person, to_person)), 'пара упорядочена from < to');

-- child: якорь + текущий супруг
select lives_ok($$ insert into tests.out select 'ch', public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{"given_name": "Ян"}') $$, 'child');
select is(tests.parents(tests.pid('ch')),
  (select array_agg(x order by x) from unnest(array['11111111-0000-4000-8000-000000000002'::uuid, tests.pid('sp1')]) x), 'родители ребёнка — якорь и супруга');

select lives_ok($$ insert into tests.out select 'sp2', public.add_relative('11111111-0000-4000-8000-000000000002', 'spouse', '{"given_name": "Ада"}') $$, 'второй spouse');
select is((select spouse_order from public.relations_live where kind = 'spouse' and tests.pid('sp2') in (from_person, to_person)), 2, 'второй брак — номер 2');

-- child у фикстуры: Глеб + Зоя; sibling у Дарьи (известен один родитель Глеб) — без placeholder
select lives_ok($$ insert into tests.out select 'ch2', public.add_relative('11111111-0000-4000-8000-000000000004', 'child', '{}') $$, 'child у Глеба');
select is(tests.parents(tests.pid('ch2')), array['11111111-0000-4000-8000-000000000004'::uuid, '11111111-0000-4000-8000-000000000006'::uuid], 'ребёнок Глеба и Зои');
select lives_ok($$ insert into tests.out select 'sib3', public.add_relative('11111111-0000-4000-8000-000000000005', 'sibling', '{}') $$, 'sibling у Дарьи');
select is(tests.parents(tests.pid('sib3')), array['11111111-0000-4000-8000-000000000004'::uuid], 'тот же единственный родитель, placeholder не создан');
select is((select is_placeholder or name_variants <> '[]' or needs_check from public.people_live where id = tests.pid('sib3')), false, 'пустые поля — значения по умолчанию');

-- ---------------------------------------------------------------- автор = вызывающий
select is((select created_by from public.people where id = tests.pid('ch')), 'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'created_by человека — вызывающий');
select is((select array_agg(distinct actor_label) from public.edits where row_id = tests.pid('ch') or row_id in
             (select (jsonb_array_elements_text(v -> 'relation_ids'))::uuid from tests.out where k = 'ch')),
  array['Борис'], 'actor_label всех правок — Борис');
select is((select count(*)::int from public.edits where op = 'insert' and actor = 'aaaaaaaa-0000-4000-8000-000000000002' and
             (row_id = tests.pid('ch') or row_id in (select (jsonb_array_elements_text(v -> 'relation_ids'))::uuid from tests.out where k = 'ch'))),
  3, 'три строки истории (человек + 2 связи), actor = uid вызывающего');

-- ---------------------------------------------------------------- белый список и ошибки
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{"created_by": "aaaaaaaa-0000-4000-8000-000000000001"}') $$, '22023', null, 'created_by не в белом списке');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{"deleted_at": "2020-01-01"}') $$, '22023', null, 'deleted_at не в белом списке');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'child', '{"portrait_document_id": "44444444-0000-4000-8000-000000000001"}') $$, '22023', null, 'portrait_document_id не в белом списке');
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000002', 'cousin', '{}') $$, '22023', null, 'неизвестный вид отклонён');
select throws_ok($$ select public.add_relative(gen_random_uuid(), 'child', '{}') $$, 'P0002', null, 'несуществующий якорь');

-- ---------------------------------------------------------------- откат при сбое
-- Зоя без родителей: sibling сначала создаёт placeholder и связь, потом падает на CHECK sex → не остаётся ничего.
insert into tests.out select 'cnt', jsonb_build_array(
  (select count(*) from public.people), (select count(*) from public.relations), (select count(*) from public.edits));
select throws_ok($$ select public.add_relative('11111111-0000-4000-8000-000000000006', 'sibling', '{"sex": "x"}') $$, '23514', null, 'сбой на поле нового человека');
select is(jsonb_build_array((select count(*) from public.people), (select count(*) from public.relations), (select count(*) from public.edits)),
  (select v from tests.out where k = 'cnt'), 'после сбоя: ни людей, ни связей, ни строк истории');

-- удалённый якорь
select tests.login('aaaaaaaa-0000-4000-8000-000000000001');
select public.soft_delete('people', tests.pid('sib3'));
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok(format($$ select public.add_relative(%L, 'child', '{}') $$, tests.pid('sib3')), 'P0002', null, 'мягко удалённый якорь');

select * from finish();
rollback;
