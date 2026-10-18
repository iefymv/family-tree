// После прогона: удалить входы e2e и вернуть вымышленную семью к снимку.
import { readFileSync, rmSync } from 'node:fs';
import { SNAP_FILE } from './global-setup';
import { LOGINS } from './cast';
import { dropE2EMembers, restore, service, signedIn, type Snapshot } from './stack';

export default async function globalTeardown() {
  const s = service();
  const snap = JSON.parse(readFileSync(SNAP_FILE, 'utf8')) as Snapshot;
  await restore(s, snap, await signedIn(LOGINS.admin, process.env.E2E_PW_ADMIN!));
  await dropE2EMembers(s);
  rmSync(SNAP_FILE, { force: true });
}
