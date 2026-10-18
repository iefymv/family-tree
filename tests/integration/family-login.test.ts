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

  test('имени нет на дереве — 404 с предложением привязаться', async () => {
    const r = await family({ name: `Никита ${S('Нетов')}`, password: FAMILY });
    assert.equal(r.status, 404);
    assert.equal(r.json.need, 'link');
    assert.match(String(r.json.error), /Вас ещё нет на дереве/);
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

  test('самодобавление: поиск родни, «я их ребёнок», вход на новую карточку', async () => {
    const anchor = await person('Остап', S('Рудин'), { birth_date_text: '1960', birth_date_from: '1960-01-01', birth_date_to: '1960-12-31', notes: 'секрет' });
    const name = `Ульяна ${S('Рудина')}`;
    const miss = await family({ name, password: FAMILY });
    assert.equal(miss.status, 404);
    assert.equal(miss.json.need, 'link');

    // Поиск — только после верного пароля, и только id + ФИО + год.
    const denied = await family({ name, password: 'не-тот', search: S('Рудин') });
    assert.equal(denied.status, 401);
    assert.equal(denied.json.people, undefined);
    const found = await family({ name, password: FAMILY, search: `остап ${S('рудин')}` });
    assert.equal(found.status, 200, JSON.stringify(found.json));
    const people = found.json.people as Record<string, unknown>[];
    assert.deepEqual(people, [{ id: anchor, name: `${S('Рудин')} Остап`, birth_year: 1960 }]);

    const noSurname = await family({ name: 'Ульяна', password: FAMILY, link: { anchor_id: anchor, kind: 'child' } });
    assert.equal(noSurname.status, 400);
    assert.equal(noSurname.json.error, 'Укажите имя и фамилию');
    const badAnchor = await family({ name, password: FAMILY, link: { anchor_id: randomUUID(), kind: 'child' } });
    assert.equal(badAnchor.status, 404);
    assert.equal(await authUserByEmail(toEmail(`ульяна ${S('рудина')}`)), null, 'компенсация: учётки нет');

    const added = await family({ name, password: FAMILY, link: { anchor_id: anchor, kind: 'child' }, birth_date: '05.06.1990', sex: 'f' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const newId = String(added.json.person_id);
    trackPerson(newId);
    assert.equal(await signInAs(String(added.json.login)), newId, 'в центре — новая карточка');

    const { data: p } = await service.from('people').select('given_name, surname, sex, birth_date_text, birth_date_from, birth_date_to, created_by').eq('id', newId).single();
    const m = await memberOf(newId);
    assert.deepEqual(p, { given_name: 'Ульяна', surname: S('Рудина'), sex: 'f', birth_date_text: '05.06.1990',
      birth_date_from: '1990-06-05', birth_date_to: '1990-06-05', created_by: m!.user_id });
    assert.equal(m!.family_login, true);
    const { data: rel } = await service.from('relations_live').select('kind, from_person, to_person').eq('to_person', newId);
    assert.deepEqual(rel, [{ kind: 'parent', from_person: anchor, to_person: newId }]);
    const { data: ed } = await service.from('edits').select('actor_label').eq('actor', m!.user_id);
    assert.ok((ed ?? []).length >= 2);
    assert.ok(ed!.every((e) => e.actor_label === 'Ульяна'), 'подпись в истории — имя нового человека');

    // Повторно добавить того же (имя + год) нельзя — указывается обычный вход.
    const dup = await family({ name, password: FAMILY, link: { anchor_id: anchor, kind: 'child' }, birth_date: '1990' });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.need, 'login');
    // А обычный семейный вход теперь находит её карточку.
    const again = await family({ name, password: FAMILY });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(await signInAs(String(again.json.login)), newId);
    assert.equal(await count('members', 'person_id', newId), 1);
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

    // Год не совпал — похожий не предлагается.
    const wrongYear = await family({ name: typed, password: FAMILY, birth_year: 1990 });
    assert.equal(wrongYear.status, 404);
    assert.equal(wrongYear.json.need, 'link');
    // Слишком далеко (3 правки) — тоже нет.
    assert.equal((await family({ name: `Арсений ${S('Ивонька')}`, password: FAMILY })).status, 404);
    // Подтвердить чужого (не похожего на введённое имя) нельзя.
    const bad = await family({ name: typed, password: FAMILY, confirm_person_id: other });
    assert.equal(bad.status, 404);

    const ok = await family({ name: typed, password: FAMILY, confirm_person_id: id });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.login, `арсений ${S('ивашко')}`);
    assert.equal(await signInAs(String(ok.json.login)), id);
    assert.equal(await count('members', 'person_id', id), 1);

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
