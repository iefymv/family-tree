-- 0009_ping.sql — keep-alive: anon может вызвать, данных не возвращает.

create function public.ping() returns boolean
language sql stable security definer set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
