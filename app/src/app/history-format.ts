// История правок человека для вкладки «История»: кто, когда, что было → что стало.
import type { EditRow } from '../lib/api';

export interface HistoryChange {
  field: string;
  old: string;
  new: string;
}

export interface HistoryItem {
  id: number;
  at: string;
  /** «18 октября 2026, 14:05» */
  when: string;
  who: string;
  title: string;
  changes: HistoryChange[];
  /** Можно ли откатить (кнопку видит только админ). */
  revertable: boolean;
}

export const FIELD_LABELS: Record<string, string> = {
  surname: 'Фамилия',
  given_name: 'Имя',
  patronymic: 'Отчество',
  maiden_name: 'Девичья фамилия',
  sex: 'Пол',
  birth_date_text: 'Дата рождения',
  birth_place: 'Место рождения',
  death_date_text: 'Дата смерти',
  death_place: 'Место смерти',
  occupation: 'Чем занимался',
  life_story: 'История жизни',
  needs_check: 'Нужно уточнить',
  notes: 'Заметки',
  portrait_document_id: 'Главное фото',
  is_placeholder: 'Неизвестный человек',
  name_variants: 'Варианты имени',
  value: 'Факт',
  date_text: 'Дата',
  caption: 'Подпись',
  end_text: 'Конец брака',
};

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function formatWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'sex') return v === 'm' ? 'мужской' : v === 'f' ? 'женский' : 'не указан';
  if (field === 'portrait_document_id') return 'фото';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (Array.isArray(v)) return v.join(', ') || '—';
  const s = String(v);
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

const OP_TITLE: Record<EditRow['op'], string> = {
  insert: 'Добавлено',
  update: 'Изменено',
  soft_delete: 'Удалено',
  restore: 'Восстановлено',
  revert: 'Откат правки',
};

/** Что показать про одну запись истории. nameOf — имя человека по id (для связей). */
export function describeEdit(e: EditRow, personId: string, nameOf: (id: string) => string | undefined): HistoryItem {
  const row = (e.new ?? e.old ?? {}) as Record<string, unknown>;
  let title = OP_TITLE[e.op];
  const changes: HistoryChange[] = [];
  if (e.table_name === 'people') {
    if (e.op === 'insert') title = 'Добавлен(а) на дерево';
    else if (e.op === 'soft_delete') title = 'Человек удалён';
    else if (e.op === 'restore') title = 'Человек восстановлен';
  } else if (e.table_name === 'facts') {
    const v = show('value', row.value);
    title = e.op === 'insert' ? `Добавлен факт: ${v}` : e.op === 'soft_delete' ? `Убран факт: ${v}` : e.op === 'restore' ? `Факт возвращён: ${v}` : e.op === 'revert' ? `Откат правки факта: ${v}` : `Изменён факт: ${v}`;
  } else if (e.table_name === 'relations') {
    const other = row.from_person === personId ? row.to_person : row.from_person;
    const name = (typeof other === 'string' && nameOf(other)) || 'другим человеком';
    const what = row.kind === 'spouse' ? 'брак' : row.from_person === personId ? 'ребёнок' : 'родитель';
    const kind = row.kind === 'spouse' ? `брак с: ${name}` : `${what} — ${name}`;
    title = e.op === 'insert' ? `Добавлена связь: ${kind}` : e.op === 'soft_delete' ? `Убрана связь: ${kind}` : e.op === 'restore' ? `Связь возвращена: ${kind}` : e.op === 'revert' ? `Откат правки связи: ${kind}` : `Изменена связь: ${kind}`;
  } else if (e.table_name === 'documents') {
    title = e.op === 'insert' ? 'Добавлен документ' : e.op === 'soft_delete' ? 'Документ удалён' : e.op === 'restore' ? 'Документ возвращён' : `${OP_TITLE[e.op]}: документ`;
  }
  if (e.op === 'update' || e.op === 'revert') {
    for (const f of e.changed_fields) {
      if (!(f in FIELD_LABELS) || f === 'deleted_at') continue;
      changes.push({ field: FIELD_LABELS[f], old: show(f, e.old?.[f]), new: show(f, e.new?.[f]) });
    }
  }
  return {
    id: e.id,
    at: e.at,
    when: formatWhen(e.at),
    who: e.actor_label === 'seed' ? SEED_LABEL : e.actor_label === 'system' || !e.actor_label ? 'система' : e.actor_label,
    title,
    changes,
    revertable: e.op !== 'update' || changes.length > 0,
  };
}

// ---------------------------------------------------------------- авторство карточки

export interface Authorship {
  /** Кто добавил человека на дерево. */
  created?: { who: string; when: string };
  /** Все, кто правил человека или его факты, связи, документы (без начального заполнения). */
  editors: string[];
  /** Последняя правка чего-либо в карточке. */
  last?: { who: string; when: string };
}

export const SEED_LABEL = 'перенесено при запуске';

export function formatDay(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Имя автора правки: текущая подпись участника, иначе подпись на момент правки; seed — «перенесено при запуске». */
export function actorName(e: Pick<EditRow, 'actor' | 'actor_label'>, names: Map<string, string>): string {
  if (e.actor_label === 'seed') return SEED_LABEL;
  if (e.actor && names.has(e.actor)) return names.get(e.actor)!;
  if (!e.actor_label || e.actor_label === 'system' || e.actor_label === 'unknown') return 'система';
  return e.actor_label;
}

/** Создал, редактировали, последний раз изменил — по истории человека (edits любого порядка). */
export function authorship(edits: EditRow[], personId: string, names: Map<string, string>): Authorship {
  const sorted = [...edits].sort((a, b) => a.id - b.id);
  const isCreate = (e: EditRow) => e.table_name === 'people' && e.row_id === personId && e.op === 'insert';
  const c = sorted.find(isCreate);
  const editors: string[] = [];
  for (const e of sorted) {
    if (isCreate(e) || e.actor_label === 'seed') continue;
    const who = actorName(e, names);
    if (!editors.includes(who)) editors.push(who);
  }
  const l = sorted[sorted.length - 1];
  return {
    created: c ? { who: actorName(c, names), when: formatDay(c.at) } : undefined,
    editors,
    last: l ? { who: actorName(l, names), when: formatDay(l.at) } : undefined,
  };
}
