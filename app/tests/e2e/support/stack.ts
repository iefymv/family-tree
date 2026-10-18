// Подготовка и уборка данных e2e секретным ключом локального стека.
// Снимок вымышленной семьи из seed.sql делается до прогона и восстанавливается после:
// всё, что сценарии добавили или поменяли, исчезает.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { toEmail } from '../../../src/lib/auth';
import { E2E_PERSONS, SEED } from './cast';
import { localEnv } from './env';

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export function service(): SupabaseClient {
  const e = localEnv();
  return createClient(e.apiUrl, e.serviceKey, noSession);
}

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

/** Удаляет входы, привязанные к e2e-карточкам (остатки прошлых прогонов), вместе с auth-пользователями. */
export async function dropE2EMembers(s: SupabaseClient): Promise<string[]> {
  const rows = await check(s.from('members').select('user_id').in('person_id', E2E_PERSONS));
  const ids = (rows as { user_id: string }[]).map((r) => r.user_id);
  if (ids.length) await check(s.from('client_errors').delete().in('user_id', ids));
  for (const id of ids) {
    const { error } = await s.auth.admin.deleteUser(id); // members — каскадом
    if (error) throw error;
  }
  return ids;
}

/** Клиент под входом участника (для RPC, которым нужен is_admin()). */
export async function signedIn(login: string, password: string): Promise<SupabaseClient> {
  const e = localEnv();
  const c = createClient(e.apiUrl, e.anonKey, noSession);
  const { error } = await c.auth.signInWithPassword({ email: toEmail(login), password });
  if (error) throw error;
  return c;
}

export async function createMember(s: SupabaseClient, personId: string, login: string, password: string, displayName: string, role: 'admin' | 'relative') {
  const norm = login.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
  const { data, error } = await s.auth.admin.createUser({ email: toEmail(login), password, email_confirm: true });
  if (error) throw error;
  const { error: mErr } = await s.from('members').insert({ user_id: data.user.id, person_id: personId, login: norm, display_name: displayName, role });
  if (mErr) {
    await s.auth.admin.deleteUser(data.user.id);
    throw mErr;
  }
  return data.user.id;
}

export interface Snapshot {
  at: string;
  /** Строки людей вымышленной семьи из seed.sql. */
  people: Record<string, unknown>[];
  /** Связи и факты этих людей (их можно мягко удалить в сценариях — вернём). */
  relationIds: string[];
  factIds: string[];
}

const inList = (ids: string[]) => `(${ids.join(',')})`;

/**
 * Снимок ТОЛЬКО вымышленной семьи из seed.sql. В локальной базе может быть и другая (настоящая) семья —
 * её строки e2e не читает, не меняет и не удаляет.
 */
export async function snapshot(s: SupabaseClient): Promise<Snapshot> {
  const at = new Date().toISOString();
  const people = (await check(s.from('people').select('*').in('id', SEED))) as Record<string, unknown>[];
  const rel = (await check(s.from('relations').select('id, from_person, to_person').or(`from_person.in.${inList(SEED)},to_person.in.${inList(SEED)}`))) as { id: string; from_person: string; to_person: string }[];
  const facts = (await check(s.from('facts').select('id').in('person_id', SEED))) as { id: string }[];
  // Связь seed-человека с кем-то вне seed — не наша: в снимок не берём.
  return { at, people, relationIds: rel.filter((r) => SEED.includes(r.from_person) && SEED.includes(r.to_person)).map((r) => r.id), factIds: facts.map((f) => f.id) };
}

/** id участников, чьи входы привязаны к e2e-карточкам (созданы setup или сценарием 1). */
export async function e2eUserIds(s: SupabaseClient): Promise<string[]> {
  return ((await check(s.from('members').select('user_id').in('person_id', E2E_PERSONS))) as { user_id: string }[]).map((r) => r.user_id);
}

