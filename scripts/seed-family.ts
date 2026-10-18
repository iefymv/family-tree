// Заполнение базы семьёй из private/family.json (фаза 5): npm run seed [-- --verify] [--file <путь>] [--prod]
// Ключ — только из переменных окружения SUPABASE_URL и SUPABASE_SECRET_KEY (service role).
// Идемпотентно: всё пишется upsert по external_ref, повторный запуск дублей и лишней истории не даёт.
// В выводе только числа и названия полей — ни имён, ни значений, ни ref.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { parseDateText } from '../app/src/lib/dates.ts';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUCKET = 'documents';
const THUMB_SIDE = 320;
const CHUNK = 100;

type Certainty = 'known' | 'probable' | 'uncertain';
type ParentType = 'biological' | 'adoptive' | 'raised_by' | 'step' | 'unknown';

export interface FamilyPerson {
  ref: string;
  surname?: string; given_name?: string; patronymic?: string; maiden_name?: string;
  sex: 'm' | 'f' | 'u';
  birth_date_text?: string; birth_place?: string; death_date_text?: string; death_place?: string;
  occupation?: string; life_story?: string; notes?: string;
  needs_check?: boolean; is_placeholder?: boolean; name_variants?: unknown[];
  documents?: string[]; documents_caption?: string;
}
export type FamilyRelation =
  | { kind: 'spouse'; a: string; b: string; certainty?: Certainty }
  | { kind: 'parent'; parent: string; child: string; parent_type?: ParentType; certainty?: Certainty };
export interface FamilyFact { person: string; kind: string; value: string; source?: string; certainty?: Certainty }
export interface Family {
  admin_ref?: string;
  source_default?: string;
  people: FamilyPerson[];
  relations: FamilyRelation[];
  facts: FamilyFact[];
}

export class SeedError extends Error {}

const CERTAINTY = new Set(['known', 'probable', 'uncertain']);
const PARENT_TYPES = new Set(['biological', 'adoptive', 'raised_by', 'step', 'unknown']);
const nn = <T>(v: T | undefined | null | ''): T | null => (v === undefined || v === '' ? null : v);

/** Проверка формы файла. В тексте ошибок — только позиции и поля, не значения. */
export function validateFamily(f: Family): void {
  const errs: string[] = [];
  if (!f || !Array.isArray(f.people)) throw new SeedError('family.json: нет массива people');
  f.relations ??= [];
  f.facts ??= [];
  const refs = new Set<string>();
  f.people.forEach((p, i) => {
    if (!p.ref) errs.push(`people[${i}].ref: пусто`);
    else if (refs.has(p.ref)) errs.push(`people[${i}].ref: повтор`);
    refs.add(p.ref);
    if (!['m', 'f', 'u'].includes(p.sex)) errs.push(`people[${i}].sex: не m/f/u`);
    if (p.name_variants !== undefined && !Array.isArray(p.name_variants)) errs.push(`people[${i}].name_variants: не массив`);
    if (p.documents !== undefined && !Array.isArray(p.documents)) errs.push(`people[${i}].documents: не массив`);
  });
  f.relations.forEach((r, i) => {
    if (r.certainty !== undefined && !CERTAINTY.has(r.certainty)) errs.push(`relations[${i}].certainty: недопустимо`);
    if (r.kind === 'spouse') {
      if (!refs.has(r.a)) errs.push(`relations[${i}].a: нет такого ref`);
      if (!refs.has(r.b)) errs.push(`relations[${i}].b: нет такого ref`);
      if (r.a === r.b) errs.push(`relations[${i}]: сам с собой`);
    } else if (r.kind === 'parent') {
      if (!refs.has(r.parent)) errs.push(`relations[${i}].parent: нет такого ref`);
      if (!refs.has(r.child)) errs.push(`relations[${i}].child: нет такого ref`);
      if (r.parent === r.child) errs.push(`relations[${i}]: сам себе родитель`);
      if (r.parent_type !== undefined && !PARENT_TYPES.has(r.parent_type)) errs.push(`relations[${i}].parent_type: недопустимо`);
    } else errs.push(`relations[${i}].kind: не spouse/parent`);
  });
  const relRefs = new Set<string>();
  f.relations.forEach((r, i) => {
    const k = relationRef(r);
    if (relRefs.has(k)) errs.push(`relations[${i}]: повтор связи`);
    relRefs.add(k);
  });
  f.facts.forEach((x, i) => {
    if (!refs.has(x.person)) errs.push(`facts[${i}].person: нет такого ref`);
    if (!x.kind) errs.push(`facts[${i}].kind: пусто`);
    if (x.certainty !== undefined && !CERTAINTY.has(x.certainty)) errs.push(`facts[${i}].certainty: недопустимо`);
  });
  if (errs.length) throw new SeedError(`family.json: ${errs.length} ошибок\n  ${errs.join('\n  ')}`);
}

