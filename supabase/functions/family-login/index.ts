// family-login — вход родственника по одному семейному паролю, без заранее созданной учётки.
// POST JSON {name, password, birth_year?} → {login}; клиент затем входит signInWithPassword(toEmail(login), password).
// Сначала проверяется семейный пароль (секрет FAMILY_PASSWORD, сравнение за постоянное время), потом всё остальное.
// Варианты после верного пароля:
//   {search: 'текст'}                         → {people: [{id, name, birth_year}]} — поиск родственника для привязки;
//   {link: {anchor_id, kind}, given_name?, surname?, birth_date?, sex?} → добавить себя на дерево и войти.
// Человек ищется по ТЕКУЩИМ полям карточки (имя + фамилия / девичья / варианты имени), вход — по person_id,
// логин учётки (и её email) не меняется при правке карточки. Пароли не логируются и не возвращаются.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { LoginError, normalizeLogin, toLoginAndEmail } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FAMILY_PASSWORD = Deno.env.get('FAMILY_PASSWORD') ?? '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_IP_FAILS = 10; // за 15 минут с одного адреса
const MAX_ALL_FAILS = 50; // за 15 минут всего — на случай подмены заголовка адреса
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['child', 'parent', 'spouse', 'sibling'];
const WRONG = 'Неверное имя или пароль';

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
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Сравнение за постоянное время: хэши одинаковой длины, XOR по всем байтам. */
async function samePassword(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function clientIp(req: Request): string {
  const raw = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
    ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0];
  const ip = raw.trim().slice(0, 100);
  return ip || 'unknown';
}

// ---------------------------------------------------------------- люди
interface Person {
  id: string;
  given_name: string | null;
  surname: string | null;
  patronymic: string | null;
  maiden_name: string | null;
  name_variants: unknown;
  birth_date_text: string | null;
  birth_date_from: string | null;
  birth_date_to: string | null;
}

async function livePeople(): Promise<Person[]> {
  const out: Person[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('people')
      .select('id, given_name, surname, patronymic, maiden_name, name_variants, birth_date_text, birth_date_from, birth_date_to')
      .is('deleted_at', null).eq('is_placeholder', false)
      .order('id').range(from, from + 999);
    if (error) throw new HttpError(500, 'Не удалось прочитать дерево');
    out.push(...(data as Person[]));
    if (data.length < 1000) return out;
  }
}

const norm = (s: string | null | undefined) => normalizeLogin(s ?? '');

/** Все написания «имя фамилия» карточки: фамилия, девичья, варианты имени; в обоих порядках. */
function nameKeys(p: Person): Set<string> {
  const keys = new Set<string>();
  const given = norm(p.given_name);
  const surnames = [p.surname, p.maiden_name].map(norm).filter(Boolean);
  const add = (s: string) => { if (s) keys.add(s); };
  if (given) for (const s of surnames) { add(`${given} ${s}`); add(`${s} ${given}`); }
  if (Array.isArray(p.name_variants)) {
    for (const v of p.name_variants) {
      if (typeof v !== 'string') continue;
      const nv = norm(v);
      if (!nv) continue;
      if (nv.includes(' ')) add(nv); // «Имя Фамилия» целиком
      else if (given) { add(`${given} ${nv}`); add(`${nv} ${given}`); } // вариант фамилии
    }
  }
  return keys;
}

const yearOf = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);

function birthYear(p: Person): number | null {
  const a = yearOf(p.birth_date_from), b = yearOf(p.birth_date_to);
  if (a && a === b) return a;
  const m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(p.birth_date_text ?? '');
  return m ? Number(m[1]) : null;
}

function bornIn(p: Person, y: number): boolean {
  const a = yearOf(p.birth_date_from), b = yearOf(p.birth_date_to);
  if (a && b && a <= y && y <= b) return true;
  return new RegExp(`(?:^|\\D)${y}(?:\\D|$)`).test(p.birth_date_text ?? '');
}

