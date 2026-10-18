// Сценарий 4: сестра меняет девичью фамилию бабушки → в истории обе версии и автор; админ откатывает одной кнопкой.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectComfortable, isPhone, login, logout, openPerson, sheet, tab } from './support/app';

test('сценарий 4: правка девичьей фамилии → история → «Вернуть как было»', async ({ page }, info) => {
  const next = isPhone(info) ? 'Петровская' : 'Петрова-Ланская';
  await login(page, LOGINS.olga, pw('olga'));
  await openPerson(page, P.anna);
  await sheet(page).getByRole('button', { name: 'Редактировать' }).click();
  const dlg = page.locator('dialog.edit-dialog[open]');
  await expect(dlg.getByLabel('Девичья фамилия')).toHaveValue('Петрова');
  await expect(dlg.getByLabel('Дата рождения')).toHaveValue('~1902');
  await expect(dlg.locator('input[type="date"]')).toHaveCount(0);
  await expect(dlg.getByLabel('Дата смерти')).toHaveAttribute('placeholder', /.+/);
  await expectComfortable(page, 'форма правки');
  await dlg.getByLabel('Девичья фамилия').fill(next);
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.toast')).toContainText('Сохранено');
  await expect(sheet(page).locator('.d-row', { hasText: 'Девичья фамилия' })).toContainText(next);

  await tab(page, 'История');
  const item = sheet(page).locator('.h-item', { hasText: `Петрова → ${next}` });
  await expect(item).toBeVisible();
  await expect(item.locator('.h-meta')).toContainText('Ольга');
  await expect(item.locator('.h-field')).toHaveText('Девичья фамилия: ');
  // У родственника нет отката и удаления человека.
  await expect(sheet(page).getByRole('button', { name: 'Вернуть как было' })).toHaveCount(0);
  await expect(page.locator('[data-action="delete-person"]')).toHaveCount(0);
  await expectComfortable(page, 'история');

  await logout(page);
  await login(page, LOGINS.admin, pw('admin'));
  await openPerson(page, P.anna);
  await tab(page, 'История');
  const mine = sheet(page).locator('.h-item', { hasText: `Петрова → ${next}` });
  await mine.getByRole('button', { name: 'Вернуть как было' }).click();
  await expect(page.locator('.toast')).toContainText('Вернули как было');
  await tab(page, 'Инфо');
  await expect(sheet(page).locator('.d-row', { hasText: 'Девичья фамилия' })).toContainText('Петрова');
  await expect(sheet(page).locator('.d-row', { hasText: 'Девичья фамилия' })).not.toContainText(next);
  await tab(page, 'История');
  const undo = sheet(page).locator('.h-item', { hasText: 'Откат правки' }).first();
  await expect(undo).toContainText(`${next} → Петрова`);
  await expect(undo.locator('.h-meta')).toContainText('Илья');
});
