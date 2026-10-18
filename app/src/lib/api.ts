// Данные дерева: чтение только из *_live-представлений, запись — в таблицы (RLS + триггеры аудита),
// мягкое удаление и откат — только через RPC.
import type { PostgrestError } from '@supabase/supabase-js';
import type { FamilyData, Gender, ParentType, Person, Relation } from '../tree/graph';
import { db } from './supabase';

// ---------------------------------------------------------------- типы строк

export type Sex = 'm' | 'f' | 'u';
export type Certainty = 'known' | 'probable' | 'uncertain';

export interface PersonRow {
  id: string;
  external_ref: string | null;
  surname: string | null;
  given_name: string | null;
  patronymic: string | null;
  maiden_name: string | null;
  name_variants: string[];
  sex: Sex;
  birth_date_text: string | null;
  birth_date_from: string | null;
  birth_date_to: string | null;
  birth_place: string | null;
  death_date_text: string | null;
  death_date_from: string | null;
  death_date_to: string | null;
  death_place: string | null;
  is_placeholder: boolean;
  needs_check: boolean;
  notes: string | null;
  occupation: string | null;
  life_story: string | null;
  portrait_document_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface RelationRow {
  id: string;
  kind: 'parent' | 'spouse';
  from_person: string;
  to_person: string;
  parent_type: ParentType | null;
  spouse_order: number | null;
  start_text: string | null;
  end_text: string | null;
  certainty: Certainty | null;
  note: string | null;
}

export interface FactRow {
  id: string;
  person_id: string;
  kind: string;
  value: string | null;
  date_text: string | null;
  source: string | null;
  certainty: Certainty | null;
  note: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  person_id: string;
  storage_path: string;
  mime: string | null;
  caption: string | null;
  source: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface EditRow {
  id: number;
  at: string;
  actor: string | null;
  actor_label: string | null;
  table_name: 'people' | 'relations' | 'facts' | 'documents';
  row_id: string;
  op: 'insert' | 'update' | 'soft_delete' | 'restore' | 'revert';
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  changed_fields: string[];
  reverts_edit: number | null;
}

/** Поля человека, которые клиент вправе писать. Служебные (id, автор, время, deleted_at) ставит сервер. */
export const PERSON_FIELDS = [
  'surname', 'given_name', 'patronymic', 'maiden_name', 'name_variants', 'sex',
  'birth_date_text', 'birth_date_from', 'birth_date_to', 'birth_place',
  'death_date_text', 'death_date_from', 'death_date_to', 'death_place',
  'is_placeholder', 'needs_check', 'notes', 'occupation', 'life_story', 'portrait_document_id',
] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];
export type PersonFields = Partial<Pick<PersonRow, PersonField>>;

export type FactFields = Pick<FactRow, 'kind'> & Partial<Pick<FactRow, 'value' | 'date_text' | 'source' | 'certainty' | 'note'>>;

/** Данные для дерева (graph.ts) плюс исходные строки для карточки, поиска и «Убрать связь». */
export interface Family extends FamilyData {
  people: PersonRow[];
  relationRows: RelationRow[];
}

// ---------------------------------------------------------------- ошибки

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly cause?: unknown) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** id попадает в строку фильтра .or(...) — пропускаем только UUID. */
function uuid(id: string): string {
  if (!UUID.test(id)) throw new ApiError(`Некорректный id: ${id}`);
  return id;
}

function fail(error: PostgrestError | { message: string; code?: string }): never {
  if (error.code === '23505') throw new ApiError('Эта связь уже есть', error.code, error);
  if (error.code === '42501') throw new ApiError('Недостаточно прав', error.code, error);
  throw new ApiError(error.message, error.code, error);
}

// ---------------------------------------------------------------- чтение

const PAGE = 1000; // = max_rows в supabase/config.toml

