// Общие шаги e2e: вход, переход к человеку, проверки «крупно и удобно пальцем».
import { expect, type Page, type TestInfo } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

export const isPhone = (info: TestInfo) => info.project.name === 'phone';

export async function treeReady(page: Page) {
  await page.waitForFunction(() => document.body.classList.contains('ready') && document.body.dataset.mode === 'live', null, { timeout: 30_000 });
}

export async function login(page: Page, name: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Имя и фамилия').fill(name);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await treeReady(page);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Меню' }).click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('menuitem', { name: 'Выйти' }).click()]);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
}

/** Открыть карточку человека по прямой ссылке (после входа). */
let nav = 0;
export async function openPerson(page: Page, id: string) {
  await page.goto(`/?n=${++nav}#/person/${id}`);
  await treeReady(page);
  await expect(page.locator('.sheet.is-open')).toBeVisible();
}

export const sheet = (page: Page) => page.locator('.sheet');
export async function tab(page: Page, name: string) {
  await sheet(page).getByRole('tab', { name, exact: true }).click();
  await expect(sheet(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
}

/** Центр элемента относительно центра экрана, в долях ширины/высоты. */
export async function offCenter(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  const vp = page.viewportSize()!;
  if (!box) throw new Error(`нет ${selector}`);
  return { dx: Math.abs(box.x + box.width / 2 - vp.width / 2) / vp.width, dy: Math.abs(box.y + box.height / 2 - vp.height / 2) / vp.height, width: box.width };
}

/** Ждать, пока элемент встанет в пределах ±tol от центра экрана (перелёт камеры анимирован). */
export async function expectCentered(page: Page, selector: string, tol = 0.15) {
  await expect.poll(async () => {
    const o = await offCenter(page, selector);
    return o.dx <= tol && o.dy <= tol;
  }, { timeout: 10_000 }).toBe(true);
}

/** Минимальный PNG w×h одного цвета — картинки генерируются на лету, в git их нет. */
export function makePng(w: number, h: number, rgb: [number, number, number] = [91, 127, 58]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Служебные подписи, которым разрешено быть мельче 18px (план, раздел 10: «исключения только у служебных подписей, списком»).
 * Подписи на самом дереве (SVG) не проверяются: их экранный размер зависит от масштаба.
 */
export const SMALL_TEXT_ALLOWED = [
  '.gen-rail span', // метки поколений сбоку
  '.brand-text span', // «12 человек · 4 поколения»
  '.sr-meta', '.rel-meta', '.admin-pick-meta', // «кем приходится · годы» под именем
  '.sec-badge', // счётчик в заголовке раздела
  '.doc-title', '.doc-year', // подписи под плитками документов
  '.g-main figcaption', // «Главное фото» на снимке
  '.h-meta', '.am-meta', // «кто · когда» в истории, «вход: … · роль» в админке
  '.initials-av', // инициалы в кружке-аватаре вместо фото — это картинка (role=img), а не текст
];

export async function smallText(page: Page): Promise<string[]> {
  return page.evaluate((allowed) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('svg') || el.closest('[hidden]') || allowed.some((s) => el.closest(s))) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 || el.closest('.toast:not(.show)')) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 18) out.push(`${fs}px «${n.textContent.trim().slice(0, 40)}» <${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    return out;
  }, SMALL_TEXT_ALLOWED);
}

export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, [role=button]:not(svg *), [role=tab], [role=menuitem]';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('[hidden]') || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      if (el.closest('.toast:not(.show)') || el.closest('.zoom-controls') && document.body.classList.contains('sheet-up') && innerWidth < 900) continue;
      // Флажок и радиокнопка нажимаются вместе со своей подписью — меряем подпись.
      const target = (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio' ? el.closest('label') ?? el : el;
      const t = target.getBoundingClientRect();
      if (t.width < 47.5 || t.height < 47.5) out.push(`${Math.round(t.width)}×${Math.round(t.height)} ${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}» class="${el.className}"`);
    }
    return out;
  });
}

export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) out.push(`document ${de.scrollWidth} > ${innerWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('.sheet-scroll, .admin-body, dialog[open] form, .login, .search-results, .menu-pop')) {
      if (el.closest('[hidden]')) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

/** Все три проверки сразу — с понятным списком нарушений. */
export async function expectComfortable(page: Page, where: string) {
  expect(await smallText(page), `${where}: текст мельче 18px`).toEqual([]);
  expect(await smallTargets(page), `${where}: зоны нажатия меньше 48px`).toEqual([]);
  expect(await horizontalOverflow(page), `${where}: горизонтальная прокрутка`).toEqual([]);
}
