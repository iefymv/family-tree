// Админка: список входов (RPC admin_list_members) и управление ими через Edge Function admin-users.
// Пароли не логируются и нигде не сохраняются.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db } from './supabase';
import type { Role } from './session';

export interface MemberRow {
  user_id: string;
  person_id: string;
  login: string;
  display_name: string;
  role: Role;
  disabled: boolean;
  created_at: string;
  /** Учётка создана семейным входом и живёт на семейном пароле. */
  family_login: boolean;
}

export class AdminError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function listMembers(): Promise<MemberRow[]> {
  const { data, error } = await db().rpc('admin_list_members');
  if (error) throw new AdminError(error.code === '42501' ? 'Только для администратора' : error.message);
  return (data ?? []) as MemberRow[];
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('admin-users', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let msg = res.status >= 500 ? 'Сервер админки сейчас не отвечает. Попробуйте ещё раз через минуту.' : 'Не удалось выполнить действие';
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* не JSON */
      }
      throw new AdminError(msg, res.status);
    }
    throw new AdminError('Нет связи с сервером. Попробуйте ещё раз.');
  }
  return data as T;
}

export interface CreateMemberInput {
  personId: string;
  login: string;
  password: string;
  displayName: string;
  role?: Role;
}

export const createMember = (i: CreateMemberInput) =>
  call<{ user_id: string; login: string }>({
    action: 'create', person_id: i.personId, login: i.login, password: i.password, display_name: i.displayName, role: i.role ?? 'relative',
  });
export const resetPassword = (userId: string, password: string) => call<{ ok: true }>({ action: 'reset_password', user_id: userId, password });
export const setDisabled = (userId: string, disabled: boolean) => call<{ ok: true }>({ action: disabled ? 'disable' : 'enable', user_id: userId });

const WORDS = ['липа', 'клён', 'рябина', 'берёза', 'ольха', 'сосна', 'ива', 'калина', 'дуб', 'ясень', 'вишня', 'груша', 'слива', 'орех', 'малина'];
/** Пароль из двух слов и числа — легко продиктовать по телефону. */
export function suggestPassword(): string {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${100 + (r[2] % 900)}`;
}
