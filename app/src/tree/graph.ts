// Модель данных дерева и перевод её во вход библиотеки раскладки (relatives-tree).
// raised_by и step в раскладку не идут: они возвращаются отдельным списком оверлеев.
import type { Node as RtNode, Relation as RtRelation } from 'relatives-tree/lib/types';

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

export interface GraphComponent {
  rootId: string;
  nodes: RtNode[];
}

export interface TreeGraph {
  main: GraphComponent;
  islands: GraphComponent[];
  overlays: OverlayLink[];
  /** id placeholder-узлов «Неизвестно — добавить». */
  placeholderIds: Set<string>;
}

/** Типы родительских связей, которые участвуют в раскладке поколений. */
const LAYOUT_PARENT_TYPES: ReadonlySet<ParentType> = new Set(['biological', 'adoptive', 'unknown']);

export const placeholderId = (knownParentId: string): string => `unknown-parent:${knownParentId}`;

type RtGender = RtNode['gender'];
type RtRelType = RtRelation['type'];

interface Draft {
  id: string;
  gender: RtGender;
  placeholder: boolean;
  parents: Map<string, RtRelType>;
  children: Map<string, RtRelType>;
  spouses: Map<string, { type: RtRelType; order: number }>;
}

const toRtGender = (g: Gender, fallback: RtGender = 'male' as RtGender): RtGender =>
  g === 'unknown' ? fallback : (g as RtGender);

const opposite = (g: RtGender): RtGender => (g === 'male' ? 'female' : 'male') as RtGender;

export function buildGraph(data: FamilyData, rootId: string): TreeGraph {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  if (!byId.has(rootId)) throw new Error(`rootId ${rootId} не найден`);

  const drafts = new Map<string, Draft>();
  for (const p of data.persons) {
    drafts.set(p.id, {
      id: p.id,
      gender: toRtGender(p.gender),
      placeholder: false,
      parents: new Map(),
      children: new Map(),
      spouses: new Map(),
    });
  }

  const overlays: OverlayLink[] = [];
  const addSpouse = (a: string, b: string, type: RtRelType, order: number) => {
    drafts.get(a)!.spouses.set(b, { type, order });
    drafts.get(b)!.spouses.set(a, { type, order });
  };

  for (const r of data.relations) {
    if (r.kind === 'spouse') {
      if (!byId.has(r.aId) || !byId.has(r.bId)) continue; // ребро к отсутствующему — отбросить
      addSpouse(r.aId, r.bId, (r.divorced ? 'divorced' : 'married') as RtRelType, r.order);
      continue;
    }
    if (!byId.has(r.parentId) || !byId.has(r.childId)) continue;
    if (r.type === 'raised_by' || r.type === 'step') {
      overlays.push({ fromId: r.parentId, toId: r.childId, type: r.type });
      continue;
    }
    if (!LAYOUT_PARENT_TYPES.has(r.type)) continue;
    const t = (r.type === 'adoptive' ? 'adopted' : 'blood') as RtRelType;
    const child = drafts.get(r.childId)!;
    if (child.parents.size >= 2 && !child.parents.has(r.parentId)) {
      throw new Error(`У ${r.childId} больше двух родителей в раскладке`);
    }
    child.parents.set(r.parentId, t);
    drafts.get(r.parentId)!.children.set(r.childId, t);
  }

  // Неизвестный второй родитель: один placeholder на известного родителя,
  // общий для всех его детей с неизвестным вторым родителем.
  const placeholderIds = new Set<string>();
  for (const child of [...drafts.values()]) {
    if (child.placeholder || child.parents.size !== 1) continue;
    const [knownId, relType] = [...child.parents.entries()][0];
    const pid = placeholderId(knownId);
    let ph = drafts.get(pid);
    if (!ph) {
      const known = drafts.get(knownId)!;
      ph = {
        id: pid,
        gender: opposite(known.gender),
        placeholder: true,
        parents: new Map(),
        children: new Map(),
        spouses: new Map(),
      };
      drafts.set(pid, ph);
      placeholderIds.add(pid);
      const maxOrder = Math.max(0, ...[...known.spouses.values()].map((s) => s.order));
      addSpouse(knownId, pid, 'married' as RtRelType, maxOrder + 1);
    }
    child.parents.set(pid, relType);
    ph.children.set(child.id, relType);
  }

  // Компоненты связности по рёбрам раскладки (родитель–ребёнок, супруги).
  const compOf = new Map<string, number>();
  const components: string[][] = [];
  for (const id of drafts.keys()) {
    if (compOf.has(id)) continue;
    const idx = components.length;
    const members: string[] = [];
    const stack = [id];
    compOf.set(id, idx);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      const d = drafts.get(cur)!;
      for (const n of [...d.parents.keys(), ...d.children.keys(), ...d.spouses.keys()]) {
        if (!compOf.has(n)) {
          compOf.set(n, idx);
          stack.push(n);
        }
      }
    }
    components.push(members);
  }

  const toRtNode = (d: Draft): RtNode => {
    const parentIds = [...d.parents.keys()];
    const siblings = new Map<string, RtRelType>();
    for (const pid of parentIds) {
      for (const sib of drafts.get(pid)!.children.keys()) {
        if (sib === d.id || siblings.has(sib)) continue;
        const sibParents = drafts.get(sib)!.parents;
        const full = parentIds.length === sibParents.size && parentIds.every((p) => sibParents.has(p));
        siblings.set(sib, (full ? 'blood' : 'half') as RtRelType);
      }
    }
    const rel = (m: Map<string, RtRelType>): RtRelation[] => [...m].map(([id, type]) => ({ id, type }));
    return {
      id: d.id,
      gender: d.gender,
      parents: rel(d.parents),
      children: rel(d.children),
      siblings: rel(siblings),
      spouses: [...d.spouses]
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id, s]) => ({ id, type: s.type })),
      ...(d.placeholder ? { placeholder: true } : {}),
    };
  };

  const rootComp = compOf.get(rootId)!;
  const mkComponent = (members: string[], root: string): GraphComponent => ({
    rootId: root,
    nodes: members.map((id) => toRtNode(drafts.get(id)!)),
  });

  const islands = components
    .map((members, idx) => ({ members, idx }))
    .filter((c) => c.idx !== rootComp)
    .map(({ members }) => {
      // Корень острова — первый по порядку во входных данных не-placeholder.
      const order = new Map(data.persons.map((p, i) => [p.id, i]));
      const root = members
        .filter((id) => !placeholderIds.has(id))
        .sort((a, b) => order.get(a)! - order.get(b)!)[0];
      return mkComponent(members, root);
    });

  return {
    main: mkComponent(components[rootComp], rootId),
    islands,
    overlays,
    placeholderIds,
  };
}
