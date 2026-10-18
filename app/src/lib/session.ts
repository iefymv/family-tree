// Вход по «имя фамилия» + пароль: логин → синтетический email (auth.ts) → signInWithPassword.
// Не подошло (неверные данные) — пробуем семейный пароль: family-login находит человека на дереве и отдаёт логин его учётки.
import { toEmail } from './auth';
import { FamilyLoginError, familyLogin, familySelfAdd, type SelfAdd } from './family-login';
import { db } from './supabase';

export type Role = 'admin' | 'relative' | 'agent';

export interface Me {
  userId: string;
  personId: string;
  displayName: string;
  role: Role;
}

export class SignInError extends Error {}

export interface SignInOptions {
  /** Год рождения — различить тёзок при семейном входе. */
  birthYear?: number;
  /** Человека нет на дереве: добавить его рядом с родственником и войти. */
  selfAdd?: SelfAdd;
}

async function passwordSignIn(email: string, password: string) {
  const { error } = await db().auth.signInWithPassword({ email, password });
  return error;
}

/**
 * Бросает LoginError (недопустимое имя), SignInError (неверное имя/пароль, сеть)
 * или FamilyLoginError (семейный вход: нужен год рождения, человека нет на дереве, вход закрыт, много попыток).
 */
export async function signIn(nameInput: string, password: string, opts: SignInOptions = {}): Promise<Me> {
  const email = toEmail(nameInput);
  let error = opts.selfAdd || opts.birthYear ? null : await passwordSignIn(email, password);
  if (opts.selfAdd || opts.birthYear || (error && (error.code === 'invalid_credentials' || (error.status === 400 && !error.code)))) {
    let login: string;
    try {
      login = opts.selfAdd
        ? (await familySelfAdd(nameInput, password, opts.selfAdd)).login
        : (await familyLogin(nameInput, password, opts.birthYear)).login;
    } catch (e) {
      if (e instanceof FamilyLoginError && e.status === 401) throw new SignInError('Неверное имя или пароль');
      throw e;
    }
    error = await passwordSignIn(toEmail(login), password);
  }
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
