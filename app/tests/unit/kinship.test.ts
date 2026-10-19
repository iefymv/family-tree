// «Кем приходится» относительно вошедшего: кровные, по браку, приёмные, отчим/мачеха, воспитатели.
// Фикстура вымышленная: Ивановы и смежные семьи, id — условные коды.
import { describe, expect, it } from 'vitest';
import { bloodLabel, kinshipMap } from '../../src/tree/kinship';
import type { FamilyData, Gender, ParentType, Relation } from '../../src/tree/graph';
import { GRANDCHILD, ivanovBig } from '../fixtures/ivanov-big';

const persons: FamilyData['persons'] = [];
const relations: Relation[] = [];
const P = (id: string, gender: Gender) => (persons.push({ id, gender, name: `Иванов ${id}` }), id);
const kid = (parents: string[], id: string, gender: Gender, type: ParentType = 'biological') => {
  P(id, gender);
  for (const p of parents) relations.push({ kind: 'parent', parentId: p, childId: id, type });
  return id;
};
const wed = (a: string, b: string, order = 1, divorced = false) => relations.push({ kind: 'spouse', aId: a, bId: b, order, divorced });
const over = (from: string, to: string, type: 'raised_by' | 'step') => relations.push({ kind: 'parent', parentId: from, childId: to, type });

// Предки по отцу: прапрадед → прадед → дед; брат деда со своей веткой.
P('gggf', 'male');
P('gggm', 'female');
wed('gggf', 'gggm');
kid(['gggf', 'gggm'], 'ggf', 'male');
P('ggm', 'female');
wed('ggf', 'ggm');
kid(['ggf', 'ggm'], 'gf', 'male');
kid(['ggf', 'ggm'], 'gfbro', 'male');
P('gfbro-w', 'female');
wed('gfbro', 'gfbro-w');
kid(['gfbro', 'gfbro-w'], 'gfbro-kid', 'female');
P('gfbro-kid-h', 'male');
wed('gfbro-kid', 'gfbro-kid-h');
kid(['gfbro-kid', 'gfbro-kid-h'], 'gfbro-gk', 'male');
P('gm', 'female');
wed('gf', 'gm');
// Отец, тётя; мать (развод), мачеха, сводный брат.
kid(['gf', 'gm'], 'dad', 'male');
kid(['gf', 'gm'], 'aunt', 'female');
P('aunt-h', 'male');
wed('aunt', 'aunt-h');
kid(['aunt', 'aunt-h'], 'cousin', 'male');
P('cousin-w', 'female');
wed('cousin', 'cousin-w');
kid(['cousin', 'cousin-w'], 'cousin-kid', 'female');
P('mom-f', 'male');
P('mom-m', 'female');
wed('mom-f', 'mom-m');
kid(['mom-f', 'mom-m'], 'mom', 'female');
wed('dad', 'mom', 1, true);
P('stepmom', 'female');
wed('dad', 'stepmom', 2);
const ME = kid(['dad', 'mom'], 'me', 'male');
kid(['dad', 'mom'], 'sis', 'female');
kid(['dad', 'stepmom'], 'halfbro', 'male');
P('mom-h2', 'male');
wed('mom', 'mom-h2', 2);
over('mom-h2', ME, 'step');
// Сестра, её муж и потомки.
P('sis-h', 'male');
wed('sis', 'sis-h');
kid(['sis', 'sis-h'], 'niece', 'female');
P('niece-h', 'male');
wed('niece', 'niece-h');
kid(['niece', 'niece-h'], 'grandnephew', 'male');
// Жена и её родня; её дочь от прошлого брака.
P('wife', 'female');
wed(ME, 'wife');
P('w-f', 'male');
P('w-m', 'female');
wed('w-f', 'w-m');
relations.push({ kind: 'parent', parentId: 'w-f', childId: 'wife', type: 'biological' }, { kind: 'parent', parentId: 'w-m', childId: 'wife', type: 'biological' });
kid(['w-f', 'w-m'], 'w-bro', 'male');
kid(['w-f', 'w-m'], 'w-sis', 'female');
P('w-ex', 'male');
wed('wife', 'w-ex', 0, true);
kid(['wife', 'w-ex'], 'w-kid', 'female');
// Дети, внуки, правнуки; приёмная дочь; сваты.
kid([ME, 'wife'], 'son', 'male');
kid([ME, 'wife'], 'daughter', 'female');
kid([ME, 'wife'], 'adopted', 'female', 'adoptive');
P('son-w', 'female');
wed('son', 'son-w');
P('sw-f', 'male');
P('sw-m', 'female');
wed('sw-f', 'sw-m');
relations.push({ kind: 'parent', parentId: 'sw-f', childId: 'son-w', type: 'biological' }, { kind: 'parent', parentId: 'sw-m', childId: 'son-w', type: 'biological' });
kid(['son', 'son-w'], 'gson', 'male');
kid(['gson'], 'ggson', 'female');
kid(['ggson'], 'gggson', 'male');
P('daughter-h', 'male');
wed('daughter', 'daughter-h');
// Бывшая жена отца (до мамы); жена двоюродного брата уже есть (cousin-w); жена брата деда — gfbro-w.
P('dad-ex', 'female');
wed('dad', 'dad-ex', 0, true);
// Воспитательница, воспитанник; брат или сестра без указанного пола; остров.
P('nanny', 'female');
over('nanny', ME, 'raised_by');
over('aunt', ME, 'raised_by');
P('ward', 'male');
over(ME, 'ward', 'raised_by');
kid(['dad', 'mom'], 'sib-x', 'unknown');
P('island', 'male');

