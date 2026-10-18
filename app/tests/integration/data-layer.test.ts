// Слой данных app/src/lib/* против локального Supabase: вход по имени, дерево, «+», diff-PATCH,
// факты/связи, история и откат, загрузка фото, client_errors, anon ничего не видит.
// Все люди вымышленные; всё созданное удаляется в afterAll.
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toEmail } from '../../src/lib/auth';
import { createAppClient, setClient } from '../../src/lib/supabase';
import { getMe, signIn, signOut } from '../../src/lib/session';
import {
  addFact, addRelative, deletePerson, diffPerson, restorePerson, getPersonDetail, history, loadFamily, revert,
  softDeleteFact, softDeleteRelation, updatePerson, type Family, type PersonRow,
} from '../../src/lib/api';
import { invalidate, signedUrl, signedUrls } from '../../src/lib/signedUrls';
import { setPortrait, uploadPrepared } from '../../src/lib/images';
import { reportError } from '../../src/lib/errors';
import { ANON_KEY, API_URL, RUN, anonClient, service } from './local';

// ---- запись запросов: оборачиваем fetch ДО создания клиентов (supabase-js запоминает fetch при создании)
interface Req { method: string; url: string; body: string | null }
const requests: Req[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url, body: typeof init?.body === 'string' ? init.body : null });
  return realFetch(input, init);
}) as typeof fetch;

const SEED_IDS = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const PETR = SEED_IDS[4];

const createdUsers: string[] = [];
const createdPeople = new Set<string>();
const uploadedPaths: string[] = [];

const relativeLogin = `матвей тестовый ${RUN}`;
const adminLogin = `захар проверкин ${RUN}`;
const relativePassword = `Пароль-${randomUUID()}`;
const adminPassword = `Пароль-${randomUUID()}`;
let relativePersonId = '';
let adminPersonId = '';
let relativeUserId = '';
let relClient: SupabaseClient;
let adminClient: SupabaseClient;

async function makeMember(given: string, surname: string, login: string, password: string, role: 'relative' | 'admin') {
  const { data: p, error: pErr } = await service.from('people')
    .insert({ external_ref: `itest-app-${RUN}-${role}`, given_name: given, surname, sex: 'm', notes: 'Вымышленный, интеграционный тест app.' })
    .select('id').single();
  if (pErr) throw pErr;
  createdPeople.add(p.id);
  const { data: u, error: uErr } = await service.auth.admin.createUser({ email: toEmail(login), password, email_confirm: true });
  if (uErr) throw uErr;
  createdUsers.push(u.user.id);
  const { error: mErr } = await service.from('members')
    .insert({ user_id: u.user.id, person_id: p.id, login, display_name: `${given} (тест)`, role });
  if (mErr) throw mErr;
  return { personId: p.id as string, userId: u.user.id };
}

/** Минимальный валидный PNG w×h (RGBA), генерируется на лету — в git картинок нет. */
function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set([91, 127, 58, 255], y * (w * 4 + 1) + 1 + x * 4); // #5B7F3A
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const parentsOf = (f: Family, id: string) =>
  f.relations.filter((r) => r.kind === 'parent' && r.childId === id).map((r) => (r.kind === 'parent' ? r.parentId : ''));
const spousesOf = (f: Family, id: string) =>
  f.relations.filter((r) => r.kind === 'spouse' && (r.aId === id || r.bId === id))
    .map((r) => (r.kind === 'spouse' ? (r.aId === id ? r.bId : r.aId) : ''));

beforeAll(async () => {
  const rel = await makeMember('Матвей', 'Тестовый', relativeLogin, relativePassword, 'relative');
  relativePersonId = rel.personId;
  relativeUserId = rel.userId;
  adminPersonId = (await makeMember('Захар', 'Проверкин', adminLogin, adminPassword, 'admin')).personId;
  relClient = createAppClient(API_URL, ANON_KEY);
  adminClient = createAppClient(API_URL, ANON_KEY);
});

