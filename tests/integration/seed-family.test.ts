// scripts/seed-family.ts на локальном стеке, вымышленные Ивановы (refs seedtest-*). Реальный private/family.json не читается.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { seed, verify, type Family } from '../../scripts/seed-family.ts';
import { API_URL, env, service } from './_local.ts';

const ROOT = new URL('../../', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'seedtest-'));
const fixturePath = join(dir, 'family.json');
let family: Family;

async function wipe(): Promise<void> {
  const { data: people } = await service.from('people').select('id').like('external_ref', 'seedtest-%');
  const ids = (people ?? []).map((p) => p.id);
  if (!ids.length) return;
  const { data: docs } = await service.from('documents').select('id, storage_path').in('person_id', ids);
  const paths = (docs ?? []).flatMap((d) => [d.storage_path, d.storage_path.replace(/\.jpg$/, '_thumb.jpg')]);
  if (paths.length) await service.storage.from('documents').remove(paths);
  const { data: rels } = await service.from('relations').select('id').or(`from_person.in.(${ids}),to_person.in.(${ids})`);
  const { data: facts } = await service.from('facts').select('id').in('person_id', ids);
  const rowIds = [...ids, ...(docs ?? []).map((d) => d.id), ...(rels ?? []).map((r) => r.id), ...(facts ?? []).map((f) => f.id)];
  await service.from('documents').delete().in('person_id', ids);
  await service.from('facts').delete().in('person_id', ids);
  if (rels?.length) await service.from('relations').delete().in('id', rels.map((r) => r.id));
  await service.from('people').delete().in('id', ids);
  await service.from('edits').delete().in('row_id', rowIds);
}

// Только история своих строк: e2e других тестов может писать в ту же базу параллельно.
async function historyCount(): Promise<number> {
  const { data: people } = await service.from('people').select('id').like('external_ref', 'seedtest-%');
  const ids = (people ?? []).map((p) => p.id);
  const { data: rels } = await service.from('relations').select('id').or(`from_person.in.(${ids}),to_person.in.(${ids})`);
  const { data: facts } = await service.from('facts').select('id').in('person_id', ids);
  const { data: docs } = await service.from('documents').select('id').in('person_id', ids);
  const rowIds = [...ids, ...[...(rels ?? []), ...(facts ?? []), ...(docs ?? [])].map((r) => r.id)];
  return (await service.from('edits').select('id', { count: 'exact', head: true }).in('row_id', rowIds)).count ?? 0;
}

function runCli(args: string[], url = API_URL) {
  const r = spawnSync('npx', ['tsx', 'scripts/seed-family.ts', '--file', fixturePath, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: url, SUPABASE_SECRET_KEY: env.SECRET_KEY || env.SERVICE_ROLE_KEY },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

before(async () => {
  await wipe();
  family = JSON.parse(readFileSync(new URL('tests/fixtures/family-ivanovy.json', ROOT), 'utf8'));
  // Сканы генерируются на лету (jpg в репозиторий не попадают); пути абсолютные.
  for (const p of family.people) {
    p.documents = await Promise.all((p.documents ?? []).map(async (name, i) => {
      const file = join(dir, name);
      await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 180 + i * 20, b: 150 } } }).jpeg().toFile(file);
      return file;
    }));
  }
  writeFileSync(fixturePath, JSON.stringify(family));
});

after(async () => {
  await wipe();
  rmSync(dir, { recursive: true, force: true });
});

describe('seed-family на локальном стеке', () => {
  test('без --prod не пишет в нелокальную базу', () => {
    const r = runCli([], 'https://example.supabase.co');
    assert.equal(r.code, 1);
    assert.match(r.err, /--prod/);
  });

  test('seed → verify: 0 расхождений; автор истории seed; миниатюра 320px', async () => {
    const s = await seed(service, family, ROOT.pathname);
    assert.deepEqual([s.people, s.relations, s.facts, s.documents, s.filesUploaded], [6, 6, 3, 2, 4]);
    assert.equal(s.history, 6 + 6 + 3 + 2);
    const v = await verify(service, family, ROOT.pathname);
    assert.deepEqual([...v.mismatches], []);
    assert.equal(v.counts['вставки в истории с автором seed'], '17/17');

    const { data: docs } = await service.from('documents').select('external_ref, storage_path, caption, source')
      .in('person_id', [(await service.from('people').select('id').eq('external_ref', 'seedtest-ivanov-semen').single()).data!.id]);
    assert.equal(docs!.length, 2);
    for (const d of docs!) assert.match(d.storage_path, new RegExp(`/${d.external_ref.slice(4)}\\.jpg$`));
    assert.equal(docs![0].caption, 'Вымышленные сканы');
    assert.equal(docs![0].source, family.source_default);
    const { data: blob } = await service.storage.from('documents').download(docs![0].storage_path.replace(/\.jpg$/, '_thumb.jpg'));
    const meta = await sharp(Buffer.from(await blob!.arrayBuffer())).metadata();
    assert.equal(Math.max(meta.width!, meta.height!), 320);

    const { data: semen } = await service.from('people').select('portrait_document_id, name_variants, birth_date_from').eq('external_ref', 'seedtest-ivanov-semen').single();
    assert.equal(semen!.portrait_document_id, null);
    assert.equal(semen!.birth_date_from, '1898-05-20');
  });

  test('повторный запуск: дублей нет, история не растёт, файлы пропущены', async () => {
    const before = await historyCount();
    const r = runCli([]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /загружено 0, уже были 4/);
    assert.match(r.out, /новых строк в истории: 0/);
    assert.equal(await historyCount(), before);
    const { count } = await service.from('people').select('id', { count: 'exact', head: true }).like('external_ref', 'seedtest-%');
    assert.equal(count, 6);
    const v = runCli(['--verify']);
    assert.equal(v.code, 0, v.out + v.err);
    assert.match(v.out, /0 расхождений/);
    assert.doesNotMatch(v.out, /Иванов|Семён|seedtest|Липовка/);
  });

  test('--verify называет поле расхождения, не значение', async () => {
    await service.from('people').update({ birth_place: 'Другое место' }).eq('external_ref', 'seedtest-ivanov-semen');
    const { data: semen } = await service.from('people').select('id').eq('external_ref', 'seedtest-ivanov-semen').single();
    await service.from('facts').insert({ person_id: semen!.id, kind: 'note', value: 'лишний факт' });
    const v = runCli(['--verify']);
    assert.equal(v.code, 1);
    assert.match(v.out, /people\.birth_place: 1/);
    assert.match(v.out, /facts\.лишние: 1/);
    assert.doesNotMatch(v.out, /Другое место|Липовка|лишний факт|seedtest/);
    // seed возвращает поле; лишний факт остаётся (seed не удаляет)
    assert.equal(runCli([]).code, 0);
    const v2 = runCli(['--verify']);
    assert.doesNotMatch(v2.out, /birth_place/);
    assert.match(v2.out, /facts\.лишние: 1/);
  });
});
