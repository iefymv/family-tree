// Сценарий 8: у родственника нет кнопки удаления человека (но есть «Убрать факт» и «Убрать связь»); у админа есть.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { isPhone, login, logout, openPerson, sheet, tab } from './support/app';
import { service } from './support/stack';

test('сценарий 8: удаление человека — только админ; восстановить можно', async ({ page }, info) => {
  const s = service();
  const tag = isPhone(info) ? 'Тимофей' : 'Лев';
  const { data: kid, error } = await s.from('people').insert({ external_ref: `e2e-${Date.now()}-kid`, given_name: tag, surname: 'Иванов', patronymic: 'Ильич', sex: 'm', notes: 'Вымышленный, e2e.' }).select('id').single();
  if (error) throw error;
  const { error: rErr } = await s.from('relations').insert([
    { kind: 'parent', from_person: P.ilya, to_person: kid.id, parent_type: 'biological' },
  ]);
  if (rErr) throw rErr;

  page.on('dialog', (d) => void d.accept());
  await login(page, LOGINS.petr, pw('petr'));
  await openPerson(page, kid.id);
  for (const t of ['Инфо', 'Дерево', 'Галерея', 'Документы', 'История']) {
    await tab(page, t);
    await expect(page.locator('[data-action="delete-person"]'), `вкладка ${t}`).toHaveCount(0);
  }
  await expect(sheet(page).getByText('Удалить человека может только администратор')).toBeVisible();

  // Родственник сам добавляет и убирает факт.
  await sheet(page).getByRole('button', { name: 'Редактировать' }).click();
  const dlg = page.locator('dialog.edit-dialog[open]');
  await dlg.getByLabel('Новый факт').fill('Собирал марки');
  await dlg.getByRole('button', { name: 'Добавить факт' }).click();
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.toast')).toContainText('Сохранено');
  await tab(page, 'Инфо');
  const fact = sheet(page).locator('.fact-list li', { hasText: 'Собирал марки' });
  await expect(fact).toBeVisible();
  await fact.getByRole('button', { name: 'Убрать факт' }).click();
  await expect(sheet(page).locator('.fact-list li', { hasText: 'Собирал марки' })).toHaveCount(0);

  // И убирает связь (кнопка у родителя на вкладке «Дерево»).
  await tab(page, 'Дерево');
  await expect(sheet(page).getByRole('button', { name: /Убрать связь: Иванов Илья/ })).toBeVisible();
  await sheet(page).getByRole('button', { name: /Убрать связь: Иванов Илья/ }).click();
  await expect(page.locator('.toast')).toContainText('Связь убрана');
  const { data: live } = await s.from('relations_live').select('id').eq('to_person', kid.id);
  expect(live).toEqual([]);

  await logout(page);
  await login(page, LOGINS.admin, pw('admin'));
  await openPerson(page, kid.id);
  await tab(page, 'История');
  const del = page.locator('[data-action="delete-person"]');
  await expect(del).toBeVisible();
  await del.click();
  await expect(page.locator('.toast')).toContainText('Человек удалён');
  await expect(page.locator(`.card[data-id="${kid.id}"]`)).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.locator('.toast')).toContainText('Человек восстановлен');
  await expect(page.locator(`.card[data-id="${kid.id}"]`)).toHaveCount(1);
});
