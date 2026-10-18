// Подписанные ссылки на файлы приватного bucket `documents`: пачкой, с кэшем и обновлением до истечения.
// Signed URL — bearer-ссылка на TTL (1 час): принятый риск по плану.
import { db } from './supabase';

export const BUCKET = 'documents';
export const TTL_SECONDS = 3600;
/** Ссылку, которой осталось жить меньше этого, выдаём заново (план: обновление после 50 минут). */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

interface Entry { url: string; expiresAt: number }
const cache = new Map<string, Entry>();

const fresh = (e: Entry | undefined, now: number): e is Entry => !!e && e.expiresAt - now > REFRESH_MARGIN_MS;

/** Ссылки на пути (одним запросом на всё, чего нет в кэше или что скоро истечёт). Пути без ссылки — отсутствуют в Map. */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const missing = [...new Set(paths)].filter((p) => !fresh(cache.get(p), now));
  if (missing.length) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrls(missing, TTL_SECONDS);
    if (error) throw error;
    const expiresAt = now + TTL_SECONDS * 1000;
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) cache.set(item.path, { url: item.signedUrl, expiresAt });
    }
  }
  const out = new Map<string, string>();
  for (const p of paths) {
    const e = cache.get(p);
    if (e) out.set(p, e.url);
  }
  return out;
}

export async function signedUrl(path: string): Promise<string | null> {
  return (await signedUrls([path])).get(path) ?? null;
}

/** Сбросить ссылку (img.onerror) или весь кэш (выход). */
export function invalidate(path?: string): void {
  if (path === undefined) cache.clear();
  else cache.delete(path);
}

/** Путь миниатюры по пути основного файла: people/<id>/<uuid>.jpg → people/<id>/<uuid>_thumb.jpg. */
export function thumbPath(path: string): string {
  return path.replace(/(\.[a-z0-9]+)?$/i, '_thumb.jpg');
}

/**
 * При возврате на вкладку: если какие-то ссылки скоро истекут — вызвать onStale (экран перезапросит).
 * Возвращает функцию отписки.
 */
export function refreshOnVisible(onStale: () => void): () => void {
  const handler = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    let stale = false;
    for (const [p, e] of cache) {
      if (!fresh(e, now)) {
        cache.delete(p);
        stale = true;
      }
    }
    if (stale) onStale();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