export function loadFamily(path: string): Family {
  if (!existsSync(path)) throw new SeedError('Нет файла с семьёй (по умолчанию private/family.json)');
  const f = JSON.parse(readFileSync(path, 'utf8')) as Family;
  validateFamily(f);
  return f;
}

// ---------------------------------------------------------------- ожидаемые строки (без uuid)

export function relationRef(r: FamilyRelation): string {
  if (r.kind === 'spouse') {
    const [lo, hi] = [r.a, r.b].sort();
    return `rel:spouse:${lo}:${hi}`;
  }
  return `rel:parent:${r.parent}:${r.child}:${r.parent_type ?? 'biological'}`;
}

export function personRow(p: FamilyPerson) {
  const birth = parseDateText(p.birth_date_text);
  const death = parseDateText(p.death_date_text);
  return {
    external_ref: p.ref,
    surname: nn(p.surname), given_name: nn(p.given_name), patronymic: nn(p.patronymic), maiden_name: nn(p.maiden_name),
    name_variants: p.name_variants ?? [],
    sex: p.sex,
    birth_date_text: nn(p.birth_date_text), birth_date_from: birth?.from ?? null, birth_date_to: birth?.to ?? null,
    birth_place: nn(p.birth_place),
    death_date_text: nn(p.death_date_text), death_date_from: death?.from ?? null, death_date_to: death?.to ?? null,
    death_place: nn(p.death_place),
    occupation: nn(p.occupation), life_story: nn(p.life_story), notes: nn(p.notes),
    needs_check: p.needs_check ?? false, is_placeholder: p.is_placeholder ?? false,
  };
}

export function relationRow(r: FamilyRelation, ids: Map<string, string>) {
  if (r.kind === 'spouse') {
    const [from, to] = [ids.get(r.a)!, ids.get(r.b)!].sort();
    return { external_ref: relationRef(r), kind: 'spouse', from_person: from, to_person: to, parent_type: null, spouse_order: 1, certainty: r.certainty ?? null };
  }
  return {
    external_ref: relationRef(r), kind: 'parent', from_person: ids.get(r.parent)!, to_person: ids.get(r.child)!,
    parent_type: r.parent_type ?? 'biological', spouse_order: null, certainty: r.certainty ?? null,
  };
}

export function factRows(f: Family, ids: Map<string, string>) {
  const n = new Map<string, number>();
  return f.facts.map((x) => {
    const i = (n.get(x.person) ?? 0) + 1;
    n.set(x.person, i);
    return {
      external_ref: `fact:${x.person}:${i}`, person_id: ids.get(x.person)!, kind: x.kind, value: nn(x.value),
      source: x.source ?? f.source_default ?? null, certainty: x.certainty ?? null,
    };
  });
}

export interface PlannedDoc { file: string; sha: string; bytes: Buffer; ref: string; caption: string | null }

export function planDocuments(f: Family, base: string): PlannedDoc[] {
  const out: PlannedDoc[] = [];
  const seen = new Set<string>();
  f.people.forEach((p, i) => (p.documents ?? []).forEach((rel, j) => {
    const file = resolve(base, rel);
    if (!existsSync(file)) throw new SeedError(`people[${i}].documents[${j}]: файл не найден`);
    const bytes = readFileSync(file);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (seen.has(sha)) throw new SeedError(`people[${i}].documents[${j}]: тот же файл уже указан (у этого или другого человека)`);
    seen.add(sha);
    out.push({ file, sha, bytes, ref: p.ref, caption: nn(p.documents_caption) });
  }));
  return out;
}

