// Запускает команду с адресом и публичным (anon) ключом ЛОКАЛЬНОГО Supabase в VITE_*-переменных.
// Ключи берутся из `supabase status -o env` и не печатаются. Пример: node scripts/with-local-env.mjs vite build
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const env = {};
for (const line of out.split('\n')) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.API_URL || !env.ANON_KEY) {
  console.error('Локальный стек не запущен: supabase start');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost'].includes(new URL(env.API_URL).hostname)) {
  console.error('Только локальный стек');
  process.exit(1);
}
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_ANON_KEY: env.ANON_KEY },
});
child.on('exit', (code) => process.exit(code ?? 1));
