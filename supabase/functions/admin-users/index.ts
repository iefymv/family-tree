// admin-users — управление входами родственников. Вызывает только активный админ.
// POST JSON: {action: 'create' | 'reset_password' | 'disable' | 'enable', ...}.
// Пароли не логируются и не возвращаются.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { LoginError, toLoginAndEmail } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const BAN_FOREVER = '876000h';
const ROLES = ['admin', 'relative', 'agent'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || v.length === 0) throw new HttpError(400, `Не заполнено поле ${key}`);
  return v;
}

function userId(body: Record<string, unknown>): string {
  const id = str(body, 'user_id');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Неверный user_id');
  return id;
}

async function requireAdmin(req: Request): Promise<string> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!m) throw new HttpError(401, 'Нужен вход');
  const { data, error } = await admin.auth.getUser(m[1]);
  if (error || !data.user) throw new HttpError(401, 'Нужен вход');
  const { data: me, error: qErr } = await admin
    .from('members').select('role, disabled').eq('user_id', data.user.id).maybeSingle();
  if (qErr) throw new HttpError(500, 'Не удалось проверить права');
  if (!me || me.disabled || me.role !== 'admin') throw new HttpError(403, 'Только для администратора');
  return data.user.id;
}

async function requireMember(id: string): Promise<void> {
  const { data, error } = await admin.from('members').select('user_id').eq('user_id', id).maybeSingle();
  if (error) throw new HttpError(500, 'Не удалось найти участника');
  if (!data) throw new HttpError(404, 'Такого участника нет');
}

async function create(body: Record<string, unknown>) {
  const personId = str(body, 'person_id');
  if (!UUID_RE.test(personId)) throw new HttpError(400, 'Неверный person_id');
  const displayName = str(body, 'display_name').trim();
  if (!displayName || displayName.length > 100) throw new HttpError(400, 'Неверное отображаемое имя');
  const role = body.role === undefined ? 'relative' : body.role;
  if (typeof role !== 'string' || !ROLES.includes(role)) throw new HttpError(400, 'Неверная роль');
  const password = str(body, 'password');

  let login: string, email: string;
  try {
    ({ login, email } = toLoginAndEmail(str(body, 'login')));
  } catch (e) {
    if (e instanceof LoginError) throw new HttpError(400, e.message);
    throw e;
  }
  const taken = () =>
    new HttpError(409, `Имя для входа «${login}» уже занято. Добавьте уточнение, например год рождения: «${login} 1985».`);

  const { data: person, error: pErr } = await admin
    .from('people').select('id').eq('id', personId).is('deleted_at', null).maybeSingle();
  if (pErr) throw new HttpError(500, 'Не удалось найти карточку');
  if (!person) throw new HttpError(404, 'Карточка не найдена');

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr || !created.user) {
    if (cErr?.code === 'email_exists' || (cErr?.status === 422 && /already/i.test(cErr.message))) throw taken();
    if (cErr?.code === 'weak_password') throw new HttpError(400, 'Слишком простой пароль');
    console.error('createUser failed:', cErr?.code, cErr?.status);
    throw new HttpError(500, 'Не удалось создать вход');
  }

  const uid = created.user.id;
  const { error: iErr } = await admin.from('members').insert({
    user_id: uid, person_id: personId, login, display_name: displayName, role,
  });
  if (iErr) {
    // Компенсация: без строки members учётка не нужна.
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    if (dErr) console.error('compensation deleteUser failed:', uid, dErr.code);
    console.error('members insert failed:', iErr.code);
    const msg = `${iErr.message} ${iErr.details ?? ''}`;
    if (iErr.code === '23505' && msg.includes('person_id')) throw new HttpError(409, 'К этой карточке уже привязан вход');
    if (iErr.code === '23505') throw taken();
    if (iErr.code === '23503') throw new HttpError(404, 'Карточка не найдена');
    throw new HttpError(500, 'Не удалось создать вход');
  }
  return { status: 201, body: { user_id: uid, login } };
}

async function resetPassword(body: Record<string, unknown>) {
  const id = userId(body);
  const password = str(body, 'password');
  await requireMember(id);
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    if (error.code === 'weak_password') throw new HttpError(400, 'Слишком простой пароль');
    console.error('reset_password failed:', error.code);
    throw new HttpError(500, 'Не удалось сменить пароль');
  }
  return { status: 200, body: { ok: true } };
}

async function setDisabled(body: Record<string, unknown>, callerId: string, disabled: boolean) {
  const id = userId(body);
  if (disabled && id === callerId) throw new HttpError(400, 'Нельзя отключить самого себя');
  await requireMember(id);
  // Сначала members.disabled: is_member() отрезает доступ сразу, не дожидаясь истечения JWT.
  const { error: mErr } = await admin.from('members').update({ disabled }).eq('user_id', id);
  if (mErr) throw new HttpError(500, 'Не удалось изменить участника');
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: disabled ? BAN_FOREVER : 'none' });
  if (error) {
    console.error('ban update failed:', error.code);
    throw new HttpError(500, 'Не удалось изменить вход');
  }
  return { status: 200, body: { ok: true, disabled } };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Только POST');
    const callerId = await requireAdmin(req);
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch {
      throw new HttpError(400, 'Ожидается JSON-объект');
    }
    let res: { status: number; body: unknown };
    switch (body.action) {
      case 'create': res = await create(body); break;
      case 'reset_password': res = await resetPassword(body); break;
      case 'disable': res = await setDisabled(body, callerId, true); break;
      case 'enable': res = await setDisabled(body, callerId, false); break;
      default: throw new HttpError(400, 'Неизвестное действие');
    }
    return reply(res.status, res.body);
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message });
    console.error('unexpected error:', e instanceof Error ? e.name : 'unknown');
    return reply(500, { error: 'Внутренняя ошибка' });
  }
});
