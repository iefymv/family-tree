// Интеграция Edge Function admin-users на локальном стеке.
// Нужны: `supabase start` и `npm run functions:serve` (в фоне). Запуск: npm run test:functions
// Если задан FUNCTIONS_LOG (файл вывода functions serve), проверяется, что пароли туда не попали.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toEmail } from '../../app/src/lib/auth.ts';
import {
  RUN, authUserByEmail, callFn, cleanup, dbExec, makeAdmin, makePerson, signIn, signInClient,
} from './_local.ts';

const pw = () => `Пароль-${randomUUID().slice(0, 12)}`;
const passwords: string[] = [];
const newPw = () => { const p = pw(); passwords.push(p); return p; };

let adminToken = '';
let adminId = '';
const people: Record<string, string> = {};

before(async () => {
  for (const [key, given, surname] of [
    ['admin', 'Илья', 'Иванов'], ['petr', 'Пётр', 'Иванов'], ['olga', 'Ольга', 'Иванова'],
    ['ksenia', 'Ксения', 'Иванова'], ['matvei', 'Матвей', 'Иванов'], ['andrei', 'Андрей', 'Иванов'],
    ['anna', 'Анна', 'Иванова'],
  ]) people[key] = await makePerson(given, surname);
  const login = `илья иванов ${RUN}`;
  const admin = await makeAdmin(login, toEmail(login), newPw(), people.admin);
  adminToken = admin.token;
  adminId = admin.userId;
});

after(cleanup);

