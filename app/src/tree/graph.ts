// Модель данных дерева и перевод её в граф для раскладки: люди, союзы (браки), компоненты.
// raised_by и step в раскладку не идут: они возвращаются отдельным списком оверлеев.

export type Gender = 'male' | 'female' | 'unknown';

export interface Person {
  id: string;
  name: string;
  gender: Gender;
}

export type ParentType = 'biological' | 'adoptive' | 'raised_by' | 'step' | 'unknown';

export interface ParentRelation {
  kind: 'parent';
  parentId: string;
  childId: string;
  type: ParentType;
}

export interface SpouseRelation {
  kind: 'spouse';
  aId: string;
  bId: string;
  /** Порядковый номер брака (1, 2, 3…) — задаёт порядок супругов в раскладке. */
  order: number;
  divorced?: boolean;
}

export type Relation = ParentRelation | SpouseRelation;

export interface FamilyData {
  persons: Person[];
  relations: Relation[];
}

/** Связь, которая рисуется поверх раскладки пунктиром («воспитывала», отчим/мачеха). */
export interface OverlayLink {
  fromId: string; // воспитатель / отчим
  toId: string; // ребёнок
  type: 'raised_by' | 'step';
}

/** Человек в графе раскладки (включая placeholder «Неизвестно»). */
export interface GraphPerson {
  id: string;
  gender: Gender;
  placeholder: boolean;
  /** Родители, участвующие в раскладке (biological, adoptive, unknown): 0 или ровно 2 (с placeholder). */
  parents: string[];
  adopted: boolean;
}

/** Союз двух людей: брак из данных или неявная пара общих родителей. Дети висят на союзе. */
export interface Union {
  id: string;
  a: string;
  b: string;
  order: number;
  divorced: boolean;
  children: string[];
}

export interface TreeGraph {
  persons: Map<string, GraphPerson>;
  unions: Union[];
  /** Компоненты связности; [0] — основное дерево (самая большая), остальные — острова. */
  components: string[][];
  overlays: OverlayLink[];
  /** id placeholder-узлов «Неизвестно — добавить». */
  placeholderIds: Set<string>;
}

/** Типы родительских связей, которые участвуют в раскладке поколений. */
const LAYOUT_PARENT_TYPES: ReadonlySet<ParentType> = new Set(['biological', 'adoptive', 'unknown']);

export const placeholderId = (knownParentId: string): string => `unknown-parent:${knownParentId}`;
export const unionId = (a: string, b: string): string => (a < b ? `u:${a}+${b}` : `u:${b}+${a}`);

const opposite = (g: Gender): Gender => (g === 'male' ? 'female' : g === 'female' ? 'male' : 'unknown');

export function buildGraph(data: FamilyData): TreeGraph {
  const persons = new Map<string, GraphPerson>();
  for (const p of data.persons) {
    persons.set(p.id, { id: p.id, gender: p.gender, placeholder: false, parents: [], adopted: false });
  }

  const unions = new Map<string, Union>();
  const ensureUnion = (a: string, b: string, order: number, divorced = false): Union => {
    const id = unionId(a, b);
    let u = unions.get(id);
    if (!u) {
      u = { id, a, b, order, divorced, children: [] };
      unions.set(id, u);
    }
    return u;
  };
  const maxOrder = (pid: string): number =>
    Math.max(0, ...[...unions.values()].filter((u) => u.a === pid || u.b === pid).map((u) => u.order));

  const overlays: OverlayLink[] = [];
  for (const r of data.relations) {
    if (r.kind === 'spouse') {
      if (!persons.has(r.aId) || !persons.has(r.bId) || r.aId === r.bId) continue; // ребро к отсутствующему — отбросить
      const u = ensureUnion(r.aId, r.bId, r.order, !!r.divorced);
      u.order = r.order;
      u.divorced = !!r.divorced;
      continue;
    }
    if (!persons.has(r.parentId) || !persons.has(r.childId) || r.parentId === r.childId) continue;
    if (r.type === 'raised_by' || r.type === 'step') {
      overlays.push({ fromId: r.parentId, toId: r.childId, type: r.type });
      continue;
    }
    if (!LAYOUT_PARENT_TYPES.has(r.type)) continue;
    const child = persons.get(r.childId)!;
    if (child.parents.includes(r.parentId)) continue;
    if (child.parents.length >= 2) throw new Error(`У ${r.childId} больше двух родителей в раскладке`);
    child.parents.push(r.parentId);
    if (r.type === 'adoptive') child.adopted = true;
  }

  // Дети — на союз своих двух родителей. Один известный родитель — placeholder-супруг,
  // общий для всех его детей с неизвестным вторым родителем.
  const placeholderIds = new Set<string>();
  for (const child of [...persons.values()]) {
    if (child.parents.length === 0) continue;
    if (child.parents.length === 1) {
      const known = child.parents[0];
      const pid = placeholderId(known);
      if (!persons.has(pid)) {
        persons.set(pid, {
          id: pid,
          gender: opposite(persons.get(known)!.gender),
          placeholder: true,
          parents: [],
          adopted: false,
        });
        placeholderIds.add(pid);
        ensureUnion(known, pid, maxOrder(known) + 1);
      }
      child.parents.push(pid);
    }
    const [a, b] = child.parents;
    ensureUnion(a, b, unions.has(unionId(a, b)) ? 0 : maxOrder(a) + 1).children.push(child.id);
  }

  // Компоненты связности по рёбрам раскладки (родитель–ребёнок, союзы).
  const adj = new Map<string, string[]>([...persons.keys()].map((id) => [id, []]));
  const link = (x: string, y: string) => {
    adj.get(x)!.push(y);
    adj.get(y)!.push(x);
  };
  for (const u of unions.values()) {
    link(u.a, u.b);
    for (const c of u.children) link(u.a, c);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of persons.keys()) {
    if (seen.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const n of adj.get(cur)!) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    components.push(members);
  }
  // Основное дерево — самая большая компонента; корень пользователя на это не влияет.
  components.sort((x, y) => y.length - x.length);

  return { persons, unions: [...unions.values()], components, overlays, placeholderIds };
}
