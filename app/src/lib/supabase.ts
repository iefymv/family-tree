// Клиент Supabase. В браузере — только публичный ключ (VITE_SUPABASE_ANON_KEY).
// detectSessionInUrl:false — hash-роуты конфликтуют с разбором токена из URL (план, H5).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createAppClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { detectSessionInUrl: false, persistSession: true } });
}

/** Общий клиент приложения; создаётся при первом обращении из VITE_*-переменных сборки. */
export function db(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) throw new Error('Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    client = createAppClient(url, key);
  }
  return client;
}

/** Подменить клиент (тесты, MCP-агент со своей учёткой). */
export function setClient(c: SupabaseClient | null): void {
  client = c;
}