afterAll(async () => {
  setClient(null);
  const people = [...createdPeople];
  // Все строки, ссылающиеся на созданных людей (включая мягко удалённые).
  const ids = async (table: string, filter: string) =>
    ((await service.from(table).select('id').or(filter)).data ?? []).map((r: { id: string }) => r.id);
  const list = people.join(',');
  const relIds = await ids('relations', `from_person.in.(${list}),to_person.in.(${list})`);
  const factIds = await ids('facts', `person_id.in.(${list})`);
  const docIds = await ids('documents', `person_id.in.(${list})`);
  await service.from('people').update({ portrait_document_id: null }).in('id', people);
  await service.from('edits').delete().in('row_id', [...people, ...relIds, ...factIds, ...docIds]);
  if (relIds.length) await service.from('relations').delete().in('id', relIds);
  if (factIds.length) await service.from('facts').delete().in('id', factIds);
  if (docIds.length) await service.from('documents').delete().in('id', docIds);
  if (uploadedPaths.length) await service.storage.from('documents').remove(uploadedPaths);
  if (createdUsers.length) await service.from('client_errors').delete().in('user_id', createdUsers);
  for (const id of createdUsers) await service.auth.admin.deleteUser(id); // members — каскадом
  await service.from('edits').delete().in('row_id', people);
  await service.from('people').delete().in('id', people);
  globalThis.fetch = realFetch;

  // Проверка уборки: ничего от прогона не осталось.
  const { count } = await service.from('people').select('id', { count: 'exact', head: true }).in('id', people);
  expect(count).toBe(0);
});

describe('anon', () => {
  test('без входа слой данных ничего не получает', async () => {
    setClient(anonClient());
    await expect(loadFamily()).rejects.toThrow();
    expect(await getMe()).toBeNull();
    await expect(getPersonDetail(PETR)).rejects.toThrow();
    // Хранилище: подписать ссылку anon не может.
    await expect(signedUrls([`people/${PETR}/nothing.jpg`])).resolves.toEqual(new Map());
    // Прямые запросы: 0 строк или отказ — данных нет.
    const a = anonClient();
    for (const t of ['people', 'relations', 'facts', 'documents', 'members', 'edits', 'people_live']) {
      const { data } = await a.from(t).select('*').limit(1);
      expect(data ?? []).toEqual([]);
    }
  });
});

describe('вход по имени', () => {
  test('неверный пароль — понятная ошибка', async () => {
    setClient(relClient);
    await expect(signIn(relativeLogin, 'неверный-пароль')).rejects.toThrow('Неверное имя или пароль');
  });

  test('«имя фамилия» в любом регистре и с лишними пробелами → getMe из members', async () => {
    setClient(relClient);
    const me = await signIn(`  МАТВЕЙ   Тестовый ${RUN} `, relativePassword);
    expect(me).toEqual({ userId: relativeUserId, personId: relativePersonId, displayName: 'Матвей (тест)', role: 'relative' });
    expect(await getMe()).toEqual(me);
    // Запрос members не просит скрытых колонок (login, disabled).
    const q = requests.filter((r) => r.url.includes('/rest/v1/members')).at(-1)!;
    expect(new URL(q.url).searchParams.get('select')).toBe('user_id,person_id,display_name,role');
  });
});

describe('дерево', () => {
  test('loadFamily: 12 Ивановых из seed, типы graph.ts', async () => {
    setClient(relClient);
    const f = await loadFamily();
    const ids = new Set(f.persons.map((p) => p.id));
    for (const id of SEED_IDS) expect(ids.has(id), id).toBe(true);
    expect(f.persons.find((p) => p.id === PETR)).toEqual({ id: PETR, name: 'Пётр Иванов', gender: 'male' });
    expect(f.persons.find((p) => p.id === SEED_IDS[1])?.gender).toBe('female');
    expect(f.people.find((p) => p.id === PETR)?.patronymic).toBe('Николаевич');
    expect(f.relations).toContainEqual({ kind: 'spouse', aId: SEED_IDS[4], bId: SEED_IDS[6], order: 1, divorced: false });
    expect(f.relations).toContainEqual({ kind: 'parent', parentId: SEED_IDS[4], childId: SEED_IDS[7], type: 'biological' });
    expect(f.relations).toContainEqual({ kind: 'parent', parentId: SEED_IDS[5], childId: SEED_IDS[9], type: 'raised_by' });
    expect(f.relationRows.length).toBe(f.relations.length);
  });

  test('getPersonDetail: человек, факты, документы', async () => {
    setClient(relClient);
    const d = await getPersonDetail(PETR);
    expect(d?.person.given_name).toBe('Пётр');
    expect(d?.facts.map((x) => x.value)).toContain('Инженер');
    expect(Array.isArray(d?.documents)).toBe(true);
    expect(await getPersonDetail(randomUUID())).toBeNull();
  });
});

