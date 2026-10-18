// Кем человек приходится вошедшему: «Отец», «Бабушка», «Двоюродный брат», «Жена брата»…
import type { FamilyData, Gender } from './graph';

type G = Gender;
const by = (g: G, m: string, f: string, u = `${m} / ${f}`) => (g === 'male' ? m : g === 'female' ? f : u);

function bloodLabel(up: number, down: number, g: G): string | null {
  if (up === 0 && down === 0) return 'Это вы';
  if (down === 0) {
    if (up === 1) return by(g, 'Отец', 'Мать', 'Родитель');
    if (up === 2) return by(g, 'Дедушка', 'Бабушка');
    return `${'Пра'.repeat(1)}${'пра'.repeat(up - 3)}${by(g, 'дедушка', 'бабушка')}`;
  }
  if (up === 0) {
    if (down === 1) return by(g, 'Сын', 'Дочь', 'Ребёнок');
    if (down === 2) return by(g, 'Внук', 'Внучка');
    return `Пра${'пра'.repeat(down - 3)}${by(g, 'внук', 'внучка')}`;
  }
  if (up === 1 && down === 1) return by(g, 'Брат', 'Сестра');
  if (down === 1) return up === 2 ? by(g, 'Дядя', 'Тётя') : `${by(g, 'Двоюродный дедушка', 'Двоюродная бабушка')}`;
  if (up === 1) return down === 2 ? by(g, 'Племянник', 'Племянница') : by(g, 'Внучатый племянник', 'Внучатая племянница');
  const degree = Math.min(up, down) - 1; // 1 — двоюродные, 2 — троюродные
  const prefix = degree === 1 ? by(g, 'Двоюродный', 'Двоюродная') : degree === 2 ? by(g, 'Троюродный', 'Троюродная') : by(g, 'Дальний', 'Дальняя');
  if (up === down) return `${prefix} ${by(g, 'брат', 'сестра')}`;
  if (up > down) return `${prefix} ${by(g, 'дядя', 'тётя')}`;
  return `${prefix} ${by(g, 'племянник', 'племянница')}`;
}

/** Карта «id → кем приходится» относительно rootId. Кого не удалось назвать — нет в карте. */
export function kinshipMap(family: FamilyData, rootId: string): Map<string, string> {
  const gender = new Map(family.persons.map((p) => [p.id, p.gender]));
  const parents = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  for (const r of family.relations) {
    if (r.kind === 'parent') {
      if (r.type === 'raised_by' || r.type === 'step') continue;
      parents.set(r.childId, [...(parents.get(r.childId) ?? []), r.parentId]);
    } else if (!r.divorced) {
      spouses.set(r.aId, [...(spouses.get(r.aId) ?? []), r.bId]);
      spouses.set(r.bId, [...(spouses.get(r.bId) ?? []), r.aId]);
    }
  }
  const children = new Map<string, string[]>();
  for (const [c, ps] of parents) for (const p of ps) children.set(p, [...(children.get(p) ?? []), c]);

  // Предки корня с числом шагов вверх.
  const upDist = new Map<string, number>([[rootId, 0]]);
  const q = [rootId];
  while (q.length) {
    const x = q.shift()!;
    for (const p of parents.get(x) ?? []) {
      if (!upDist.has(p)) {
        upDist.set(p, upDist.get(x)! + 1);
        q.push(p);
      }
    }
  }
  // От каждого предка вниз — кровные родственники с (up, down), берём ближайшее.
  const best = new Map<string, [number, number]>();
  for (const [anc, up] of upDist) {
    const dq: [string, number][] = [[anc, 0]];
    const seen = new Set([anc]);
    while (dq.length) {
      const [x, down] = dq.shift()!;
      const cur = best.get(x);
      if (!cur || up + down < cur[0] + cur[1]) best.set(x, [up, down]);
      for (const c of children.get(x) ?? []) if (!seen.has(c)) (seen.add(c), dq.push([c, down + 1]));
    }
  }
  const out = new Map<string, string>();
  for (const [id, [u, d]] of best) {
    const l = bloodLabel(u, d, gender.get(id) ?? 'unknown');
    if (l) out.set(id, l);
  }
  // Супруги.
  for (const p of family.persons) {
    if (out.has(p.id)) continue;
    const g = p.gender;
    for (const s of spouses.get(p.id) ?? []) {
      if (s === rootId) {
        out.set(p.id, by(g, 'Муж', 'Жена', 'Супруг(а)'));
        break;
      }
      const rel = best.get(s);
      if (!rel) continue;
      const [u, d] = rel;
      let l: string | null = null;
      if (u === 1 && d === 0) l = by(g, 'Отчим', 'Мачеха');
      else if (u === 0 && d === 1) l = by(g, 'Зять', 'Невестка');
      else if (u === 1 && d === 1) l = by(g, 'Зять', 'Невестка');
      else if (out.has(s)) l = by(g, 'Родственник по браку', 'Родственница по браку');
      if (l) {
        out.set(p.id, l);
        break;
      }
    }
  }
  // Родители супруга.
  for (const s of spouses.get(rootId) ?? []) {
    for (const p of parents.get(s) ?? []) {
      if (out.has(p)) continue;
      const g = gender.get(p) ?? 'unknown';
      const husband = gender.get(s) === 'male';
      out.set(p, husband ? by(g, 'Свёкор', 'Свекровь') : by(g, 'Тесть', 'Тёща'));
    }
  }
  return out;
}
