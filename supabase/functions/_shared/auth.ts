// Логин и синтетический email. КАНОНИЧЕСКАЯ копия; байт-в-байт копия лежит в
// supabase/functions/_shared/auth.ts (Edge Function не видит app/), равенство проверяет tests/unit/login.test.ts.
//
// Логин = нормализованные «имя фамилия»: NFC, нижний регистр, ё→е, одиночные пробелы, без краёв.
// Это ровно то, что требует CHECK members_login_normalized в базе.
// Email = транслит логина (как в загранпаспорте РФ, ICAO 9303) + «@family.invalid», пробел → точка.

export const EMAIL_DOMAIN = 'family.invalid';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ie', ы: 'y', ь: '',
  э: 'e', ю: 'iu', я: 'ia',
  // украинские и белорусские буквы
  і: 'i', ї: 'i', є: 'ie', ґ: 'g', ў: 'u',
  ' ': '.',
};

export class LoginError extends Error {}

export function normalizeLogin(input: string): string {
  return input.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

export function transliterate(login: string): string {
  let out = '';
  for (const ch of login) {
    const t = TRANSLIT[ch];
    if (t !== undefined) out += t;
    else if (/[a-z0-9-]/.test(ch)) out += ch;
    else throw new LoginError(`Недопустимый символ «${ch}» в имени для входа`);
  }
  return out;
}

/** Нормализует ввод и возвращает логин (для базы) и email (для Auth). Бросает LoginError. */
export function toLoginAndEmail(input: string): { login: string; email: string } {
  const login = normalizeLogin(input);
  if (login.length === 0) throw new LoginError('Введите имя и фамилию');
  if (login.length > 100) throw new LoginError('Имя для входа длиннее 100 символов');
  const local = transliterate(login).replace(/\.{2,}/g, '.');
  if (!/[a-z0-9]/.test(local)) throw new LoginError('В имени для входа нет ни одной буквы');
  if (local.startsWith('.') || local.endsWith('.')) throw new LoginError('Имя для входа не может начинаться или кончаться точкой');
  if (local.length > 64) throw new LoginError('Имя для входа слишком длинное');
  return { login, email: `${local}@${EMAIL_DOMAIN}` };
}

/** «Иванов  Пётр» → «ivanov.petr@family.invalid». */
export function toEmail(input: string): string {
  return toLoginAndEmail(input).email;
}
