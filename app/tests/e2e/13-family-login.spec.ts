// Сценарий 13: вход по общему семейному паролю без заранее созданной учётки.
// Есть карточка — вход сразу на неё; нет — своя карточка без связей, родню человек показывает на дереве. Приветствие — один раз.
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

test('семейный пароль: кого нет на дереве — своя карточка без связей → «+» маму у бабушки → «Это моя мама»', async ({ page }, info) => {
  const given = isPhone(info) ? 'Ярослав' : 'Всеволод';
  const mom = isPhone(info) ? 'Зоя' : 'Фаина';
  await page.goto('/');
  await familyLogin(page, `${given} Иванов`);
  await treeReady(page);

  const login = `${given.toLowerCase()} иванов`;
  const { data: m } = await service().from('members').select('person_id, family_login').eq('login', login).single();
  const me = m!.person_id as string;
  expect(m!.family_login).toBe(true);
  await page.locator('.welcome-card').getByRole('button', { name: 'Понятно' }).click(); // приветствие — первым, закрываем
  const banner = page.locator('.join-banner');
  await expect(banner).toContainText('Вы пока не связаны с деревом. Найдите родного человека и покажите, кто он вам');
  // Своя карточка «Это вы» — на экране, рядом с основным деревом.
  const vp = page.viewportSize()!;
  await expect.poll(async () => {
    const b = await page.locator(`.card.is-root[data-id="${me}"] .photo-ring`).boundingBox();
    return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
  }).toBe(true);
  await expectComfortable(page, 'баннер «не связаны»');

  // Бабушку — поиском; у выбранного человека — «Это мой…».
  await page.getByRole('searchbox', { name: 'Найти родственника' }).fill('Анна Иванова');
  await page.locator(`.search-results button[data-id="${P.anna}"]`).click();
  await expect(banner.locator('.join-who')).toContainText('Кто вам');
  await expect(banner.getByRole('button', { name: 'Это моя мама' })).toBeVisible();

  // Мамы на дереве нет — добавить её обычным «+» у бабушки.
  await page.locator(`.add-chip[data-add="child"][data-for="${P.anna}"]`).click();
  const dlg = page.locator('dialog.add-dialog[open]');
  await dlg.getByRole('radio', { name: 'Женщина' }).check();
  await dlg.getByLabel('Имя').fill(mom);
  await dlg.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.locator('.toast')).toContainText('Добавлено на дерево');
  const { data: added } = await service().from('people').select('id').eq('given_name', mom).eq('created_by', (await service().from('members').select('user_id').eq('person_id', me).single()).data!.user_id).single();
  const momId = added!.id as string;
  await page.getByRole('searchbox', { name: 'Найти родственника' }).fill(mom);
  await page.locator(`.search-results button[data-id="${momId}"]`).click();

  page.once('dialog', async (d) => {
    expect(d.message()).toMatch(new RegExp(`${mom} — ваша мать\\?$`));
    await d.accept();
  });
  await banner.getByRole('button', { name: 'Это моя мама' }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator(`.card.is-root[data-id="${me}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
  const { data: rel } = await service().from('relations_live').select('from_person').eq('kind', 'parent').eq('to_person', me);
  expect(rel).toEqual([{ from_person: momId }]);

  // Повторный вход — сразу на свою карточку, баннера нет.
  await logout(page);
  await familyLogin(page, `${given} Иванов`);
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${me}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
  await expect(page.locator('.join-banner')).toBeHidden();
});

test('семейный пароль: опечатка в фамилии → «Это вы?» → вход на свою карточку', async ({ page }, info) => {
  const who = isPhone(info) ? { id: P.matvei, typed: 'Матвей Иваноф' } : { id: P.elena, typed: 'Елена Петрава' };
  await page.goto('/');
  await familyLogin(page, who.typed);
  await expect(page.getByText('Это вы?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeHidden();
  await expectComfortable(page, '«Это вы?»');
  await expect(page.getByRole('button', { name: 'Нет, меня нет на дереве' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.locator(`.admin-pick[data-id="${who.id}"]`).click();
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${who.id}"]`)).toBeVisible();
  const { count } = await service().from('members').select('*', { count: 'exact', head: true }).eq('person_id', who.id);
  expect(count).toBe(1);
});
