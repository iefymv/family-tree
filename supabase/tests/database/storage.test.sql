-- storage.test.sql — приватный bucket documents: anon ничего, relative читает и вставляет только в people/,
-- не перезаписывает и не удаляет; чужой bucket недоступен; CHECK пути в documents.
begin;
\ir _helpers.psql
select plan(18);

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents' $$,
  $$ values (false, 15728640::bigint, '{image/jpeg,image/png,image/webp,application/pdf}'::text[]) $$,
  'bucket documents приватный, лимит 15 МБ, только jpeg/png/webp/pdf');

-- чужой bucket и объекты, созданные мимо RLS
insert into storage.buckets (id, name, public) values ('other', 'other', false);
insert into storage.objects (bucket_id, name) values
  ('documents', 'people/11111111-0000-4000-8000-000000000004/scan1.jpg'),
  ('other',     'people/11111111-0000-4000-8000-000000000004/x.jpg');

-- ---------------------------------------------------------------- anon
select tests.as_anon();
select is((select count(*)::int from storage.objects), 0, 'anon не видит ни одного объекта');
select is((select count(*)::int from storage.buckets where id = 'documents'), 0, 'anon не видит bucket documents');
select is(tests.affected($$ insert into storage.objects (bucket_id, name) values ('documents', 'people/11111111-0000-4000-8000-000000000004/anon.jpg') $$), -1,
  'anon не загружает файлы');

-- ---------------------------------------------------------------- relative
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 1, 'relative видит объекты documents');
select is((select count(*)::int from storage.objects where bucket_id = 'other'), 0, 'relative не видит объекты чужого bucket');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                   values ('documents', 'people/11111111-0000-4000-8000-000000000005/photo.jpg', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  'relative загружает в people/<id>/');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'misc/photo.jpg') $$, '42501', null,
  'relative не загружает вне people/');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'photo.jpg') $$, '42501', null,
  'relative не загружает в корень bucket');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('other', 'people/11111111-0000-4000-8000-000000000005/x.jpg') $$, '42501', null,
  'relative не загружает в чужой bucket');
select is(tests.affected($$ update storage.objects set name = 'people/11111111-0000-4000-8000-000000000004/renamed.jpg'
                            where name = 'people/11111111-0000-4000-8000-000000000004/scan1.jpg' $$), 0,
  'relative не перезаписывает объекты (0 строк)');
select ok(tests.affected($$ delete from storage.objects where bucket_id = 'documents' $$) <= 0,
  'relative не удаляет объекты');

-- ---------------------------------------------------------------- disabled relative
select tests.login('aaaaaaaa-0000-4000-8000-000000000003');
select is((select count(*)::int from storage.objects), 0, 'disabled relative не видит объектов');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'people/11111111-0000-4000-8000-000000000003/x.jpg') $$, '42501', null,
  'disabled relative не загружает');

-- ---------------------------------------------------------------- проверки как postgres
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 2, 'оба объекта documents на месте после попыток удаления');
select is((select count(*)::int from storage.objects where name like '%renamed.jpg'), 0, 'объект не переименован');

-- documents: путь привязан к человеку
select tests.login('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ insert into public.documents (person_id, storage_path)
                    values ('11111111-0000-4000-8000-000000000005', 'people/11111111-0000-4000-8000-000000000004/alien.jpg') $$,
  '23514', null, 'строка documents с чужим person_id в пути отклоняется CHECK');
select throws_ok($$ insert into public.documents (person_id, storage_path)
                    values ('11111111-0000-4000-8000-000000000005', 'other/11111111-0000-4000-8000-000000000005/x.jpg') $$,
  '23514', null, 'строка documents вне people/ отклоняется CHECK');

select * from finish();
rollback;
