// Кем человек приходится вошедшему: «Отец», «Прабабушка», «Двоюродная тётя», «Внучатый племянник»,
// «Свекровь», «Шурин», «Отчим», «Воспитательница»… Всегда относительно одного человека — того, кто вошёл.
import type { FamilyData, Gender } from './graph';

type G = Gender;
const by = (g: G, m: string, f: string, u = `${m} / ${f}`) => (g === 'male' ? m : g === 'female' ? f : u);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «пра» × n перед словом: 0 — как есть, 1 — «прадедушка», 2 — «прапрадедушка». */
const pra = (n: number, word: string) => 'пра'.repeat(Math.max(0, n)) + word;

/** Степень родства по боковой линии: 0 — родной, 1 — двоюродный, 2 — троюродный, 3 — четвероюродный, дальше — дальний. */
function degreeWord(n: number, g: G): string {
  if (n <= 0) return '';
  const m = ['', 'двоюродный', 'троюродный', 'четвероюродный'][n] ?? 'дальний';
  const f = ['', 'двоюродная', 'троюродная', 'четвероюродная'][n] ?? 'дальняя';
  return `${by(g, m, f, m)} `;
}

/** Кровное родство: up — шагов вверх от вошедшего до общего предка, down — вниз от предка до человека. */
export function bloodLabel(up: number, down: number, g: G, opts: { half?: boolean; adopted?: boolean } = {}): string {
  if (up === 0 && down === 0) return 'Это вы';
  const adopt = opts.adopted ? `${by(g, 'приёмный', 'приёмная', 'приёмный')} ` : '';
  if (down === 0) {
    if (up === 1) return cap(adopt + by(g, 'отец', 'мать', 'родитель'));
    return cap(pra(up - 2, by(g, 'дедушка', 'бабушка')));
  }
  if (up === 0) {
    if (down === 1) return cap(adopt + by(g, 'сын', 'дочь', 'ребёнок'));
    return cap(pra(down - 2, by(g, 'внук', 'внучка')));
  }
  if (up === down) {
    if (up === 1) return cap(`${opts.half ? by(g, 'сводный ', 'сводная ', 'сводный ') : ''}${by(g, 'брат', 'сестра')}`);
    return cap(degreeWord(up - 1, g) + by(g, 'брат', 'сестра'));
  }
  if (up > down) {
    // Боковые старшие: дядя/тётя, двоюродный дедушка (брат деда), троюродный дядя…
    const gap = up - down;
    if (gap === 1) return cap(degreeWord(down - 1, g) + by(g, 'дядя', 'тётя'));
    return cap(degreeWord(down, g) + pra(gap - 2, by(g, 'дедушка', 'бабушка')));
  }
  // Боковые младшие: племянник, внучатый племянник, двоюродный племянник…
  const gap = down - up;
  const noun = gap === 1 ? by(g, 'племянник', 'племянница') : `${pra(gap - 2, by(g, 'внучатый', 'внучатая', 'внучатый'))} ${by(g, 'племянник', 'племянница')}`;
  return cap(degreeWord(up - 1, g) + noun);
}

interface Link {
  id: string;
  adoptive: boolean;
}
interface Graph {
  gender: Map<string, G>;
  /** Родители в раскладке (biological, adoptive, unknown). */
  parents: Map<string, Link[]>;
  children: Map<string, Link[]>;
  spouses: Map<string, { id: string; divorced: boolean }[]>;
}

function graphOf(family: FamilyData): Graph {
  const gender = new Map(family.persons.map((p) => [p.id, p.gender]));
  const parents = new Map<string, Link[]>();
  const children = new Map<string, Link[]>();
  const spouses = new Map<string, { id: string; divorced: boolean }[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const r of family.relations) {
    if (r.kind === 'parent') {
      if (r.type === 'raised_by' || r.type === 'step' || !gender.has(r.parentId) || !gender.has(r.childId)) continue;
      push(parents, r.childId, { id: r.parentId, adoptive: r.type === 'adoptive' });
      push(children, r.parentId, { id: r.childId, adoptive: r.type === 'adoptive' });
    } else if (gender.has(r.aId) && gender.has(r.bId)) {
      push(spouses, r.aId, { id: r.bId, divorced: !!r.divorced });
      push(spouses, r.bId, { id: r.aId, divorced: !!r.divorced });
    }
  }
  return { gender, parents, children, spouses };
}

