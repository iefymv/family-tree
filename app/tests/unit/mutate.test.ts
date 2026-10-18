// Добавление родственников в памяти: связи, раскладка без наложений, «Неизвестно».
import { describe, expect, it } from 'vitest';
import { addRelative, canAdd, fillUnknownParent, layoutParents } from '../../src/tree/mutate';
import { layoutTree, type NodeRect } from '../../src/tree/layout';
import { NODE_LAYOUT } from '../../src/tree/render';
import { kinshipMap } from '../../src/tree/kinship';
import { buildDemoProfiles, fullName, patronymicFrom } from '../../src/demo/profiles';
import { placeholderId } from '../../src/tree/graph';
import { GRANDCHILD, UNKNOWN_PARENT_CHILD, ivanovBig } from '../fixtures/ivanov-big';

const overlaps = (a: NodeRect, b: NodeRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlaps = (nodes: NodeRect[]) => {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (overlaps(nodes[i], nodes[j])) return [nodes[i].id, nodes[j].id];
  return null;
};
const person = (id: string, gender: 'male' | 'female' = 'female') => ({ id, gender, name: `Иванова ${id}` });

describe('раскладка с размерами узлов приложения', () => {
  it('все узлы на месте и без наложений', () => {
    const l = layoutTree(ivanovBig, GRANDCHILD, NODE_LAYOUT);
    expect(l.nodes.filter((n) => !n.placeholder).length).toBe(ivanovBig.persons.length);
    expect(noOverlaps(l.nodes)).toBeNull();
  });
});

describe('addRelative', () => {
  it('ребёнок получает обоих родителей: человека и его текущего супруга', () => {
    const f = addRelative(ivanovBig, GRANDCHILD, 'child', person('n1'));
    expect(layoutParents(f, 'n1').sort()).toEqual([GRANDCHILD, `${GRANDCHILD}-sp`].sort());
    expect(ivanovBig.persons.some((p) => p.id === 'n1')).toBe(false); // исходные данные не тронуты
    const l = layoutTree(f, GRANDCHILD, NODE_LAYOUT);
    expect(l.nodes.some((n) => n.id === 'n1')).toBe(true);
    expect(noOverlaps(l.nodes)).toBeNull();
  });

  it('супруг — новый брак со следующим номером', () => {
    const f = addRelative(ivanovBig, 's1', 'spouse', person('n2'));
    const m = f.relations.find((r) => r.kind === 'spouse' && r.bId === 'n2');
    expect(m && m.kind === 'spouse' && m.order).toBe(4);
    expect(noOverlaps(layoutTree(f, GRANDCHILD, NODE_LAYOUT).nodes)).toBeNull();
  });

  it('родитель: первый — один, второй — женится на первом; третьего нельзя', () => {
    const base = addRelative(ivanovBig, 'gfbro-w', 'spouse', person('x', 'male')); // произвольная опора
    expect(canAdd(base, 'gfbro-w').parent).toBe(true);
    const f1 = addRelative(base, 'gfbro-w', 'parent', person('p1', 'male'));
    expect(layoutParents(f1, 'gfbro-w')).toEqual(['p1']);
    const f2 = addRelative(f1, 'gfbro-w', 'parent', person('p2', 'female'));
    expect(layoutParents(f2, 'gfbro-w').sort()).toEqual(['p1', 'p2']);
    expect(f2.relations.some((r) => r.kind === 'spouse' && r.aId === 'p1' && r.bId === 'p2')).toBe(true);
    expect(canAdd(f2, 'gfbro-w').parent).toBe(false);
    expect(() => addRelative(f2, 'gfbro-w', 'parent', person('p3'))).toThrow();
    expect(noOverlaps(layoutTree(f2, GRANDCHILD, NODE_LAYOUT).nodes)).toBeNull();
  });

  it('брат или сестра — те же родители; без родителей нельзя', () => {
    const f = addRelative(ivanovBig, GRANDCHILD, 'sibling', person('n3'));
    expect(layoutParents(f, 'n3').sort()).toEqual(layoutParents(ivanovBig, GRANDCHILD).sort());
    expect(canAdd(ivanovBig, 'ggf').sibling).toBe(false);
    expect(() => addRelative(ivanovBig, 'ggf', 'sibling', person('n4'))).toThrow();
  });

  it('«Неизвестно» заполняется: второй родитель у детей с одним известным', () => {
    const known = 's3-c2';
    expect(layoutTree(ivanovBig, GRANDCHILD).nodes.some((n) => n.id === placeholderId(known))).toBe(true);
    const f = fillUnknownParent(ivanovBig, known, person('n5', 'female'));
    expect(layoutParents(f, UNKNOWN_PARENT_CHILD).sort()).toEqual([known, 'n5'].sort());
    const l = layoutTree(f, GRANDCHILD, NODE_LAYOUT);
    expect(l.nodes.some((n) => n.id === placeholderId(known))).toBe(false);
    expect(noOverlaps(l.nodes)).toBeNull();
  });
});

describe('кем приходится и анкеты', () => {
  const kin = kinshipMap(ivanovBig, GRANDCHILD);
  it('основные родственные связи', () => {
    expect(kin.get(GRANDCHILD)).toBe('Это вы');
    expect(kin.get('s1')).toBe('Отец');
    expect(kin.get('s1-sp')).toBe('Мать');
    expect(kin.get('gf')).toBe('Дедушка');
    expect(kin.get('ggf')).toBe('Прадедушка');
    expect(kin.get('s1-c2')).toBe('Сестра');
    expect(kin.get('s2')).toBe('Тётя');
    expect(kin.get('s2-c1')).toMatch(/^Двоюродн/);
    expect(kin.get(`${GRANDCHILD}-sp`)).toBe('Жена');
    expect(kin.get('s1-sp3')).toBe('Мачеха');
  });

  it('у каждого — ФИО из трёх частей, отчество от имени отца', () => {
    const profiles = buildDemoProfiles(ivanovBig);
    expect(profiles.size).toBe(ivanovBig.persons.length);
    for (const p of profiles.values()) expect(fullName(p).split(' ').length).toBe(3);
    const dad = profiles.get('s1')!;
    const son = profiles.get(GRANDCHILD)!;
    expect(son.patronymic).toBe(patronymicFrom(dad.given, 'male'));
    expect(son.surname).toBe(dad.surname);
  });
});
