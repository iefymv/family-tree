// Раскладка полного графа семьи: поколения — слои, браки — союзы внутри «семейных блоков».
// Блок — люди, связанные браками (человек со всеми супругами), он идёт в d3-dag как один
// широкий узел, поэтому супруги всегда стоят рядом. Дети цепляются к точке своего союза.
// d3-dag (Sugiyama) даёт слои, порядок блоков в слое и координаты; порядок людей внутри
// блока и линии считаем сами. Корень пользователя на раскладку не влияет — только на фокус.
import {
  coordSimplex,
  decrossTwoLayer,
  graph as dagGraph,
  layeringSimplex,
  sugiyama,
  type MutGraphLink,
  type MutGraphNode,
} from 'd3-dag';
import { buildGraph, unionId, type FamilyData, type OverlayLink, type TreeGraph, type Union } from './graph';

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  /** Зазор между соседними блоками в слое. */
  gapX: number;
  /** Зазор между супругами внутри блока. */
  spouseGap: number;
  /** Зазор между слоями (поколениями), в нём идут линии к детям. */
  gapY: number;
  /** Вертикальный зазор между основным деревом и островами. */
  islandGap: number;
  engine: LayoutEngine;
}

/** Движок раскладки. relatives-tree и family-chart отклонены в spike (не показывают весь граф). */
export type LayoutEngine = 'd3-dag';

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 168,
  nodeHeight: 84,
  gapX: 40,
  spouseGap: 28,
  gapY: 96,
  islandGap: 160,
  engine: 'd3-dag',
};

export interface NodeRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  placeholder: boolean;
  /** 0 — основное дерево, 1..n — номер острова. */
  component: number;
  /** Номер слоя (поколения) внутри своей компоненты, сверху вниз от 0. */
  layer: number;
}

/** Ребро родитель → ребёнок (через союз), с полилинией от точки союза до верха карточки ребёнка. */
export interface Edge {
  parentId: string;
  childId: string;
  unionId: string;
  component: number;
  adopted: boolean;
  path: [number, number][];
}

/** Точка союза и линия брака между супругами. */
export interface UnionMark {
  id: string;
  a: string;
  b: string;
  divorced: boolean;
  placeholder: boolean;
  /** Точка, из которой идёт линия к детям. */
  x: number;
  y: number;
  /** Линия брака [x1, y, x2, y]. */
  line: [number, number, number, number];
  component: number;
}

export interface TreeLayout {
  nodes: NodeRect[];
  edges: Edge[];
  unions: UnionMark[];
  overlays: OverlayLink[];
  width: number;
  height: number;
  /** Центр карточки корня (вошедшего человека) — для центрирования и подсветки. */
  focus: { id: string; x: number; y: number } | null;
  /** Число пересечений линий родитель → ребёнок разных союзов. */
  crossings: number;
}

interface Block {
  members: string[];
  unions: Union[];
  x: number; // центр
  y: number; // центр
  layer: number;
}

interface LinkData {
  unionId: string;
  childId: string;
}

interface Placed {
  nodes: Omit<NodeRect, 'component'>[];
  edges: Omit<Edge, 'component'>[];
  unions: Omit<UnionMark, 'component'>[];
}

const blockWidth = (b: Block, o: LayoutOptions) => b.members.length * o.nodeWidth + (b.members.length - 1) * o.spouseGap;

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items.slice();
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

