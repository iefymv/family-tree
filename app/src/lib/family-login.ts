// Вход по семейному паролю: Edge Function family-login находит человека на дереве (или заводит ему карточку
// без связей) и возвращает логин учётки; дальше обычный signInWithPassword. Пароль никуда не сохраняется.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db } from './supabase';

/** Похожий человек на дереве для вопроса «Это вы?». */
export interface Candidate {
  id: string;
  fio: string;
  birth_year: number | null;
}

export type Need = 'birth_year' | 'link' | 'login' | 'confirm';

/**
 * Ответ функции с отказом. need: 'birth_year' — тёзки, нужен год; 'link' — человека нет на дереве;
 * 'confirm' — есть похожие (candidates). Код ответа — httpStatus, а не status: ошибка не должна
 * выглядеть для wake как «сервер не отвечает» (503 «не настроен» не повторяется).
 */
export class FamilyLoginError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly need?: Need, readonly candidates: Candidate[] = []) {
    super(message);
  }
}

export const NOT_CONFIGURED = 'Вход для родни пока не настроен — напишите Ефиму';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('family-login', { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    // Шлюз не достучался до функции (просыпается) — это повторяет wake; остальное — ответ функции.
    if (res.status === 502 || res.status === 504) throw Object.assign(new Error('Сервер не отвечает'), { status: res.status });
    let msg = 'Не получилось войти. Попробуйте ещё раз.';
    let need: Need | undefined;
    let candidates: Candidate[] = [];
    try {
      const j = (await res.json()) as { error?: string; need?: Need; candidates?: Candidate[] };
      msg = j.error ?? msg;
      need = j.need;
      candidates = Array.isArray(j.candidates) ? j.candidates : [];
    } catch {
      /* не JSON */
    }
    if (res.status === 503) msg = NOT_CONFIGURED;
    throw new FamilyLoginError(msg, res.status, need, candidates);
  }
  // Сеть или relay: запрос не дошёл до функции — повторит wake (isRetryable узнаёт status 0).
  throw Object.assign(new Error('fetch failed'), { status: 0 });
}

export interface FamilyLoginOptions {
  birthYear?: number;
  /** «Это вы?» — выбран похожий человек. */
  confirmPersonId?: string;
  /** «Нет, меня нет на дереве» — завести новую карточку без связей. */
  createNew?: boolean;
}

export const familyLogin = (name: string, password: string, o: FamilyLoginOptions = {}) =>
  call<{ login: string; person_id?: string }>({
    name, password,
    ...(o.birthYear ? { birth_year: o.birthYear } : {}),
    ...(o.confirmPersonId ? { confirm_person_id: o.confirmPersonId } : {}),
    ...(o.createNew ? { create_new: true } : {}),
  });