const hasBirth = (p: Person) => !!(p.birth_date_from || p.birth_date_to || p.birth_date_text);

function fullName(p: Person): string {
  return [p.surname, p.given_name, p.patronymic].filter(Boolean).join(' ') || 'Без имени';
}

// ---------------------------------------------------------------- разбор ввода
function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || v.length === 0) throw new HttpError(400, `Не заполнено поле ${key}`);
  return v;
}

function year(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 1800 || n > 2200) throw new HttpError(400, 'Год рождения — четыре цифры, например 1985');
  return n;
}

interface BirthDate { text: string; from: string; to: string; year: number }

/** «1985», «12.03.1985» или «1985-03-12». */
function birthDate(v: unknown): BirthDate | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new HttpError(400, 'Неверная дата рождения');
  const s = v.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = (y: number, m: number, d: number): BirthDate => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (y < 1800 || y > 2200 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new HttpError(400, 'Неверная дата рождения');
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    return { text: `${pad(d)}.${pad(m)}.${y}`, from: iso, to: iso, year: y };
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(s))) { const y = year(m[1])!; return { text: m[1], from: `${y}-01-01`, to: `${y}-12-31`, year: y }; }
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return day(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return day(+m[1], +m[2], +m[3]);
  throw new HttpError(400, 'Дата рождения: год (1985) или число (12.03.1985)');
}

function emailFor(login: string): string {
  try {
    return toLoginAndEmail(login).email;
  } catch (e) {
    if (e instanceof LoginError) throw new HttpError(400, e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- учётки
interface Member { user_id: string; login: string; role: string; disabled: boolean; family_login: boolean }

async function memberBy(col: 'person_id' | 'login', value: string): Promise<Member | null> {
  const { data, error } = await admin.from('members')
    .select('user_id, login, role, disabled, family_login').eq(col, value).maybeSingle();
  if (error) throw new HttpError(500, 'Не удалось найти вход');
  return data as Member | null;
}

/** Существующий вход: открывается семейным паролем только семейная учётка. */
async function useExisting(m: Member) {
  if (m.role === 'admin' || !m.family_login) throw new HttpError(403, 'Для этого человека вход по семейному паролю закрыт');
  if (m.disabled) throw new HttpError(403, 'Вход отключён — обратитесь к администратору');
  // Пароль учётки = текущий семейный (если семейный пароль сменили — подтягиваем).
  const { error } = await admin.auth.admin.updateUserById(m.user_id, { password: FAMILY_PASSWORD });
  if (error) {
    console.error('family password sync failed:', error.code);
    throw new HttpError(500, 'Не удалось войти');
  }
  return { status: 200, body: { login: m.login } };
}

/**
 * Перебирает логины-кандидаты: свободный → auth-пользователь + make(uid, login).
 * make бросает {code} ошибки PostgREST; при сбое auth-пользователь удаляется (компенсация).
 * Возвращает логин или null, если все кандидаты заняты.
 */
async function createWithLogin(
  candidates: string[],
  make: (uid: string, login: string) => Promise<{ code?: string; message?: string; details?: string } | null>,
): Promise<string | null> {
  for (const login of candidates) {
    if (await memberBy('login', login)) continue;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: emailFor(login), password: FAMILY_PASSWORD, email_confirm: true,
    });
    if (cErr || !created.user) {
      if (cErr?.code === 'email_exists' || (cErr?.status === 422 && /already/i.test(cErr.message))) continue;
      if (cErr?.code === 'weak_password') throw new HttpError(500, 'Семейный пароль не подходит для входа — сообщите администратору');
      console.error('createUser failed:', cErr?.code, cErr?.status);
      throw new HttpError(500, 'Не удалось создать вход');
    }
    const uid = created.user.id;
    const err = await make(uid, login);
    if (!err) return login;
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    if (dErr) console.error('compensation deleteUser failed:', uid, dErr.code);
    if (err.code === '23505' && `${err.message ?? ''} ${err.details ?? ''}`.includes('login')) continue;
    throw err;
  }
  return null;
}

const busy = () => new HttpError(409, 'Имя для входа уже занято — попросите Ефима создать вам вход');

async function loginPerson(p: Person) {
  const existing = await memberBy('person_id', p.id);
  if (existing) return useExisting(existing);

  const base = norm(`${p.given_name ?? ''} ${p.surname ?? p.maiden_name ?? ''}`);
  const by = birthYear(p);
  const candidates = [base, ...(by ? [`${base} ${by}`] : [])];
  try {
    const login = await createWithLogin(candidates, async (uid, l) => {
      const { error } = await admin.from('members').insert({
        user_id: uid, person_id: p.id, login: l, display_name: p.given_name || l, role: 'relative', family_login: true,
      });
      if (error) console.error('members insert failed:', error.code);
      return error;
    });
    if (!login) throw busy();
    return { status: 201, body: { login } };
  } catch (e) {
    // Параллельный запрос успел создать вход этому человеку (наша учётка уже удалена компенсацией).
    const err = e as { code?: string; message?: string; details?: string };
    if (err.code === '23505' && `${err.message ?? ''} ${err.details ?? ''}`.includes('person_id')) {
      const m = await memberBy('person_id', p.id);
      if (m) return useExisting(m);
    }
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, 'Не удалось создать вход');
  }
}

