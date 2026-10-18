// Сценарий 1: администратор создаёт вход родственнику и привязывает к карточке; однофамилец-тёзка — понятная подсказка.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectCentered, expectComfortable, isPhone, login, logout } from './support/app';
import { service } from './support/stack';
import { toEmail } from '../../src/lib/auth';

test('сценарий 1: админ создаёт вход родственнику, тот сразу входит', async ({ page }, info) => {
  const phone = isPhone(info);
  const target = phone ? { id: P.andrei, login: LOGINS.andrei, first: 'Андрей' } : { id: P.ksenia, login: LOGINS.ksenia, first: 'Ксения' };
  const norm = target.login.toLowerCase().replace(/ё/g, 'е');
  const password = `липа-ясень-${Date.now() % 1000}`;

  await login(page, LOGINS.admin, pw('admin'));
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('menuitem', { name: 'Администрирование' }).click();
  const admin = page.locator('.admin');
  await expect(admin).toBeVisible();

  if (phone) {
    // Выбор карточки поиском.
    await admin.getByLabel('Чья карточка').fill(target.first);
    await admin.locator(`.admin-pick[data-id="${target.id}"]`).click();
  } else {
    // Выбор карточки прямо на дереве.
    await admin.getByRole('button', { name: 'Выбрать на дереве' }).click();
    await expect(admin).toBeHidden();
    await expect(page.locator('.pick-bar')).toBeVisible();
    await page.locator(`.card[data-id="${target.id}"]`).click();
    await expect(admin).toBeVisible();
  }
  await expect(admin.locator('.admin-chosen')).toContainText(target.first);
  await expect(admin.getByLabel('Имя и фамилия для входа')).toHaveValue(new RegExp(target.first));
  await expect(admin.getByLabel('Подпись в истории правок')).toHaveValue(target.first);
  await admin.getByLabel('Пароль', { exact: true }).fill(password);
  await admin.getByRole('button', { name: 'Создать вход' }).click();
  await expect(admin.locator('.form-ok')).toContainText('Вход создан');
  await expect(admin.locator(`.admin-member[data-login="${norm}"]`)).toBeVisible();
  await expectComfortable(page, 'админка');

  // Тёзка: тот же логин для другой карточки — 409 и подсказка с годом рождения; лишнего auth-пользователя нет.
  await admin.getByLabel('Чья карточка').fill('Матвей');
  await admin.locator(`.admin-pick[data-id="${P.matvei}"]`).click();
  await admin.getByLabel('Имя и фамилия для входа').fill(target.login);
  await admin.getByRole('button', { name: 'Создать вход' }).click();
  await expect(admin.locator('.form-error')).toContainText('уже занято');
  await expect(admin.locator('.form-error')).toContainText('год рождения');
  const s = service();
  const { data: users } = await s.auth.admin.listUsers({ perPage: 1000 });
  expect(users.users.filter((u) => u.email === toEmail(target.login))).toHaveLength(1);
  const { data: rows } = await s.from('members').select('person_id').eq('login', norm);
  expect(rows).toEqual([{ person_id: target.id }]);

  await admin.getByRole('button', { name: 'Закрыть' }).click();
  await logout(page);

  // Новый участник входит по имени и фамилии и видит себя в центре.
  await page.getByLabel('Имя и фамилия').fill(target.login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await expect(page.locator(`.card.is-root[data-id="${target.id}"]`)).toBeVisible();
  await expectCentered(page, '.card.is-root .photo-ring');
  // Не админ — пункта «Администрирование» нет.
  await page.getByRole('button', { name: 'Меню' }).click();
  await expect(page.getByRole('menuitem', { name: 'Администрирование' })).toHaveCount(0);
});
