// `supabase functions serve` для e2e: CORS разрешён только адресу vite preview e2e.
// Печатает «E2E functions ready», когда функция отвечает (401 без входа).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const url = `${process.env.E2E_API_URL}/functions/v1/admin-users`;
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(url, { method: 'POST' });
    if (r.status === 401) {
      console.log('E2E functions ready');
      break;
    }
  } catch {
    /* ещё не поднялась */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