async function selectAll<T>(view: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(view).select(columns).order('id').range(from, from + PAGE - 1);
    if (error) fail(error);
    out.push(...(data as unknown as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

const GENDER: Record<Sex, Gender> = { m: 'male', f: 'female', u: 'unknown' };

/** «Имя Фамилия» для дерева; у безымянных — «Неизвестно». */
export function displayName(p: Pick<PersonRow, 'given_name' | 'surname'>): string {
  return [p.given_name, p.surname].filter((s) => s && s.trim()).join(' ') || 'Неизвестно';
}

export function toPerson(p: PersonRow): Person {
  return { id: p.id, name: displayName(p), gender: GENDER[p.sex] ?? 'unknown' };
}

/** Брак считается расторгнутым, если у него заполнен end_text. */
export function toRelation(r: RelationRow): Relation {
  if (r.kind === 'spouse') {
    return { kind: 'spouse', aId: r.from_person, bId: r.to_person, order: r.spouse_order ?? 1, divorced: !!r.end_text };
  }
  return { kind: 'parent', parentId: r.from_person, childId: r.to_person, type: r.parent_type ?? 'unknown' };
}

const RELATION_COLUMNS = 'id, kind, from_person, to_person, parent_type, spouse_order, start_text, end_text, certainty, note';

export async function loadFamily(): Promise<Family> {
  const [people, relationRows] = await Promise.all([
    selectAll<PersonRow>('people_live', '*'),
    selectAll<RelationRow>('relations_live', RELATION_COLUMNS),
  ]);
  return { people, relationRows, persons: people.map(toPerson), relations: relationRows.map(toRelation) };
}

export interface PersonDetail {
  person: PersonRow;
  facts: FactRow[];
  documents: DocumentRow[];
}

export async function getPersonDetail(id: string): Promise<PersonDetail | null> {
  const [p, f, d] = await Promise.all([
    db().from('people_live').select('*').eq('id', id).maybeSingle(),
    db().from('facts_live').select('id, person_id, kind, value, date_text, source, certainty, note, created_at')
      .eq('person_id', id).order('created_at'),
    db().from('documents_live').select('id, person_id, storage_path, mime, caption, source, uploaded_by, created_at')
      .eq('person_id', id).order('created_at'),
  ]);
  for (const r of [p, f, d]) if (r.error) fail(r.error);
  if (!p.data) return null;
  return { person: p.data as PersonRow, facts: (f.data ?? []) as FactRow[], documents: (d.data ?? []) as DocumentRow[] };
}

// ---------------------------------------------------------------- добавление родственника

export type AddKind = 'parent' | 'spouse' | 'child' | 'sibling';

export interface AddRelativeResult {
  person: PersonRow;
  /** Созданный placeholder-родитель (только для sibling, если у якоря не было родителей). */
  placeholder?: PersonRow;
  relationIds: string[];
}

/**
 * «+» на дереве: человек и связи с якорем одной транзакцией (RPC add_relative, миграция 0011).
 * Семантика как в tree/mutate.ts:
 * - parent: новый → якорь; если у якоря уже один родитель — новый становится его супругом;
 * - spouse: брак с номером max+1;
 * - child: якорь → новый, плюс текущий (нерасторгнутый, с наибольшим номером) супруг якоря;
 * - sibling: общие родители якоря; если родителей нет — сначала placeholder-родитель.
 * При любой ошибке не создаётся ничего.
 */
export async function addRelative(anchorId: string, kind: AddKind, fields: PersonFields): Promise<AddRelativeResult> {
  const { portrait_document_id: _portrait, ...rest } = pickPersonFields(fields);
  if (_portrait !== undefined) throw new ApiError('Портрет новому человеку задаётся после загрузки фото');
  const { data, error } = await db().rpc('add_relative', { anchor: uuid(anchorId), kind, fields: rest });
  if (error) {
    if (/two parents/.test(error.message)) throw new ApiError('У человека уже двое родителей', error.code, error);
    if (error.code === 'P0002') throw new ApiError('Человек не найден или удалён', error.code, error);
    fail(error);
  }
  const r = data as { person: PersonRow; placeholder: PersonRow | null; relation_ids: string[] };
  return { person: r.person, placeholder: r.placeholder ?? undefined, relationIds: r.relation_ids };
}

// ---------------------------------------------------------------- правка

function pickPersonFields(fields: PersonFields): PersonFields {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!(PERSON_FIELDS as readonly string[]).includes(k)) throw new ApiError(`Поле ${k} нельзя менять`);
    if (v !== undefined) out[k] = v;
  }
  return out as PersonFields;
}

/** Только изменившиеся поля формы относительно исходной строки (для diff-PATCH). */
export function diffPerson(original: PersonRow, form: PersonFields): PersonFields {
  const out: Record<string, unknown> = {};
  for (const k of PERSON_FIELDS) {
    if (!(k in form)) continue;
    const v = form[k];
    if (v === undefined) continue;
    if (JSON.stringify(v) !== JSON.stringify(original[k])) out[k] = v;
  }
  return out as PersonFields;
}

/** PATCH только переданными полями; пустой набор — запрос не уходит, возвращается null. */
export async function updatePerson(id: string, changed: PersonFields): Promise<PersonRow | null> {
  const patch = pickPersonFields(changed);
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await db().from('people').update(patch).eq('id', id).select('*').single();
  if (error) fail(error);
  return data as PersonRow;
}

export async function addFact(personId: string, fact: FactFields): Promise<FactRow> {
  const row = {
    person_id: personId, kind: fact.kind, value: fact.value ?? null, date_text: fact.date_text ?? null,
    source: fact.source ?? null, certainty: fact.certainty ?? null, note: fact.note ?? null,
  };
  const { data, error } = await db().from('facts').insert(row)
    .select('id, person_id, kind, value, date_text, source, certainty, note, created_at').single();
  if (error) fail(error);
  return data as FactRow;
}

async function softDelete(table: 'facts' | 'relations' | 'people', id: string, restore = false): Promise<void> {
  const { error } = await db().rpc(restore ? 'restore' : 'soft_delete', { p_table: table, p_id: id });
  if (error) fail(error);
}

export const softDeleteFact = (id: string): Promise<void> => softDelete('facts', id);
export const softDeleteRelation = (id: string): Promise<void> => softDelete('relations', id);
/** Только админ: человек исчезает из *_live вместе со своими связями, фактами и документами. */
export const deletePerson = (id: string): Promise<void> => softDelete('people', id);
/** Только админ: возвращает человека и всё скрытое вместе с ним. */
export const restorePerson = (id: string): Promise<void> => softDelete('people', id, true);

// ---------------------------------------------------------------- история и откат

/** Правки человека и всего, что к нему относится (факты, документы, связи — включая удалённые). */
export async function history(personId: string): Promise<EditRow[]> {
  const [f, d, r] = await Promise.all([
    db().from('facts').select('id').eq('person_id', personId),
    db().from('documents').select('id').eq('person_id', personId),
    db().from('relations').select('id').or(`from_person.eq.${uuid(personId)},to_person.eq.${personId}`),
  ]);
  for (const x of [f, d, r]) if (x.error) fail(x.error);
  const ids = [personId, ...[f, d, r].flatMap((x) => (x.data ?? []).map((row: { id: string }) => row.id))];
  const { data, error } = await db().from('edits')
    .select('id, at, actor, actor_label, table_name, row_id, op, old, new, changed_fields, reverts_edit')
    .in('row_id', ids).order('id', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as EditRow[];
}

export type RevertResult =
  | { ok: true; fields: string[]; forced: boolean }
  | { conflict: string[] };

/** Только админ. Конфликт (поле с тех пор правили) — { conflict }, без изменений, если не force. */
export async function revert(editId: number, force = false): Promise<RevertResult> {
  const { data, error } = await db().rpc('revert_edit', { p_edit_id: editId, p_force: force });
  if (error) fail(error);
  return data as RevertResult;
}

// ---------------------------------------------------------------- для экрана дерева

/** Пути файлов портретов по id документов (для миниатюр на дереве). */
export async function loadPortraitPaths(documentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(documentIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from('documents_live').select('id, storage_path').in('id', ids.slice(i, i + 200));
    if (error) fail(error);
    for (const d of (data ?? []) as { id: string; storage_path: string }[]) out.set(d.id, d.storage_path);
  }
  return out;
}

/** Подписи участников (кто добавил / правил): user_id → display_name. login не читается (column grants). */
export async function loadMemberNames(): Promise<Map<string, string>> {
  const { data, error } = await db().from('members').select('user_id, display_name');
  if (error) fail(error);
  return new Map(((data ?? []) as { user_id: string; display_name: string }[]).map((m) => [m.user_id, m.display_name]));
}

/** Второй родитель для ребёнка, у которого известен один (заполнение «Неизвестно» у остальных детей). */
export async function addParentRelation(parentId: string, childId: string): Promise<string> {
  const { data, error } = await db().from('relations')
    .insert({ kind: 'parent', from_person: uuid(parentId), to_person: uuid(childId), parent_type: 'biological' })
    .select('id').single();
  if (error) fail(error);
  return (data as { id: string }).id;
}

/** Мягко удалённые люди (для «Восстановить» у админа). Удалённые строки RLS участникам отдаёт — для истории. */
export async function listDeletedPeople(): Promise<PersonRow[]> {
  const { data, error } = await db().from('people').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100);
  if (error) fail(error);
  return (data ?? []) as PersonRow[];
}
