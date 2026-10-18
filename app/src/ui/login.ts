// Экран входа: «Имя и фамилия» + пароль от администратора семьи. Без входа данных нет вовсе.
import { LoginError } from '../lib/auth';
import { SignInError, signIn, type Me } from '../lib/session';
import { isRetryable } from './wake';

const LEAF = '<svg viewBox="0 0 32 32"><path d="M16 29v-9"/><path d="M16 20c-6 0-10-4-10-9 0-4 3-7 7-7 1-1 2-1 3-1s2 0 3 1c4 0 7 3 7 7 0 5-4 9-10 9Z"/><path d="M16 20l-4-4M16 17l4-4"/></svg>';

export function friendlyLoginError(e: unknown): string {
  if (e instanceof LoginError) return e.message;
  if (e instanceof SignInError && /Неверное имя или пароль|отключ/.test(e.message)) return e.message;
  if (isRetryable(e)) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (e instanceof SignInError) return 'Не получилось войти. Попробуйте ещё раз или спросите администратора семьи.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

export function showLogin(host: HTMLElement, wake: { run<T>(fn: () => Promise<T>): Promise<T> }): Promise<Me> {
  const screen = document.createElement('main');
  screen.className = 'login';
  const card = document.createElement('form');
  card.className = 'login-card';
  card.noValidate = true;
  card.setAttribute('aria-labelledby', 'login-title');

  const mark = document.createElement('span');
  mark.className = 'brand-mark login-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = LEAF; // статичная иконка
  const title = document.createElement('h1');
  title.id = 'login-title';
  title.textContent = 'Семейное дерево';
  const sub = document.createElement('p');
  sub.className = 'login-sub';
  sub.textContent = 'Войдите, чтобы увидеть дерево и себя на нём.';

  const mk = (label: string, name: string, type: string, auto: AutoFill) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.autocomplete = auto;
    input.required = true;
    wrap.append(span, input);
    return { wrap, input };
  };
  const name = mk('Имя и фамилия', 'login', 'text', 'username');
  name.input.placeholder = 'как в паспорте: имя и фамилия';
  name.input.setAttribute('autocapitalize', 'off');
  name.input.setAttribute('autocorrect', 'off');
  name.input.spellcheck = false;
  name.input.enterKeyHint = 'next';
  const pass = mk('Пароль', 'password', 'password', 'current-password');
  pass.input.enterKeyHint = 'go';

  const err = document.createElement('p');
  err.className = 'form-error';
  err.setAttribute('role', 'alert');
  err.hidden = true;

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'btn btn-primary btn-big';
  btn.textContent = 'Войти';

  const hint = document.createElement('p');
  hint.className = 'login-hint';
  hint.textContent = 'Имя и пароль выдаёт администратор семьи. Забыли пароль — спросите его, он поменяет.';

  card.append(mark, title, sub, name.wrap, pass.wrap, err, btn, hint);
  screen.appendChild(card);
  host.appendChild(screen);
  name.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает

  return new Promise((resolve) => {
    card.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      if (!name.input.value.trim()) {
        err.textContent = 'Введите имя и фамилию';
        err.hidden = false;
        name.input.focus();
        return;
      }
      if (!pass.input.value) {
        err.textContent = 'Введите пароль';
        err.hidden = false;
        pass.input.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Входим…';
      try {
        const me = await wake.run(() => signIn(name.input.value, pass.input.value));
        screen.remove();
        resolve(me);
      } catch (e) {
        err.textContent = friendlyLoginError(e);
        err.hidden = false;
        pass.input.select();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
      }
    });
  });
}
