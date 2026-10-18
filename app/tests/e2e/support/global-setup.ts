// Перед прогоном: убрать остатки, снять снимок seed, создать входы (пароли — только в памяти процесса).
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { P, LOGINS } from './cast';
import { localEnv } from './env';
import { createMember, dropE2EMembers, service, snapshot } from './stack';

export const SNAP_FILE = new URL('../../../test-results/e2e-snapshot.json', import.meta.url);

export default async function globalSetup() {
  localEnv();
  const s = service();
  await dropE2EMembers(s);
  const snap = await snapshot(s);
  // Снимок — только вымышленные строки seed; лежит в gitignored test-results/.
  mkdirSync(new URL('.', SNAP_FILE), { recursive: true });
  writeFileSync(SNAP_FILE, JSON.stringify(snap));
  const mk = () => `${randomUUID().slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  process.env.E2E_PW_ADMIN = mk();
  process.env.E2E_PW_PETR = mk();
  process.env.E2E_PW_OLGA = mk();
  await createMember(s, P.ilya, LOGINS.admin, process.env.E2E_PW_ADMIN, 'Илья', 'admin');
  await createMember(s, P.petr, LOGINS.petr, process.env.E2E_PW_PETR, 'Пётр', 'relative');
  await createMember(s, P.olga, LOGINS.olga, process.env.E2E_PW_OLGA, 'Ольга', 'relative');
}