/**
 * Уборка после прогона. Удаляется только то, что доказуемо создал e2e:
 * строки, автор которых — e2e-участник; люди с external_ref «e2e-…» (их тесты создают секретным ключом)
 * и всё, что к ним относится. Вымышленная семья seed.sql возвращается к снимку.
 * rpcAs — клиент e2e-админа: soft_delete/restore проверяют is_admin(), у service_role его нет.
 */
export async function restore(s: SupabaseClient, snap: Snapshot, rpcAs: SupabaseClient, users: string[]): Promise<void> {
  const ids = <T extends { id: string }>(rows: unknown) => (rows as T[]).map((r) => r.id);
  const byUsers = users.length ? `created_by.in.${inList(users)}` : null;
  const madePeople = ids(await check(s.from('people').select('id').or([byUsers, 'external_ref.like.e2e-*'].filter(Boolean).join(','))))
    .filter((id) => !SEED.includes(id));
  const touch = (col1: string, col2?: string) => madePeople.length ? [`${col1}.in.${inList(madePeople)}`, col2 ? `${col2}.in.${inList(madePeople)}` : null] : [];
  const relIds = ids(await check(s.from('relations').select('id').or([byUsers, ...touch('from_person', 'to_person')].filter(Boolean).join(',') || 'id.is.null')));
  const factIds = ids(await check(s.from('facts').select('id').or([byUsers, ...touch('person_id')].filter(Boolean).join(',') || 'id.is.null')));
  const docs = (await check(s.from('documents').select('id, storage_path').or([users.length ? `uploaded_by.in.${inList(users)}` : null, ...touch('person_id')].filter(Boolean).join(',') || 'id.is.null'))) as { id: string; storage_path: string }[];
  const docIds = docs.map((d) => d.id);

  // Портреты, указывающие на удаляемые документы, отвязать (только у seed и у созданных e2e людей).
  if (docIds.length) await check(s.from('people').update({ portrait_document_id: null }).in('id', [...SEED, ...madePeople]).in('portrait_document_id', docIds));
  if (relIds.length) await check(s.from('relations').delete().in('id', relIds));
  if (factIds.length) await check(s.from('facts').delete().in('id', factIds));
  if (docIds.length) await check(s.from('documents').delete().in('id', docIds));
  const paths = docs.flatMap((d) => [d.storage_path, d.storage_path.replace(/(\.[a-z0-9]+)?$/i, '_thumb.jpg')]);
  if (paths.length) await s.storage.from('documents').remove(paths);
  if (madePeople.length) await check(s.from('people').delete().in('id', madePeople));

  // Вымышленная семья seed.sql: поля, мягкое удаление, убранные связи и факты.
  for (const row of snap.people) {
    const { id, created_by: _c, created_at: _a, updated_by: _u, updated_at: _t, deleted_at, ...fields } = row;
    await check(s.from('people').update(fields).eq('id', id as string));
    const cur = (await check(s.from('people').select('deleted_at').eq('id', id as string).single())) as { deleted_at: string | null };
    if (!!cur.deleted_at !== !!deleted_at) await check(rpcAs.rpc(deleted_at ? 'soft_delete' : 'restore', { p_table: 'people', p_id: id }));
  }
  for (const [t, keep] of [['relations', snap.relationIds], ['facts', snap.factIds]] as const) {
    if (!keep.length) continue;
    const gone = ids(await check(s.from(t).select('id').in('id', keep).not('deleted_at', 'is', null)));
    for (const id of gone) await check(rpcAs.rpc('restore', { p_table: t, p_id: id }));
  }

  // История: правки e2e-участников, правки удалённых строк и служебные правки восстановления seed за время прогона.
  const removed = [...madePeople, ...relIds, ...factIds, ...docIds];
  if (users.length) await check(s.from('edits').delete().in('actor', users));
  for (let i = 0; i < removed.length; i += 200) await check(s.from('edits').delete().in('row_id', removed.slice(i, i + 200)));
  const seedRows = [...SEED, ...snap.relationIds, ...snap.factIds];
  await check(s.from('edits').delete().in('row_id', seedRows).gte('at', snap.at).is('actor', null));
}
