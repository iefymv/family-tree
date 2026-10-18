// DEMO: вымышленные анкеты для фикстуры Ивановых — ФИО, даты, места, занятия, факты, история.
// Всё генерируется детерминированно из id, реальных людей здесь нет.
import type { FamilyData, Gender, Person } from '../tree/graph';

export type PhotoKind = { kind: 'portrait' } | { kind: 'initials' } | { kind: 'upload'; url: string };

export interface LifeEvent {
  /** ISO-дата `YYYY-MM-DD`, только год `YYYY` или пусто (известно лишь место). */
  date: string;
  /** Дата как написана в семье («20–25 мая 1919») — показывается вместо разобранной. */
  label?: string;
  place?: string;
}

export interface DocTile {
  title: string;
  year?: number;
  kind: 'certificate' | 'letter' | 'photo' | 'diploma';
  /** Только у загруженных: id строки documents, путь в хранилище, MIME, ссылка на миниатюру. */
  id?: string;
  path?: string;
  mime?: string | null;
  thumb?: string;
}

export interface FactItem {
  id: string;
  text: string;
}

export interface Profile {
  id: string;
  gender: Gender;
  surname: string;
  given: string;
  patronymic: string;
  maidenName?: string;
  birth?: LifeEvent;
  death?: LifeEvent;
  occupation?: string;
  facts: FactItem[];
  story?: string;
  docs: DocTile[];
  photo: PhotoKind;
  /** «Нужно уточнить» — данные неточные. */
  needsCheck?: boolean;
  /** Кто добавил человека на дерево (подпись участника). */
  addedBy?: string;
}

export const TODAY_YEAR = 2026;

export const fullName = (p: Pick<Profile, 'surname' | 'given' | 'patronymic'>): string =>
  [p.surname, p.given, p.patronymic].filter(Boolean).join(' ');

export const yearOf = (e?: LifeEvent): number | undefined => (e && /^\d{4}/.test(e.date) ? Number(e.date.slice(0, 4)) : undefined);

// ——— случайность от id ———
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ——— имена: [имя, отчество муж., отчество жен.] ———
type MaleName = readonly [string, string, string];
const MALE_OLD: MaleName[] = [
  ['Иван', 'Иванович', 'Ивановна'],
  ['Пётр', 'Петрович', 'Петровна'],
  ['Николай', 'Николаевич', 'Николаевна'],
  ['Василий', 'Васильевич', 'Васильевна'],
  ['Григорий', 'Григорьевич', 'Григорьевна'],
  ['Фёдор', 'Фёдорович', 'Фёдоровна'],
  ['Степан', 'Степанович', 'Степановна'],
  ['Семён', 'Семёнович', 'Семёновна'],
  ['Михаил', 'Михайлович', 'Михайловна'],
  ['Павел', 'Павлович', 'Павловна'],
];
const MALE_MID: MaleName[] = [
  ['Алексей', 'Алексеевич', 'Алексеевна'],
  ['Сергей', 'Сергеевич', 'Сергеевна'],
  ['Андрей', 'Андреевич', 'Андреевна'],
  ['Владимир', 'Владимирович', 'Владимировна'],
  ['Юрий', 'Юрьевич', 'Юрьевна'],
  ['Виктор', 'Викторович', 'Викторовна'],
  ['Борис', 'Борисович', 'Борисовна'],
  ['Олег', 'Олегович', 'Олеговна'],
];
const MALE_NEW: MaleName[] = [
  ['Дмитрий', 'Дмитриевич', 'Дмитриевна'],
  ['Максим', 'Максимович', 'Максимовна'],
  ['Артём', 'Артёмович', 'Артёмовна'],
  ['Егор', 'Егорович', 'Егоровна'],
  ['Матвей', 'Матвеевич', 'Матвеевна'],
  ['Лев', 'Львович', 'Львовна'],
  ['Марк', 'Маркович', 'Марковна'],
  ['Тимофей', 'Тимофеевич', 'Тимофеевна'],
  ['Илья', 'Ильич', 'Ильинична'],
];
const FEMALE_OLD = ['Анна', 'Мария', 'Евдокия', 'Прасковья', 'Антонина', 'Зинаида', 'Клавдия', 'Нина', 'Агафья'];
const FEMALE_MID = ['Татьяна', 'Ольга', 'Елена', 'Наталья', 'Светлана', 'Ирина', 'Людмила', 'Галина', 'Валентина'];
const FEMALE_NEW = ['Алиса', 'София', 'Варвара', 'Полина', 'Вероника', 'Ксения', 'Дарья', 'Ева', 'Мирослава'];
const ALL_MALE = [...MALE_OLD, ...MALE_MID, ...MALE_NEW];

