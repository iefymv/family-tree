import { describe, expect, test } from 'vitest';
import { authorship, describeEdit } from '../../src/app/history-format';
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
    expect(rel).toMatchObject({ who: 'перенесено при запуске', title: 'Убрана связь: родитель — Иванов Илья' });
    const fact = describeEdit({ ...base, table_name: 'facts', op: 'insert', new: { value: 'Пел в хоре' } }, 'p1', () => undefined);
    expect(fact.title).toBe('Добавлен факт: Пел в хоре');
    expect(describeEdit({ ...base, op: 'update', changed_fields: ['sex'], old: { sex: 'u' }, new: { sex: 'f' } }, 'p1', () => undefined).changes).toEqual([{ field: 'Пол', old: 'не указан', new: 'женский' }]);
  });
});

describe('authorship', () => {
  const e = (id: number, over: Partial<EditRow>): EditRow => ({ ...base, id, at: `2026-10-${10 + id}T10:00:00Z`, ...over });
  test('создатель, все редакторы без начального заполнения, последний', () => {
    const edits = [
      e(1, { actor: null, actor_label: 'seed', op: 'insert' }),
      e(2, { actor: null, actor_label: 'seed', table_name: 'facts', row_id: 'f1', op: 'insert' }),
      e(5, { actor: 'u2', actor_label: 'Илья', op: 'revert' }),
      e(3, { actor: 'u1', actor_label: 'Оля', op: 'update' }),
      e(4, { actor: 'u1', actor_label: 'Оля', table_name: 'relations', row_id: 'r1', op: 'soft_delete' }),
    ];
    const a = authorship(edits, 'p1', new Map([['u1', 'Ольга']]));
    expect(a.created).toEqual({ who: 'перенесено при запуске', when: '11 октября 2026' });
    expect(a.editors).toEqual(['Ольга', 'Илья']); // текущая подпись участника важнее старой
    expect(a.last).toEqual({ who: 'Илья', when: '15 октября 2026' });
  });
  test('человек, добавленный участником; пустая история', () => {
    const a = authorship([e(1, { actor: 'u3', actor_label: 'Пётр', op: 'insert' })], 'p1', new Map());
    expect(a).toEqual({ created: { who: 'Пётр', when: '11 октября 2026' }, editors: [], last: { who: 'Пётр', when: '11 октября 2026' } });
    expect(authorship([], 'p1', new Map())).toEqual({ created: undefined, editors: [], last: undefined });
  });
});
