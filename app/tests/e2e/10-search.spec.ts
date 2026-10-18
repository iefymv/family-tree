// Сценарий 10: в строке поиска имя сестры → экран переезжает к её карточке, она подсвечена.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectCentered, expectComfortable, login } from './support/app';

test('сценарий 10: поиск переводит к человеку и подсвечивает', async ({ page }) => {
  await login(page, LOGINS.petr, pw('petr'));
  const box = page.getByRole('searchbox', { name: 'Найти родственника' });
  await box.fill('ольга');
  const hit = page.locator('.search-results button', { hasText: 'Иванова Ольга Николаевна' });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('Сестра');
  await expectComfortable(page, 'результаты поиска');
  await hit.click();
  await expect(page.locator(`.card.is-found[data-id="${P.olga}"]`)).toBeVisible();
  await expectCentered(page, `.card[data-id="${P.olga}"] .photo-ring`);

  // «ё» = «е», регистр не важен; Enter — первый найденный.
  await box.fill('СЕМЕН');
  await box.press('Enter');
  await expect(page.locator(`.card.is-found[data-id="${P.semen}"]`)).toBeVisible();
  await expectCentered(page, `.card[data-id="${P.semen}"] .photo-ring`);
  await box.fill('Никтотакой');
  await expect(page.locator('.search-results .empty')).toHaveText('Никого не нашли');
});