// ---------------------------------------------------------------- база

function fail(what: string, e: { code?: string; message?: string } | null): never {
  // details/hint у PostgREST содержат значения ключей — не печатаем.
  throw new SeedError(`${what}: ${e?.code ?? ''} ${e?.message ?? ''}`.trim());
}

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function selectIn(db: SupabaseClient, table: string, cols: string, col: string, vals: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (const part of chunks(vals)) {
    const { data, error } = await db.from(table).select(cols).in(col, part);
    if (error) fail(`чтение ${table}`, error);
    rows.push(...(data as unknown as Record<string, unknown>[]));
  }
  return rows;
}

async function upsert(db: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  const out: { id: string; external_ref: string }[] = [];
  for (const part of chunks(rows)) {
    const { data, error } = await db.from(table).upsert(part, { onConflict: 'external_ref' }).select('id, external_ref');
    if (error) fail(`запись ${table}`, error);
    out.push(...data);
  }
  return out;
}

const isExists = (e: { message?: string; statusCode?: string; status?: number } | null) =>
  !!e && (/exists|duplicate/i.test(e.message ?? '') || e.statusCode === '409' || e.status === 409);

async function uploadOnce(db: SupabaseClient, path: string, body: Buffer): Promise<'uploaded' | 'skipped'> {
  const { error } = await db.storage.from(BUCKET).upload(path, body, { upsert: false, contentType: 'image/jpeg' });
  if (!error) return 'uploaded';
  if (isExists(error as never)) return 'skipped';
  fail('загрузка файла', error as never);
}

export const thumbOf = (path: string) => path.replace(/\.jpg$/, '_thumb.jpg');

export interface SeedStats {
  people: number; relations: number; facts: number; documents: number;
  filesUploaded: number; filesSkipped: number; history: number;
}

async function lastEditId(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from('edits').select('id').order('id', { ascending: false }).limit(1);
  if (error) fail('чтение edits', error);
  return (data?.[0]?.id as number | undefined) ?? 0;
}

/** Строки истории по своим записям после метки (сайт и тесты могут писать параллельно — чужие не считаем). */
async function editsSince(db: SupabaseClient, since: number, rowIds: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(rowIds)) {
    const { count, error } = await db.from('edits').select('id', { count: 'exact', head: true }).gt('id', since).in('row_id', part);
    if (error) fail('чтение edits', error);
    n += count ?? 0;
  }
  return n;
}

export async function seed(db: SupabaseClient, f: Family, base = ROOT): Promise<SeedStats> {
  const docs = planDocuments(f, base); // до записи: отсутствующий файл не оставит базу наполовину заполненной
  const mark = await lastEditId(db);

  const people = await upsert(db, 'people', f.people.map(personRow));
  const ids = new Map(people.map((r) => [r.external_ref, r.id]));
  const relations = await upsert(db, 'relations', f.relations.map((r) => relationRow(r, ids)));
  const facts = await upsert(db, 'facts', factRows(f, ids));

  let filesUploaded = 0, filesSkipped = 0;
  const docRows: Record<string, unknown>[] = [];
  for (const d of docs) {
    const pid = ids.get(d.ref)!;
    const path = `people/${pid}/${d.sha}.jpg`;
    const thumb = await sharp(d.bytes).rotate().resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    for (const [p, body] of [[path, d.bytes], [thumbOf(path), thumb]] as const) {
      if ((await uploadOnce(db, p, body)) === 'uploaded') filesUploaded++; else filesSkipped++;
    }
    docRows.push({ external_ref: `doc:${d.sha}`, person_id: pid, storage_path: path, mime: 'image/jpeg', caption: d.caption, source: f.source_default ?? null });
  }
  const documents = await upsert(db, 'documents', docRows);

  return {
    people: people.length, relations: relations.length, facts: facts.length, documents: documents.length,
    filesUploaded, filesSkipped,
    history: await editsSince(db, mark, [...people, ...relations, ...facts, ...documents].map((r) => r.id)),
  };
}

// ---------------------------------------------------------------- сверка

export interface VerifyResult {
  counts: Record<string, string>;
  mismatches: Map<string, number>;
}

