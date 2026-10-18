// Вход по «имя фамилия» + пароль: логин → синтетический email (auth.ts) → signInWithPassword.
import { toEmail } from './auth';
import { db } from './supabase';

export type Role = 'admin' | 'relative' | 'agent';

export interface Me {
  userId: string;
  personId: string;
  displayName: string;
  role: Role;
}

export class SignInError extends Error {}

/** Бросает LoginError (недопустимое имя) или SignInError (неверное имя/пароль, сеть). */
export async function signIn(nameInput: string, password: string): Promise<Me> {
  const email = toEmail(nameInput);
  const { error } = await db().auth.signInWithPassword({ email, password });
  if (error) {
    throw new SignInError(error.status === 400 ? 'Неверное имя или пароль' : `Не удалось войти: ${error.message}`);
  }
  const me = await getMe();
  if (!me) {
    await db().auth.signOut();
    throw new SignInError('Вход отключён — обратитесь к администратору');
  }
  return me;
}

export async function signOut(): Promise<void> {
  const { error } = await db().auth.signOut();
  if (error) throw error;
}

/** Текущий участник или null (нет сессии, нет строки members, вход отключён). */
export async function getMe(): Promise<Me | null> {
  const { data: auth } = await db().auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return null;
  // Только разрешённые column grants: login скрыт, disabled не выдан.
  const { data, error } = await db()
    .from('members')
    .select('user_id, person_id, display_name, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { userId: data.user_id, personId: data.person_id, displayName: data.display_name, role: data.role as Role };
}
