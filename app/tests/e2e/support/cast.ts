// Вымышленная семья Ивановых из supabase/seed.sql и роли в сценариях (как в плане, раздел 8).
import { readFileSync } from 'node:fs';

export const SEED = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
export const P = {
  semen: SEED[0], // прадед
  anna: SEED[1], // прабабушка, девичья Петрова
  nikolai: SEED[2],
  maria: SEED[3],
  petr: SEED[4], // «папа», relative
  olga: SEED[5], // сестра папы, relative
  elena: SEED[6],
  ilya: SEED[7], // «Ефим», admin
  andrei: SEED[8], // брат; вход создаёт админ в сценарии 1 (телефон)
  ksenia: SEED[9], // сестра; вход создаёт админ в сценарии 1 (компьютер)
  matvei: SEED[10],
} as const;

/** Логины e2e. Перед прогоном и после него входы этих карточек удаляются. */
export const LOGINS = {
  admin: 'Илья Иванов',
  petr: 'Пётр Иванов',
  olga: 'Ольга Иванова',
  andrei: 'Андрей Иванов',
  ksenia: 'Ксения Иванова',
} as const;

/** Карточки, к которым e2e привязывает входы. */
export const E2E_PERSONS = [P.ilya, P.petr, P.olga, P.andrei, P.ksenia, P.matvei, P.elena];

/** Имена из фикстуры — для проверки «без входа не видно ни одного имени». */
export const SEED_NAMES = ['Семён', 'Анна', 'Николай', 'Мария', 'Пётр', 'Ольга', 'Елена', 'Илья', 'Андрей', 'Ксения', 'Матвей', 'Иванов', 'Петров', 'Сидоров'];

export const pw = (role: 'admin' | 'petr' | 'olga') => process.env[`E2E_PW_${role.toUpperCase()}`]!;

/** Тестовый семейный пароль локальных функций (генерирует serve-functions; настоящий сюда не попадает). */
export const familyPw = () => readFileSync(new URL('../../../../supabase/.temp/family-password.test', import.meta.url), 'utf8').trim();

/** Самодобавленные семейным входом в сценарии 13 (вымышленные); их входы и карточки убираются после прогона. */
export const SELF_ADDED_LOGINS = ['ярослав иванов', 'всеволод иванов'];
