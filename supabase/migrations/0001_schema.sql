-- 0001_schema.sql — таблицы семейного дерева.
-- Закрыто по умолчанию: новые функции и таблицы никому не выдаются автоматически,
-- права выдаются точечно в 0002/0003/0004.

-- Новые функции в public/private по умолчанию никому не выданы
-- (Supabase по умолчанию выдаёт execute anon/authenticated — снимаем).
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Новые таблицы/представления/последовательности в public: anon не получает ничего.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------- people
create table public.people (
  id                   uuid primary key default gen_random_uuid(),
  external_ref         text unique,
  surname              text,
  given_name           text,
  patronymic           text,
  maiden_name          text,
  name_variants        jsonb not null default '[]'::jsonb check (jsonb_typeof(name_variants) = 'array'),
  sex                  text not null default 'u' check (sex in ('m', 'f', 'u')),
  birth_date_text      text,
  birth_date_from      date,
  birth_date_to        date,
  birth_place          text,
  death_date_text      text,
  death_date_from      date,
  death_date_to        date,
  death_place          text,
  is_placeholder       boolean not null default false,
  needs_check          boolean not null default false,
  notes                text,
  portrait_document_id uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_by           uuid,
  updated_at           timestamptz,
  deleted_at           timestamptz,
  check (birth_date_from is null or birth_date_to is null or birth_date_from <= birth_date_to),
  check (death_date_from is null or death_date_to is null or death_date_from <= death_date_to)
);

-- ---------------------------------------------------------------- relations
-- parent: from_person — родитель, to_person — ребёнок.
-- spouse: пара хранится упорядоченно (from_person < to_person).
create table public.relations (
  id           uuid primary key default gen_random_uuid(),
  external_ref text unique,
  kind         text not null check (kind in ('parent', 'spouse')),
  from_person  uuid not null references public.people (id),
  to_person    uuid not null references public.people (id),
  parent_type  text check (parent_type in ('biological', 'adoptive', 'raised_by', 'step', 'unknown')),
  spouse_order int,
  start_text   text,
  end_text     text,
  certainty    text check (certainty in ('known', 'probable', 'uncertain')),
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz,
  deleted_at   timestamptz,
  constraint relations_spouse_order check (kind <> 'spouse' or from_person < to_person),
  constraint relations_parent_type check ((kind = 'parent') = (parent_type is not null)),
  constraint relations_not_self check (from_person <> to_person)
);
create unique index relations_live_uniq on public.relations (kind, from_person, to_person, parent_type)
  nulls not distinct where deleted_at is null;
create index relations_from_idx on public.relations (from_person);
create index relations_to_idx on public.relations (to_person);

-- ---------------------------------------------------------------- facts
create table public.facts (
  id           uuid primary key default gen_random_uuid(),
  external_ref text unique,
  person_id    uuid not null references public.people (id),
  kind         text not null,
  value        text,
  date_text    text,
  source       text,
  certainty    text check (certainty in ('known', 'probable', 'uncertain')),
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz,
  deleted_at   timestamptz
);
create index facts_person_idx on public.facts (person_id);

-- ---------------------------------------------------------------- documents
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  external_ref text unique,
  person_id    uuid not null references public.people (id),
  storage_path text not null unique,
  mime         text,
  caption      text,
  source       text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz,
  deleted_at   timestamptz,
  constraint documents_path_prefix check (storage_path like 'people/' || person_id::text || '/%')
);
create index documents_person_idx on public.documents (person_id);

alter table public.people
  add constraint people_portrait_fk foreign key (portrait_document_id) references public.documents (id);

-- ---------------------------------------------------------------- members
-- login — нормализованные «имя фамилия» (нижний регистр, ё→е, одиночные пробелы, без краёв).
-- Однофамильцев-тёзок админ различает уточнением (например, годом рождения) — уникальность ниже.
create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  person_id    uuid not null unique references public.people (id),
  login        text not null unique,
  display_name text not null,
  role         text not null default 'relative' check (role in ('admin', 'relative', 'agent')),
  disabled     boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint members_login_normalized check (
    login = replace(lower(regexp_replace(btrim(login), '\s+', ' ', 'g')), 'ё', 'е')
    and length(login) between 1 and 100
  )
);

-- ---------------------------------------------------------------- edits (аудит)
create table public.edits (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor          uuid,
  actor_label    text,
  table_name     text not null,
  row_id         uuid not null,
  op             text not null check (op in ('insert', 'update', 'soft_delete', 'restore', 'revert')),
  old            jsonb,
  new            jsonb,
  changed_fields text[],
  reverts_edit   bigint references public.edits (id)
);
create index edits_row_idx on public.edits (table_name, row_id, id);
create index edits_at_idx on public.edits (at desc);

-- ---------------------------------------------------------------- client_errors (только insert)
create table public.client_errors (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid default auth.uid(),
  message text check (length(message) <= 2000),
  stack   text check (length(stack) <= 8000),
  url     text check (length(url) <= 2000)
);
