// Входы для показа на ЛОКАЛЬНОМ стеке: вымышленные Илья Иванов (админ) и Пётр Иванов (родственник) из seed.sql.
// Пароли генерируются и пишутся только в ../.env.showcase (gitignored), в консоль не выводятся.
// Внимание: e2e (`npm run test:e2e`) перед прогоном удаляет входы этих карточек — после e2e запустите скрипт снова.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { toLoginAndEmail } from '../src/lib/auth.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = {};
for (const line of execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.API_URL || !['127.0.0.1', 'localhost'].includes(new URL(env.API_URL).hostname)) throw new Error('Только локальный стек');
const s = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PEOPLE = [
  { id: '00000000-0000-4000-8000-000000000008', name: 'Илья Иванов', label: 'Илья', role: 'admin' },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Пётр Иванов', label: 'Пётр', role: 'relative' },
];
const lines = ['# Локальные входы для показа (вымышленные люди из seed.sql). Не коммитится.'];
for (const p of PEOPLE) {
  const { data: old } = await s.from('members').select('user_id').eq('person_id', p.id);
  for (const m of old ?? []) await s.auth.admin.deleteUser(m.user_id);
  const { login, email } = toLoginAndEmail(p.name);
  const password = `${randomUUID().slice(0, 6)}-${randomUUID().slice(0, 6)}`;
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { error: mErr } = await s.from('members').insert({ user_id: data.user.id, person_id: p.id, login, display_name: p.label, role: p.role });
  if (mErr) throw mErr;
  lines.push(`${p.role === 'admin' ? 'ADMIN' : 'RELATIVE'}_LOGIN="${p.name}"`, `${p.role === 'admin' ? 'ADMIN' : 'RELATIVE'}_PASSWORD="${password}"`);
}
writeFileSync(new URL('../../.env.showcase', import.meta.url), `${lines.join('\n')}\n`, { mode: 0o600 });
console.log('Готово: входы созданы, пароли — в .env.showcase');
