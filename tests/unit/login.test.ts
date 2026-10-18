import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLogin, toEmail, toLoginAndEmail, transliterate, LoginError } from '../../app/src/lib/auth.ts';

test('копия для Edge Function совпадает с канонической app/src/lib/auth.ts', () => {
  const canon = readFileSync(new URL('../../app/src/lib/auth.ts', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../../supabase/functions/_shared/auth.ts', import.meta.url), 'utf8');
  assert.equal(copy, canon, 'скопируйте app/src/lib/auth.ts в supabase/functions/_shared/auth.ts');
});

test('таблица транслитерации (ICAO 9303)', () => {
  const table: Array<[string, string]> = [
    ['абвгдежзий', 'abvgdezhzii'],
    ['клмнопрстуф', 'klmnoprstuf'],
    ['хцчшщъыьэюя', 'khtschshshchieyeiuia'],
    ['іїєґў', 'iiiegu'],
    ['петр иванов', 'petr.ivanov'],
    ['анна-мария иванова', 'anna-mariia.ivanova'],
    ['петр иванов 1955', 'petr.ivanov.1955'],
  ];
  for (const [src, want] of table) assert.equal(transliterate(src), want, src);
});

test('нормализация логина как в CHECK members_login_normalized', () => {
  assert.equal(normalizeLogin('  Пётр   ИВАНОВ\t'), 'петр иванов');
  assert.equal(normalizeLogin('Семён Иванов'), 'семен иванов');
  assert.equal(normalizeLogin('ЁЛКИН Фёдор'), 'елкин федор');
  // NFD-ввод (и + краткая, е + диерезис) приводится к тем же буквам
  assert.equal(normalizeLogin('Андрей Ёлкин'), 'андрей елкин');
});

test('toEmail: детерминированный email на family.invalid', () => {
  assert.equal(toEmail('Пётр Иванов'), 'petr.ivanov@family.invalid');
  assert.equal(toEmail('  петр   иванов '), 'petr.ivanov@family.invalid');
  assert.equal(toEmail('Ксения Иванова'), 'kseniia.ivanova@family.invalid');
  assert.equal(toEmail('Матвей Иванов 2015'), 'matvei.ivanov.2015@family.invalid');
  assert.equal(toEmail('Илья Иванов'), 'ilia.ivanov@family.invalid');
  assert.equal(toEmail('Семён Иванов'), 'semen.ivanov@family.invalid'); // ё→е до транслита
  assert.deepEqual(toLoginAndEmail('Щукин Ю'), { login: 'щукин ю', email: 'shchukin.iu@family.invalid' });
});

test('toEmail: отказ на пустом, чужих символах и длинном вводе', () => {
  assert.throws(() => toEmail('   '), LoginError);
  assert.throws(() => toEmail('петр.иванов'), LoginError);
  assert.throws(() => toEmail('петр@иванов'), LoginError);
  assert.throws(() => toEmail('ь'), LoginError);
  assert.throws(() => toEmail('щ'.repeat(20)), LoginError); // 80 символов транслита > 64
  assert.throws(() => toEmail('а'.repeat(101)), LoginError);
});
