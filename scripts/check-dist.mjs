// Проверяет сборку: в ней не должно быть секретного ключа Supabase.
// Ищет настоящие ключи sb_secret_<…> и JWT; у каждого JWT роль должна быть anon.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] || 'app/dist';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(dir);
let bad = 0, jwts = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(s)) { console.error(`секретный ключ sb_secret_ в ${f}`); bad++; }
  for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    jwts++;
    let role = '?';
    try { role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role; } catch {}
    if (role !== 'anon') { console.error(`JWT с ролью «${role}» в ${f}`); bad++; }
  }
}
console.log(`check-dist: файлов ${files.length}, JWT ${jwts}, проблем ${bad}`);
process.exit(bad ? 1 : 0);