/** Кровные родственники `from`: id → [вверх, вниз] по кратчайшему пути через общего предка. */
function bloodOf(gr: Graph, from: string): Map<string, [number, number]> {
  const up = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const x = q.shift()!;
    for (const p of gr.parents.get(x) ?? []) {
      if (!up.has(p.id)) {
        up.set(p.id, up.get(x)! + 1);
        q.push(p.id);
      }
    }
  }
  const best = new Map<string, [number, number]>();
  for (const [anc, u] of up) {
    const dq: [string, number][] = [[anc, 0]];
    const seen = new Set([anc]);
    while (dq.length) {
      const [x, d] = dq.shift()!;
      const cur = best.get(x);
      if (!cur || u + d < cur[0] + cur[1] || (u + d === cur[0] + cur[1] && u < cur[0])) best.set(x, [u, d]);
      for (const c of gr.children.get(x) ?? []) if (!seen.has(c.id)) (seen.add(c.id), dq.push([c.id, d + 1]));
    }
  }
  return best;
}

/** Карта «id → кем приходится» относительно rootId. Несвязанных с ним (острова) в карте нет. */
export function kinshipMap(family: FamilyData, rootId: string): Map<string, string> {
  const gr = graphOf(family);
  const out = new Map<string, string>();
  if (!gr.gender.has(rootId)) return out;
  const g = (id: string): G => gr.gender.get(id) ?? 'unknown';
  const rootG = g(rootId);
  const blood = bloodOf(gr, rootId);
  const parentIds = (id: string) => (gr.parents.get(id) ?? []).map((p) => p.id);

  // 1. Кровные (и приёмные — как кровные, с пометкой у прямых родителей/детей).
  for (const [id, [u, d]] of blood) {
    let half = false;
    let adopted = false;
    if (u === 1 && d === 1) {
      const a = parentIds(rootId);
      const b = parentIds(id);
      half = a.length === 2 && b.length === 2 && a.filter((x) => b.includes(x)).length === 1;
    }
    if (u === 1 && d === 0) adopted = !!gr.parents.get(rootId)?.find((p) => p.id === id)?.adoptive;
    if (u === 0 && d === 1) adopted = !!gr.children.get(rootId)?.find((c) => c.id === id)?.adoptive;
    out.set(id, bloodLabel(u, d, g(id), { half, adopted }));
  }

  // 2. Супруги вошедшего.
  const mySpouses = gr.spouses.get(rootId) ?? [];
  for (const s of mySpouses) {
    if (out.has(s.id)) continue;
    out.set(s.id, s.divorced ? by(g(s.id), 'Бывший муж', 'Бывшая жена', 'Бывший супруг') : by(g(s.id), 'Муж', 'Жена', 'Супруг(а)'));
  }

  // 3. Родня супруга: свёкор/свекровь, тесть/тёща, деверь/золовка, шурин/свояченица, пасынок/падчерица.
  for (const s of mySpouses) {
    if (s.divorced) continue;
    const husband = g(s.id) === 'male' || (g(s.id) === 'unknown' && rootG === 'female');
    for (const [id, [u, d]] of bloodOf(gr, s.id)) {
      if (out.has(id) || id === s.id) continue;
      const pg = g(id);
      let l: string;
      if (u === 1 && d === 0) l = husband ? by(pg, 'Свёкор', 'Свекровь') : by(pg, 'Тесть', 'Тёща');
      else if (u === 1 && d === 1) l = husband ? by(pg, 'Деверь', 'Золовка') : by(pg, 'Шурин', 'Свояченица');
      else if (u === 0 && d === 1) l = by(pg, 'Пасынок', 'Падчерица');
      else l = `${by(pg, 'Родственник', 'Родственница', 'Родственник')} ${husband ? 'мужа' : 'жены'}`;
      out.set(id, l);
    }
  }

  // 4. Супруги кровных родственников.
  const spouseLabel = (u: number, d: number, sg: G): string | null => {
    if (u === 1 && d === 0) return by(sg, 'Отчим', 'Мачеха');
    if (u === 0 && d === 1) return by(sg, 'Зять', 'Невестка');
    if (u === 1 && d === 1) return by(sg, 'Зять', 'Невестка');
    if (u === 0 && d === 2) return by(sg, 'Муж внучки', 'Жена внука');
    if (u === 2 && d === 1) return by(sg, 'Дядя', 'Тётя');
    if (u === 1 && d === 2) return by(sg, 'Муж племянницы', 'Жена племянника');
    if (u === 2 && d === 0) return by(sg, 'Неродной дедушка', 'Неродная бабушка');
    // Супруги старших по боковой линии зовутся так же: жена двоюродного деда — двоюродная бабушка.
    if (u > d && d >= 1) return bloodLabel(u, d, sg);
    if (u === d && u >= 2 && u <= 3) {
      const deg = u === 2 ? ['двоюродного', 'двоюродной'] : ['троюродного', 'троюродной'];
      return by(sg, `Муж ${deg[1]} сестры`, `Жена ${deg[0]} брата`);
    }
    return null;
  };
  // Бывшие супруги родителей.
  const exLabel = (u: number, d: number, sg: G): string | null => (u === 1 && d === 0 ? by(sg, 'Бывший муж матери', 'Бывшая жена отца') : null);
  for (const [id, [u, d]] of blood) {
    if (id === rootId) continue;
    for (const s of gr.spouses.get(id) ?? []) {
      if (out.has(s.id)) continue;
      const l = s.divorced ? exLabel(u, d, g(s.id)) : spouseLabel(u, d, g(s.id));
      if (l) out.set(s.id, l);
    }
  }

  // 5. Сваты: родители супругов моих детей.
  for (const c of gr.children.get(rootId) ?? []) {
    for (const s of gr.spouses.get(c.id) ?? []) {
      for (const p of parentIds(s.id)) if (!out.has(p)) out.set(p, by(g(p), 'Сват', 'Сватья'));
    }
  }

  // 6. «Воспитывал(а)» и отчим/мачеха из пометок поверх раскладки.
  for (const r of family.relations) {
    if (r.kind !== 'parent' || (r.type !== 'raised_by' && r.type !== 'step')) continue;
    if (!gr.gender.has(r.parentId) || !gr.gender.has(r.childId)) continue;
    const raised = r.type === 'raised_by';
    const [other, toRoot] = r.childId === rootId ? [r.parentId, true] : r.parentId === rootId ? [r.childId, false] : [null, false];
    if (!other) continue;
    const og = g(other);
    const noun = toRoot
      ? raised
        ? by(og, 'Воспитатель', 'Воспитательница')
        : by(og, 'Отчим', 'Мачеха')
      : raised
        ? by(og, 'Воспитанник', 'Воспитанница')
        : by(og, 'Пасынок', 'Падчерица');
    const prev = blood.has(other) ? out.get(other) : undefined;
    const verb = toRoot && raised ? by(og, 'воспитал', 'воспитала', 'воспитывал(а)') : noun.toLowerCase();
    out.set(other, prev ? `${prev} · ${verb}` : noun);
  }

  // 7. Остальные, связанные с вошедшим через браки и т. п., — «Родственник»; несвязанных не подписываем.
  const seen = new Set([rootId]);
  const q = [rootId];
  while (q.length) {
    const x = q.shift()!;
    const next = [...(gr.parents.get(x) ?? []), ...(gr.children.get(x) ?? []), ...(gr.spouses.get(x) ?? [])];
    for (const y of next) if (!seen.has(y.id)) (seen.add(y.id), q.push(y.id));
  }
  for (const id of seen) if (!out.has(id)) out.set(id, by(g(id), 'Родственник', 'Родственница', 'Родственник'));
  return out;
}
