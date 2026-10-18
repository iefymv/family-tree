// bootstrap-admin.ts и create-member.ts на локальном стеке (секретный ключ — из supabase status, в env процесса).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { toEmail } from '../../app/src/lib/auth.ts';
import { API_URL, RUN, authUserByEmail, cleanup, env, makePerson, service, signInClient } from './_local.ts';

const ROOT = new URL('../../', import.meta.url);

function runScript(script: string, args: string[], input: string) {
  const r = spawnSync('npx', ['tsx', `scripts/${script}`, ...args], {
    cwd: ROOT, input, encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: API_URL, SUPABASE_SECRET_KEY: env.SECRET_KEY || env.SERVICE_ROLE_KEY },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const refs: Record<string, string> = {};

before(async () => {
  for (const [key, given] of [['admin', 'Андрей'], ['relative', 'Ксения']]) {
    const id = await makePerson(given, 'Иванова');
    const { data } = await service.from('people').select('external_ref').eq('id', id).single();
    refs[key] = data!.external_ref;
  }
});

after(cleanup);

describe('scripts', () => {
  test('bootstrap-admin без карточки падает с «сначала npm run seed»', () => {
    const r = runScript('bootstrap-admin.ts', ['--ref', `itest-net-${RUN}`], '');
    assert.equal(r.code, 1);
    assert.match(r.err, /сначала npm run seed/);
  });

  test('bootstrap-admin без ключа в окружении падает', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/bootstrap-admin.ts', '--ref', refs.admin], {
      cwd: ROOT, encoding: 'utf8', input: '', env: { ...process.env, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SUPABASE_SECRET_KEY/);
  });

  test('bootstrap-admin создаёт админа; пароль не печатается', async () => {
    const login = `Андрей Иванов ${RUN}`;
    const password = `Пароль-${randomUUID().slice(0, 12)}`;
    const r = runScript('bootstrap-admin.ts', ['--ref', refs.admin], `${login}\n${password}\n${password}\n`);
    assert.equal(r.code, 0, r.err);
    assert.ok(!r.out.includes(password) && !r.err.includes(password));
    const { client, error } = await signInClient(toEmail(login), password);
    assert.equal(error, null);
    const { data, error: rpcErr } = await client.rpc('admin_list_members');
    assert.equal(rpcErr, null);
    assert.ok((data as Array<{ login: string; role: string }>).some((m) => m.login === `андрей иванов ${RUN}` && m.role === 'admin'));
  });

  test('повторный bootstrap на ту же карточку: отказ и компенсация', async () => {
    const login = `андрей иванов ${RUN} второй`;
    const r = runScript('bootstrap-admin.ts', ['--ref', refs.admin], `${login}\nx-${RUN}-pass\nx-${RUN}-pass\n`);
    assert.equal(r.code, 1);
    assert.match(r.err, /уже привязан вход/);
    assert.equal(await authUserByEmail(toEmail(login)), null);
  });

  test('несовпадающие пароли — отказ, пользователь не создаётся', async () => {
    const login = `ксения иванова ${RUN} опечатка`;
    const r = runScript('create-member.ts', ['--ref', refs.relative], `${login}\nraz-${RUN}-pass\ndva-${RUN}-pass\n`);
    assert.equal(r.code, 1);
    assert.match(r.err, /не совпадают/);
    assert.equal(await authUserByEmail(toEmail(login)), null);
  });

  test('create-member создаёт родственника; он видит people_live, но не логины', async () => {
    const login = `Ксения Иванова ${RUN}`;
    const password = `Пароль-${randomUUID().slice(0, 12)}`;
    const r = runScript('create-member.ts', ['--ref', refs.relative], `${login}\n${password}\n${password}\n`);
    assert.equal(r.code, 0, r.err);
    const { client, error } = await signInClient(toEmail(login), password);
    assert.equal(error, null);
    const { data } = await client.from('people_live').select('id');
    assert.ok((data ?? []).length >= 12);
    const { error: rpcErr } = await client.rpc('admin_list_members');
    assert.ok(rpcErr);
  });
});
