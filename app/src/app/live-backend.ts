// Настоящие данные: lib/api (чтение из *_live, запись в таблицы под RLS), фото и документы — приватный bucket.
import type { DocTile, LifeEvent, Profile } from '../demo/profiles';
import {
  addFact, addParentRelation, addRelative, deletePerson, diffPerson, getPersonDetail, history, loadFamily, loadMemberNames,
  loadPortraitPaths, restorePerson, revert, softDeleteFact, softDeleteRelation, updatePerson,
  type DocumentRow, type Family, type PersonFields, type PersonRow,
} from '../lib/api';
import { dateFields } from '../lib/dates';
import { setPortrait, uploadDocument, uploadPhoto } from '../lib/images';
import { signOut } from '../lib/session';
import { invalidate, signedUrl, signedUrls, thumbPath } from '../lib/signedUrls';
import type { Gender } from '../tree/graph';
import { layoutParents } from '../tree/mutate';
import type { AddResult } from '../ui/add-dialog';
import type { Backend, EditResult, Loaded, MeInfo, PersonForm } from './backend';
import { describeEdit } from './history-format';

const GENDER: Record<PersonRow['sex'], Gender> = { m: 'male', f: 'female', u: 'unknown' };
const SEX: Record<Gender, PersonRow['sex']> = { male: 'm', female: 'f', unknown: 'u' };
const IMAGE = /^image\//;

function lifeEvent(text: string | null, from: string | null, to: string | null, place: string | null): LifeEvent | undefined {
  if (!text && !from && !place) return undefined;
  const date = from && to && from === to ? from : from ? from.slice(0, 4) : '';
  return { date, label: text ?? undefined, place: place ?? undefined };
}

export function profileFromRow(p: PersonRow, photoUrl?: string, addedBy?: string): Profile {
  return {
    id: p.id,
    gender: GENDER[p.sex] ?? 'unknown',
    surname: p.surname ?? (p.given_name ? '' : 'Неизвестно'),
    given: p.given_name ?? '',
    patronymic: p.patronymic ?? '',
    maidenName: p.maiden_name ?? undefined,
    birth: lifeEvent(p.birth_date_text, p.birth_date_from, p.birth_date_to, p.birth_place),
    death: lifeEvent(p.death_date_text, p.death_date_from, p.death_date_to, p.death_place),
    occupation: p.occupation ?? undefined,
    story: p.life_story ?? undefined,
    facts: [],
    docs: [],
    photo: photoUrl ? { kind: 'upload', url: photoUrl } : { kind: 'initials' },
    needsCheck: p.needs_check,
    addedBy,
  };
}

/** Подписанные ссылки на миниатюры; если миниатюры нет — на сам файл. */
async function thumbUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const thumbs = await signedUrls(paths.map(thumbPath));
  const missing: string[] = [];
  for (const p of paths) {
    const t = thumbs.get(thumbPath(p));
    if (t) out.set(p, t);
    else missing.push(p);
  }
  if (missing.length) for (const [p, u] of await signedUrls(missing)) out.set(p, u);
  return out;
}

const blank = (s: string) => s.trim() || null;

export interface Wake {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLiveBackend(me: MeInfo, wake: Wake): Backend {
  let fam: Family | null = null;
  const rows = new Map<string, PersonRow>();
  const names = new Map<string, string>();

  async function load(): Promise<Loaded> {
    const [f, members] = await wake.run(() => Promise.all([loadFamily(), loadMemberNames()]));
    fam = f;
    rows.clear();
    for (const p of f.people) rows.set(p.id, p);
    names.clear();
    for (const [k, v] of members) names.set(k, v);
    const portraitIds = f.people.map((p) => p.portrait_document_id).filter((x): x is string => !!x);
    let urls = new Map<string, string>();
    let paths = new Map<string, string>();
    try {
      paths = await loadPortraitPaths(portraitIds);
      urls = await thumbUrls([...paths.values()]);
    } catch {
      /* без фото дерево всё равно показываем — с инициалами */
    }
    const profiles = new Map<string, Profile>();
    for (const p of f.people) {
      const path = p.portrait_document_id ? paths.get(p.portrait_document_id) : undefined;
      profiles.set(p.id, profileFromRow(p, path ? urls.get(path) : undefined, p.created_by ? names.get(p.created_by) : undefined));
    }
    return { family: { persons: f.persons, relations: f.relations }, profiles };
  }

  async function detail(id: string): Promise<Profile | null> {
    const d = await wake.run(() => getPersonDetail(id));
    if (!d) return null;
    rows.set(id, d.person);
    const docs = d.documents;
    const urls = await thumbUrls(docs.filter((x) => IMAGE.test(x.mime ?? '')).map((x) => x.storage_path)).catch(() => new Map<string, string>());
    const portrait = docs.find((x) => x.id === d.person.portrait_document_id);
    const prof = profileFromRow(d.person, portrait ? urls.get(portrait.storage_path) : undefined, d.person.created_by ? names.get(d.person.created_by) : undefined);
    prof.facts = d.facts.map((f) => ({ id: f.id, text: [f.value, f.date_text].filter(Boolean).join(', ') || f.kind }));
    prof.docs = docs.map((x: DocumentRow): DocTile => ({
      id: x.id,
      title: x.caption || (IMAGE.test(x.mime ?? '') ? 'Фото' : 'Документ'),
      kind: IMAGE.test(x.mime ?? '') ? 'photo' : 'certificate',
      path: x.storage_path,
      mime: x.mime,
      thumb: urls.get(x.storage_path),
      year: undefined,
    }));
    return prof;
  }

