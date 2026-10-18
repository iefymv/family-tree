// Сценарий 5: три снимка документа в карточке прадеда открываются с телефона; истёкшая ссылка обновляется.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectComfortable, isPhone, login, makePng, openPerson, sheet, tab } from './support/app';

test('сценарий 5: загрузить 3 скана → миниатюры → просмотр на весь экран', async ({ page }, info) => {
  const tag = isPhone(info) ? 'тел' : 'комп';
  await login(page, LOGINS.petr, pw('petr'));
  await openPerson(page, P.semen);
  await tab(page, 'Документы');
  const files = [1, 2, 3].map((i) => ({ name: `военный билет ${i} ${tag}.png`, mimeType: 'image/png', buffer: makePng(900, 1200, [220 - i * 30, 210, 180]) }));
  await page.getByTestId('doc-input').setInputFiles(files);
  await expect(page.locator('.toast')).toContainText('Добавлено документов: 3');
  const tiles = sheet(page).locator('button.doc', { hasText: `${tag}` });
  await expect(tiles).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect.poll(() => tiles.nth(i).locator('img.doc-thumb').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  }
  await expectComfortable(page, 'документы');

  // Первая выдача ссылки «истекла» (обрываем загрузку) — просмотр сам берёт новую.
  let broke = false;
  let signs = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/storage\/v1\/object\/sign\/documents/.test(r.url())) signs++; // выдача подписанных ссылок
  });
  await page.route(/\/storage\/v1\/object\/sign\/documents\/people\/.+\/[0-9a-f-]{36}\.jpg\?token=/, async (route) => {
    if (!broke) {
      broke = true;
      return route.abort();
    }
    return route.continue();
  });
  const before = signs;
  await tiles.first().click();
  const viewer = page.locator('dialog.viewer[open]');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('figcaption')).toContainText(`военный билет 1 ${tag}`);
  await expect.poll(() => viewer.locator('img.viewer-img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  expect(broke).toBe(true);
  expect(signs - before).toBeGreaterThanOrEqual(2); // ссылку выдали заново
  await expectComfortable(page, 'просмотр документа');
  await viewer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(viewer).toHaveCount(0);
});
