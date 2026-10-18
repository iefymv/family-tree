// Общий семейный пароль для готового приглашения. Отдаётся только вошедшему участнику; не кэшируется.
import { db } from './supabase';

export async function fetchFamilyPassword(): Promise<string | null> {
  try {
    const { data, error } = await db().functions.invoke('family-password', { body: {} });
    if (error || typeof data?.password !== 'string') return null;
    return data.password;
  } catch {
    return null;
  }
}