  function addFields(res: AddResult): PersonFields {
    const b = dateFields(res.birthDate);
    return {
      sex: SEX[res.gender], surname: blank(res.surname), given_name: blank(res.given), patronymic: blank(res.patronymic),
      birth_date_text: b.text, birth_date_from: b.from, birth_date_to: b.to, birth_place: res.birthPlace?.trim() || null,
    };
  }

  return {
    mode: 'live',
    me,
    title: 'Семейное дерево',
    load,
    detail,
    async addRelative(targetId, kind, res, family) {
      const fields = addFields(res);
      if (kind !== 'fill') return (await addRelative(targetId, kind, fields)).person.id;
      // «Неизвестно» у детей targetId: новый человек — второй родитель каждого такого ребёнка.
      const kids = family.persons.map((p) => p.id).filter((id) => {
        const ps = layoutParents(family, id);
        return ps.length === 1 && ps[0] === targetId;
      });
      if (!kids.length) return (await addRelative(targetId, 'spouse', fields)).person.id;
      const id = (await addRelative(kids[0], 'parent', fields)).person.id;
      for (const k of kids.slice(1)) await addParentRelation(id, k);
      return id;
    },
    async formFor(id) {
      const d = await wake.run(() => getPersonDetail(id));
      if (!d) return null;
      rows.set(id, d.person);
      const p = d.person;
      return {
        surname: p.surname ?? '', given: p.given_name ?? '', patronymic: p.patronymic ?? '', maidenName: p.maiden_name ?? '', sex: p.sex,
        birthDate: p.birth_date_text ?? '', birthPlace: p.birth_place ?? '', deathDate: p.death_date_text ?? '', deathPlace: p.death_place ?? '',
        occupation: p.occupation ?? '', lifeStory: p.life_story ?? '', needsCheck: p.needs_check,
        facts: d.facts.map((f) => ({ id: f.id, text: [f.value, f.date_text].filter(Boolean).join(', ') || f.kind })),
      } satisfies PersonForm;
    },
    async save(id, edit: EditResult) {
      const row = rows.get(id);
      if (!row) throw new Error('Карточка устарела — откройте её заново');
      const f = edit.form;
      const b = dateFields(f.birthDate);
      const d = dateFields(f.deathDate);
      const form: PersonFields = {
        surname: blank(f.surname), given_name: blank(f.given), patronymic: blank(f.patronymic), maiden_name: blank(f.maidenName), sex: f.sex,
        birth_date_text: b.text, birth_place: blank(f.birthPlace), death_date_text: d.text, death_place: blank(f.deathPlace),
        occupation: blank(f.occupation), life_story: f.lifeStory.trim() ? f.lifeStory.replace(/\s+$/, '') : null, needs_check: f.needsCheck,
      };
      // Диапазон дат пересчитывается, только если поменялся текст даты.
      if (b.text !== row.birth_date_text) Object.assign(form, { birth_date_from: b.from, birth_date_to: b.to });
      if (d.text !== row.death_date_text) Object.assign(form, { death_date_from: d.from, death_date_to: d.to });
      const changed = diffPerson(row, form);
      const updated = await updatePerson(id, changed);
      if (updated) rows.set(id, updated);
      for (const fid of edit.removedFactIds) await softDeleteFact(fid);
      for (const text of edit.newFacts) await addFact(id, { kind: 'interesting', value: text });
    },
    async uploadPhoto(id, file) {
      const doc = await uploadPhoto(id, file, { caption: 'Фото' });
      await setPortrait(id, doc.id);
    },
    async uploadDocuments(id, files) {
      for (const f of files) await uploadDocument(id, f, { caption: f.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Документ' });
    },
    documentUrl: (path) => signedUrl(path),
    async history(id, nameOf) {
      return (await history(id)).map((e) => describeEdit(e, id, nameOf));
    },
    async revert(editId, force = false) {
      const r = await revert(editId, force);
      return 'conflict' in r ? { ok: false, conflict: r.conflict } : { ok: true };
    },
    removeFact: (factId) => softDeleteFact(factId),
    async removeRelation(personId, otherId) {
      const rels = (fam?.relationRows ?? []).filter(
        (r) => (r.from_person === personId && r.to_person === otherId) || (r.from_person === otherId && r.to_person === personId),
      );
      if (!rels.length) throw new Error('Связь не найдена — обновите страницу');
      for (const r of rels) await softDeleteRelation(r.id);
    },
    deletePerson: (id) => deletePerson(id),
    restorePerson: (id) => restorePerson(id),
    async logout() {
      invalidate();
      await signOut();
    },
  };
}
