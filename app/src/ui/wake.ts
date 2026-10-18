// «Сервер просыпается…»: бесплатный Supabase засыпает без запросов. Если запрос висит дольше 5 с,
// показываем экран ожидания; сетевые сбои и зависания повторяем сами, без участия человека.
const SHOW_AFTER_MS = 5000;
const HANG_MS = 20000;
const MAX_TRIES = 6;

export class HangError extends Error {}

/** Сетевой сбой или «сервер не отвечает» — стоит повторить. Ошибки прав и данных — нет. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof HangError || e instanceof TypeError) return true;
  const err = e as { message?: string; status?: number; name?: string } | null;
  if (!err) return false;
  if (typeof err.status === 'number' && (err.status === 0 || err.status >= 502)) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out|AuthRetryableFetchError/i.test(`${err.name ?? ''} ${err.message ?? ''}`);
}

export function createWake(host: HTMLElement) {
  const box = document.createElement('div');
  box.className = 'wake';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  const card = document.createElement('div');
  card.className = 'wake-card';
  const spin = document.createElement('span');
  spin.className = 'wake-spin';
  spin.setAttribute('aria-hidden', 'true');
  const t = document.createElement('p');
  t.className = 'wake-title';
  t.textContent = 'Сервер просыпается…';
  const s = document.createElement('p');
  s.className = 'wake-sub';
  s.textContent = 'Если сайтом давно не пользовались, первый вход занимает до минуты. Ничего нажимать не нужно.';
  card.append(spin, t, s);
  box.appendChild(card);
  host.appendChild(box);

  let active = 0;
  const show = () => {
    box.hidden = false;
  };
  const hide = () => {
    if (active === 0) box.hidden = true;
  };

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    active++;
    const timer = window.setTimeout(show, SHOW_AFTER_MS);
    try {
      for (let attempt = 1; ; attempt++) {
        let hang = 0;
        try {
          return await Promise.race([
            fn(),
            new Promise<never>((_, rej) => (hang = window.setTimeout(() => rej(new HangError('timeout')), HANG_MS))),
          ]);
        } catch (e) {
          if (!isRetryable(e) || attempt >= MAX_TRIES) throw e;
          show();
          s.textContent = 'Сервер ещё не ответил — пробуем снова. Ничего нажимать не нужно.';
          await new Promise((r) => setTimeout(r, Math.min(1500 * 2 ** (attempt - 1), 10000)));
        } finally {
          clearTimeout(hang);
        }
      }
    } finally {
      clearTimeout(timer);
      active--;
      hide();
    }
  }

  return { run, element: box };
}