const era = (y: number) => (y < 1935 ? 0 : y < 1975 ? 1 : 2);
const maleNames = (y: number) => [MALE_OLD, MALE_MID, MALE_NEW][era(y)];
const femaleNames = (y: number) => [FEMALE_OLD, FEMALE_MID, FEMALE_NEW][era(y)];

/** Отчество от мужского имени: по таблице, иначе — по общим правилам. */
export function patronymicFrom(fatherGiven: string, gender: Gender): string {
  const row = ALL_MALE.find(([n]) => n === fatherGiven);
  if (row) return gender === 'female' ? row[2] : row[1];
  if (!fatherGiven) return '';
  const g = gender === 'female';
  if (/ий$/.test(fatherGiven)) return fatherGiven.slice(0, -2) + (g ? 'иевна' : 'иевич');
  if (/[йь]$/.test(fatherGiven)) return fatherGiven.slice(0, -1) + (g ? 'евна' : 'евич');
  if (/а$/.test(fatherGiven)) return fatherGiven.slice(0, -1) + (g ? 'ична' : 'ич');
  return fatherGiven + (g ? 'овна' : 'ович');
}

/** Фамилия в нужном роде: «Иванов» ↔ «Иванова». */
export function genderSurname(base: string, gender: Gender): string {
  const male = base.replace(/(ов|ев|ёв|ин|ын)а$/, '$1');
  return gender === 'female' && /(ов|ев|ёв|ин|ын)$/.test(male) ? male + 'а' : male;
}

const PLACES_OLD = [
  'д. Берёзовка, Тверская губерния',
  'с. Покровское, Ярославская губерния',
  'д. Липки, Калужская губерния',
  'с. Устье, Вологодская губерния',
  'д. Ольховка, Тульская губерния',
];
const PLACES = ['Ярославль', 'Калуга', 'Вологда', 'Тверь', 'Тула', 'Кострома', 'Рязань', 'Самара', 'Нижний Новгород', 'Казань', 'Москва', 'Санкт-Петербург', 'Екатеринбург'];

const JOBS = [
  { m: ['Кузнец', 'Плотник', 'Машинист паровоза', 'Пасечник', 'Сельский счетовод'], f: ['Сельская учительница', 'Швея', 'Фельдшер', 'Доярка, бригадир фермы', 'Ткачиха'] },
  { m: ['Инженер-строитель', 'Агроном', 'Токарь высшего разряда', 'Водитель автобуса', 'Геолог', 'Врач-хирург'], f: ['Врач-педиатр', 'Бухгалтер', 'Учитель литературы', 'Инженер-технолог', 'Библиотекарь', 'Медсестра'] },
  { m: ['Программист', 'Архитектор', 'Инженер-энергетик', 'Предприниматель', 'Фотограф', 'Школьник'], f: ['Дизайнер интерфейсов', 'Врач-офтальмолог', 'Переводчик', 'Юрист', 'Студентка', 'Школьница'] },
];