const family: FamilyData = { persons, relations };
const kin = kinshipMap(family, ME);

const CASES: [string, string][] = [
  ['me', 'Это вы'],
  ['dad', 'Отец'],
  ['mom', 'Мать'],
  ['gf', 'Дедушка'],
  ['gm', 'Бабушка'],
  ['mom-f', 'Дедушка'],
  ['mom-m', 'Бабушка'],
  ['ggf', 'Прадедушка'],
  ['ggm', 'Прабабушка'],
  ['gggf', 'Прапрадедушка'],
  ['gggm', 'Прапрабабушка'],
  ['sis', 'Сестра'],
  ['halfbro', 'Сводный брат'],
  ['sib-x', 'Брат / сестра'],
  ['stepmom', 'Мачеха'],
  ['mom-h2', 'Отчим'],
  ['aunt', 'Тётя · воспитала'],
  ['aunt-h', 'Дядя'],
  ['cousin', 'Двоюродный брат'],
  ['cousin-kid', 'Двоюродная племянница'],
  ['gfbro', 'Двоюродный дедушка'],
  ['gfbro-kid', 'Двоюродная тётя'],
  ['gfbro-gk', 'Троюродный брат'],
  ['sis-h', 'Зять'],
  ['niece', 'Племянница'],
  ['niece-h', 'Муж племянницы'],
  ['grandnephew', 'Внучатый племянник'],
  ['wife', 'Жена'],
  ['w-f', 'Тесть'],
  ['w-m', 'Тёща'],
  ['w-bro', 'Шурин'],
  ['w-sis', 'Свояченица'],
  ['w-kid', 'Падчерица'],
  ['son', 'Сын'],
  ['daughter', 'Дочь'],
  ['adopted', 'Приёмная дочь'],
  ['son-w', 'Невестка'],
  ['daughter-h', 'Зять'],
  ['sw-f', 'Сват'],
  ['sw-m', 'Сватья'],
  ['gson', 'Внук'],
  ['ggson', 'Правнучка'],
  ['gggson', 'Праправнук'],
  ['nanny', 'Воспитательница'],
  ['ward', 'Воспитанник'],
  ['w-ex', 'Родственник'],
  ['dad-ex', 'Бывшая жена отца'],
  ['cousin-w', 'Жена двоюродного брата'],
  ['gfbro-w', 'Двоюродная бабушка'],
  ['gfbro-kid-h', 'Двоюродный дядя'],
];

describe('кем приходится вошедшему', () => {
  it.each(CASES)('%s → %s', (id, label) => {
    expect(kin.get(id)).toBe(label);
  });
  it('несвязанных не подписываем', () => {
    expect(kin.has('island')).toBe(false);
  });
  it('с точки зрения жены — родня мужа', () => {
    const k = kinshipMap(family, 'wife');
    expect(k.get(ME)).toBe('Муж');
    expect(k.get('dad')).toBe('Свёкор');
    expect(k.get('mom')).toBe('Свекровь');
    expect(k.get('sis')).toBe('Золовка');
    expect(k.get('halfbro')).toBe('Деверь');
    expect(k.get('w-ex')).toBe('Бывший муж');
    expect(k.get('w-kid')).toBe('Дочь');
  });
  it('относительно вошедшего, а не выбранного: другой корень — другие подписи', () => {
    expect(kinshipMap(family, 'son').get(ME)).toBe('Отец');
    expect(kinshipMap(family, 'son').get('dad')).toBe('Дедушка');
  });
  it('большая фикстура: у всех связанных есть подпись, острова — без', () => {
    const k = kinshipMap(ivanovBig, GRANDCHILD);
    const island = ivanovBig.persons.filter((p) => p.id.startsWith('isl-'));
    for (const p of ivanovBig.persons) {
      if (island.includes(p)) expect(k.has(p.id)).toBe(false);
      else expect(k.get(p.id), p.id).toBeTruthy();
    }
    expect(k.get('s6-c1')).toBe('Двоюродная сестра');
    expect(k.get('cz1')).toMatch(/^Двоюродн/);
  });
  it('bloodLabel: дальние степени', () => {
    expect(bloodLabel(4, 4, 'male')).toBe('Четвероюродный брат');
    expect(bloodLabel(5, 5, 'female')).toBe('Дальняя сестра');
    expect(bloodLabel(4, 1, 'male')).toBe('Двоюродный прадедушка');
    expect(bloodLabel(1, 4, 'female')).toBe('Правнучатая племянница');
    expect(bloodLabel(3, 2, 'female')).toBe('Двоюродная тётя');
  });
});
