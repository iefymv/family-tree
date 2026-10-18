// Раскладка через relatives-tree: только координаты, отрисовка своя.
import calcTree from 'relatives-tree';
import { calculateTree as f3CalculateTree } from 'family-chart';
import type { Datum as F3Datum, TreeDatum as F3TreeDatum } from 'family-chart';
import type { RelData } from 'relatives-tree/lib/types';
import { buildGraph, type FamilyData, type GraphComponent, type OverlayLink } from './graph';

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  /** Вертикальный зазор между основным деревом и островами. */
  islandGap: number;
  /** Движок раскладки: основной relatives-tree или фолбэк family-chart (только расчёт). */
  engine: LayoutEngine;
}

export type LayoutEngine = 'relatives-tree' | 'family-chart';

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 160,
  nodeHeight: 96,
  gapX: 24,
  gapY: 64,
  islandGap: 120,
  engine: 'relatives-tree',
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
}

/** Ребро родитель → ребёнок, как его уложила библиотека (по семьям relatives-tree). */
export interface Edge {
  parentId: string;
  childId: string;
  component: number;
}

export interface TreeLayout {
  nodes: NodeRect[];
  edges: Edge[];
  /** Отрезки линий-соединителей в пикселях [x1, y1, x2, y2]. */
  connectors: [number, number, number, number][];
  overlays: OverlayLink[];
  width: number;
  height: number;
}

// relatives-tree считает в единицах сетки: узел занимает 2×2 единицы (SIZE = 2).
const UNIT = 2;

function edgesFromFamilies(data: RelData): Omit<Edge, 'component'>[] {
  const out: Omit<Edge, 'component'>[] = [];
  const seen = new Set<string>();
  const placed = new Set(data.nodes.map((n) => n.id));
  for (const fam of data.families) {
    // Родители, от которых библиотека реально ведёт линию к детям этой семьи:
    // узлы родительского блока, а у блока из одного узла — ещё и супруг spouses[0],
    // с которым его соединяет линия брака (так рисует relatives-tree при нескольких браках).
    const drawn = new Set<string>();
    for (const u of fam.parents) {
      for (const n of u.nodes) drawn.add(n.id);
      if (u.nodes.length === 1 && u.nodes[0].spouses.length) {
        const sp = u.nodes[0].spouses[0].id;
        if (placed.has(sp)) drawn.add(sp);
      }
    }
    for (const c of fam.children.flatMap((u) => u.nodes)) {
      for (const { id } of c.parents) {
        if (!drawn.has(id)) continue;
        const key = `${id}>${c.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ parentId: id, childId: c.id });
      }
    }
  }
  return out;
}

interface PlacedComponent {
  nodes: Omit<NodeRect, 'component'>[];
  edges: Omit<Edge, 'component'>[];
  connectors: TreeLayout['connectors'];
  width: number;
  height: number;
}

function placeRelativesTree(comp: GraphComponent, opts: LayoutOptions, placeholders: Set<string>): PlacedComponent {
  const cellW = (opts.nodeWidth + opts.gapX) / UNIT;
  const cellH = (opts.nodeHeight + opts.gapY) / UNIT;
  const data = calcTree(comp.nodes, { rootId: comp.rootId });
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      x: n.left * cellW + opts.gapX / 2, // карточка по центру своей клетки
      y: n.top * cellH + opts.gapY / 2,
      w: opts.nodeWidth,
      h: opts.nodeHeight,
      placeholder: placeholders.has(n.id),
    })),
    // Соединители заданы в той же сетке; центр узла — +1 единица.
    connectors: data.connectors.map(([x1, y1, x2, y2]) => [x1 * cellW, y1 * cellH, x2 * cellW, y2 * cellH]),
    edges: edgesFromFamilies(data),
    width: data.canvas.width * cellW,
    height: data.canvas.height * cellH,
  };
}

/** Фолбэк: координаты из family-chart (calculateTree, без DOM). Линии не считаем — только рёбра. */
function placeFamilyChart(comp: GraphComponent, opts: LayoutOptions, placeholders: Set<string>): PlacedComponent {
  const data: F3Datum[] = comp.nodes.map((n) => ({
    id: n.id,
    data: { gender: n.gender === 'female' ? 'F' : 'M' },
    rels: {
      parents: n.parents.map((r) => r.id),
      spouses: n.spouses.map((r) => r.id),
      children: n.children.map((r) => r.id),
    },
  }));
  const tree = f3CalculateTree(data, {
    main_id: comp.rootId,
    node_separation: opts.nodeWidth + opts.gapX,
    level_separation: opts.nodeHeight + opts.gapY,
    single_parent_empty_card: false, // placeholder'ы уже добавил graph.ts
    show_siblings_of_main: true,
  });
  const td = tree.data;
  const minX = Math.min(...td.map((d) => d.x)) - opts.nodeWidth / 2;
  const minY = Math.min(...td.map((d) => d.y)) - opts.nodeHeight / 2;
  const nodes = td.map((d) => ({
    id: d.data.id,
    x: d.x - opts.nodeWidth / 2 - minX,
    y: d.y - opts.nodeHeight / 2 - minY,
    w: opts.nodeWidth,
    h: opts.nodeHeight,
    placeholder: placeholders.has(d.data.id),
  }));
  // Рёбра: у предков — d.parents; у потомков — d3-родитель и его показанный супруг-сородитель.
  const edges: PlacedComponent['edges'] = [];
  const seen = new Set<string>();
  const add = (parentId: string, childId: string) => {
    const key = `${parentId}>${childId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ parentId, childId });
  };
  for (const d of td as F3TreeDatum[]) {
    const childParents = new Set(d.data.rels.parents);
    for (const p of d.parents ?? []) if (childParents.has(p.data.id)) add(p.data.id, d.data.id);
    if (d.parent && !d.is_ancestry && childParents.has(d.parent.data.id)) {
      add(d.parent.data.id, d.data.id);
      for (const sp of d.parent.spouses ?? []) if (childParents.has(sp.data.id)) add(sp.data.id, d.data.id);
    }
  }
  return {
    nodes,
    edges,
    connectors: [],
    width: Math.max(...nodes.map((n) => n.x + n.w)),
    height: Math.max(...nodes.map((n) => n.y + n.h)),
  };
}

export function layoutTree(
  family: FamilyData,
  rootId: string,
  options: Partial<LayoutOptions> = {},
): TreeLayout {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const graph = buildGraph(family, rootId);
  const placeComponent = opts.engine === 'family-chart' ? placeFamilyChart : placeRelativesTree;

  const out: TreeLayout = { nodes: [], edges: [], connectors: [], overlays: graph.overlays, width: 0, height: 0 };
  let offsetY = 0;
  [graph.main, ...graph.islands].forEach((comp, component) => {
    const placed = placeComponent(comp, opts, graph.placeholderIds);
    for (const n of placed.nodes) out.nodes.push({ ...n, y: n.y + offsetY, component });
    for (const e of placed.edges) out.edges.push({ ...e, component });
    for (const [x1, y1, x2, y2] of placed.connectors) out.connectors.push([x1, y1 + offsetY, x2, y2 + offsetY]);
    out.width = Math.max(out.width, placed.width);
    offsetY += placed.height + opts.islandGap;
  });
  out.height = Math.max(0, offsetY - opts.islandGap);
  return out;
}
