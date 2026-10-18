-- 0010_card_fields.sql — поля раскрытой карточки: чем занимался, история жизни.
alter table public.people
  add column occupation text check (occupation is null or length(occupation) <= 500),
  add column life_story text check (life_story is null or length(life_story) <= 20000);

-- p.* во view раскрывается при создании — пересоздаём, чтобы новые колонки попали в people_live.
create or replace view public.people_live with (security_invoker = on) as
  select p.* from public.people p
  where p.deleted_at is null;
