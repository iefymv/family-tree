// Ошибки браузера → client_errors (только message, stack, url — без данных форм).
import { db } from './supabase';

const MAX = { message: 2000, stack: 8000, url: 2000 };
const cut = (s: unknown, n: number): string | null => (s == null ? null : String(s).slice(0, n));

let sentThisSession = 0;
const LIMIT = 20; // не заваливать таблицу циклом одной и той же ошибки

export async function reportError(message: unknown, stack?: unknown, url: string = location.href): Promise<void> {
  if (sentThisSession >= LIMIT) return;
  sentThisSession++;
  // URL без query/hash: в hash-роуте могут быть id и поисковый ввод.
  const cleanUrl = url.split(/[?#]/)[0];
  try {
    const { data } = await db().auth.getSession();
    if (!data.session) return; // anon не может писать (RLS), и не надо
    await db().from('client_errors').insert({
      message: cut(message, MAX.message),
      stack: cut(stack, MAX.stack),
      url: cut(cleanUrl, MAX.url),
    });
  } catch {
    // Сбой отчёта об ошибке не должен порождать новую ошибку.
  }
}

/** Подключить window.onerror и unhandledrejection. Возвращает функцию отключения. */
export function installErrorReporting(): () => void {
  const onError = (e: ErrorEvent) => void reportError(e.message, e.error instanceof Error ? e.error.stack : undefined);
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    void reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
