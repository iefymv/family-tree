-- 0012_service_role_grants.sql — service_role (seed, бэкап, admin-users) получает права явно,
-- а не через «Automatically expose new tables» панели Supabase (выключено в облаке).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
