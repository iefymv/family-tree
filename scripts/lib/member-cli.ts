// Общая часть bootstrap-admin.ts и create-member.ts: создание входа секретным ключом,
// атомарно (auth-пользователь удаляется, если строка members не вставилась).
// Ключ берётся только из переменных окружения SUPABASE_URL и SUPABASE_SECRET_KEY.
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { LoginError, toLoginAndEmail } from '../../app/src/lib/auth.ts';

export class CliError extends Error {}

function argValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
  }
  return undefined;
}

function makePrompter() {
  const tty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  // Скрытый ввод: пока muted, readline не печатает набранное.
  let muted = false;
  const internal = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = internal._writeToOutput.bind(rl);
  internal._writeToOutput = (s: string) => { if (!muted) write(s); };
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question: string, hidden = false): Promise<string> {
      process.stdout.write(question);
      muted = hidden;
      const r = await lines.next();
      muted = false;
      if (hidden) process.stdout.write('\n');
      if (r.done) throw new CliError('Ввод прерван');
      return r.value;
    },
    close: () => rl.close(),
  };
}

export async function runCreateMember(role: 'admin' | 'relative', argv: string[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new CliError('Задайте переменные окружения SUPABASE_URL и SUPABASE_SECRET_KEY');
  const ref = argValue(argv, '--ref');
  if (!ref) throw new CliError('Укажите карточку: --ref <external_ref>');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: person, error: pErr } = await db
    .from('people').select('id, given_name, surname').eq('external_ref', ref).is('deleted_at', null).maybeSingle();
  if (pErr) throw new CliError(`Не удалось прочитать карточки: ${pErr.message}`);
  if (!person) throw new CliError(`Карточка «${ref}» не найдена — сначала npm run seed`);

  const prompt = makePrompter();
  let login: string, email: string, password: string;
  try {
    try {
      ({ login, email } = toLoginAndEmail(await prompt.ask('Имя для входа (имя фамилия): ')));
    } catch (e) {
      if (e instanceof LoginError) throw new CliError(e.message);
      throw e;
    }
    password = await prompt.ask('Пароль: ', true);
    const again = await prompt.ask('Пароль ещё раз: ', true);
    if (!password) throw new CliError('Пустой пароль');
    if (password !== again) throw new CliError('Пароли не совпадают');
  } finally {
    prompt.close();
  }
  const displayName = argValue(argv, '--display-name') ?? person.given_name ?? person.surname ?? login;

  const { data: created, error: cErr } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr || !created.user) {
    if (cErr?.code === 'email_exists') throw new CliError(`Имя для входа «${login}» уже занято — добавьте уточнение, например год рождения`);
    throw new CliError(`Не удалось создать пользователя: ${cErr?.code ?? cErr?.message ?? 'нет ответа'}`);
  }
  const uid = created.user.id;
  const { error: iErr } = await db.from('members').insert({
    user_id: uid, person_id: person.id, login, display_name: displayName, role,
  });
  if (iErr) {
    const { error: dErr } = await db.auth.admin.deleteUser(uid);
    const tail = dErr ? ` ВНИМАНИЕ: не удалось удалить пользователя ${uid}, удалите вручную.` : '';
    if (iErr.code === '23505' && `${iErr.message} ${iErr.details ?? ''}`.includes('person_id')) {
      throw new CliError(`К этой карточке уже привязан вход.${tail}`);
    }
    throw new CliError(`Не удалось записать участника (${iErr.code}): ${iErr.message}.${tail}`);
  }
  console.log(`Готово: вход «${login}» (${role}) привязан к карточке ${ref}.`);
}

export function main(role: 'admin' | 'relative'): void {
  runCreateMember(role, process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof CliError ? e.message : e);
    process.exit(1);
  });
}
