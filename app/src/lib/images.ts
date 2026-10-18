// Фото на клиенте: уменьшение до 1600px + миниатюра 320px (JPEG, EXIF с геометкой при перекодировании пропадает),
// HEIC → JPEG, если браузер умеет его декодировать (Safari), загрузка в bucket `documents` и строка documents.
import { updatePerson, type DocumentRow, type PersonRow } from './api';
import { BUCKET, thumbPath } from './signedUrls';
import { db } from './supabase';

export const MAX_SIDE = 1600;
export const THUMB_SIDE = 320;
const QUALITY = 0.85;

export class ImageError extends Error {}

const isHeic = (f: Blob & { name?: string }) =>
  /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name ?? '');

async function decode(file: Blob & { name?: string }): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError(isHeic(file)
      ? 'Этот браузер не открывает HEIC. Сохраните фото как JPEG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимый»)'
      : 'Не удалось прочитать изображение');
  }
}

async function toJpeg(img: ImageBitmap, maxSide: number): Promise<Blob> {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Canvas недоступен');
  ctx.fillStyle = '#fff'; // прозрачность PNG → белый фон, а не чёрный
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError('Не удалось сжать изображение'))), 'image/jpeg', QUALITY));
}

export interface PreparedImage { full: Blob; thumb: Blob }

/** Уменьшенный JPEG и миниатюра. Только браузер. */
export async function prepareImage(file: Blob & { name?: string }): Promise<PreparedImage> {
  const img = await decode(file);
  try {
    return { full: await toJpeg(img, MAX_SIDE), thumb: await toJpeg(img, THUMB_SIDE) };
  } finally {
    img.close();
  }
}

export interface UploadOptions {
  caption?: string | null;
  source?: string | null;
  /** MIME основного файла; по умолчанию image/jpeg (после prepareImage). */
  mime?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/**
 * Загружает готовые файлы (upsert:false — ничего не перезаписывается) и пишет строку documents.
 * Путь: people/<personId>/<uuid>.jpg, миниатюра рядом: <uuid>_thumb.jpg.
 * Если строка не записалась, файл остаётся сиротой (DELETE в bucket запрещён; чистка — follow-up).
 */
export async function uploadPrepared(personId: string, files: { full: Blob; thumb?: Blob }, opts: UploadOptions = {}): Promise<DocumentRow> {
  const mime = opts.mime ?? 'image/jpeg';
  const path = `people/${personId}/${crypto.randomUUID()}.${EXT[mime]}`;
  const bucket = db().storage.from(BUCKET);
  const up = await bucket.upload(path, files.full, { upsert: false, contentType: mime });
  if (up.error) throw up.error;
  if (files.thumb) {
    const t = await bucket.upload(thumbPath(path), files.thumb, { upsert: false, contentType: 'image/jpeg' });
    if (t.error) throw t.error;
  }
  const { data, error } = await db().from('documents')
    .insert({ person_id: personId, storage_path: path, mime, caption: opts.caption ?? null, source: opts.source ?? null })
    .select('id, person_id, storage_path, mime, caption, source, uploaded_by, created_at').single();
  if (error) throw error;
  return data as DocumentRow;
}

/** Фото из <input type=file>: сжать, сделать миниатюру, загрузить. */
export async function uploadPhoto(personId: string, file: Blob & { name?: string }, opts: Omit<UploadOptions, 'mime'> = {}): Promise<DocumentRow> {
  return uploadPrepared(personId, await prepareImage(file), opts);
}

/** Документ из <input type=file>: картинка — как фото (сжать + миниатюра), PDF — как есть. */
export async function uploadDocument(personId: string, file: Blob & { name?: string }, opts: Omit<UploadOptions, 'mime'> = {}): Promise<DocumentRow> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')) {
    return uploadPrepared(personId, { full: file }, { ...opts, mime: 'application/pdf' });
  }
  return uploadPhoto(personId, file, opts);
}

export async function setPortrait(personId: string, documentId: string | null): Promise<PersonRow | null> {
  return updatePerson(personId, { portrait_document_id: documentId });
}
