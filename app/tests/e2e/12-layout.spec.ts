// Дизайн-долги: все вкладки карточки помещаются на телефоне, подпись поколения не наезжает на «+»,
// фамилия для неизвестного отца подставляется по детям; крупный текст и большие кнопки во всех вкладках.
import { expect, test } from '@playwright/test';
import { LOGINS, P, pw } from './support/cast';
import { expectComfortable, login, openPerson, sheet, tab } from './support/app';
import { service } from './support/stack';

test('вкладки целиком видны, текст ≥18px, кнопки ≥48px во всех вкладках', async ({ page }) => {
  await login(page, LOGINS.admin, pw('admin'));
  await openPerson(page, P.semen);
  const vp = page.viewportSize()!;
  const tabs = sheet(page).getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const t of ['Инфо', 'Дерево', 'Галерея', 'Документы', 'История']) {
    await tab(page, t);
    const sheetBox = (await sheet(page).boundingBox())!;
    for (let i = 0; i < 5; i++) {
      const b = (await tabs.nth(i).boundingBox())!;
      expect(b.x, `вкладка ${i} слева`).toBeGreaterThanOrEqual(sheetBox.x);
      expect(b.x + b.width, `вкладка ${i} справа`).toBeLessThanOrEqual(Math.min(vp.width, sheetBox.x + sheetBox.width) + 0.5);
      // Текст вкладки не обрезан.
      expect(await tabs.nth(i).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    await page.waitForTimeout(400); // вкладка «История» догружается
    await expectComfortable(page, `вкладка ${t}`);
  }
});

test('подпись поколения не наезжает на зелёный «+»', async ({ page }) => {
  await login(page, LOGINS.petr, pw('petr'));
  const box = page.getByRole('searchbox', { name: 'Найти родственника' });
  for (const [q, id] of [['Пётр Иванов', P.petr], ['Николай Иванов', P.nikolai], ['Илья Иванов', P.ilya], ['Ольга Иванова', P.olga], ['Матвей Иванов', P.matvei]] as const) {
    if (id !== P.petr) {
      await box.fill(q);
      await page.locator(`.search-results button[data-id="${id}"]`).click();
      await expect(page.locator(`.card.is-selected[data-id="${id}"]`)).toHaveCount(1);
    }
    await page.waitForTimeout(1600); // перелёт камеры
    const overlaps = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.add-chip')].map((c) => c.getBoundingClientRect());
      return [...document.querySelectorAll<HTMLElement>('.gen-rail span')]
        .filter((s) => Number(getComputedStyle(s).opacity) > 0.05)
        .filter((s) => {
          const r = s.getBoundingClientRect();
          return chips.some((c) => c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top);
        })
        .map((s) => s.textContent);
    });
    expect(overlaps, `выбран ${q}`).toEqual([]);
  }
});

test('«Неизвестно» отец: фамилия подставляется по фамилии ребёнка', async ({ page }) => {
  const s = service();
  const { data: kid, error } = await s.from('people').insert({ external_ref: `e2e-${Date.now()}-zlata`, given_name: 'Злата', surname: 'Берёзкина', sex: 'f', notes: 'Вымышленная, e2e.' }).select('id').single();
  if (error) throw error;
  await s.from('relations').insert({ kind: 'parent', from_person: P.olga, to_person: kid.id, parent_type: 'biological' });
  await login(page, LOGINS.olga, pw('olga'));
  const ph = page.locator(`.card.placeholder[data-id="unknown-parent:${P.olga}"]`);
  await expect(ph).toHaveCount(1);
  await ph.dispatchEvent('click');
  const dlg = page.locator('dialog.add-dialog[open]');
  await expect(dlg.getByRole('heading', { name: 'Второй родитель' })).toBeVisible();
  await expect(dlg.getByLabel('Мужчина')).toBeChecked();
  await expect(dlg.getByLabel('Фамилия')).toHaveValue('Берёзкин');
  await dlg.getByRole('button', { name: 'Отмена' }).click();
});