const FACTS = [
  [
    'Знал наизусть «Конька-Горбунка» и читал его внукам по памяти',
    'Сама построила печь в новом доме — соседи приходили посмотреть',
    'Писала письма химическим карандашом, их бережно хранят до сих пор',
    'Держал пасеку на двенадцать ульев',
    'Пекла пироги с калиной к каждому празднику',
    'Прошёл пешком до Ярославля, чтобы поступить в училище',
    'Пела в церковном хоре, а потом — в сельском клубе',
  ],
  [
    'Первым в семье получил высшее образование',
    'Сорок лет собирала открытки — в альбоме больше тысячи',
    'Мастерил радиоприёмники из того, что находил на рынке',
    'Каждое лето возила детей в деревню к бабушке',
    'Объехал всю страну по комсомольским путёвкам',
    'Вязала свитеры всей семье — у каждого свой узор',
    'Играл на баяне на всех свадьбах родни',
  ],
  [
    'Собирает эту родословную вместе с семьёй',
    'Пробежала полумарафон в Казани',
    'Знает три языка и учит четвёртый',
    'Нашёл в архиве метрику прадеда',
    'Любит походы на байдарках',
    'Рисует акварелью — картины висят у всех родных',
    'Обожает собирать конструкторы',
  ],
] as const;

/** В каком возрасте появляется документ. */
const DOC_AGE: Record<string, number> = {
  'Метрическая выписка': 0,
  'Свидетельство о рождении': 0,
  'Письмо родным': 24,
  'Фото у дома': 35,
  'Трудовая книжка': 17,
  'Диплом техникума': 20,
  'Свадебное фото': 24,
  'Почётная грамота': 40,
  'Письмо из армии': 19,
  'Аттестат': 17,
  'Фото с выпускного': 17,
};

const DOCS: DocTile[][] = [
  [
    { title: 'Метрическая выписка', kind: 'certificate' },
    { title: 'Письмо родным', kind: 'letter' },
    { title: 'Фото у дома', kind: 'photo' },
    { title: 'Трудовая книжка', kind: 'diploma' },
  ],
  [
    { title: 'Диплом техникума', kind: 'diploma' },
    { title: 'Свадебное фото', kind: 'photo' },
    { title: 'Почётная грамота', kind: 'certificate' },
    { title: 'Письмо из армии', kind: 'letter' },
  ],
  [
    { title: 'Аттестат', kind: 'diploma' },
    { title: 'Фото с выпускного', kind: 'photo' },
    { title: 'Свидетельство о рождении', kind: 'certificate' },
  ],
];

function storyOf(r: () => number, p: Profile, y: number, job: string | undefined): string {
  const she = p.gender === 'female';
  const v = (m: string, f: string) => (she ? f : m);
  const place = p.birth?.place ?? 'деревне';
  const e = era(y);
  const parts: string[] = [];
  if (e === 0) {
    parts.push(
      `${v('Родился', 'Родилась')} в ${y} году — ${place}. В семье было ${pick(r, ['пятеро', 'шестеро', 'семеро'])} детей, и с ранних лет ${p.given} ${v('помогал', 'помогала')} по хозяйству: ${pick(r, [v('пас гусей', 'пасла гусей'), v('носил воду с родника', 'носила воду с родника'), v('нянчил младших', 'нянчила младших')])}.`,
    );
    parts.push(
      job
        ? `Всю жизнь ${v('проработал', 'проработала')} — ${job.toLowerCase()}. ${v('Его', 'Её')} уважали за спокойный характер и золотые руки; к ${v('нему', 'ней')} шли за советом со всей округи.`
        : `${v('Его', 'Её')} уважали за спокойный характер и золотые руки.`,
    );
    parts.push(
      `В трудные годы семья держалась вместе. Дома до сих пор хранят ${pick(r, ['самовар', 'сундук с вышивкой', 'старые часы с кукушкой'])}, который помнит ${v('его', 'её')} руки, и рассказы о том, как по вечерам все собирались за одним столом.`,
    );
  } else if (e === 1) {
    parts.push(
      `${v('Родился', 'Родилась')} в ${y} году в городе ${p.birth?.place ?? 'Ярославль'}. После школы ${v('поступил', 'поступила')} в ${pick(r, ['политехнический институт', 'медицинское училище', 'педагогический институт', 'техникум'])} и ${v('уехал', 'уехала')} по распределению.`,
    );
    if (job) parts.push(`Работа — ${job.toLowerCase()} — была делом жизни. Коллеги вспоминают ${v('его', 'её')} как человека, который никогда не отказывал в помощи.`);
    parts.push(
      `Летом вся семья собиралась на даче: ${pick(r, ['сажали яблони', 'варили варенье из крыжовника', 'строили баню своими руками'])}. Эти фотографии — одни из самых любимых в семейном архиве.`,
    );
  } else {
    parts.push(`${v('Родился', 'Родилась')} в ${y} году в городе ${p.birth?.place ?? 'Москва'}.`);
    if (job && !/Школ|Студент/.test(job)) parts.push(`По профессии — ${job.toLowerCase()}. В свободное время ${pick(r, ['путешествует с семьёй', 'занимается спортом', 'восстанавливает старые фотографии'])}.`);
    else parts.push(`Любит ${pick(r, ['рисовать', 'читать про путешествия', 'играть в футбол', 'собирать гербарий'])} и расспрашивать старших о том, как жила семья раньше.`);
  }
  return parts.join('\n\n');
}