// jsonb переупорядочивает ключи объектов — сравниваем в каноническом виде.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v ?? null;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export async function verify(db: SupabaseClient, f: Family, base = ROOT): Promise<VerifyResult> {
  const mm = new Map<string, number>();
  const bump = (k: string, n = 1) => mm.set(k, (mm.get(k) ?? 0) + n);

  // люди
  const pCols = ['id', 'deleted_at', ...Object.keys(personRow(f.people[0] ?? { ref: '', sex: 'u' }))];
  const pRows = await selectIn(db, 'people', pCols.join(','), 'external_ref', f.people.map((p) => p.ref));
  const byRef = new Map(pRows.map((r) => [r.external_ref as string, r]));
  const ids = new Map<string, string>();
  for (const p of f.people) {
    const row = byRef.get(p.ref);
    if (!row) { bump('people.нет_в_базе'); continue; }
    ids.set(p.ref, row.id as string);
    if (row.deleted_at) bump('people.deleted_at');
    for (const [k, v] of Object.entries(personRow(p))) if (!same(row[k], v)) bump(`people.${k}`);
  }
  const pids = [...ids.values()];

  // связи: ожидаемые по external_ref + живые лишние между людьми из файла
  const expRel = f.relations.filter((r) => (r.kind === 'spouse' ? ids.has(r.a) && ids.has(r.b) : ids.has(r.parent) && ids.has(r.child)))
    .map((r) => relationRow(r, ids));
  if (expRel.length < f.relations.length) bump('relations.нет_людей', f.relations.length - expRel.length);
  const relCols = 'id,external_ref,kind,from_person,to_person,parent_type,spouse_order,certainty,deleted_at';
  const relRows = new Map<string, Record<string, unknown>>();
  for (const r of [...await selectIn(db, 'relations', relCols, 'from_person', pids), ...await selectIn(db, 'relations', relCols, 'to_person', pids)]) relRows.set(r.id as string, r);
  const relByRef = new Map([...relRows.values()].filter((r) => r.external_ref).map((r) => [r.external_ref as string, r]));
  let relOk = 0;
  for (const e of expRel) {
    const row = relByRef.get(e.external_ref);
    if (!row) { bump('relations.нет_в_базе'); continue; }
    if (row.deleted_at) bump('relations.deleted_at');
    let ok = !row.deleted_at;
    for (const [k, v] of Object.entries(e)) if (!same(row[k], v)) { bump(`relations.${k}`); ok = false; }
    if (ok) relOk++;
  }
  const expRelRefs = new Set(expRel.map((e) => e.external_ref));
  const extraRel = [...relRows.values()].filter((r) => !r.deleted_at && !expRelRefs.has(r.external_ref as string)).length;
  if (extraRel) bump('relations.лишние', extraRel);

  // факты
  const expFacts = factRows(f, ids).filter((x) => x.person_id);
  const fRows = await selectIn(db, 'facts', 'id,external_ref,person_id,kind,value,source,certainty,deleted_at', 'person_id', pids);
  const fByRef = new Map(fRows.filter((r) => r.external_ref).map((r) => [r.external_ref as string, r]));
  let factOk = 0;
  for (const e of expFacts) {
    const row = fByRef.get(e.external_ref);
    if (!row) { bump('facts.нет_в_базе'); continue; }
    if (row.deleted_at) bump('facts.deleted_at');
    let ok = !row.deleted_at;
    for (const [k, v] of Object.entries(e)) if (!same(row[k], v)) { bump(`facts.${k}`); ok = false; }
    if (ok) factOk++;
  }
  const expFactRefs = new Set(expFacts.map((e) => e.external_ref));
  const extraFacts = fRows.filter((r) => !r.deleted_at && !expFactRefs.has(r.external_ref as string)).length;
  if (extraFacts) bump('facts.лишние', extraFacts);

  // документы и файлы
  const docs = planDocuments(f, base);
  const dRows = await selectIn(db, 'documents', 'id,external_ref,person_id,storage_path,mime,caption,source,deleted_at', 'person_id', pids);
  const dByRef = new Map(dRows.filter((r) => r.external_ref).map((r) => [r.external_ref as string, r]));
  let docOk = 0, filesOk = 0;
  const folders = new Map<string, Set<string>>();
  for (const d of docs) {
    const pid = ids.get(d.ref);
    if (!pid) { bump('documents.нет_человека'); continue; }
    const path = `people/${pid}/${d.sha}.jpg`;
    const expected = { person_id: pid, storage_path: path, mime: 'image/jpeg', caption: d.caption, source: f.source_default ?? null };
    const row = dByRef.get(`doc:${d.sha}`);
    if (!row) bump('documents.нет_в_базе');
    else {
      if (row.deleted_at) bump('documents.deleted_at');
      let ok = !row.deleted_at;
      for (const [k, v] of Object.entries(expected)) if (!same(row[k], v)) { bump(`documents.${k}`); ok = false; }
      if (ok) docOk++;
    }
    if (!folders.has(pid)) {
      const { data, error } = await db.storage.from(BUCKET).list(`people/${pid}`, { limit: 1000 });
      if (error) fail('список файлов', error as never);
      folders.set(pid, new Set((data ?? []).map((o) => `people/${pid}/${o.name}`)));
    }
    for (const p of [path, thumbOf(path)]) {
      if (folders.get(pid)!.has(p)) filesOk++; else bump(p === path ? 'storage.скан' : 'storage.миниатюра');
    }
  }
  const expDocRefs = new Set(docs.map((d) => `doc:${d.sha}`));
  const extraDocs = dRows.filter((r) => !r.deleted_at && !expDocRefs.has(r.external_ref as string)).length;
  if (extraDocs) bump('documents.лишние', extraDocs);

  // история: каждая вставка сделана под service role → автор 'seed'
  const rowIds = [...pids, ...[...relByRef.values()].map((r) => r.id as string), ...fRows.map((r) => r.id as string), ...dRows.map((r) => r.id as string)];
  const inserts = (await selectIn(db, 'edits', 'row_id,op,actor_label', 'row_id', rowIds)).filter((e) => e.op === 'insert');
  const seedInserts = inserts.filter((e) => e.actor_label === 'seed').length;
  if (seedInserts < inserts.length) bump('edits.actor_label', inserts.length - seedInserts);

  return {
    counts: {
      'люди': `${pids.length}/${f.people.length}`,
      'связи': `${relOk}/${f.relations.length}`,
      'факты': `${factOk}/${f.facts.length}`,
      'документы': `${docOk}/${docs.length}`,
      'файлы (скан+миниатюра)': `${filesOk}/${docs.length * 2}`,
      'вставки в истории с автором seed': `${seedInserts}/${inserts.length}`,
    },
    mismatches: mm,
  };
}

