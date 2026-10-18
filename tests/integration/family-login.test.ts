// Интеграция Edge Function family-login (вход по семейному паролю) на локальном стеке.
// Нужны: `supabase start` и `npm run functions:serve` (в фоне) — скрипт генерирует ТЕСТОВЫЙ семейный пароль
// и кладёт его в supabase/.temp/family-password.test. Люди — вымышленные, с меткой прогона в фамилии;
// всё созданное (люди, связи, входы, записи счётчика попыток этого прогона) удаляется в конце.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toEmail } from '../../app/src/lib/auth.ts';
import {
  API_URL, RUN, authUserByEmail, cleanup, dbExec, env, makeAdmin, makePerson, service, signInClient, trackPerson, trackUser,
} from './_local.ts';

const FAMILY = readFileSync(new URL('../../supabase/.temp/family-password.test', import.meta.url), 'utf8').trim();
const URL_FN = `${env.FUNCTIONS_URL ?? `${API_URL}/functions/v1`}/family-login`;
const IP = `itest-${RUN}`;
const S = (s: string) => `${s}-${RUN}`; // фамилия с меткой прогона: не пересекается ни с кем в базе

async function family(body: Record<string, unknown>, ip = IP, extra: Record<string, string> = {}) {
  const res = await fetch(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, 'cf-connecting-ip': ip, ...extra },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}

async function person(given: string, surname: string, extra: Record<string, unknown> = {}) {
  const id = await makePerson(given, surname);
  if (Object.keys(extra).length) {
    const { error } = await service.from('people').update(extra).eq('id', id);
    if (error) throw error;
  }
  return id;
}

async function memberOf(personId: string) {
  const { data, error } = await service.from('members').select('user_id, login, role, family_login, display_name').eq('person_id', personId).maybeSingle();
  if (error) throw error;
  if (data) trackUser(data.user_id);
  return data;
}

/** Вход как в браузере: signInWithPassword по логину из ответа; возвращает person_id «я» (как getMe). */
async function signInAs(login: string, password = FAMILY) {
  const { client, error } = await signInClient(toEmail(login), password);
  assert.equal(error, null, `вход ${login}: ${error?.message}`);
  const { data: s } = await client.auth.getSession();
  const { data, error: qErr } = await client.from('members').select('person_id').eq('user_id', s.session!.user.id).single();
  assert.equal(qErr, null);
  return data!.person_id as string;
}

const count = async (table: 'members' | 'people', col: string, val: string) =>
  (await service.from(table).select('*', { count: 'exact', head: true }).eq(col, val)).count;

before(() => {
  assert.ok(FAMILY.startsWith('test-'), 'ожидается тестовый семейный пароль из scripts/serve-functions.sh');
});

after(async () => {
  await cleanup();
  dbExec(`delete from private.family_login_attempts where ip like 'itest-${RUN}%';`);
});

