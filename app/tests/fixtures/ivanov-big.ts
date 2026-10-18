// Вымышленная стресс-фикстура «Ивановы» (≈120 узлов), генерируется кодом.
// Все люди выдуманы; имена — фамилия + условный код, без реальных имён.
import type { FamilyData, Gender, ParentType, Person, Relation } from '../../src/tree/graph';

const persons: Person[] = [];
const relations: Relation[] = [];

function person(id: string, surname: string, gender: Gender): string {
  const name = `${gender === 'female' ? surname + 'а' : surname} ${id}`;
  persons.push({ id, name, gender });
  return id;
}
function marry(a: string, b: string, order = 1, divorced = false): void {
  relations.push({ kind: 'spouse', aId: a, bId: b, order, divorced });
}
function child(parents: string[], id: string, surname: string, gender: Gender, type: ParentType = 'biological'): string {
  person(id, surname, gender);
  for (const p of parents) relations.push({ kind: 'parent', parentId: p, childId: id, type });
  return id;
}
const g = (i: number): Gender => (i % 2 === 0 ? 'male' : 'female');

// Поколение −1: прадед и прабабушка.
const ggf = person('ggf', 'Иванов', 'male');
const ggm = person('ggm', 'Иванов', 'female');
marry(ggf, ggm);

// Поколение 0: дед и бабушка; брат деда (ветка двоюродных).
export const GRANDFATHER = child([ggf, ggm], 'gf', 'Иванов', 'male');
// Родители бабушки (Зайцевы) — ещё одна линия предков.
const gmF = person('gm-f', 'Зайцев', 'male');
const gmM = person('gm-m', 'Зайцев', 'female');
marry(gmF, gmM);
const gm = child([gmF, gmM], 'gm', 'Зайцев', 'female');
marry(GRANDFATHER, gm);
const gfBro = child([ggf, ggm], 'gfbro', 'Иванов', 'male');
const gfBroW = person('gfbro-w', 'Иванов', 'female');
marry(gfBro, gfBroW);

