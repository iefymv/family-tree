// Сценарии 2 и 9: вход по имени и фамилии с телефона → дерево с собой в центре; рядом родители, сыновья, сестра.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectCentered, expectComfortable, offCenter, treeReady } from './support/app';

test('сценарии 2 и 9: вход по имени → «я» в центре, «Ко мне» возвращает', async ({ page }) => {
  await page.goto('/');
  await expectComfortable(page, 'экран входа');
  const name = page.getByLabel('Имя и фамилия');
  await expect(name).toHaveAttribute('autocapitalize', 'off');
  await expect(name).toHaveAttribute('autocorrect', 'off');
  await expect(name).toHaveAttribute('spellcheck', 'false');

  // Ошибки — по-русски и понятно.
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Введите имя и фамилию');
  await name.fill('Пётр Иванов');
  await page.getByLabel('Пароль').fill('не-тот-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверное имя или пароль');
  await name.fill('Пётр@Иванов');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toContainText('Недопустимый символ');

  // Регистр, «ё» и лишние пробелы не мешают.
  await name.fill('  пётр   ИВАНОВ ');
  await page.getByLabel('Пароль').fill(pw('petr'));
  await page.getByRole('button', { name: 'Войти' }).click();
  await treeReady(page);

  const me = '.card.is-root .photo-ring';
  await expect(page.locator(`.card.is-root[data-id="${P.petr}"]`)).toBeVisible();
  await expectCentered(page, me);
  expect((await offCenter(page, `.card.is-root[data-id="${P.petr}"]`)).width).toBeGreaterThanOrEqual(160);
  await expectComfortable(page, 'дерево');

  // Отдалить — родители, сыновья и сестра на экране.
  await page.getByRole('button', { name: 'Уменьшить' }).click();
  await page.getByRole('button', { name: 'Уменьшить' }).click();
  const vp = page.viewportSize()!;
  for (const id of [P.nikolai, P.maria, P.ilya, P.andrei, P.olga]) {
    await expect.poll(async () => {
      const b = await page.locator(`.card[data-id="${id}"] .photo-ring`).boundingBox();
      return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
    }, { message: `на экране: ${id}` }).toBe(true);
  }

  // Сдвинуть дерево и вернуться «Ко мне».
  const box = (await page.locator('.tree-svg').boundingBox())!;
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.width / 2 - 150, box.height / 2 - 250, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await offCenter(page, me)).dy > 0.15 || (await offCenter(page, me)).dx > 0.15).toBe(true);
  await page.getByRole('button', { name: 'Показать меня' }).click();
  await expectCentered(page, me);

  // Сессия сохраняется после перезагрузки.
  await page.reload();
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${P.petr}"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toHaveCount(0);
});

test('админ входит — в центре он сам', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Имя и фамилия').fill(LOGINS.admin);
  await page.getByLabel('Пароль').fill(pw('admin'));
  await page.getByRole('button', { name: 'Войти' }).click();
  await treeReady(page);
  await expect(page.locator(`.card.is-root[data-id="${P.ilya}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
});