describe('«+» addRelative', () => {
  const anchor = () => relativePersonId;
  let placeholderId = '';
  let parentId = '';
  let spouseId = '';
  let childId = '';

  test('sibling без родителей: создаётся placeholder-родитель, общий с якорем', async () => {
    setClient(relClient);
    const n = requests.length;
    const r = await addRelative(anchor(), 'sibling', { given_name: 'Варвара', surname: 'Тестовая', sex: 'f' });
    createdPeople.add(r.person.id);
    // Один запрос — RPC; прямых вставок в people/relations нет.
    const sent = requests.slice(n).map((x) => `${x.method} ${new URL(x.url).pathname}`);
    expect(sent).toEqual(['POST /rest/v1/rpc/add_relative']);
    expect(r.relationIds).toHaveLength(2);
    expect(r.placeholder?.is_placeholder).toBe(true);
    placeholderId = r.placeholder!.id;
    createdPeople.add(placeholderId);
    const f = await loadFamily();
    expect(parentsOf(f, anchor())).toEqual([placeholderId]);
    expect(parentsOf(f, r.person.id)).toEqual([placeholderId]);
    expect(f.persons.find((p) => p.id === placeholderId)?.name).toBe('Неизвестно');
  });

  test('sibling при известных родителях: те же родители, без нового placeholder', async () => {
    setClient(relClient);
    const r = await addRelative(anchor(), 'sibling', { given_name: 'Глеб', surname: 'Тестовый', sex: 'm' });
    createdPeople.add(r.person.id);
    expect(r.placeholder).toBeUndefined();
    expect(parentsOf(await loadFamily(), r.person.id)).toEqual([placeholderId]);
  });

  test('parent: второй родитель становится супругом первого', async () => {
    setClient(relClient);
    const r = await addRelative(anchor(), 'parent', { given_name: 'Степан', surname: 'Тестовый', sex: 'm' });
    createdPeople.add(r.person.id);
    parentId = r.person.id;
    const f = await loadFamily();
    expect(parentsOf(f, anchor()).sort()).toEqual([placeholderId, parentId].sort());
    expect(spousesOf(f, parentId)).toEqual([placeholderId]);
    await expect(addRelative(anchor(), 'parent', { given_name: 'Лишний' })).rejects.toThrow('двое родителей');
  });

  test('spouse: брак с упорядоченной парой и номером 1', async () => {
    setClient(relClient);
    const r = await addRelative(anchor(), 'spouse', { given_name: 'Дарья', surname: 'Тестовая', sex: 'f' });
    createdPeople.add(r.person.id);
    spouseId = r.person.id;
    const f = await loadFamily();
    const m = f.relations.find((x) => x.kind === 'spouse' && [x.aId, x.bId].includes(spouseId));
    expect(m).toMatchObject({ kind: 'spouse', order: 1, divorced: false });
    expect(m?.kind === 'spouse' && m.aId < m.bId).toBe(true);
  });

  test('child: ребёнок якоря и его текущего супруга', async () => {
    setClient(relClient);
    const r = await addRelative(anchor(), 'child', { given_name: 'Тимофей', surname: 'Тестовый', sex: 'm' });
    createdPeople.add(r.person.id);
    const f = await loadFamily();
    expect(parentsOf(f, r.person.id).sort()).toEqual([anchor(), spouseId].sort());
    expect(f.persons.find((p) => p.id === r.person.id)).toEqual({ id: r.person.id, name: 'Тимофей Тестовый', gender: 'male' });
    childId = r.person.id;
    // Автор — вызывающий участник (DEFINER-функция не подменяет auth.uid()).
    const h = await history(r.person.id);
    const own = h.filter((e) => e.row_id === r.person.id || r.relationIds.includes(e.row_id));
    expect(own).toHaveLength(3);
    for (const e of own) expect(e).toMatchObject({ op: 'insert', actor: relativeUserId, actor_label: 'Матвей (тест)' });
    expect(r.person.created_by).toBe(relativeUserId);
  });

  test('сбой посередине — не остаётся ничего (одна транзакция)', async () => {
    setClient(relClient);
    const count = async () => ({
      people: (await service.from('people').select('id', { count: 'exact', head: true })).count,
      relations: (await service.from('relations').select('id', { count: 'exact', head: true })).count,
      edits: (await service.from('edits').select('id', { count: 'exact', head: true })).count,
    });
    // У Дарьи (супруга) нет родителей: sibling сначала создаст placeholder, затем упадёт на CHECK sex.
    const before = await count();
    await expect(addRelative(spouseId, 'sibling', { given_name: 'Сбой', sex: 'x' as never })).rejects.toThrow();
    expect(await count()).toEqual(before);
    await expect(addRelative(anchor(), 'child', { deleted_at: '2020-01-01' } as never)).rejects.toThrow('нельзя менять');
    await expect(addRelative(randomUUID(), 'child', {})).rejects.toThrow('не найден');
  });

  test('deletePerson / restorePerson: участнику нельзя, админ скрывает человека вместе со связями и возвращает', async () => {
    setClient(relClient);
    await expect(deletePerson(childId)).rejects.toThrow('Недостаточно прав');
    setClient(adminClient);
    await signIn(adminLogin, adminPassword);
    await deletePerson(childId);
    let f = await loadFamily();
    expect(f.persons.some((p) => p.id === childId)).toBe(false);
    expect(parentsOf(f, childId)).toEqual([]);
    await expect(restorePerson(relativePersonId)).rejects.toThrow(); // не удалён
    await restorePerson(childId);
    f = await loadFamily();
    expect(f.persons.some((p) => p.id === childId)).toBe(true);
    expect(parentsOf(f, childId).sort()).toEqual([anchor(), spouseId].sort());
    await signOut();
  });
});

