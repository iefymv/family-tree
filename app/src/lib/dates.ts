// Даты в свободной форме, как их пишут в семье: «1919», «12.03.1955», «20–25 мая 1919», «~1902», «1920-е».
// Текст хранится как написан (birth_date_text), а диапазон from/to — для лет на дереве и сортировки.

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

// Месяц словом: именительный («май 1919») и родительный («20 мая 1919») падежи.
const MONTHS: [RegExp, number][] = [
  [/^январ[ья]$/, 1], [/^феврал[ья]$/, 2], [/^марта?$/, 3], [/^апрел[ья]$/, 4], [/^ма[йя]$/, 5], [/^июн[ья]$/, 6],
  [/^июл[ья]$/, 7], [/^августа?$/, 8], [/^сентябр[ья]$/, 9], [/^октябр[ья]$/, 10], [/^ноябр[ья]$/, 11], [/^декабр[ья]$/, 12],
];

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
const okYear = (y: number) => y >= 1000 && y <= 2200;

function monthOf(word: string): number | null {
  for (const [re, m] of MONTHS) if (re.test(word)) return m;
  return null;
}

function day(y: number, m: number, d: number): string | null {
  if (!okYear(y) || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return iso(y, m, d);
}

function range(from: string | null, to: string | null): DateRange | null {
  return from && to && from <= to ? { from, to } : null;
}

const yearRange = (y1: number, y2 = y1) => (okYear(y1) && okYear(y2) ? range(iso(y1, 1, 1), iso(y2, 12, 31)) : null);
const monthRange = (y: number, m: number) => range(day(y, m, 1), m >= 1 && m <= 12 ? day(y, m, daysIn(y, m)) : null);

/** Разбирает дату в свободной форме. Не понял — null (текст всё равно сохраняется как написан). */
export function parseDateText(input: string | null | undefined): DateRange | null {
  if (!input) return null;
  let s = input.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[‐‑‒–—−]/g, '–').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\(.*\)\s*$/, ''); // «1898 (ранее 1891)» → «1898»
  s = s.replace(/\s*(г\.|гг\.|года?|годы|год)\s*$/, '').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { const d = day(+m[1], +m[2], +m[3]); return range(d, d); }
  if ((m = s.match(/^(\d{3})0-е$/))) return yearRange(+m[1] * 10, +m[1] * 10 + 9);
  s = s.replace(/ ?[-–] ?/g, '–'); // «20 - 25» → «20–25»

  if ((m = s.match(/^(?:~|около|ок\.|примерно|приблизительно)\s*(\d{4})$/))) return yearRange(+m[1] - 2, +m[1] + 2);
  if ((m = s.match(/^(\d{4})$/))) return yearRange(+m[1]);
  if ((m = s.match(/^(\d{4})–(\d{4})$/))) return yearRange(+m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) { const d = day(+m[3], +m[2], +m[1]); return range(d, d); }
  if ((m = s.match(/^(\d{1,2})–(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return range(day(+m[4], +m[3], +m[1]), day(+m[4], +m[3], +m[2]));
  if ((m = s.match(/^(\d{1,2})\.(\d{4})$/))) return monthRange(+m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2}) ([а-я]+) (\d{4})$/))) { const mo = monthOf(m[2]); const d = mo ? day(+m[3], mo, +m[1]) : null; return range(d, d); }
  if ((m = s.match(/^(\d{1,2})–(\d{1,2}) ([а-я]+) (\d{4})$/))) {
    const mo = monthOf(m[3]);
    return mo ? range(day(+m[4], mo, +m[1]), day(+m[4], mo, +m[2])) : null;
  }
  if ((m = s.match(/^([а-я]+) (\d{4})$/))) { const mo = monthOf(m[1]); return mo ? monthRange(+m[2], mo) : null; }
  return null;
}

/** Поля базы для даты: текст как написан + диапазон, если понят. Пустой ввод — всё null. */
export function dateFields(text: string | null | undefined): { text: string | null; from: string | null; to: string | null } {
  const t = text?.trim() || null;
  const r = parseDateText(t);
  return { text: t, from: r?.from ?? null, to: r?.to ?? null };
}
