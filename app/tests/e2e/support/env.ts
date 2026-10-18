// Локальный стек для e2e: адрес и ключи из `supabase status -o env` — только в памяти процесса, не печатаются.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // ~/Projects/family-tree

export interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
}

/** Читает ключи один раз и кладёт в process.env (рабочие процессы Playwright наследуют окружение). */
export function localEnv(): LocalEnv {
  if (!process.env.E2E_API_URL) {
    const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const env: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
    if (!env.API_URL || !env.SERVICE_ROLE_KEY || !env.ANON_KEY) throw new Error('Локальный стек не запущен: supabase start');
    if (!['127.0.0.1', 'localhost'].includes(new URL(env.API_URL).hostname)) throw new Error('e2e гоняются только на локальном стеке');
    process.env.E2E_API_URL = env.API_URL;
    process.env.E2E_ANON_KEY = env.ANON_KEY;
    process.env.E2E_SERVICE_KEY = env.SERVICE_ROLE_KEY;
  }
  return { apiUrl: process.env.E2E_API_URL!, anonKey: process.env.E2E_ANON_KEY!, serviceKey: process.env.E2E_SERVICE_KEY! };
}
