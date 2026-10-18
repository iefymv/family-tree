// family-password — отдаёт общий семейный пароль только вошедшему активному участнику
// (для готового приглашения «Поделиться с родственником»). Пароль не логируется.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FAMILY_PASSWORD = Deno.env.get('FAMILY_PASSWORD') ?? '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Только POST' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { error: 'Нужен вход' });
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u?.user) return reply(401, { error: 'Нужен вход' });
  const { data: m } = await admin.from('members').select('disabled').eq('user_id', u.user.id).maybeSingle();
  if (!m || m.disabled) return reply(403, { error: 'Нет доступа' });
  if (!FAMILY_PASSWORD) return reply(503, { error: 'Семейный пароль не задан' });
  return reply(200, { password: FAMILY_PASSWORD });
});
