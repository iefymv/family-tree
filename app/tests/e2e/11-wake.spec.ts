// «Сервер просыпается…»: запрос висит дольше 5 с — экран ожидания, затем дерево само открывается.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { login, treeReady } from './support/app';

test('сервер долго отвечает → «Сервер просыпается…» → дерево без нажатий', async ({ page }) => {
  await login(page, LOGINS.petr, pw('petr'));
  let delayed = false;
  await page.route('**/rest/v1/people_live?*', async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 7000));
    }
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('.wake')).toBeVisible({ timeout: 6500 });
  await expect(page.locator('.wake')).toContainText('Сервер просыпается…');
  await treeReady(page);
  await expect(page.locator('.wake')).toBeHidden();
  await expect(page.locator(`.card.is-root[data-id="${P.petr}"]`)).toBeVisible();

  // Сеть пропала на первый запрос — повтор сам, без ошибки на экране.
  let failed = false;
  await page.unroute('**/rest/v1/people_live?*');
  await page.route('**/rest/v1/people_live?*', async (route) => {
    if (!failed) {
      failed = true;
      return route.abort('internetdisconnected');
    }
    return route.continue();
  });
  await page.reload();
  await treeReady(page);
  expect(failed).toBe(true);
  await expect(page.locator(`.card.is-root[data-id="${P.petr}"]`)).toBeVisible();
});
