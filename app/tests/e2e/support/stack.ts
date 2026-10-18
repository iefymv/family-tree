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
  people: Record<string, unknown>[];
  relationIds: string[];
  factIds: string[];
  documentIds: string[];
}

/** Снимок: строки людей seed и id всех связей/фактов/документов, существующих до прогона. */
export async function snapshot(s: SupabaseClient): Promise<Snapshot> {
  const at = new Date().toISOString();
  const people = (await check(s.from('people').select('*').in('id', SEED))) as Record<string, unknown>[];
  const ids = async (t: string) => ((await check(s.from(t).select('id'))) as { id: string }[]).map((r) => r.id);
  return { at, people, relationIds: await ids('relations'), factIds: await ids('facts'), documentIds: await ids('documents') };
}

/** Возвращает базу к снимку: новые строки удаляются, поля людей seed восстанавливаются, история прогона чистится. */
/** rpcAs — клиент с сессией e2e-админа: soft_delete/restore проверяют is_admin(), у service_role его нет. */
export async function restore(s: SupabaseClient, snap: Snapshot, rpcAs: SupabaseClient): Promise<void> {
  const before = { rel: new Set(snap.relationIds), fact: new Set(snap.factIds), doc: new Set(snap.documentIds) };
  const newIds = async (t: string, keep: Set<string>) => ((await check(s.from(t).select('id'))) as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  const newPeople = ((await check(s.from('people').select('id').gte('created_at', snap.at))) as { id: string }[]).map((r) => r.id).filter((id) => !SEED.includes(id));
  const rel = await newIds('relations', before.rel);
  const fact = await newIds('facts', before.fact);
  const docs = (await check(s.from('documents').select('id, storage_path'))) as { id: string; storage_path: string }[];
  const newDocs = docs.filter((d) => !before.doc.has(d.id));

  // Сначала отвязать портреты, затем удалить новые строки (service_role может DELETE).
  await check(s.from('people').update({ portrait_document_id: null }).in('id', [...SEED, ...newPeople]));
  if (rel.length) await check(s.from('relations').delete().in('id', rel));
  if (fact.length) await check(s.from('facts').delete().in('id', fact));
  if (newDocs.length) await check(s.from('documents').delete().in('id', newDocs.map((d) => d.id)));
  const paths = newDocs.flatMap((d) => [d.storage_path, d.storage_path.replace(/(\.[a-z0-9]+)?$/i, '_thumb.jpg')]);
  if (paths.length) await s.storage.from('documents').remove(paths);
  if (newPeople.length) {
    await check(s.from('edits').delete().in('row_id', newPeople));
    await check(s.from('people').delete().in('id', newPeople));
  }

  // Люди seed: вернуть поля и мягкое удаление (deleted_at меняется только через RPC — у service_role тоже).
  for (const row of snap.people) {
    const { id, created_by: _c, created_at: _a, updated_by: _u, updated_at: _t, deleted_at, ...fields } = row;
    await check(s.from('people').update(fields).eq('id', id as string));
    const cur = (await check(s.from('people').select('deleted_at').eq('id', id as string).single())) as { deleted_at: string | null };
    if (!!cur.deleted_at !== !!deleted_at) await check(rpcAs.rpc(deleted_at ? 'soft_delete' : 'restore', { p_table: 'people', p_id: id }));
  }
  // Связи и факты seed, которые сценарии убрали, — вернуть.
  for (const [t, keep] of [['relations', before.rel], ['facts', before.fact]] as const) {
    const gone = ((await check(s.from(t).select('id').not('deleted_at', 'is', null))) as { id: string }[]).map((r) => r.id).filter((id) => keep.has(id));
    for (const id of gone) await check(rpcAs.rpc('restore', { p_table: t, p_id: id }));
  }
  await check(s.from('edits').delete().gte('at', snap.at));
}