describe('правка, факты, связи, история, откат', () => {
  let original: PersonRow;
  let updateEditId = 0;

  test('updatePerson шлёт только изменённые поля и пишет одну строку edits', async () => {
    setClient(relClient);
    original = (await getPersonDetail(relativePersonId))!.person;
    const before = (await history(relativePersonId)).filter((e) => e.table_name === 'people' && e.row_id === relativePersonId);

    // Форма целиком, изменено одно поле.
    const form = { given_name: original.given_name, surname: original.surname, sex: original.sex, notes: original.notes, occupation: 'Бортник' };
    const changed = diffPerson(original, form);
    expect(changed).toEqual({ occupation: 'Бортник' });

    const n = requests.length;
    const row = await updatePerson(relativePersonId, changed);
    expect(row?.occupation).toBe('Бортник');
    const patches = requests.slice(n).filter((r) => r.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0].body!)).toEqual({ occupation: 'Бортник' });

    const after = (await history(relativePersonId)).filter((e) => e.table_name === 'people' && e.row_id === relativePersonId);
    expect(after.length - before.length).toBe(1);
    expect(after[0]).toMatchObject({ op: 'update', changed_fields: ['occupation'], actor_label: 'Матвей (тест)' });
    updateEditId = after[0].id;

    // Пустой diff — запрос не уходит.
    const m = requests.length;
    expect(await updatePerson(relativePersonId, diffPerson(row!, { occupation: 'Бортник' }))).toBeNull();
    expect(requests.length).toBe(m);
    // Служебные поля клиент не пишет.
    await expect(updatePerson(relativePersonId, { deleted_at: '2020-01-01' } as never)).rejects.toThrow('нельзя менять');
  });

  test('addFact / softDeleteFact / softDeleteRelation; история их видит', async () => {
    setClient(relClient);
    const fact = await addFact(relativePersonId, { kind: 'occupation', value: 'Пасечник', certainty: 'probable' });
    expect((await getPersonDetail(relativePersonId))!.facts.map((x) => x.id)).toContain(fact.id);
    await softDeleteFact(fact.id);
    expect((await getPersonDetail(relativePersonId))!.facts.map((x) => x.id)).not.toContain(fact.id);

    const f = await loadFamily();
    const rel = f.relationRows.find((r) => r.kind === 'spouse' && (r.from_person === relativePersonId || r.to_person === relativePersonId))!;
    await softDeleteRelation(rel.id);
    expect((await loadFamily()).relationRows.map((r) => r.id)).not.toContain(rel.id);

    const h = await history(relativePersonId);
    expect(h.some((e) => e.row_id === fact.id && e.op === 'soft_delete')).toBe(true);
    expect(h.some((e) => e.row_id === rel.id && e.op === 'soft_delete')).toBe(true);
  });

  test('revert: участник не может, админ возвращает как было', async () => {
    setClient(relClient);
    await expect(revert(updateEditId)).rejects.toThrow();
    setClient(adminClient);
    await signIn(adminLogin, adminPassword);
    expect(await revert(updateEditId)).toEqual({ ok: true, fields: ['occupation'], forced: false });
    expect((await getPersonDetail(relativePersonId))!.person.occupation).toBe(original.occupation);
    const top = (await history(relativePersonId))[0];
    expect(top).toMatchObject({ op: 'revert', reverts_edit: updateEditId });
    await signOut();
    expect(await getMe()).toBeNull();
  });
});