function placeComponent(memberIds: string[], g: TreeGraph, o: LayoutOptions): Placed {
  const inComp = new Set(memberIds);
  const unions = g.unions.filter((u) => inComp.has(u.a));
  const unionById = new Map(unions.map((u) => [u.id, u]));

  // 1. Семейные блоки: компоненты связности по бракам/союзам.
  const uf = new Map<string, string>(memberIds.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (uf.get(r) !== r) r = uf.get(r)!;
    uf.set(x, r);
    return r;
  };
  for (const u of unions) uf.set(find(u.a), find(u.b));
  const blocksByRoot = new Map<string, Block>();
  const blockOf = new Map<string, Block>();
  for (const id of memberIds) {
    const r = find(id);
    let b = blocksByRoot.get(r);
    if (!b) {
      b = { members: [], unions: [], x: 0, y: 0, layer: 0 };
      blocksByRoot.set(r, b);
    }
    b.members.push(id);
    blockOf.set(id, b);
  }
  for (const u of unions) blockOf.get(u.a)!.unions.push(u);
  const blocks = [...blocksByRoot.values()];

  // 2. Граф блоков для d3-dag. Ребро на каждую пару (союз, ребёнок); рёбра, замыкающие цикл
  //    (брак с собственным потомком и т. п.), в раскладку не идут, но рисуются.
  const childLinks: { from: Block; to: Block; data: LinkData }[] = [];
  for (const u of unions) {
    for (const c of u.children) childLinks.push({ from: blockOf.get(u.a)!, to: blockOf.get(c)!, data: { unionId: u.id, childId: c } });
  }
  const out = new Map<Block, Block[]>(blocks.map((b) => [b, []]));
  for (const l of childLinks) if (l.from !== l.to) out.get(l.from)!.push(l.to);
  const state = new Map<Block, number>(); // 1 — в стеке, 2 — готов
  const backEdges = new Set<string>();
  const key = (a: Block, b: Block) => `${blocks.indexOf(a)}>${blocks.indexOf(b)}`;
  for (const start of blocks) {
    if (state.has(start)) continue;
    const stack: [Block, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = out.get(top[0])![top[1]++];
      if (!next) {
        state.set(top[0], 2);
        stack.pop();
      } else if (state.get(next) === 1) backEdges.add(key(top[0], next));
      else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }

  const dg = dagGraph<Block, LinkData>();
  const dn = new Map<Block, MutGraphNode<Block, LinkData>>(blocks.map((b) => [b, dg.node(b)]));
  const linkOf = new Map<string, MutGraphLink<Block, LinkData>>();
  for (const l of childLinks) {
    if (l.from === l.to || backEdges.has(key(l.from, l.to))) continue;
    linkOf.set(`${l.data.unionId}>${l.data.childId}`, dg.link(dn.get(l.from)!, dn.get(l.to)!, l.data));
  }

  const layout = sugiyama()
    .layering(layeringSimplex())
    .decross(decrossTwoLayer())
    .coord(coordSimplex())
    .nodeSize((n: { data: Block }) => [blockWidth(n.data, o), o.nodeHeight] as const)
    .gap([o.gapX, o.gapY]);
  layout(dg);

  const ys = [...new Set([...dn.values()].map((n) => n.y))].sort((a, b) => a - b);
  for (const [b, n] of dn) {
    b.x = n.x;
    b.y = n.y;
    b.layer = ys.indexOf(n.y);
  }

  // 3. Порядок людей внутри блока: супруги рядом, затем — ближе к своим родителям и детям.
  const order = new Map<Block, string[]>(blocks.map((b) => [b, b.members.slice()]));
  const slotStep = o.nodeWidth + o.spouseGap;
  const personX = (id: string, ord = order.get(blockOf.get(id)!)!): number => {
    const b = blockOf.get(id)!;
    return b.x - blockWidth(b, o) / 2 + ord.indexOf(id) * slotStep + o.nodeWidth / 2;
  };
  const unionX = (u: Union, ord?: string[]): number => {
    const ordU = ord ?? order.get(blockOf.get(u.a)!)!;
    const ia = ordU.indexOf(u.a);
    const ib = ordU.indexOf(u.b);
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    const left = blockOf.get(u.a)!.x - blockWidth(blockOf.get(u.a)!, o) / 2;
    if (hi - lo === 1) return left + hi * slotStep - o.spouseGap / 2;
    // Супруги не рядом: точка союза — в зазоре у «внешнего» супруга (у кого меньше браков).
    const degree = (id: string) => blockOf.get(id)!.unions.filter((x) => x.a === id || x.b === id).length;
    const outer = degree(ordU[lo]) < degree(ordU[hi]) ? lo : hi;
    return outer === lo ? left + (lo + 1) * slotStep - o.spouseGap / 2 : left + hi * slotStep - o.spouseGap / 2;
  };
  const costOf = (b: Block, ord: string[]): number => {
    let cost = 0;
    for (const u of b.unions) cost += 1e6 * (Math.abs(ord.indexOf(u.a) - ord.indexOf(u.b)) - 1);
    for (const id of b.members) {
      const p = g.persons.get(id)!;
      if (p.parents.length !== 2 || !inComp.has(p.parents[0])) continue;
      const pu = unionById.get(unionId(p.parents[0], p.parents[1]));
      if (pu && blockOf.get(pu.a) !== b) cost += Math.abs(personX(id, ord) - unionX(pu));
    }
    for (const u of b.unions) {
      const ux = unionX(u, ord);
      for (const c of u.children) if (blockOf.get(c) !== b) cost += Math.abs(ux - personX(c));
    }
    return cost;
  };
  const byLayer = blocks.slice().sort((a, b) => a.layer - b.layer || a.x - b.x);
  for (let sweep = 0; sweep < 4; sweep++) {
    const seq = sweep % 2 === 0 ? byLayer : byLayer.slice().reverse();
    for (const b of seq) {
      if (b.members.length < 2 || b.members.length > 6) continue;
      let best = order.get(b)!;
      let bestCost = costOf(b, best);
      for (const p of permutations(b.members)) {
        const c = costOf(b, p);
        if (c < bestCost - 1e-6) {
          best = p;
          bestCost = c;
        }
      }
      order.set(b, best);
    }
  }

  // 4. Карточки.
  const nodes: Placed['nodes'] = memberIds.map((id) => {
    const b = blockOf.get(id)!;
    return {
      id,
      x: personX(id) - o.nodeWidth / 2,
      y: b.y - o.nodeHeight / 2,
      w: o.nodeWidth,
      h: o.nodeHeight,
      placeholder: g.placeholderIds.has(id),
      layer: b.layer,
    };
  });

  // 5. Союзы и линии брака. Если супруги не рядом, линия ниже и проходит за карточками между ними.
  const marks: Placed['unions'] = unions.map((u) => {
    const b = blockOf.get(u.a)!;
    const ord = order.get(b)!;
    const dist = Math.abs(ord.indexOf(u.a) - ord.indexOf(u.b));
    const y = b.y + (dist > 1 ? Math.min(o.nodeHeight / 2 - 8, 14 * (dist - 1)) : 0);
    const xa = personX(u.a);
    const xb = personX(u.b);
    const [l, r] = xa < xb ? [xa, xb] : [xb, xa];
    return {
      id: u.id,
      a: u.a,
      b: u.b,
      divorced: u.divorced,
      placeholder: g.placeholderIds.has(u.a) || g.placeholderIds.has(u.b),
      x: unionX(u),
      y,
      line: [l + o.nodeWidth / 2, y, r - o.nodeWidth / 2, y],
    };
  });
  const markById = new Map(marks.map((m) => [m.id, m]));

  // 6. Линии к детям. В зазоре между слоями у каждого союза своя «шина»; шины, которые
  //    перекрываются по x, разводятся по высоте.
  const busY = new Map<string, number>();
  const unionsByLayer = new Map<number, Union[]>();
  for (const u of unions) {
    if (!u.children.length) continue;
    const l = blockOf.get(u.a)!.layer;
    unionsByLayer.set(l, [...(unionsByLayer.get(l) ?? []), u]);
  }
  for (const [layer, list] of unionsByLayer) {
    const spans = list
      .map((u) => {
        const xs = [markById.get(u.id)!.x, ...u.children.map((c) => personX(c))];
        return { u, lo: Math.min(...xs), hi: Math.max(...xs) };
      })
      .sort((a, b) => a.lo - b.lo);
    const slotEnds: number[] = [];
    const slotOf = new Map<Union, number>();
    for (const s of spans) {
      let k = slotEnds.findIndex((end) => end < s.lo - 12);
      if (k < 0) k = slotEnds.length;
      slotEnds[k] = s.hi;
      slotOf.set(s.u, k);
    }
    const bottom = ys[layer] + o.nodeHeight / 2;
    for (const s of spans) busY.set(s.u.id, bottom + (o.gapY * (slotOf.get(s.u)! + 1)) / (slotEnds.length + 1));
  }

  const edges: Placed['edges'] = [];
  for (const u of unions) {
    const m = markById.get(u.id)!;
    for (const c of u.children) {
      const cb = blockOf.get(c)!;
      const cx = personX(c);
      const childTop = cb.y - o.nodeHeight / 2;
      const by = busY.get(u.id)!;
      const link = linkOf.get(`${u.id}>${c}`);
      let path: [number, number][];
      if (link && cb.layer === blockOf.get(u.a)!.layer + 1) {
        path = [[m.x, m.y], [m.x, by], [cx, by], [cx, childTop]];
      } else if (link) {
        // Через несколько поколений: по фиктивным узлам d3-dag (они держат место в слоях).
        const dummies = link.points.slice(1, -1);
        path = [[m.x, m.y], [m.x, by]];
        for (const [dx, dy] of dummies) path.push([dx, path[path.length - 1][1]], [dx, dy]);
        path.push([cx, childTop - o.gapY / 2], [cx, childTop]);
      } else {
        path = [[m.x, m.y], [cx, childTop]]; // ребро вне раскладки (цикл)
      }
      const adopted = g.persons.get(c)!.adopted;
      for (const parentId of [u.a, u.b]) edges.push({ parentId, childId: c, unionId: u.id, adopted, path });
    }
  }
  return { nodes, edges, unions: marks };
}

type Seg = [number, number, number, number];

function segmentsCross([ax, ay, bx, by]: Seg, [cx, cy, dx, dy]: Seg): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0; // только собственные пересечения, касания не в счёт
}

