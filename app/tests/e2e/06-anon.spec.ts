// Сценарий 6: по прямой ссылке без входа — только экран входа, ни одного имени ни в DOM, ни в ответах сервера.
import { expect, test } from '@playwright/test';
import { P, SEED_NAMES } from './support/cast';
import { localEnv } from './support/env';

test('сценарий 6: #/person/<id> без входа — только вход, имён нет', async ({ page, request }) => {
  const bodies: string[] = [];
  const urls: string[] = [];
  page.on('response', async (r) => {
    urls.push(r.url());
    try {
      // Ответы с данными (HTML, JSON, файлы). Код приложения (JS/CSS) — не данные: в нём только
      // таблица отчеств для подсказок в форме; демо-дерево в эту сборку не входит (грузится отдельно по ?demo).
      const type = r.headers()['content-type'] ?? '';
      if (!/fonts\.(googleapis|gstatic)/.test(r.url()) && !/javascript|text\/css|font/.test(type)) bodies.push(await r.text());
    } catch {
      /* тело недоступно (редирект и т.п.) */
    }
  });
  await page.goto(`/#/person/${P.petr}`);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  await expect(page.locator('.tree-svg')).toHaveCount(0);
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.waitForTimeout(1500);
  const html = await page.content();
  for (const n of SEED_NAMES) {
    expect(html, `имя «${n}» в DOM`).not.toContain(n);
    for (const b of bodies) expect(b, `имя «${n}» в ответе`).not.toContain(n);
  }
  // Без сессии клиент вообще не ходит за данными.
  const api = localEnv().apiUrl;
  expect(urls.filter((u) => u.startsWith(api) && /\/(rest|storage)\/v1\//.test(u))).toEqual([]);

  // Прямой запрос публичным ключом: 0 строк или отказ.
  const { anonKey } = localEnv();
  for (const view of ['people_live', 'people', 'relations_live', 'facts_live', 'documents_live', 'members', 'edits']) {
    const r = await request.get(`${api}/rest/v1/${view}?select=*`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    const t = await r.text();
    expect(r.status() === 200 ? t : '[]', view).toBe('[]');
    for (const n of SEED_NAMES) expect(t).not.toContain(n);
  }
});
