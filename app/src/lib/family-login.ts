// Вход по семейному паролю: Edge Function family-login находит человека на дереве (или добавляет его)
// и возвращает логин учётки; дальше обычный signInWithPassword. Пароль никуда не сохраняется.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db } from './supabase';

export type LinkKind = 'child' | 'parent' | 'spouse' | 'sibling';

export interface Relative {
  id: string;
  name: string;
  birth_year: number | null;
}

/** Ответ функции с отказом. need: 'birth_year' — тёзки, нужен год; 'link' — человека нет на дереве. */
export class FamilyLoginError extends Error {
  constructor(message: string, readonly status: number, readonly need?: 'birth_year' | 'link' | 'login') {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('family-login', { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    let msg = 'Не получилось войти. Попробуйте ещё раз.';
    let need: FamilyLoginError['need'];
    try {
      const j = (await res.json()) as { error?: string; need?: FamilyLoginError['need'] };
      msg = j.error ?? msg;
      need = j.need;
    } catch {
      /* не JSON */
    }
    if (res.status >= 502) throw Object.assign(new Error(msg), { status: res.status });
    throw new FamilyLoginError(msg, res.status, need);
  }
  throw error; // сеть — повторит wake
}

export const familyLogin = (name: string, password: string, birthYear?: number) =>
  call<{ login: string }>({ name, password, ...(birthYear ? { birth_year: birthYear } : {}) });

export const searchRelatives = async (name: string, password: string, query: string) =>
  (await call<{ people: Relative[] }>({ name, password, search: query })).people;

export interface SelfAdd {
  givenName: string;
  surname: string;
  anchorId: string;
  kind: LinkKind;
  birthDate?: string;
  sex?: 'm' | 'f';
}

export const familySelfAdd = (name: string, password: string, a: SelfAdd) =>
  call<{ login: string; person_id: string }>({
    name, password, given_name: a.givenName, surname: a.surname, link: { anchor_id: a.anchorId, kind: a.kind },
    ...(a.birthDate ? { birth_date: a.birthDate } : {}), ...(a.sex ? { sex: a.sex } : {}),
  });
