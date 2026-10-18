// Поиск родственника по имени на клиенте: без учёта регистра, «ё» = «е».
import type { Person } from './graph';

export const normalizeName = (s: string): string => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Люди, у которых в имени есть все слова запроса; сначала те, у кого имя начинается с запроса. */
export function findPersons(persons: Person[], query: string, limit = 8): Person[] {
  const q = normalizeName(query);
  if (!q) return [];
  const words = q.split(' ');
  return persons
    .map((p) => ({ p, n: normalizeName(p.name) }))
    .filter(({ n }) => words.every((w) => n.includes(w)))
    .sort((a, b) => Number(!a.n.startsWith(q)) - Number(!b.n.startsWith(q)) || a.n.localeCompare(b.n, 'ru'))
    .slice(0, limit)
    .map(({ p }) => p);
}
