// Вход в приложение. Есть настройки сервера (VITE_SUPABASE_URL) — настоящие данные: экран входа → дерево.
// Нет настроек или в адресе `?demo` — вымышленное демо-дерево для работы над дизайном.
import './style.css';
import { createLiveBackend } from './app/live-backend';
import { mountTreeApp } from './app/tree-app';
import { installErrorReporting, reportError } from './lib/errors';
import { getMe } from './lib/session';
import { createWake } from './ui/wake';
import { showLogin } from './ui/login';
import { showWelcomeCard } from './ui/welcome';

const app = document.querySelector<HTMLDivElement>('#app')!;
const hasServer = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const demo = !hasServer || new URLSearchParams(location.search).has('demo');

function fatal(text: string) {
  const box = document.createElement('main');
  box.className = 'login';
  const card = document.createElement('div');
  card.className = 'login-card';
  const h = document.createElement('h1');
  h.textContent = 'Не получилось открыть дерево';
  const p = document.createElement('p');
  p.className = 'login-sub';
  p.textContent = text;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-primary btn-big';
  b.textContent = 'Обновить страницу';
  b.addEventListener('click', () => location.reload());
  card.append(h, p, b);
  box.appendChild(card);
  app.replaceChildren(box);
}

async function start() {
  if (demo) {
    document.body.dataset.mode = 'demo';
    // Демо-дерево грузится отдельным файлом: в сборке для входа его вымышленных имён нет.
    const { createDemoBackend } = await import('./app/demo-backend');
    await mountTreeApp(app, createDemoBackend());
    return;
  }
  installErrorReporting();
  const wake = createWake(document.body);
  // Без сессии в сеть за данными не ходим вовсе: сначала экран входа.
  let me = await wake.run(() => getMe()).catch(() => null);
  const fresh = !me;
  if (!me) me = await showLogin(app, wake);
  await mountTreeApp(app, createLiveBackend({ personId: me.personId, displayName: me.displayName, role: me.role }, wake));
  if (fresh) showWelcomeCard(document.body);
}

start().catch((e: unknown) => {
  void reportError(e instanceof Error ? e.message : String(e), e instanceof Error ? e.stack : undefined);
  fatal(e instanceof Error && e.message ? `${e.message}. Попробуйте обновить страницу.` : 'Попробуйте обновить страницу.');
});