describe('фото', () => {
  test('PNG → файл в bucket, строка documents, signed URL отдаёт 200 и те же байты; портрет', async () => {
    setClient(relClient);
    const png = makePng(4, 3);
    const doc = await uploadPrepared(relativePersonId, { full: new Blob([new Uint8Array(png)], { type: 'image/png' }) }, { mime: 'image/png', caption: 'Тестовая плашка' });
    uploadedPaths.push(doc.storage_path);
    expect(doc.storage_path).toMatch(new RegExp(`^people/${relativePersonId}/[0-9a-f-]{36}\\.png$`));
    expect(doc.uploaded_by).toBe(relativeUserId);

    const d = await getPersonDetail(relativePersonId);
    expect(d!.documents.map((x) => x.id)).toContain(doc.id);

    const url = await signedUrl(doc.storage_path);
    expect(url).toBeTruthy();
    const res = await realFetch(url!);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);

    // Кэш: повторный запрос ссылки не ходит в сеть.
    const n = requests.length;
    expect(await signedUrl(doc.storage_path)).toBe(url);
    expect(requests.length).toBe(n);
    invalidate(doc.storage_path);
    expect(await signedUrl(doc.storage_path)).toBeTruthy();
    expect(requests.length).toBe(n + 1);

    const p = await setPortrait(relativePersonId, doc.id);
    expect(p?.portrait_document_id).toBe(doc.id);

    // anon ссылку на этот файл не получит.
    invalidate();
    setClient(anonClient());
    expect(await signedUrl(doc.storage_path)).toBeNull();
  });
});

describe('client_errors', () => {
  test('reportError пишет message/stack/url без query и hash', async () => {
    setClient(relClient);
    await reportError('Тестовая ошибка', 'Error: Тестовая ошибка\n    at test', 'http://localhost:5173/index.html?x=1#/person/abc');
    const { data } = await service.from('client_errors').select('message, stack, url, user_id').eq('user_id', relativeUserId);
    expect(data).toEqual([{ message: 'Тестовая ошибка', stack: 'Error: Тестовая ошибка\n    at test', url: 'http://localhost:5173/index.html', user_id: relativeUserId }]);
    await signOut();
  });
});
