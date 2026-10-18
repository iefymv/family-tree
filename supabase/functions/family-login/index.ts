// family-login — вход родственника по одному семейному паролю, без заранее созданной учётки.
// POST JSON {name, password, birth_year?} → {login}; клиент затем входит signInWithPassword(toEmail(login), password).
// Сначала проверяется семейный пароль (секрет FAMILY_PASSWORD, сравнение за постоянное время), потом всё остальное.
// После верного пароля:
//   точное совпадение (или прежнее имя переименованной карточки) → вход на эту карточку;
//   похожие (опечатка в фамилии) → 409 {need:'confirm', candidates:[{id, fio, birth_year}]};
//   {confirm_person_id} — «Это вы?» подтверждён: вход как при точном совпадении;
//   никого похожего или {create_new: true} («Нет, меня нет на дереве») → новая карточка БЕЗ связей
//   (имя, фамилия из ввода, год рождения, если указан) + вход; связи человек показывает уже на дереве.
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

// ---------------------------------------------------------------- похожие имена
// «Ивашка» ≈ «Ивашко», «Сольпи» ≈ «Солпе»: мягкий/твёрдый знак выбрасываются, й→и, э→е, затем расстояние Левенштейна.
const fold = (s: string) => norm(s).replace(/[ьъ]/g, '').replace(/й/g, 'и').replace(/э/g, 'е');

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Фамилии карточки: текущая, девичья, однословные варианты имени. */
function surnamesOf(p: Person): string[] {
  const out = [p.surname, p.maiden_name].filter((s): s is string => !!s);
  if (Array.isArray(p.name_variants)) {
    for (const v of p.name_variants) if (typeof v === 'string' && v.trim() && !v.trim().includes(' ')) out.push(v);
  }
  return out.map(fold).filter(Boolean);
}

/** Имя совпадает, фамилия близка (≤2 правки; для коротких фамилий ≤1) — в любом порядке слов. */
function nearMatch(p: Person, input: string): boolean {
  const given = fold(p.given_name ?? '');
  if (!given) return false;
  const words = input.split(' ');
  if (words.length < 2) return false;
  const orders: [string, string][] = [[words[0], words.slice(1).join(' ')], [words[words.length - 1], words.slice(0, -1).join(' ')]];
  return orders.some(([g, sn]) => {
    if (fold(g) !== given) return false;
    const typed = fold(sn);
    const limit = typed.length <= 4 ? 1 : 2;
    return surnamesOf(p).some((s) => levenshtein(s, typed) <= limit);
  });
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
/** «Пётр» из «пётр»: заглавная у каждого слова и части через дефис. */
const capital = (w: string) => w.split('-').map((x) => (x ? x[0].toLocaleUpperCase('ru') + x.slice(1) : x)).join('-');

/** Новая карточка без связей из «Имя Фамилия» и вход family_login для неё. */
async function createUnlinked(name: string, people: Person[], y: number | null) {
  const parts = name.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new HttpError(400, 'Введите имя и фамилию');
  const given = capital(parts[0]);
  const surname = parts.slice(1).map(capital).join(' ');
  if (given.length > 100 || surname.length > 100) throw new HttpError(400, 'Слишком длинное имя');
  const key = norm(`${given} ${surname}`);
  // Тёзка с тем же годом уже есть — это, скорее всего, он сам: входить обычным образом.
  const same = people.filter((p) => nameKeys(p).has(key) && (y === null || !hasBirth(p) || bornIn(p, y)));
  if (same.length) throw new HttpError(409, 'Человек с таким именем уже есть на дереве — войдите по имени и паролю', { need: 'login' });

  const fields: Record<string, unknown> = { given_name: given, surname };
  if (y !== null) Object.assign(fields, { birth_date_text: String(y), birth_date_from: `${y}-01-01`, birth_date_to: `${y}-12-31` });
  let personId = '';
  const login = await createWithLogin([key, ...(y !== null ? [`${key} ${y}`] : [])], async (uid, l) => {
    const { data, error } = await admin.rpc('family_self_create', { p_user: uid, p_fields: fields, p_login: l, p_display: given });
    if (error) {
      console.error('family_self_create failed:', error.code);
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

  const input = norm(name);
  if (!input) throw new HttpError(400, 'Введите имя и фамилию');

  const y = year(body.birth_year);
  const people = await livePeople();

  // «Нет, меня нет на дереве» — сразу новая карточка без связей.
  if (body.create_new === true) return createUnlinked(name, people, y);

  // «Это вы?» подтверждён: человек выбран из предложенных похожих (и должен им оставаться).
  if (body.confirm_person_id !== undefined) {
    const id = body.confirm_person_id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(400, 'Неверный выбор');
    const p = people.find((x) => x.id === id);
    if (!p || !(nameKeys(p).has(input) || nearMatch(p, input))) throw new HttpError(404, 'Этого человека нет среди похожих — попробуйте ещё раз');
    return loginPerson(p);
  }

  let matches = people.filter((p) => nameKeys(p).has(input));
  if (y !== null) matches = matches.filter((p) => !hasBirth(p) ? matches.length === 1 : bornIn(p, y));
  if (matches.length > 1) {
    if (y === null) throw new HttpError(409, 'На дереве несколько человек с таким именем — укажите год рождения', { need: 'birth_year' });
    throw new HttpError(409, 'Не получается выбрать между тёзками — попросите Ефима создать вам вход');
  }
  if (matches.length === 1) return loginPerson(matches[0]);

  // Карточку переименовали, а человек вводит прежнее имя — его семейная учётка по старому логину.
  const old = await memberBy('login', input);
  if (old && old.family_login) return useExisting(old);

  // Опечатка или другое написание фамилии: предложить похожих, не создавая двойника.
  let near = people.filter((p) => nearMatch(p, input));
  if (y !== null) near = near.filter((p) => !hasBirth(p) || bornIn(p, y));
  if (near.length) {
    throw new HttpError(409, 'Это вы?', {
      need: 'confirm',
      candidates: near.slice(0, 5).map((p) => ({ id: p.id, fio: fullName(p), birth_year: birthYear(p) })),
    });
  }
  return createUnlinked(name, people, y);
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