// ---------------------------------------------------------------- сценарии
async function search(body: Record<string, unknown>) {
  const q = norm(typeof body.search === 'string' ? body.search : '');
  if (q.length < 2) return { status: 200, body: { people: [] } };
  const words = q.split(' ');
  const people = (await livePeople())
    .filter((p) => {
      const hay = norm([p.given_name, p.surname, p.patronymic, p.maiden_name].filter(Boolean).join(' '));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, 20)
    .map((p) => ({ id: p.id, name: fullName(p), birth_year: birthYear(p) }));
  return { status: 200, body: { people } };
}

async function selfAdd(body: Record<string, unknown>, name: string) {
  const link = body.link as Record<string, unknown> | null;
  if (!link || typeof link !== 'object' || Array.isArray(link)) throw new HttpError(400, 'Неверная привязка');
  const anchor = link.anchor_id, kind = link.kind;
  if (typeof anchor !== 'string' || !UUID_RE.test(anchor)) throw new HttpError(400, 'Выберите родственника на дереве');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw new HttpError(400, 'Выберите, кем вы приходитесь');

  // Имя и фамилия: явные поля или «Имя Фамилия» из строки входа (как написаны, без нижнего регистра).
  const parts = name.normalize('NFC').trim().split(/\s+/);
  const pick = (k: string, fallback: string) => {
    const v = body[k];
    return (typeof v === 'string' ? v : fallback).normalize('NFC').trim().replace(/\s+/g, ' ');
  };
  const given = pick('given_name', parts[0] ?? '');
  const surname = pick('surname', parts.slice(1).join(' '));
  if (!given || !surname) throw new HttpError(400, 'Укажите имя и фамилию');
  if (given.length > 100 || surname.length > 100) throw new HttpError(400, 'Слишком длинное имя');
  const sex = body.sex === undefined || body.sex === null || body.sex === '' ? 'u' : body.sex;
  if (typeof sex !== 'string' || !['m', 'f', 'u'].includes(sex)) throw new HttpError(400, 'Неверный пол');
  const born = birthDate(body.birth_date);

  // Такой человек уже есть — входить обычным образом, а не плодить двойника.
  const key = norm(`${given} ${surname}`);
  const same = (await livePeople()).filter((p) => nameKeys(p).has(key));
  if (born) {
    if (same.some((p) => bornIn(p, born.year))) {
      throw new HttpError(409, 'Вы уже есть на дереве — войдите по имени, фамилии и семейному паролю', { need: 'login' });
    }
  } else if (same.length) {
    throw new HttpError(409, 'Человек с таким именем уже есть на дереве. Если это вы — войдите обычным образом, если нет — укажите год рождения',
      { need: 'birth_year' });
  }

  const fields: Record<string, unknown> = { given_name: given, surname, sex };
  if (born) Object.assign(fields, { birth_date_text: born.text, birth_date_from: born.from, birth_date_to: born.to });
  const candidates = [key, ...(born ? [`${key} ${born.year}`] : [])];
  let personId = '';
  const login = await createWithLogin(candidates, async (uid, l) => {
    const { data, error } = await admin.rpc('family_self_add', {
      p_user: uid, p_anchor: anchor, p_kind: kind, p_fields: fields, p_login: l, p_display: given,
    });
    if (error) {
      console.error('family_self_add failed:', error.code);
      if (error.code === 'P0002') return new HttpError(404, 'Этого родственника нет на дереве — найдите его ещё раз');
      if (error.code === '23514') return new HttpError(409, 'У этого человека на дереве уже двое родителей');
      if (error.code === '23505') return error;
      return new HttpError(500, 'Не удалось добавить вас на дерево');
    }
    personId = data as string;
    return null;
  });
  if (!login) throw busy();
  return { status: 201, body: { login, person_id: personId } };
}

async function familyLogin(body: Record<string, unknown>, ip: string) {
  const name = str(body, 'name');
  const password = str(body, 'password');
  if (name.length > 200 || password.length > 200) throw new HttpError(400, WRONG);
  if (!FAMILY_PASSWORD) throw new HttpError(503, 'Вход по семейному паролю не настроен');

  const { data: fails, error: fErr } = await admin.rpc('family_login_fails', { p_ip: ip }).single();
  if (fErr || !fails) throw new HttpError(500, 'Не удалось проверить попытки входа');
  const f = fails as { ip_fails: number; all_fails: number };
  if (f.ip_fails >= MAX_IP_FAILS || f.all_fails >= MAX_ALL_FAILS) {
    throw new HttpError(429, 'Слишком много неудачных попыток. Подождите 15 минут и попробуйте снова.');
  }
  if (!(await samePassword(password, FAMILY_PASSWORD))) {
    const { error } = await admin.rpc('family_login_fail', { p_ip: ip });
    if (error) console.error('attempt log failed:', error.code);
    throw new HttpError(401, WRONG);
  }

  if (body.search !== undefined) return search(body);
  const input = norm(name);
  if (!input) throw new HttpError(400, 'Введите имя и фамилию');
  if (body.link !== undefined) return selfAdd(body, name);

  const y = year(body.birth_year);
  let matches = (await livePeople()).filter((p) => nameKeys(p).has(input));
  if (y !== null) matches = matches.filter((p) => !hasBirth(p) ? matches.length === 1 : bornIn(p, y));
  if (matches.length > 1) {
    if (y === null) throw new HttpError(409, 'На дереве несколько человек с таким именем — укажите год рождения', { need: 'birth_year' });
    throw new HttpError(409, 'Не получается выбрать между тёзками — попросите Ефима создать вам вход');
  }
  if (matches.length === 1) return loginPerson(matches[0]);

  // Карточку переименовали, а человек вводит прежнее имя — его семейная учётка по старому логину.
  const old = await memberBy('login', input);
  if (old && old.family_login) return useExisting(old);
  throw new HttpError(404, 'Вас ещё нет на дереве. Кем вы приходитесь родне?', { need: 'link' });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Только POST');
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch {
      throw new HttpError(400, 'Ожидается JSON-объект');
    }
    const res = await familyLogin(body, clientIp(req));
    return reply(res.status, res.body);
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message, ...e.extra });
    console.error('unexpected error:', e instanceof Error ? e.name : 'unknown');
    return reply(500, { error: 'Внутренняя ошибка' });
  }
});
