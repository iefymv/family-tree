// «Присоединиться к дереву»: кто без связей, где стоит своя карточка, подписи кнопок и вопрос подтверждения.
import { describe, expect, it } from 'vitest';
import type { FamilyData } from '../../src/tree/graph';
import { layoutTree } from '../../src/tree/layout';
import { isLinked, linkLabel, linkQuestion, pinBesideMain } from '../../src/ui/join';
import type { Profile } from '../../src/demo/profiles';

const family: FamilyData = {
  persons: [
    { id: 'gp', gender: 'male', name: 'Дед' },
    { id: 'gm', gender: 'female', name: 'Бабушка' },
    { id: 'mom', gender: 'female', name: 'Мама' },
    { id: 'me', gender: 'male', name: 'Я' },
  ],
  relations: [
    { kind: 'spouse', aId: 'gm', bId: 'gp', order: 1 },
    { kind: 'parent', parentId: 'gp', childId: 'mom', type: 'biological' },
    { kind: 'parent', parentId: 'gm', childId: 'mom', type: 'biological' },
  ],
} as FamilyData;

describe('присоединиться к дереву', () => {
  it('связей нет — не связан; любая связь — связан', () => {
    expect(isLinked(family, 'me')).toBe(false);
    expect(isLinked(family, 'mom')).toBe(true);
    const linked = { ...family, relations: [...family.relations, { kind: 'parent', parentId: 'mom', childId: 'me', type: 'biological' }] } as FamilyData;
    expect(isLinked(linked, 'me')).toBe(true);
  });

  it('своя карточка — над левым верхним углом основного дерева, остальное сдвинуто вниз', () => {
    const base = layoutTree(family, 'me');
    const me0 = base.nodes.find((n) => n.id === 'me')!;
    expect(me0.component).toBeGreaterThan(0);
    const pinned = pinBesideMain(base, 'me');
    const me = pinned.nodes.find((n) => n.id === 'me')!;
    const main = pinned.nodes.filter((n) => n.component === 0);
    expect(me.x).toBe(Math.min(...main.map((n) => n.x)));
    expect(me.y + me.h).toBeLessThan(Math.min(...main.map((n) => n.y)));
    expect(pinned.focus).toEqual({ id: 'me', x: me.x + me.w / 2, y: me.y + me.h / 2 });
    // Линии сдвинуты вместе с карточками.
    const dy = main[0].y - base.nodes.find((n) => n.id === main[0].id)!.y;
    expect(pinned.edges[0].path[0][1] - base.edges[0].path[0][1]).toBe(dy);
    // Уже связанного не трогаем.
    expect(pinBesideMain(base, 'mom')).toBe(base);
  });

  it('подписи по полу и вопрос «— ваш отец?»', () => {
    expect(linkLabel('parent', 'female')).toBe('Это моя мама');
    expect(linkLabel('parent', 'male')).toBe('Это мой папа');
    expect(linkLabel('sibling', 'unknown')).toBe('Мой брат или сестра');
    expect(linkLabel('child', 'female')).toBe('Это моя дочь');
    expect(linkLabel('spouse', 'male')).toBe('Это мой муж');
    const p = { id: 'x', gender: 'male', surname: 'Петров', given: 'Борис' } as Profile;
    expect(linkQuestion(p, 'parent')).toBe('Петров Борис — ваш отец?');
    expect(linkQuestion({ ...p, gender: 'female', surname: 'Петрова', given: 'Вера' }, 'sibling')).toBe('Петрова Вера — ваша сестра?');
  });
});
