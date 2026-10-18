// Добавление родственников в данные дерева (пока в памяти, без сервера).
import type { FamilyData, ParentType, Person, Relation } from './graph';

export type AddKind = 'parent' | 'spouse' | 'child' | 'sibling';

const LAYOUT_TYPES: ReadonlySet<ParentType> = new Set(['biological', 'adoptive', 'unknown']);

/** Родители, участвующие в раскладке (без «воспитывал» и отчимов). */
export function layoutParents(family: FamilyData, id: string): string[] {
  return family.relations.filter((r): r is Extract<Relation, { kind: 'parent' }> => r.kind === 'parent' && r.childId === id && LAYOUT_TYPES.has(r.type)).map((r) => r.parentId);
}

const maxOrder = (family: FamilyData, id: string): number =>
  Math.max(0, ...family.relations.filter((r) => r.kind === 'spouse' && (r.aId === id || r.bId === id)).map((r) => (r.kind === 'spouse' ? r.order : 0)));

/** Текущий супруг: брак с наибольшим номером, не расторгнутый. */
export function currentSpouse(family: FamilyData, id: string): string | undefined {
  const m = family.relations
    .filter((r): r is Extract<Relation, { kind: 'spouse' }> => r.kind === 'spouse' && (r.aId === id || r.bId === id) && !r.divorced)
    .sort((a, b) => b.order - a.order)[0];
  return m ? (m.aId === id ? m.bId : m.aId) : undefined;
}

export function canAdd(family: FamilyData, id: string): Record<AddKind, boolean> {
  const parents = layoutParents(family, id).length;
  return { parent: parents < 2, sibling: parents > 0, spouse: true, child: true };
}

/** Добавляет человека `person` как родственника `targetId`. Возвращает новые данные (исходные не меняются). */
export function addRelative(family: FamilyData, targetId: string, kind: AddKind, person: Person): FamilyData {
  if (!family.persons.some((p) => p.id === targetId)) throw new Error(`Нет человека ${targetId}`);
  if (family.persons.some((p) => p.id === person.id)) throw new Error(`id ${person.id} уже занят`);
  const persons = [...family.persons, person];
  const add: Relation[] = [];
  const parentRel = (parentId: string, childId: string): Relation => ({ kind: 'parent', parentId, childId, type: 'biological' });

  if (kind === 'spouse') {
    add.push({ kind: 'spouse', aId: targetId, bId: person.id, order: maxOrder(family, targetId) + 1 });
  } else if (kind === 'child') {
    add.push(parentRel(targetId, person.id));
    const sp = currentSpouse(family, targetId);
    if (sp) add.push(parentRel(sp, person.id));
  } else if (kind === 'parent') {
    const existing = layoutParents(family, targetId);
    if (existing.length >= 2) throw new Error('У человека уже двое родителей');
    add.push(parentRel(person.id, targetId));
    if (existing.length === 1) {
      add.push({ kind: 'spouse', aId: existing[0], bId: person.id, order: maxOrder(family, existing[0]) + 1 });
    }
  } else {
    const parents = layoutParents(family, targetId);
    if (!parents.length) throw new Error('Сначала добавьте родителя');
    for (const p of parents) add.push(parentRel(p, person.id));
  }
  return { persons, relations: [...family.relations, ...add] };
}

/** Заполняет «Неизвестно»: второй родитель для детей `knownParentId`, у которых известен только он. */
export function fillUnknownParent(family: FamilyData, knownParentId: string, person: Person): FamilyData {
  if (family.persons.some((p) => p.id === person.id)) throw new Error(`id ${person.id} уже занят`);
  const kids = family.persons.map((p) => p.id).filter((id) => {
    const ps = layoutParents(family, id);
    return ps.length === 1 && ps[0] === knownParentId;
  });
  const add: Relation[] = [{ kind: 'spouse', aId: knownParentId, bId: person.id, order: maxOrder(family, knownParentId) + 1 }];
  for (const k of kids) add.push({ kind: 'parent', parentId: person.id, childId: k, type: 'biological' });
  return { persons: [...family.persons, person], relations: [...family.relations, ...add] };
}

let seq = 0;
export const newPersonId = (): string => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`;