/** Пересечения линий к детям между разными союзами. */
export function countCrossings(edges: Pick<Edge, 'unionId' | 'path' | 'component'>[]): number {
  const segsByUnion = new Map<string, Seg[]>();
  const seen = new Set<string>();
  for (const e of edges) {
    const uid = `${e.component}|${e.unionId}`;
    const list = segsByUnion.get(uid) ?? [];
    segsByUnion.set(uid, list);
    for (let i = 1; i < e.path.length; i++) {
      const s: Seg = [...e.path[i - 1], ...e.path[i]];
      if (s[0] === s[2] && s[1] === s[3]) continue;
      const k = `${uid}|${s.join(',')}`;
      if (seen.has(k)) continue;
      seen.add(k);
      list.push(s);
    }
  }
  const groups = [...segsByUnion.values()];
  let n = 0;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      for (const s of groups[i]) for (const t of groups[j]) if (segmentsCross(s, t)) n++;
    }
  }
  return n;
}

export function layoutTree(family: FamilyData, rootId?: string, options: Partial<LayoutOptions> = {}): TreeLayout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const g = buildGraph(family);
  if (rootId !== undefined && !g.persons.has(rootId)) throw new Error(`rootId ${rootId} не найден`);

  const res: TreeLayout = {
    nodes: [],
    edges: [],
    unions: [],
    overlays: g.overlays,
    width: 0,
    height: 0,
    focus: null,
    crossings: 0,
  };
  let offsetY = 0;
  g.components.forEach((members, component) => {
    const p = placeComponent(members, g, o);
    // Нормализуем компоненту к (0, offsetY).
    const minX = Math.min(...p.nodes.map((n) => n.x));
    const minY = Math.min(...p.nodes.map((n) => n.y));
    const dx = -minX;
    const dy = offsetY - minY;
    const mv = ([x, y]: [number, number]): [number, number] => [x + dx, y + dy];
    let maxX = 0;
    let maxY = offsetY;
    for (const n of p.nodes) {
      const r = { ...n, x: n.x + dx, y: n.y + dy, component };
      res.nodes.push(r);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    for (const e of p.edges) res.edges.push({ ...e, path: e.path.map(mv), component });
    for (const u of p.unions) {
      const [x1, y1, x2, y2] = u.line;
      res.unions.push({ ...u, x: u.x + dx, y: u.y + dy, line: [x1 + dx, y1 + dy, x2 + dx, y2 + dy], component });
    }
    res.width = Math.max(res.width, maxX);
    offsetY = maxY + o.islandGap;
  });
  res.height = Math.max(0, offsetY - o.islandGap);
  res.crossings = countCrossings(res.edges);
  if (rootId !== undefined) {
    const r = res.nodes.find((n) => n.id === rootId)!;
    res.focus = { id: rootId, x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  return res;
}
