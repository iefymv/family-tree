// Сценарий 3: родственник добавляет сестру с датой и фото; админ после перезагрузки видит её и автора.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectComfortable, isPhone, login, logout, sheet, treeReady } from './support/app';
import { makePng } from './support/app';

test('сценарий 3: «+» сестра с датой и фото → админ видит «Добавил(а): Пётр»', async ({ page }, info) => {
  const given = isPhone(info) ? 'Вера' : 'Надежда';
  await login(page, LOGINS.petr, pw('petr'));

  // Зелёный «+» сбоку от своей карточки — «Брат, сестра».
  await page.locator(`.add-chip[data-add="sibling"][data-for="${P.petr}"]`).click();
  const dlg = page.locator('dialog.add-dialog[open]');
  await expect(dlg.getByRole('heading', { name: 'Брат или сестра' })).toBeVisible();
  await expect(dlg.locator('input[type="date"]')).toHaveCount(0); // никаких мм/дд/гггг
  await expect(dlg.getByLabel('Дата рождения')).toHaveAttribute('placeholder', /12\.03\.1955/);
  await dlg.getByRole('radio', { name: 'Женщина' }).check();
  await expect(dlg.getByLabel('Фамилия')).toHaveValue('Иванова');
  await expect(dlg.getByLabel('Отчество')).toHaveValue('Николаевна');
  await dlg.getByLabel('Имя').fill(given);
  await dlg.getByLabel('Дата рождения').fill('20–25 мая 1960');
  await dlg.getByLabel('Место рождения').fill('г. Тверь');
  await expectComfortable(page, 'форма добавления');
  await dlg.getByRole('button', { name: 'Добавить' }).click();

  await expect(sheet(page).locator('.hn-given')).toHaveText(`${given} Николаевна`);
  const newId = await page.locator('.card.is-selected').getAttribute('data-id');
  expect(newId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator(`.card[data-id="${newId}"] .dates`)).toHaveText('род. 20–25 мая 1960');

  // Фото: сгенерировано на лету.
  await page.getByTestId('photo-input').setInputFiles({ name: 'sister.png', mimeType: 'image/png', buffer: makePng(400, 500, [200, 120, 90]) });
  await expect(page.locator('.toast')).toContainText('Фото добавлено');
  await expect(page.locator(`.card[data-id="${newId}"] image.photo`)).toHaveAttribute('href', /\/storage\/v1\/object\/sign\/documents\/people\//);

  await logout(page);
  await login(page, LOGINS.admin, pw('admin'));
  await page.reload();
  await treeReady(page);
  await page.getByRole('searchbox', { name: 'Найти родственника' }).fill(given);
  await page.locator('.search-results button', { hasText: given }).click();
  await expect(page.locator(`.card.is-found[data-id="${newId}"]`)).toBeVisible();
  await page.locator(`.card[data-id="${newId}"]`).click();
  await expect(sheet(page).locator('.d-row', { hasText: 'Добавил(а) на дерево' })).toContainText('Пётр');
  await expect(sheet(page).locator('.d-row', { hasText: 'Дата рождения' })).toContainText('20–25 мая 1960');
  // Миниатюра действительно загружается.
  const hero = sheet(page).locator('img.hero-img');
  await expect(hero).toHaveAttribute('src', /\/storage\/v1\/object\/sign\//);
  const src = (await hero.getAttribute('src'))!;
  expect((await page.request.get(src)).status()).toBe(200);
  await expect.poll(() => hero.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
});
