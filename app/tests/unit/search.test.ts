import { describe, expect, it } from 'vitest';
import { findPersons, normalizeName } from '../../src/tree/search';
import { ivanovBig } from '../fixtures/ivanov-big';

describe('поиск родственника', () => {
  it('без учёта регистра и ё = е', () => {
    expect(normalizeName('  ФЁДОРОВ  s8 ')).toBe('федоров s8');
    expect(findPersons(ivanovBig.persons, 'федоров').map((p) => p.id)).toContain('s8-sp');
    expect(findPersons(ivanovBig.persons, 'ФЁДОРОВ').map((p) => p.id)).toContain('s8-sp');
  });
  it('все слова запроса, пустой запрос — пусто', () => {
    expect(findPersons(ivanovBig.persons, 'тихонова isl-b').map((p) => p.id)).toEqual(['isl-b']);
    expect(findPersons(ivanovBig.persons, '   ')).toEqual([]);
  });
});
