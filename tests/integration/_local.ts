// Локальный стек для интеграционных тестов. Ключи берутся из `supabase status -o env` в памяти и не печатаются.
// Тесты создают своих вымышленных людей (external_ref itest-*) и удаляют всё созданное в конце.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = new URL('../../', import.meta.url);

function status(): Record<string, string> {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  if (!env.API_URL || !env.SERVICE_ROLE_KEY || !env.ANON_KEY) throw new Error('Локальный стек не запущен: supabase start');
  return env;
}

export const env = status();
export const API_URL = env.API_URL;
export const FN_URL = `${env.FUNCTIONS_URL ?? `${API_URL}/functions/v1`}/admin-users`;
export const RUN = String(Date.now() % 1_000_000).padStart(6, '0');

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export const service: SupabaseClient = createClient(API_URL, env.SERVICE_ROLE_KEY, noSession);
export const anonClient = (): SupabaseClient => createClient(API_URL, env.ANON_KEY, noSession);

const createdUsers = new Set<string>();
const createdPeople = new Set<string>();

export function trackUser(id: string): void { createdUsers.add(id); }
/** Человек, созданный не makePerson (например, самодобавлением через family-login). */
export function trackPerson(id: string): void { createdPeople.add(id); }

export async function makePerson(given: string, surname: string): Promise<string> {
  const { data, error } = await service.from('people')
    .insert({ external_ref: `itest-${RUN}-${createdPeople.size}`, given_name: given, surname, sex: 'u', notes: 'Вымышленный, интеграционный тест.' })
    .select('id').single();
  if (error) throw error;
  createdPeople.add(data.id);
  return data.id;
}

/** Создаёт админа напрямую секретным ключом (как bootstrap-admin) и возвращает его токен. */
export async function makeAdmin(login: string, email: string, password: string, personId: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  trackUser(data.user.id);
  const { error: iErr } = await service.from('members')
    .insert({ user_id: data.user.id, person_id: personId, login, display_name: 'Тест-админ', role: 'admin' });
  if (iErr) throw iErr;
  return { userId: data.user.id, token: await signIn(email, password) };
}

export async function signIn(email: string, password: string): Promise<string> {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

export async function signInClient(email: string, password: string) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  return { client: c, error };
}

export async function callFn(body: unknown, token?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: env.ANON_KEY, ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (typeof json.user_id === 'string') trackUser(json.user_id);
  return { status: res.status, json, headers: res.headers };
}

export async function authUserByEmail(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
}

/** psql внутри контейнера базы (суперпользователь) — для симуляции сбоев. */
export function dbExec(sql: string): void {
  const cfg = readFileSync(new URL('supabase/config.toml', ROOT), 'utf8');
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1];
  execFileSync('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'ignore', 'pipe'] });
}

export async function cleanup(): Promise<void> {
  const ids = [...createdPeople];
  if (ids.length) {
    const { data } = await service.from('members').select('user_id').in('person_id', ids);
    for (const m of data ?? []) createdUsers.add(m.user_id);
  }
  for (const id of createdUsers) await service.auth.admin.deleteUser(id); // members удаляются каскадом
  if (ids.length) {
    const list = `(${ids.join(',')})`;
    const { data: rels } = await service.from('relations').select('id').or(`from_person.in.${list},to_person.in.${list}`);
    const relIds = (rels ?? []).map((r) => r.id);
    if (relIds.length) {
      await service.from('relations').delete().in('id', relIds);
      await service.from('edits').delete().eq('table_name', 'relations').in('row_id', relIds);
    }
    await service.from('people').delete().in('id', ids);
    await service.from('edits').delete().eq('table_name', 'people').in('row_id', ids);
  }
}
