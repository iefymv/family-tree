// Источник данных экрана дерева: настоящий сервер (live) или вымышленное демо-дерево (demo).
// Экран дерева (tree-app.ts) знает только этот интерфейс.
import type { Profile } from '../demo/profiles';
import type { FamilyData } from '../tree/graph';
import type { AddKind } from '../tree/mutate';
import type { AddResult } from '../ui/add-dialog';
import type { Role } from '../lib/session';
import type { HistoryItem } from './history-format';

export interface MeInfo {
  personId: string;
  displayName: string;
  role: Role;
}

export interface Loaded {
  family: FamilyData;
  profiles: Map<string, Profile>;
}

/** Значения формы «Редактировать». Даты — как написаны. */
export interface PersonForm {
  surname: string;
  given: string;
  patronymic: string;
  maidenName: string;
  sex: 'm' | 'f' | 'u';
  birthDate: string;
  birthPlace: string;
  deathDate: string;
  deathPlace: string;
  occupation: string;
  lifeStory: string;
  needsCheck: boolean;
  facts: { id: string; text: string }[];
}

export interface EditResult {
  form: PersonForm;
  newFacts: string[];
  removedFactIds: string[];
}

export interface RevertOutcome {
  ok: boolean;
  conflict?: string[];
}

export interface Backend {
  mode: 'demo' | 'live';
  me: MeInfo;
  title: string;
  load(): Promise<Loaded>;
  /** Полная карточка (факты, документы с миниатюрами). */
  detail(id: string): Promise<Profile | null>;
  /** Добавить родственника; kind = 'fill' — второй родитель детей targetId. Возвращает id нового человека. */
  addRelative(targetId: string, kind: AddKind | 'fill', res: AddResult, family: FamilyData): Promise<string>;
  formFor(id: string): Promise<PersonForm | null>;
  save(id: string, edit: EditResult): Promise<void>;
  uploadPhoto(id: string, file: File): Promise<void>;
  uploadDocuments(id: string, files: File[]): Promise<void>;
  /** Адрес для просмотра документа (подписанная ссылка на оригинал). */
  documentUrl(path: string): Promise<string | null>;
  history(id: string, nameOf: (id: string) => string | undefined): Promise<HistoryItem[]>;
  revert(editId: number, force?: boolean): Promise<RevertOutcome>;
  removeFact(factId: string): Promise<void>;
  removeRelation(personId: string, otherId: string): Promise<void>;
  deletePerson(id: string): Promise<void>;
  restorePerson(id: string): Promise<void>;
  logout(): Promise<void>;
}
