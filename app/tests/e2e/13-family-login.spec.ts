// Сценарий 13: вход по общему семейному паролю без заранее созданной учётки.
// Есть карточка — вход сразу на неё; нет — человек находит родственника и добавляет себя сам. Приветствие — один раз.
// Люди — вымышленные Ивановы из seed.sql и самодобавленные Ярослав/Всеволод (их убирает global-teardown).
import { expect, test } from '@playwright/test';
import { P, familyPw } from './support/cast';
import { expectCentered, expectComfortable, isPhone, logout, treeReady } from './support/app';
import { service } from './support/stack';

test.use({ storageState: { cookies: [], origins: [] } }); // приветствие на этом «устройстве» ещё не закрывали

async function familyLogin(page: import('@playwright/test').Page, name: string) {
  await page.getByLabel('Имя и фамилия').fill(name);
  await page.getByLabel('Пароль').fill(familyPw());
  await page.getByRole('button', { name: 'Войти' }).click();
}

test('семейный пароль: человек с карточкой входит сразу на неё; приветствие показывается, пока не закроют', async ({ page }, info) => {
  // Елена — по девичьей фамилии: поиск идёт по полям карточки.
  const who = isPhone(info) ? { id: P.matvei, name: 'Матвей Иванов' } : { id: P.elena, name: 'Елена Петрова' };
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Наше семейное дерево' })).toBeVisible();
  await expect(page.locator('.login-welcome li')).toHaveText([
    'Не нашли себя или знаете кого-то из родных — добавьте',
    'Нашли ошибку или неточность — смело правьте',
    'Знаете факт, дату или историю — допишите, даже если не уверены',
    'Есть старые фото или документы — загрузите',
  ]);
  await expect(page.locator('.login-welcome')).toContainText('Ничего не потеряется: каждая правка сохраняется, и прежний вариант всегда можно вернуть.');
  await expectComfortable(page, 'экран входа с приветствием');

  await familyLogin(page, who.name);
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${who.id}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
  const { data: m } = await service().from('members').select('family_login, role').eq('person_id', who.id).single();
  expect(m).toEqual({ family_login: true, role: 'relative' });

  const welcome = page.locator('.welcome-card');
  await expect(welcome.getByRole('heading', { name: 'Наше семейное дерево' })).toBeVisible();
  await expectComfortable(page, 'приветствие на дереве');
  await welcome.getByRole('button', { name: 'Понятно' }).click();
  await expect(welcome).toHaveCount(0);

  // Повторный вход на том же устройстве: та же учётка, приветствия нет.
  await logout(page);
  await familyLogin(page, who.name);
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${who.id}"]`)).toBeVisible();
  await expect(page.locator('.welcome-card')).toHaveCount(0);
  const { count } = await service().from('members').select('*', { count: 'exact', head: true }).eq('person_id', who.id);
  expect(count).toBe(1);
});

test('семейный пароль: кого нет на дереве — находит родственника, «я их ребёнок», входит на свою новую карточку', async ({ page }, info) => {
  const given = isPhone(info) ? 'Ярослав' : 'Всеволод';
  await page.goto('/');
  await familyLogin(page, `${given} Иванов`);
  await expect(page.getByText('Вас ещё нет на дереве. Кем вы приходитесь родне?')).toBeVisible();
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue(given);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Иванов');

  await page.getByLabel('Найдите родственника на дереве').fill('Ольга Иван');
  await page.locator(`.admin-pick[data-id="${P.olga}"]`).click();
  await expect(page.locator('.admin-chosen')).toContainText('Иванова Ольга Николаевна, 1958');
  await page.getByText('я их ребёнок').click();
  await page.getByLabel('Год или дата рождения (необязательно)').fill('1996');
  await page.getByText('мужской').click();
  await expectComfortable(page, 'шаг «Кем вы приходитесь родне?»');
  await page.getByRole('button', { name: 'Добавить меня и войти' }).click();
  await treeReady(page);

  const login = `${given.toLowerCase().replace(/ё/g, 'е')} иванов`;
  const { data: m } = await service().from('members').select('person_id, family_login, display_name').eq('login', login).single();
  expect(m?.family_login).toBe(true);
  expect(m?.display_name).toBe(given);
  await expect(page.locator(`.card.is-root[data-id="${m!.person_id}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
  const { data: rel } = await service().from('relations_live').select('from_person').eq('kind', 'parent').eq('to_person', m!.person_id);
  expect(rel).toEqual([{ from_person: P.olga }]);
  await expect(page.locator('.welcome-card')).toBeVisible();
});

test('семейный пароль: опечатка в фамилии → «Это вы?» → вход на свою карточку; «Нет» ведёт к добавлению', async ({ page }, info) => {
  const who = isPhone(info) ? { id: P.matvei, typed: 'Матвей Иваноф' } : { id: P.elena, typed: 'Елена Петрава' };
  await page.goto('/');
  await familyLogin(page, who.typed);
  await expect(page.getByText('Это вы?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeHidden();
  await expectComfortable(page, '«Это вы?»');
  await page.getByRole('button', { name: 'Нет, меня нет на дереве' }).click();
  await expect(page.getByText('Вас ещё нет на дереве. Кем вы приходитесь родне?')).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.locator(`.admin-pick[data-id="${who.id}"]`).click();
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${who.id}"]`)).toBeVisible();
  const { count } = await service().from('members').select('*', { count: 'exact', head: true }).eq('person_id', who.id);
  expect(count).toBe(1);
});
