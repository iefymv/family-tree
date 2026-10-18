// DEMO: вымышленное дерево Ивановых в памяти (для работы над дизайном, `?demo` или без настроек сервера).
// Ничего не уходит в сеть; после перезагрузки всё как было.
import { buildDemoProfiles, ensurePortrait, fullName, newProfile, type Profile } from '../demo/profiles';
import type { FamilyData, Person } from '../tree/graph';
import { addRelative, fillUnknownParent, newPersonId } from '../tree/mutate';
import { GRANDCHILD, ivanovBig } from '../../tests/fixtures/ivanov-big';
import type { Backend, PersonForm } from './backend';
import type { HistoryItem } from './history-format';
import { formatWhen } from './history-format';

export function createDemoBackend(): Backend {
  const profiles: Map<string, Profile> = buildDemoProfiles(ivanovBig);
  ensurePortrait(profiles, GRANDCHILD);
  const withNames = (persons: Person[]): Person[] => persons.map((p) => ({ ...p, name: profiles.get(p.id) ? fullName(profiles.get(p.id)!) : p.name }));
  let family: FamilyData = { persons: withNames(ivanovBig.persons), relations: [...ivanovBig.relations] };
  const log = new Map<string, HistoryItem[]>();
  let seq = 1;
  const note = (id: string, title: string) => {
    const at = new Date().toISOString();
    log.set(id, [{ id: seq++, at, when: formatWhen(at), who: 'вы (демо)', title, changes: [], revertable: false }, ...(log.get(id) ?? [])]);
  };
  const local = () => Promise.reject(new Error('В демо-режиме это недоступно'));

  return {
    mode: 'demo',
    me: { personId: GRANDCHILD, displayName: 'Демо', role: 'relative' },
    title: 'Семья Ивановых',
    async load() {
      return { family, profiles };
    },
    async detail(id) {
      return profiles.get(id) ?? null;
    },
    async addRelative(targetId, kind, res) {
      const id = newPersonId();
      const prof = newProfile(id, res.gender, res.surname, res.given, res.patronymic, res.birthDate, res.birthPlace);
      if (prof.birth) prof.birth.label = res.birthDate;
      const person: Person = { id, gender: res.gender, name: fullName(prof) };
      family = kind === 'fill' ? fillUnknownParent(family, targetId, person) : addRelative(family, targetId, kind, person);
      profiles.set(id, prof);
      note(id, 'Добавлен(а) на дерево');
      return id;
    },
    async formFor(id) {
      const p = profiles.get(id);
      if (!p) return null;
      return {
        surname: p.surname, given: p.given, patronymic: p.patronymic, maidenName: p.maidenName ?? '',
        sex: p.gender === 'male' ? 'm' : p.gender === 'female' ? 'f' : 'u',
        birthDate: p.birth?.label ?? p.birth?.date ?? '', birthPlace: p.birth?.place ?? '',
        deathDate: p.death?.label ?? p.death?.date ?? '', deathPlace: p.death?.place ?? '',
        occupation: p.occupation ?? '', lifeStory: p.story ?? '', needsCheck: !!p.needsCheck, facts: [...p.facts],
      } satisfies PersonForm;
    },
    async save(id, { form: f, newFacts, removedFactIds }) {
      const p = profiles.get(id);
      if (!p) return;
      const ev = (label: string, place: string) => (label.trim() || place.trim() ? { date: /^\d{4}/.test(label) ? label.slice(0, 4) : '', label: label.trim() || undefined, place: place.trim() || undefined } : undefined);
      Object.assign(p, {
        surname: f.surname.trim(), given: f.given.trim(), patronymic: f.patronymic.trim(), maidenName: f.maidenName.trim() || undefined,
        gender: f.sex === 'm' ? 'male' : f.sex === 'f' ? 'female' : 'unknown',
        birth: ev(f.birthDate, f.birthPlace), death: ev(f.deathDate, f.deathPlace),
        occupation: f.occupation.trim() || undefined, story: f.lifeStory.trim() || undefined, needsCheck: f.needsCheck,
        facts: [...p.facts.filter((x) => !removedFactIds.includes(x.id)), ...newFacts.map((text, i) => ({ id: `demo-new-${seq}-${i}`, text }))],
      });
      family = { ...family, persons: family.persons.map((x) => (x.id === id ? { ...x, name: fullName(p), gender: p.gender } : x)) };
      note(id, 'Изменено');
    },
    async uploadPhoto(id, file) {
      const p = profiles.get(id);
      if (p) p.photo = { kind: 'upload', url: URL.createObjectURL(file) };
    },
    uploadDocuments: local,
    documentUrl: async () => null,
    async history(id) {
      return log.get(id) ?? [];
    },
    revert: local,
    async removeFact(factId) {
      for (const p of profiles.values()) p.facts = p.facts.filter((f) => f.id !== factId);
    },
    async removeRelation(personId, otherId) {
      family = {
        ...family,
        relations: family.relations.filter((r) =>
          r.kind === 'spouse' ? !([r.aId, r.bId].includes(personId) && [r.aId, r.bId].includes(otherId)) : !([r.parentId, r.childId].includes(personId) && [r.parentId, r.childId].includes(otherId))),
      };
    },
    deletePerson: local,
    restorePerson: local,
    async logout() {
      location.search = '';
    },
  };
}
