// Edge Functions для e2e. Печатает «E2E functions ready», когда функция отвечает (401 без входа).
// Свой `supabase functions serve` запускается, только если функции ещё никто не обслуживает.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = `${process.env.E2E_API_URL}/functions/v1/admin-users`;
const probe = async () => {
  try {
    return (await fetch(url, { method: 'POST' })).status;
  } catch {
    return 0;
  }
};

// Контейнер edge runtime у локального стека один на проект: второй `supabase functions serve` убивает первый
// (EdgeRuntimeContainerCrashedError, exit 137), и функция отвечает 503. Если функции уже обслуживаются
// (например, `npm run functions:serve` для показа), используем их и ничего не запускаем и не останавливаем.
// CORS локально не мешает: шлюз Kong сам ставит Access-Control-Allow-Origin: *.
const already = await probe();
if (already === 401) {
  console.log('E2E functions ready (уже запущены — используем их)');
  setInterval(() => {}, 1 << 30);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
} else {
  let running = '';
  try {
    running = execFileSync('pgrep', ['-f', 'supabase functions serve'], { encoding: 'utf8' }).trim();
  } catch {
    /* pgrep: нет процессов */
  }
  if (running) {
    console.error(`Уже запущен \`supabase functions serve\` (pid ${running.split('\n').join(', ')}), но функция отвечает ${already || 'ошибкой сети'}. ` +
      'Два serve делят один контейнер edge runtime и роняют друг друга. Остановите его (pkill -f "supabase functions serve") и запустите e2e снова.');
    process.exit(1);
  }
  await startOwn();
}

async function startOwn() {
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.E2E_PORT ?? '4174';
const dir = mkdtempSync(join(tmpdir(), 'ft-e2e-fn-'));
const envFile = join(dir, 'env');
writeFileSync(envFile, `ALLOWED_ORIGINS=http://localhost:${port},http://127.0.0.1:${port}\n`);
const child = spawn('supabase', ['functions', 'serve', '--env-file', envFile], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => {
  child.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
};
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('SIGINT', () => { stop(); process.exit(0); });
child.on('exit', (code) => { rmSync(dir, { recursive: true, force: true }); process.exit(code ?? 0); });

for (let i = 0; i < 90; i++) {
  if ((await probe()) === 401) {
    console.log('E2E functions ready');
    return;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error('Edge Functions не ответили за 90 с');
stop();
process.exit(1);
}
