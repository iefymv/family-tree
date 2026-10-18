// Нетипичные графы: ребро через поколение (брак дяди и племянницы) и цикл (брак с собственным ребёнком).
import { describe, expect, it } from 'vitest';
import type { FamilyData, Relation } from '../../src/tree/graph';
import { layoutTree, type TreeLayout } from '../../src/tree/layout';

const P = (id: string) => ({ id, name: `Тестов ${id}`, gender: 'unknown' as const });
const parent = (parentId: string, childId: string): Relation => ({ kind: 'parent', parentId, childId, type: 'biological' });
const spouse = (aId: string, bId: string): Relation => ({ kind: 'spouse', aId, bId, order: 1 });

function noOverlaps(l: TreeLayout): boolean {
  return l.nodes.every((a, i) => l.nodes.every((b, j) => j <= i || !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)));
}

describe('раскладка на нетипичных графах', () => {
  it('брак через поколение: ребро идёт через фиктивные узлы, карточки не пересекаются', () => {
    // ga+gb → m, l; m+n → r; l женат на r (племяннице) → у ga+gb ребёнок l на два слоя ниже.
    const data: FamilyData = {
      persons: ['ga', 'gb', 'm', 'n', 'l', 'r', 'k'].map(P),
      relations: [spouse('ga', 'gb'), parent('ga', 'm'), parent('gb', 'm'), parent('ga', 'l'), parent('gb', 'l'), spouse('m', 'n'), parent('m', 'r'), parent('n', 'r'), spouse('l', 'r'), parent('l', 'k'), parent('r', 'k')],
    };
    const l = layoutTree(data, 'k');
    expect(l.nodes.length).toBe(7);
    expect(noOverlaps(l)).toBe(true);
    const e = l.edges.find((x) => x.parentId === 'ga' && x.childId === 'l')!;
    expect(e).toBeDefined();
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    expect(byId.get('l')!.layer - byId.get('ga')!.layer).toBe(2);
    expect(e.path.length).toBeGreaterThan(4);
  });

  it('цикл в данных (брак с собственным ребёнком) не роняет раскладку', () => {
    const data: FamilyData = {
      persons: ['a', 'b', 'c'].map(P),
      relations: [spouse('a', 'b'), parent('a', 'c'), parent('b', 'c'), spouse('a', 'c')],
    };
    const l = layoutTree(data, 'a');
    expect(l.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(noOverlaps(l)).toBe(true);
    expect(l.edges.filter((e) => e.childId === 'c').map((e) => e.parentId).sort()).toEqual(['a', 'b']);
  });
});