describe('family-login', () => {
  test('новый родственник: учётка создаётся, вход — на свою карточку', async () => {
    const id = await person('Мирон', S('Лесков'));
    const r = await family({ name: `  мирон   ${S('ЛЕСКОВ')} `, password: FAMILY });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.login, `мирон ${S('лесков')}`);
    assert.deepEqual(Object.keys(r.json), ['login']);
    const m = await memberOf(id);
    assert.equal(m?.family_login, true);
    assert.equal(m?.role, 'relative');
    assert.equal(m?.display_name, 'Мирон');
    assert.equal(await signInAs(String(r.json.login)), id, 'в центре — своя карточка');
  });

  test('неверный семейный пароль — 401', async () => {
    const r = await family({ name: `Мирон ${S('Лесков')}`, password: 'не-тот-пароль' });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'Неверное имя или пароль');
  });

  test('имени нет на дереве — сразу своя карточка без связей и вход на неё', async () => {
    const one = await family({ name: 'Никита', password: FAMILY });
    assert.equal(one.status, 400);
    assert.equal(one.json.error, 'Введите имя и фамилию');

    const r = await family({ name: `  никита   ${S('нетов')} `, password: FAMILY, birth_year: 1999 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const id = String(r.json.person_id);
    trackPerson(id);
    assert.equal(r.json.login, `никита ${S('нетов')}`);
    const { data: p } = await service.from('people').select('given_name, surname, birth_date_text, birth_date_from, birth_date_to, is_placeholder').eq('id', id).single();
    assert.deepEqual(p, { given_name: 'Никита', surname: S('Нетов'), birth_date_text: '1999', birth_date_from: '1999-01-01', birth_date_to: '1999-12-31', is_placeholder: false });
    const { count: rels } = await service.from('relations').select('*', { count: 'exact', head: true }).or(`from_person.eq.${id},to_person.eq.${id}`);
    assert.equal(rels, 0, 'связей нет');
    const m = await memberOf(id);
    assert.equal(m?.family_login, true);
    assert.equal(m?.display_name, 'Никита');
    assert.equal(await signInAs(String(r.json.login)), id, 'в центре — своя новая карточка');

    // Второй вход тем же именем — та же карточка и учётка, двойника нет.
    const again = await family({ name: `Никита ${S('Нетов')}`, password: FAMILY });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.login, r.json.login);
    assert.equal(await count('members', 'person_id', id), 1);
    const { data: same } = await service.from('people').select('id').eq('surname', S('Нетов'));
    assert.deepEqual((same ?? []).map((x) => x.id), [id]);
  });

  test('тёзки: 409 «нужен год», с годом — вход на нужную карточку', async () => {
    const old = await person('Глеб', S('Сомов'), { birth_date_text: '1950', birth_date_from: '1950-01-01', birth_date_to: '1950-12-31' });
    const young = await person('Глеб', S('Сомов'), { birth_date_text: '12.03.1980', birth_date_from: '1980-03-12', birth_date_to: '1980-03-12' });
    const r = await family({ name: `Глеб ${S('Сомов')}`, password: FAMILY });
    assert.equal(r.status, 409);
    assert.equal(r.json.need, 'birth_year');
    const ok = await family({ name: `Глеб ${S('Сомов')}`, password: FAMILY, birth_year: 1980 });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(await signInAs(String(ok.json.login)), young);
    assert.equal(await memberOf(old), null, 'у тёзки входа нет');
    // Второй тёзка: логин «глеб сомов-…» занят — к логину добавляется год рождения.
    const second = await family({ name: `Глеб ${S('Сомов')}`, password: FAMILY, birth_year: '1950' });
    assert.equal(second.status, 201, JSON.stringify(second.json));
    assert.equal(second.json.login, `глеб ${S('сомов')} 1950`);
    assert.equal(await signInAs(String(second.json.login)), old);
  });

  test('админ и вход со своим паролем семейным паролем не открываются — 403', async () => {
    const adminPerson = await person('Тимур', S('Варин'));
    const login = `тимур ${S('варин')}`;
    const adminPw = `Пароль-${randomUUID().slice(0, 12)}`;
    await makeAdmin(login, toEmail(login), adminPw, adminPerson);
    const r = await family({ name: `Тимур ${S('Варин')}`, password: FAMILY });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'Для этого человека вход по семейному паролю закрыт');
    assert.ok((await signInClient(toEmail(login), FAMILY)).error, 'пароль админа не подменён семейным');
    assert.equal((await signInClient(toEmail(login), adminPw)).error, null);

    // Родственник, которому админ выдал свой пароль (family_login = false).
    const own = await person('Роман', S('Варин'));
    const ownLogin = `роман ${S('варин')}`;
    const { data: u, error } = await service.auth.admin.createUser({ email: toEmail(ownLogin), password: adminPw, email_confirm: true });
    if (error) throw error;
    trackUser(u.user.id);
    await service.from('members').insert({ user_id: u.user.id, person_id: own, login: ownLogin, display_name: 'Роман', role: 'relative' });
    const r2 = await family({ name: `Роман ${S('Варин')}`, password: FAMILY });
    assert.equal(r2.status, 403);
  });

  test('повторный семейный вход использует ту же учётку и подтягивает сменённый семейный пароль', async () => {
    const id = await person('Савва', S('Крылов'));
    const first = await family({ name: `Савва ${S('Крылов')}`, password: FAMILY });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const m = await memberOf(id);
    // Имитация смены семейного пароля: у учётки старый пароль.
    await service.auth.admin.updateUserById(m!.user_id, { password: `старый-${randomUUID()}` });
    const again = await family({ name: `${S('Крылов')} Савва`, password: FAMILY }); // «фамилия имя» тоже находит
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.login, first.json.login);
    assert.equal(await signInAs(String(again.json.login)), id);
    assert.equal(await count('members', 'person_id', id), 1);
    const u = await authUserByEmail(toEmail(String(first.json.login)));
    assert.equal(u?.id, m!.user_id);
  });

  test('девичья фамилия тоже находит человека', async () => {
    const id = await person('Вера', S('Колесова'), { maiden_name: S('Дубова') });
    const r = await family({ name: `Вера ${S('Дубова')}`, password: FAMILY });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.login, `вера ${S('колесова')}`, 'логин — по текущей фамилии');
    assert.equal(await signInAs(String(r.json.login)), id);
  });

  test('карточку переименовали: входит и новое, и прежнее имя; двойников нет', async () => {
    const id = await person('Лидия', S('Пахомова'));
    const first = await family({ name: `Лидия ${S('Пахомова')}`, password: FAMILY });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const m = await memberOf(id);

    // Админ правит карточку: фамилия по мужу, отчество.
    const { error } = await service.from('people').update({ surname: S('Гордеева'), patronymic: 'Ильинична' }).eq('id', id);
    if (error) throw error;

    const byNew = await family({ name: `Лидия ${S('Гордеева')}`, password: FAMILY });
    assert.equal(byNew.status, 200, JSON.stringify(byNew.json));
    assert.equal(byNew.json.login, first.json.login, 'логин учётки (и email) не меняется');
    assert.equal(await signInAs(String(byNew.json.login)), id);

    const byOld = await family({ name: `Лидия ${S('Пахомова')}`, password: FAMILY });
    assert.equal(byOld.status, 200, JSON.stringify(byOld.json));
    assert.equal(byOld.json.login, first.json.login);
    assert.equal(await signInAs(String(byOld.json.login)), id);

    assert.equal(await count('members', 'person_id', id), 1);
    const { data: same } = await service.from('people').select('id').eq('given_name', 'Лидия').in('surname', [S('Пахомова'), S('Гордеева')]);
    assert.deepEqual((same ?? []).map((p) => p.id), [id], 'новой карточки не появилось');
    assert.equal((await authUserByEmail(toEmail(String(first.json.login))))?.id, m!.user_id);
  });

  test('карточка без связей: сам показывает родню через link_relative (только за свою карточку)', async () => {
    const grandma = await person('Аграфена', S('Лукина'));
    const r = await family({ name: `Тихон ${S('Лукин')}`, password: FAMILY });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const self = String(r.json.person_id);
    trackPerson(self);
    const { client } = await signInClient(toEmail(String(r.json.login)), FAMILY);

    // Чужую карточку связывать нельзя.
    const foreign = await client.rpc('link_relative', { self_person: grandma, other_person: self, kind: 'child' });
    assert.equal(foreign.error?.code, '42501');

    // «+» у бабушки: мама (обычный add_relative), затем «Это моя мама».
    const { data: added, error: aErr } = await client.rpc('add_relative', { anchor: grandma, kind: 'child', fields: { given_name: 'Марфа', surname: S('Лукина'), sex: 'f' } });
    assert.equal(aErr, null);
    const mom = (added as { person: { id: string } }).person.id;
    trackPerson(mom);
    const link = await client.rpc('link_relative', { self_person: self, other_person: mom, kind: 'parent' });
    assert.equal(link.error, null, link.error?.message);
    const { data: rel } = await service.from('relations_live').select('kind, from_person, to_person').eq('to_person', self);
    assert.deepEqual(rel, [{ kind: 'parent', from_person: mom, to_person: self }]);
    const { data: ed } = await service.from('edits').select('actor_label').eq('table_name', 'relations').eq('row_id', (link.data as { relation_ids: string[] }).relation_ids[0]);
    assert.deepEqual(ed, [{ actor_label: 'Тихон' }], 'в истории — сам человек');
    const dup = await client.rpc('link_relative', { self_person: self, other_person: mom, kind: 'parent' });
    assert.equal(dup.error?.code, '23505');
  });

  test('похожая фамилия («Ивашка» вместо «Ивашко», мягкий знак): «Это вы?» → подтверждение → вход на ту карточку', async () => {
    const id = await person('Арсений', S('Ивашко'), { birth_date_text: '1961', birth_date_from: '1961-01-01', birth_date_to: '1961-12-31' });
    const other = await person('Глафира', S('Ивашко'));
    const typed = `Арсений ${S('Ивашка')}`;

    const denied = await family({ name: typed, password: 'не-тот' });
    assert.equal(denied.status, 401);
    assert.equal(denied.json.candidates, undefined, 'без верного пароля — никаких кандидатов');

    const ask = await family({ name: typed, password: FAMILY });
    assert.equal(ask.status, 409, JSON.stringify(ask.json));
    assert.equal(ask.json.need, 'confirm');
    assert.deepEqual(ask.json.candidates, [{ id, fio: `${S('Ивашко')} Арсений`, birth_year: 1961 }]);
    assert.equal(await memberOf(id), null, 'до подтверждения вход не создаётся');

    // Слишком далеко (3 правки) — похожих нет, сразу новая карточка.
    const far = await family({ name: `Арсений ${S('Ивонька')}`, password: FAMILY });
    assert.equal(far.status, 201, JSON.stringify(far.json));
    trackPerson(String(far.json.person_id));
    assert.notEqual(far.json.person_id, id);
    // Подтвердить чужого (не похожего на введённое имя) нельзя.
    const bad = await family({ name: typed, password: FAMILY, confirm_person_id: other });
    assert.equal(bad.status, 404);

    const ok = await family({ name: typed, password: FAMILY, confirm_person_id: id });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.login, `арсений ${S('ивашко')}`);
    assert.equal(await signInAs(String(ok.json.login)), id);
    assert.equal(await count('members', 'person_id', id), 1);

    // «Нет, меня нет на дереве» (год не совпадает с похожим) — новая карточка, а не вход в чужую.
    const no = await family({ name: typed, password: FAMILY, create_new: true, birth_year: 1990 });
    assert.equal(no.status, 201, JSON.stringify(no.json));
    trackPerson(String(no.json.person_id));
    assert.notEqual(no.json.person_id, id);
    assert.equal(no.json.login, `арсений ${S('ивашка')}`);
    // Повторное «нет» тем же именем и годом — уже есть такой человек, входить обычным образом.
    const twice = await family({ name: typed, password: FAMILY, create_new: true, birth_year: 1990 });
    assert.equal(twice.status, 409);
    assert.equal(twice.json.need, 'login');

    // ь/й/э: карточка «Солпе», вводят «Сольпи».
    const soft = await person('Нонна', S('Солпе'));
    const r = await family({ name: `${S('Сольпи')} Нонна`, password: FAMILY });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.deepEqual((r.json.candidates as { id: string }[]).map((c) => c.id), [soft]);
  });

  test('ограничение попыток: 10 неверных паролей за 15 минут — 429, даже с верным', async () => {
    const ip = `${IP}-flood`;
    for (let i = 0; i < 10; i++) {
      const r = await family({ name: `Мирон ${S('Лесков')}`, password: `нет-${i}` }, ip);
      assert.equal(r.status, 401, `попытка ${i + 1}`);
    }
    const blocked = await family({ name: `Мирон ${S('Лесков')}`, password: 'нет' }, ip);
    assert.equal(blocked.status, 429);
    assert.match(String(blocked.json.error), /Подождите 15 минут/);
    assert.equal((await family({ name: `Мирон ${S('Лесков')}`, password: FAMILY }, ip)).status, 429);
    // Другой адрес не задет.
    assert.equal((await family({ name: `Мирон ${S('Лесков')}`, password: FAMILY }, `${IP}-other`)).status, 200);
  });

  test('CORS: заголовки функции только разрешённому origin', async () => {
    const ours = (h: Headers) => h.get('access-control-allow-methods') === 'POST, OPTIONS';
    assert.ok(ours((await family({}, IP, { Origin: 'http://localhost:5173' })).headers));
    assert.ok(!ours((await family({}, IP, { Origin: 'https://evil.example' })).headers));
  });

  test('семейный пароль не попадает в логи функции', { skip: !process.env.FUNCTIONS_LOG && 'FUNCTIONS_LOG не задан' }, () => {
    const log = readFileSync(process.env.FUNCTIONS_LOG!, 'utf8');
    assert.ok(!log.includes(FAMILY), 'семейный пароль найден в логе функции');
  });
});