// ---------------------------------------------------------------- CLI

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
  } catch { return false; }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new SeedError('Задайте переменные окружения SUPABASE_URL и SUPABASE_SECRET_KEY');
  if (!isLocalUrl(url) && !argv.includes('--prod')) throw new SeedError('SUPABASE_URL не локальный — для прода добавьте флаг --prod');
  const file = resolve(ROOT, argValue(argv, '--file') ?? 'private/family.json');
  const f = loadFamily(file);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (argv.includes('--verify')) {
    const r = await verify(db, f);
    for (const [k, v] of Object.entries(r.counts)) console.log(`${k}: ${v}`);
    if (!r.mismatches.size) { console.log('0 расхождений'); return 0; }
    const total = [...r.mismatches.values()].reduce((a, b) => a + b, 0);
    console.log(`Расхождений: ${total}`);
    for (const [k, n] of [...r.mismatches].sort()) console.log(`  ${k}: ${n}`);
    return 1;
  }

  const s = await seed(db, f);
  console.log(`люди: ${s.people}, связи: ${s.relations}, факты: ${s.facts}, документы: ${s.documents}`);
  console.log(`файлы: загружено ${s.filesUploaded}, уже были ${s.filesSkipped}`);
  console.log(`новых строк в истории: ${s.history}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (e) => {
    // Текст SyntaxError от JSON.parse содержит кусок файла — его не печатаем.
    const err = e as Error;
    console.error(e instanceof SeedError ? err.message : err instanceof SyntaxError ? 'family.json: не JSON' : `Сбой: ${err?.name}: ${err?.message}`);
    process.exit(1);
  });
}
