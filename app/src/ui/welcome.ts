// Приветствие на дереве после входа через экран входа: показывается, пока его не закроют на этом устройстве.
import { welcomeNote } from './login';

export const WELCOME_DISMISSED_KEY = 'family-tree.welcome-dismissed';

export function showWelcomeCard(host: HTMLElement): void {
  try {
    if (localStorage.getItem(WELCOME_DISMISSED_KEY)) return;
  } catch {
    /* хранилище недоступно — просто показываем */
  }
  const card = welcomeNote('welcome-card', 'h2');
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-primary';
  ok.textContent = 'Понятно';
  ok.addEventListener('click', () => {
    try {
      localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    } catch {
      /* не запомнили — покажется после следующего входа */
    }
    card.remove();
  });
  card.appendChild(ok);
  host.appendChild(card);
}
