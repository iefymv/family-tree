// Критерии spike раскладки (план, раздел 5) на вымышленной фикстуре Ивановых.
import { describe, expect, it } from 'vitest';
import { layoutTree, type LayoutEngine, type NodeRect, type TreeLayout } from '../../src/tree/layout';
import { ISLAND_IDS, ROOTS, UNKNOWN_PARENT_CHILD, ivanovBig } from '../fixtures/ivanov-big';
import { placeholderId } from '../../src/tree/graph';

const TIME_LIMIT_MS = 200;
// Основной движок и фолбэк по плану (раздел 5) проверяются одними и теми же критериями.
const ENGINES: LayoutEngine[] = ['relatives-tree', 'family-chart'];

function overlaps(a: NodeRect, b: NodeRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlappingPairs(layout: TreeLayout): [string, string][] {
  const out: [string, string][] = [];
  const n = layout.nodes;
  for (let i = 0; i < n.length; i++) {
    for (let j = i + 1; j < n.length; j++) {
      if (overlaps(n[i], n[j])) out.push([n[i].id, n[j].id]);
    }
  }
  return out;
}

/** Известные родители в раскладке: biological, adoptive, unknown (raised_by и step — оверлеи). */
const knownParents = new Map<string, string[]>();
for (const r of ivanovBig.relations) {
  if (r.kind !== 'parent' || r.type === 'raised_by' || r.type === 'step') continue;
  knownParents.set(r.childId, [...(knownParents.get(r.childId) ?? []), r.parentId]);
}

describe('фикстура ivanov-big', () => {
  it('около 120 узлов', () => {
    expect(ivanovBig.persons.length).toBeGreaterThanOrEqual(110);
    expect(ivanovBig.persons.length).toBeLessThanOrEqual(130);
  });
});

const CASES = ENGINES.flatMap((engine) => Object.entries(ROOTS).map(([label, rootId]) => [engine, label, rootId] as const));

describe.each(CASES)('%s, rootId = %s', (engine, _label, rootId) => {
  const t0 = performance.now();
  const layout = layoutTree(ivanovBig, rootId, { engine });
  const elapsed = performance.now() - t0;
  const ids = new Set(layout.nodes.map((n) => n.id));

  it(`время расчёта < ${TIME_LIMIT_MS} мс`, () => {
    console.info(`[${engine} / ${_label}] layout ${elapsed.toFixed(1)} ms, nodes ${layout.nodes.length}`);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
  });

  it('0 пересечений прямоугольников узлов', () => {
    expect(overlappingPairs(layout)).toEqual([]);
  });

  it('все узлы фикстуры присутствуют (в дереве или на островах), без дублей', () => {
    const missing = ivanovBig.persons.map((p) => p.id).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    expect(ids.size).toBe(layout.nodes.length);
  });

  it('остров вынесен отдельно, остальные — в основном дереве', () => {
    const comp = new Map(layout.nodes.map((n) => [n.id, n.component]));
    for (const id of ISLAND_IDS) expect(comp.get(id)).toBeGreaterThan(0);
    const wrong = ivanovBig.persons
      .filter((p) => !ISLAND_IDS.includes(p.id) && comp.get(p.id) !== 0)
      .map((p) => p.id);
    expect(wrong).toEqual([]);
  });

  it('у каждого уложенного ребёнка ребро к обоим известным родителям', () => {
    const edgeSet = new Set(layout.edges.map((e) => `${e.parentId}>${e.childId}`));
    const missingEdges: string[] = [];
    for (const [childId, parents] of knownParents) {
      if (!ids.has(childId)) continue; // отсутствие самого узла ловит тест «все узлы присутствуют»
      for (const p of parents) if (!edgeSet.has(`${p}>${childId}`)) missingEdges.push(`${p}>${childId}`);
    }
    expect(missingEdges).toEqual([]);
  });

  it('неизвестный родитель — placeholder с ребром к ребёнку', () => {
    const [known] = knownParents.get(UNKNOWN_PARENT_CHILD)!;
    const ph = placeholderId(known);
    expect(layout.nodes.find((n) => n.id === ph)?.placeholder).toBe(true);
    expect(layout.edges.some((e) => e.parentId === ph && e.childId === UNKNOWN_PARENT_CHILD)).toBe(true);
  });

  it('raised_by и step не в раскладке, а в оверлеях', () => {
    expect(layout.overlays.map((o) => o.type).sort()).toEqual(['raised_by', 'step']);
    const edgeSet = new Set(layout.edges.map((e) => `${e.parentId}>${e.childId}`));
    for (const o of layout.overlays) expect(edgeSet.has(`${o.fromId}>${o.toId}`)).toBe(false);
  });
});