describe('admin-users', () => {
  test('без JWT — 401', async () => {
    const r = await callFn({ action: 'create' });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'Нужен вход');
  });

  test('самостоятельная регистрация закрыта (вход по email при этом включён)', async () => {
    const { anonClient } = await import('./_local.ts');
    const { data, error } = await anonClient().auth.signUp({ email: `chuzhoi.${RUN}@family.invalid`, password: pw() });
    assert.ok(error, 'signUp должен отклоняться');
    assert.equal(data.user, null);
  });

  test('с anon-ключом вместо JWT пользователя — 401', async () => {
    const { env } = await import('./_local.ts');
    const r = await callFn({ action: 'create' }, env.ANON_KEY);
    assert.equal(r.status, 401);
  });

  let petr = { userId: '', login: '', password: '' };

  test('админ создаёт вход; родственник входит по «имя фамилия» и видит people_live', async () => {
    const password = newPw();
    const r = await callFn({
      action: 'create', person_id: people.petr, login: `  Пётр   ИВАНОВ ${RUN} `, display_name: 'Пётр', password,
    }, adminToken);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.login, `петр иванов ${RUN}`);
    petr = { userId: String(r.json.user_id), login: `петр иванов ${RUN}`, password };

    // Вход тем, что человек вводит на экране: имя и фамилия в любом регистре, с ё.
    const { client, error } = await signInClient(toEmail(`Пётр Иванов ${RUN}`), password);
    assert.equal(error, null);
    const { data, error: qErr } = await client.from('people_live').select('id');
    assert.equal(qErr, null);
    assert.ok((data ?? []).length >= 12, `people_live вернул ${(data ?? []).length} строк`);
    assert.ok(data!.some((p) => p.id === people.petr));
    // Роль relative: логины чужих не видны, admin_list_members запрещён.
    const { error: rpcErr } = await client.rpc('admin_list_members');
    assert.ok(rpcErr, 'relative не должен вызывать admin_list_members');
  });

  test('дубль логина — 409 с понятным текстом, лишнего auth-пользователя нет', async () => {
    const r = await callFn({
      action: 'create', person_id: people.olga, login: `ПЁТР иванов ${RUN}`, display_name: 'Ольга', password: newPw(),
    }, adminToken);
    assert.equal(r.status, 409);
    assert.match(String(r.json.error), /уже занято.*уточнение/);
    const u = await authUserByEmail(toEmail(petr.login));
    assert.equal(u?.id, petr.userId);
  });

  test('тёзка с уточнением (год рождения) создаётся', async () => {
    const r = await callFn({
      action: 'create', person_id: people.olga, login: `Пётр Иванов ${RUN} 1958`, display_name: 'Ольга', password: newPw(),
    }, adminToken);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.login, `петр иванов ${RUN} 1958`);
  });

  test('не-админ — 403', async () => {
    const token = await signIn(toEmail(petr.login), petr.password);
    const r = await callFn({ action: 'disable', user_id: adminId }, token);
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'Только для администратора');
  });

  test('компенсация: карточка уже привязана — 409, auth-пользователь удалён', async () => {
    const login = `андрей иванов ${RUN}`;
    const r = await callFn({
      action: 'create', person_id: people.petr, login, display_name: 'Андрей', password: newPw(),
    }, adminToken);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'К этой карточке уже привязан вход');
    assert.equal(await authUserByEmail(toEmail(login)), null);
  });

  test('компенсация: сбой вставки members (триггер) — auth-пользователь удалён', async () => {
    const fn = `itest_fail_${RUN}`;
    dbExec(`create function public.${fn}() returns trigger language plpgsql as $$
      begin if new.login like '%сбой%' then raise exception 'itest simulated failure'; end if; return new; end $$;
      create trigger ${fn} before insert on public.members for each row execute function public.${fn}();`);
    try {
      const login = `матвей иванов ${RUN} сбой`;
      const r = await callFn({
        action: 'create', person_id: people.matvei, login, display_name: 'Матвей', password: newPw(),
      }, adminToken);
      assert.equal(r.status, 500);
      assert.equal(r.json.error, 'Не удалось создать вход');
      assert.equal(await authUserByEmail(toEmail(login)), null);
    } finally {
      dbExec(`drop trigger if exists ${fn} on public.members; drop function if exists public.${fn}();`);
    }
  });

  test('неизвестная карточка — 404, пользователь не создаётся', async () => {
    const login = `анна иванова ${RUN} нет`;
    const r = await callFn({
      action: 'create', person_id: randomUUID(), login, display_name: 'Анна', password: newPw(),
    }, adminToken);
    assert.equal(r.status, 404);
    assert.equal(await authUserByEmail(toEmail(login)), null);
  });

  test('недопустимый логин — 400', async () => {
    const r = await callFn({
      action: 'create', person_id: people.anna, login: 'anna@ivanova', display_name: 'Анна', password: newPw(),
    }, adminToken);
    assert.equal(r.status, 400);
    assert.match(String(r.json.error), /Недопустимый символ/);
  });

  test('reset_password: старый пароль перестаёт работать, новый работает; семейный вход закрывается', async () => {
    const { service } = await import('./_local.ts');
    await service.from('members').update({ family_login: true }).eq('user_id', petr.userId);
    const fresh = newPw();
    const r = await callFn({ action: 'reset_password', user_id: petr.userId, password: fresh }, adminToken);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok((await signInClient(toEmail(petr.login), petr.password)).error, 'старый пароль должен отклоняться');
    assert.equal((await signInClient(toEmail(petr.login), fresh)).error, null);
    const { data: m } = await service.from('members').select('family_login').eq('user_id', petr.userId).single();
    assert.equal(m?.family_login, false, 'свой пароль от админа — семейный к учётке больше не подходит');
    petr.password = fresh;
  });

  test('disable: вход отклонён, открытая сессия перестаёт видеть данные; enable возвращает', async () => {
    const { client: open } = await signInClient(toEmail(petr.login), petr.password);
    const before = await open.from('people_live').select('id');
    assert.ok((before.data ?? []).length > 0);

    const r = await callFn({ action: 'disable', user_id: petr.userId }, adminToken);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const { error } = await signInClient(toEmail(petr.login), petr.password);
    assert.ok(error, 'вход отключённого должен отклоняться');
    const afterRows = await open.from('people_live').select('id');
    assert.equal((afterRows.data ?? []).length, 0);

    const e = await callFn({ action: 'enable', user_id: petr.userId }, adminToken);
    assert.equal(e.status, 200, JSON.stringify(e.json));
    assert.equal((await signInClient(toEmail(petr.login), petr.password)).error, null);
  });

  test('отключённый админ — отказ (403 или 401)', async () => {
    const login = `ксения иванова ${RUN}`;
    const password = newPw();
    const c = await callFn({ action: 'create', person_id: people.ksenia, login, display_name: 'Ксения', password, role: 'admin' }, adminToken);
    assert.equal(c.status, 201, JSON.stringify(c.json));
    const token = await signIn(toEmail(login), password);
    assert.equal((await callFn({ action: 'enable', user_id: petr.userId }, token)).status, 200);
    assert.equal((await callFn({ action: 'disable', user_id: c.json.user_id }, adminToken)).status, 200);
    const r = await callFn({ action: 'enable', user_id: petr.userId }, token);
    assert.ok([401, 403].includes(r.status), `получено ${r.status}`);
  });

  test('админ не может отключить сам себя', async () => {
    const r = await callFn({ action: 'disable', user_id: adminId }, adminToken);
    assert.equal(r.status, 400);
  });

  // Локальный Kong добавляет свой CORS-плагин и подменяет Allow-Origin на «*» (и сам отвечает на OPTIONS),
  // поэтому решение функции видно по её собственным заголовкам Allow-Methods/Allow-Headers.
  // На хостинге Supabase шлюз CORS не добавляет, и Allow-Origin ставит только функция.
  test('CORS: функция выдаёт свои заголовки только разрешённому origin (без пути)', async () => {
    const ours = (h: Headers) => h.get('access-control-allow-methods') === 'POST, OPTIONS'
      && h.get('access-control-allow-headers') === 'authorization, x-client-info, apikey, content-type';
    const ok = await callFn({ action: 'create' }, undefined, { Origin: 'http://localhost:5173' });
    assert.ok(ours(ok.headers), 'запустите функции через npm run functions:serve (ALLOWED_ORIGINS)');
    const bad = await callFn({ action: 'create' }, undefined, { Origin: 'https://evil.example' });
    assert.ok(!ours(bad.headers), 'чужой origin не должен получать CORS-заголовки функции');
    const withPath = await callFn({ action: 'create' }, undefined, { Origin: 'https://iefymv.github.io/family-tree' });
    assert.ok(!ours(withPath.headers), 'origin с путём не совпадает');
    const none = await callFn({ action: 'create' });
    assert.ok(!ours(none.headers));
  });

  test('пароли не попадают в логи функции', { skip: !process.env.FUNCTIONS_LOG && 'FUNCTIONS_LOG не задан' }, () => {
    const log = readFileSync(process.env.FUNCTIONS_LOG!, 'utf8');
    for (const p of passwords) assert.ok(!log.includes(p), 'пароль найден в логе функции');
  });
});