// Поколение 1: 9 сиблингов (дети деда), у каждого супруг и 1–3 ребёнка.
const SIB_KIDS = [0, 2, 3, 1, 2, 3, 2, 1, 3]; // s1 — отдельно, 3 брака
const siblings: string[] = [];
const sibSpouses: string[] = [];
for (let i = 1; i <= 9; i++) {
  const sex: Gender = [1, 3, 5, 8].includes(i) ? 'male' : 'female';
  const s = child([GRANDFATHER, gm], `s${i}`, 'Иванов', sex);
  const spSurname = ['Петров', 'Сидоров', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Новиков', 'Фёдоров', 'Морозов'][i - 1];
  const sp = person(`s${i}-sp`, spSurname, sex === 'male' ? 'female' : 'male');
  marry(s, sp, 1, i === 1);
  siblings.push(s);
  sibSpouses.push(sp);
}

// s1: три брака, дети от каждого.
export const THRICE_MARRIED = 's1';
const s1w2 = person('s1-sp2', 'Лебедев', 'female');
const s1w3 = person('s1-sp3', 'Козлов', 'female');
marry('s1', s1w2, 2, true);
marry('s1', s1w3, 3);
const gen2: string[] = [];
gen2.push(child(['s1', 's1-sp'], 's1-c1', 'Иванов', 'male'));
gen2.push(child(['s1', 's1-sp'], 's1-c2', 'Иванов', 'female'));
gen2.push(child(['s1', s1w2], 's1-c3', 'Иванов', 'male'));
gen2.push(child(['s1', s1w3], 's1-c4', 'Иванов', 'female'));
gen2.push(child(['s1', s1w3], 's1-c5', 'Иванов', 'male'));

// Дети остальных сиблингов.
for (let i = 2; i <= 9; i++) {
  const s = `s${i}`;
  const sp = `s${i}-sp`;
  for (let k = 1; k <= SIB_KIDS[i - 1]; k++) {
    gen2.push(child([s, sp], `${s}-c${k}`, 'Иванов', g(i + k)));
  }
}

// Супруг s2 «из другой семьи» — со своими родителями и братом.
export const SPOUSE_OTHER_FAMILY = 's2-sp';
const sidF = person('sid-f', 'Сидоров', 'male');
const sidM = person('sid-m', 'Сидоров', 'female');
marry(sidF, sidM);
relations.push({ kind: 'parent', parentId: sidF, childId: SPOUSE_OTHER_FAMILY, type: 'biological' });
relations.push({ kind: 'parent', parentId: sidM, childId: SPOUSE_OTHER_FAMILY, type: 'biological' });
const sidBro = child([sidF, sidM], 'sid-bro', 'Сидоров', 'male');
const sidBroW = person('sid-bro-w', 'Сидоров', 'female');
marry(sidBro, sidBroW);
child([sidBro, sidBroW], 'sid-bro-c1', 'Сидоров', 'male');
child([sidBro, sidBroW], 'sid-bro-c2', 'Сидоров', 'female');

// Тётя s5 воспитывала племянника s6-c1 (raised_by — оверлей, не раскладка).
export const AUNT = 's5';
relations.push({ kind: 'parent', parentId: AUNT, childId: 's6-c1', type: 'raised_by' });
// Отчим (step) — тоже оверлей: второй муж s4… моделируем как отчима ребёнка s4.
const s4h2 = person('s4-sp2', 'Орлов', 'male');
marry('s4', s4h2, 2);
relations.push({ kind: 'parent', parentId: s4h2, childId: 's4-c1', type: 'step' });

// Поколение 2: часть внуков женится и имеет детей (поколение 3 — троюродные).
gen2.forEach((c, idx) => {
  if (idx % 3 === 2) return; // примерно треть без семьи
  const cp = persons.find((p) => p.id === c)!;
  const sp = person(`${c}-sp`, 'Егоров', cp.gender === 'male' ? 'female' : 'male');
  marry(c, sp);
  const kids = 1 + (idx % 3);
  for (let k = 1; k <= kids; k++) {
    child([c, sp], `${c}-k${k}`, 'Иванов', g(idx + k));
  }
});
export const GRANDCHILD = 's1-c1';

// Неизвестный родитель: у s3-c2 ребёнок без известного второго родителя.
export const UNKNOWN_PARENT_CHILD = child(['s3-c2'], 's3-c2-solo', 'Иванов', 'male');
// Усыновлённый ребёнок у s7.
child(['s7', 's7-sp'], 's7-adopted', 'Иванов', 'female', 'adoptive');

// Ветка брата деда: двоюродные отца (пок. 1) и их дети (пок. 2), внуки (пок. 3).
for (let k = 1; k <= 3; k++) {
  const c = child([gfBro, gfBroW], `cz${k}`, 'Иванов', g(k));
  const sp = person(`cz${k}-sp`, 'Белов', g(k + 1));
  marry(c, sp);
  for (let j = 1; j <= 2; j++) {
    const cc = child([c, sp], `cz${k}-c${j}`, 'Иванов', g(k + j));
    if (j === 1) {
      const ccsp = person(`cz${k}-c${j}-sp`, 'Гусев', g(k + j + 1));
      marry(cc, ccsp);
      child([cc, ccsp], `cz${k}-c${j}-k1`, 'Иванов', g(k));
    }
  }
}
export const COUSIN = 'cz2';

// Остров: семья, никак не связанная с Ивановыми.
const isA = person('isl-a', 'Тихонов', 'male');
const isB = person('isl-b', 'Тихонов', 'female');
marry(isA, isB);
const isC1 = child([isA, isB], 'isl-c1', 'Тихонов', 'male');
child([isA, isB], 'isl-c2', 'Тихонов', 'female');
const isC1w = person('isl-c1-w', 'Тихонов', 'female');
marry(isC1, isC1w);
child([isC1, isC1w], 'isl-c1-k1', 'Тихонов', 'female');
export const ISLAND_IDS = ['isl-a', 'isl-b', 'isl-c1', 'isl-c2', 'isl-c1-w', 'isl-c1-k1'];

export const ivanovBig: FamilyData = { persons, relations };

export const ROOTS = {
  grandfather: GRANDFATHER,
  grandchild: GRANDCHILD,
  aunt: AUNT,
  spouseOtherFamily: SPOUSE_OTHER_FAMILY,
  cousin: COUSIN,
} as const;
