// Локальный стек: ключи из `supabase status -o env` — только в памяти, не печатаются.
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = new URL('../../../', import.meta.url); // ~/Projects/family-tree

function status(): Record<string, string> {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  if (!env.API_URL || !env.SERVICE_ROLE_KEY || !env.ANON_KEY) throw new Error('Локальный стек не запущен: supabase start');
  const host = new URL(env.API_URL).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('Тесты гоняются только на локальном стеке');
  return env;
}

const env = status();
export const API_URL = env.API_URL;
export const ANON_KEY = env.ANON_KEY;
export const RUN = String(Date.now() % 1_000_000).padStart(6, '0');

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export const service: SupabaseClient = createClient(API_URL, env.SERVICE_ROLE_KEY, noSession);
export const anonClient = (): SupabaseClient => createClient(API_URL, ANON_KEY, noSession);
