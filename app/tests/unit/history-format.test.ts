import { describe, expect, test } from 'vitest';
import { describeEdit } from '../../src/app/history-format';
import type { EditRow } from '../../src/lib/api';

const base: EditRow = { id: 7, at: '2026-10-18T11:05:00Z', actor: 'u1', actor_label: 'Ольга', table_name: 'people', row_id: 'p1', op: 'update', old: null, new: null, changed_fields: [], reverts_edit: null };

describe('describeEdit', () => {
  test('правка: поле, было → стало, автор; служебные поля дат не показываются', () => {
    const it = describeEdit({ ...base, old: { maiden_name: 'Петрова', birth_date_from: null }, new: { maiden_name: 'Петровская', birth_date_from: '1900-01-01' }, changed_fields: ['birth_date_from', 'maiden_name'] }, 'p1', () => undefined);
    expect(it).toMatchObject({ who: 'Ольга', title: 'Изменено', changes: [{ field: 'Девичья фамилия', old: 'Петрова', new: 'Петровская' }], revertable: true });
    expect(it.when).toMatch(/18 октября 2026, \d\d:05/);
  });
  test('правка только служебных полей — откатывать нечего', () => {
    expect(describeEdit({ ...base, changed_fields: ['birth_date_to'], old: {}, new: {} }, 'p1', () => undefined).revertable).toBe(false);
  });
  test('связь и факт — понятными словами; seed — «начальное заполнение»', () => {
    const rel = describeEdit({ ...base, actor_label: 'seed', table_name: 'relations', op: 'soft_delete', new: { kind: 'parent', from_person: 'p2', to_person: 'p1' } }, 'p1', (id) => (id === 'p2' ? 'Иванов Илья' : undefined));
    expect(rel).toMatchObject({ who: 'начальное заполнение', title: 'Убрана связь: родитель — Иванов Илья' });
    const fact = describeEdit({ ...base, table_name: 'facts', op: 'insert', new: { value: 'Пел в хоре' } }, 'p1', () => undefined);
    expect(fact.title).toBe('Добавлен факт: Пел в хоре');
    expect(describeEdit({ ...base, op: 'update', changed_fields: ['sex'], old: { sex: 'u' }, new: { sex: 'f' } }, 'p1', () => undefined).changes).toEqual([{ field: 'Пол', old: 'не указан', new: 'женский' }]);
  });
});