function isoDate(r: () => number, y: number): string {
  const m = 1 + Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Поколение каждого человека: дети ниже родителей, супруги на одном уровне. */
function generations(family: FamilyData): Map<string, number> {
  const gen = new Map(family.persons.map((p) => [p.id, 0]));
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (const r of family.relations) {
      if (r.kind === 'parent') {
        if (r.type === 'raised_by' || r.type === 'step') continue;
        const want = (gen.get(r.parentId) ?? 0) + 1;
        if ((gen.get(r.childId) ?? 0) < want) {
          gen.set(r.childId, want);
          changed = true;
        }
      } else {
        const m = Math.max(gen.get(r.aId) ?? 0, gen.get(r.bId) ?? 0);
        for (const id of [r.aId, r.bId]) {
          if ((gen.get(id) ?? 0) < m) {
            gen.set(id, m);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return gen;
}

/** Анкеты для всех людей фикстуры. Фамилия из фикстуры — фамилия при рождении. */
export function buildDemoProfiles(family: FamilyData, base = 1897): Map<string, Profile> {
  const gen = generations(family);
  const byId = new Map(family.persons.map((p) => [p.id, p]));
  const parentsOf = new Map<string, string[]>();
  for (const r of family.relations) {
    if (r.kind !== 'parent' || r.type === 'raised_by' || r.type === 'step') continue;
    parentsOf.set(r.childId, [...(parentsOf.get(r.childId) ?? []), r.parentId]);
  }
  const spouses = family.relations.filter((r) => r.kind === 'spouse');
  const islandIds = new Set(family.persons.filter((p) => p.id.startsWith('isl-')).map((p) => p.id));

  const birthYear = new Map<string, number>();
  for (const p of family.persons) {
    const r = rng(`y:${p.id}`);
    const g0 = islandIds.has(p.id) ? base + 40 : base;
    birthYear.set(p.id, Math.min(TODAY_YEAR - 2, g0 + (gen.get(p.id) ?? 0) * 27 + Math.floor(r() * 9) - 3));
  }

  const out = new Map<string, Profile>();
  const order = [...family.persons].sort((a, b) => (gen.get(a.id) ?? 0) - (gen.get(b.id) ?? 0));
  const birthSurname = (p: Person) => genderSurname(p.name.split(' ')[0], p.gender);

  for (const p of order) {
    const r = rng(p.id);
    const y = birthYear.get(p.id)!;
    const father = (parentsOf.get(p.id) ?? []).map((id) => byId.get(id)!).find((x) => x.gender === 'male');
    const fatherProfile = father ? out.get(father.id) : undefined;
    const given = p.gender === 'female' ? pick(r, femaleNames(y)) : pick(r, maleNames(y))[0];
    const patronymic = fatherProfile ? patronymicFrom(fatherProfile.given, p.gender) : patronymicFrom(pick(r, maleNames(y - 28))[0], p.gender);
    const surnameAtBirth = fatherProfile ? genderSurname(fatherProfile.maidenName ?? fatherProfile.surname, p.gender) : birthSurname(p);

    const e = era(y);
    const birthPlace = e === 0 ? pick(r, PLACES_OLD) : pick(r, PLACES);
    const ageNow = TODAY_YEAR - y;
    const deathChance = ageNow > 95 ? 1 : ageNow > 80 ? 0.75 : ageNow > 65 ? 0.25 : 0;
    const dies = r() < deathChance;
    const deathYear = dies ? Math.min(TODAY_YEAR - 1, y + 58 + Math.floor(r() * 30)) : undefined;
    const jobs = JOBS[e][p.gender === 'female' ? 'f' : 'm'];
    let job: string | undefined = pick(r, jobs);
    if (ageNow < 7) job = undefined;
    else if (ageNow < 17) job = p.gender === 'female' ? 'Школьница' : 'Школьник';
    else if (/Школ/.test(job)) job = p.gender === 'female' ? 'Студентка' : pick(r, jobs.slice(0, 4));

    const facts = [...FACTS[e]].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 2)).map((text, i) => ({ id: `demo-fact-${p.id}-${i}`, text }));
    const docs = DOCS[e].slice(0, 2 + Math.floor(r() * (DOCS[e].length - 1))).map((d) => ({ ...d, year: y + (DOC_AGE[d.title] ?? 20) })).filter((d) => d.year <= TODAY_YEAR);

    const prof: Profile = {
      id: p.id,
      gender: p.gender,
      surname: surnameAtBirth,
      given,
      patronymic,
      birth: { date: isoDate(r, y), place: birthPlace },
      death: deathYear ? { date: isoDate(r, deathYear), place: r() < 0.6 ? birthPlace : pick(r, PLACES) } : undefined,
      occupation: job,
      facts,
      docs,
      photo: r() < 0.86 ? { kind: 'portrait' } : { kind: 'initials' },
    };
    prof.story = storyOf(r, prof, y, job);
    out.set(p.id, prof);
  }

  // Замужние женщины берут фамилию мужа по первому браку; фамилия при рождении — девичья.
  for (const s of spouses) {
    if (s.kind !== 'spouse' || s.order !== 1) continue;
    const a = out.get(s.aId);
    const b = out.get(s.bId);
    if (!a || !b) continue;
    const [wife, husband] = a.gender === 'female' && b.gender === 'male' ? [a, b] : b.gender === 'female' && a.gender === 'male' ? [b, a] : [null, null];
    if (!wife || !husband) continue;
    const married = genderSurname(husband.maidenName ?? husband.surname, 'female');
    if (married !== wife.surname) {
      wife.maidenName = wife.surname;
      wife.surname = married;
    }
  }
  return out;
}

/** У вошедшего всегда есть фото — с него начинается дерево. */
export function ensurePortrait(profiles: Map<string, Profile>, id: string): void {
  const p = profiles.get(id);
  if (p && p.photo.kind === 'initials') p.photo = { kind: 'portrait' };
}

/** Анкета для нового, только что добавленного человека. */
export function newProfile(id: string, gender: Gender, surname: string, given: string, patronymic: string, birthDate?: string, birthPlace?: string): Profile {
  return {
    id,
    gender,
    surname: surname.trim(),
    given: given.trim(),
    patronymic: patronymic.trim(),
    birth: birthDate ? { date: birthDate, place: birthPlace?.trim() || undefined } : undefined,
    facts: [],
    docs: [],
    photo: { kind: 'initials' },
  };
}
