// Экран входа: «Имя и фамилия» + пароль (свой от администратора или общий семейный). Без входа данных нет вовсе.
// Семейный пароль: тёзкам — вопрос о годе рождения; похожим (опечатка) — «Это вы?»; кого нет на дереве —
// сразу своя карточка без связей (кто ему кто, человек показывает уже на дереве — ui/join.ts).
import { LoginError } from '../lib/auth';
import { FamilyLoginError, type Candidate } from '../lib/family-login';
import { SignInError, signIn, type Me, type SignInOptions } from '../lib/session';
import { isRetryable } from './wake';

const LEAF = '<svg viewBox="0 0 32 32"><path d="M16 29v-9"/><path d="M16 20c-6 0-10-4-10-9 0-4 3-7 7-7 1-1 2-1 3-1s2 0 3 1c4 0 7 3 7 7 0 5-4 9-10 9Z"/><path d="M16 20l-4-4M16 17l4-4"/></svg>';

export const WELCOME_TITLE = 'Наше семейное дерево';
export const WELCOME_LEAD = 'Здесь мы вместе собираем историю нашей семьи.';
export const WELCOME_ITEMS = [
  'Не нашли себя или знаете кого-то из родных — добавьте',
  'Нашли ошибку или неточность — смело правьте',
  'Знаете факт, дату или историю — допишите, даже если не уверены',
  'Есть старые фото или документы — загрузите',
];
export const WELCOME_CLOSING = 'Ничего не потеряется: каждая правка сохраняется, и прежний вариант всегда можно вернуть.';

export function friendlyLoginError(e: unknown): string {
  if (e instanceof LoginError) return e.message;
  if (e instanceof FamilyLoginError) return e.message;
  if (e instanceof SignInError && /Неверное имя или пароль|отключ/.test(e.message)) return e.message;
  if (isRetryable(e)) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (e instanceof SignInError) return 'Не получилось войти. Попробуйте ещё раз или спросите администратора семьи.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function mk(label: string, name: string, type: string, auto: AutoFill) {
  const wrap = el('label', 'field');
  const span = el('span', undefined, label);
  const input = el('input');
  input.name = name;
  input.type = type;
  input.autocomplete = auto;
  wrap.append(span, input);
  return { wrap, input };
}

/** Заголовок и текст-приветствие (экран входа и карточка на дереве после первого входа). */
export function welcomeNote(cls: string, heading: 'h1' | 'h2' = 'h1'): HTMLElement {
  const box = el('section', cls);
  box.setAttribute('aria-labelledby', `${cls}-title`);
  const t = el(heading, 'welcome-title', WELCOME_TITLE);
  t.id = `${cls}-title`;
  const list = el('ul', 'welcome-list');
  for (const item of WELCOME_ITEMS) list.appendChild(el('li', undefined, item));
  box.append(t, el('p', 'welcome-lead', WELCOME_LEAD), list, el('p', 'welcome-closing', WELCOME_CLOSING));
  return box;
}

export function showLogin(host: HTMLElement, wake: { run<T>(fn: () => Promise<T>): Promise<T> }): Promise<Me> {
  const screen = el('main', 'login');
  const card = el('form', 'login-card');
  card.noValidate = true;
  card.setAttribute('aria-labelledby', 'login-welcome-title');

  const mark = el('span', 'brand-mark login-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = LEAF; // статичная иконка
  const note = welcomeNote('login-welcome');

  // ---------------------------------------------------------------- имя и пароль
  const step1 = el('div', 'login-step');
  const name = mk('Имя и фамилия', 'login', 'text', 'username');
  name.input.required = true;
  name.input.placeholder = 'как в паспорте: имя и фамилия';
  name.input.setAttribute('autocapitalize', 'off');
  name.input.setAttribute('autocorrect', 'off');
  name.input.spellcheck = false;
  name.input.enterKeyHint = 'next';
  const pass = mk('Пароль', 'password', 'password', 'current-password');
  pass.input.required = true;
  pass.input.enterKeyHint = 'go';
  const year = mk('Год рождения', 'birth_year', 'text', 'bday-year');
  year.input.inputMode = 'numeric';
  year.input.maxLength = 4;
  year.input.placeholder = 'например, 1985';
  year.wrap.hidden = true;
  const hint = el('p', 'login-hint', 'Пароль — общий семейный, его знают родные. Если администратор выдал вам свой пароль — входите с ним.');
  step1.append(name.wrap, pass.wrap, year.wrap);

  // ---------------------------------------------------------------- «Это вы?» — похожие на дереве
  const stepConfirm = el('div', 'login-step');
  stepConfirm.hidden = true;
  const confirmList = el('ul', 'admin-results');
  const newYear = mk('Год рождения (необязательно)', 'new_birth_year', 'text', 'bday-year');
  newYear.input.inputMode = 'numeric';
  newYear.input.maxLength = 4;
  newYear.input.placeholder = 'например, 1985';
  const notMe = el('button', 'btn btn-soft', 'Нет, меня нет на дереве');
  notMe.type = 'button';
  stepConfirm.append(el('p', 'login-sub login-link-title', 'Это вы?'), confirmList, newYear.wrap, notMe);

  const err = el('p', 'form-error');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const btn = el('button', 'btn btn-primary btn-big', 'Войти');
  btn.type = 'submit';
  const back = el('button', 'btn btn-soft', 'Назад');
  back.type = 'button';
  back.hidden = true;

  card.append(mark, note, step1, stepConfirm, err, btn, back, hint);
  screen.appendChild(card);
  host.appendChild(screen);
  name.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает

  let mode: 'login' | 'confirm' = 'login';
  const fail = (text: string, focus?: HTMLInputElement) => {
    err.textContent = text;
    err.hidden = false;
    focus?.focus();
  };
  const yearOf = (input: HTMLInputElement): number | undefined | null => {
    const y = input.value.trim();
    if (!y) return undefined;
    return /^\d{4}$/.test(y) ? Number(y) : null;
  };

  const setMode = (m: typeof mode) => {
    mode = m;
    step1.hidden = m !== 'login';
    stepConfirm.hidden = m !== 'confirm';
    back.hidden = m === 'login';
    btn.hidden = m === 'confirm';
    hint.hidden = m !== 'login';
    note.hidden = m !== 'login';
    if (m === 'login') name.input.focus();
  };
  back.addEventListener('click', () => {
    err.hidden = true;
    setMode('login');
  });

  return new Promise((resolve) => {
    async function attempt(opts: SignInOptions, from: HTMLButtonElement = btn) {
      from.disabled = true;
      if (from === btn) btn.textContent = 'Входим…';
      try {
        const me = await wake.run(() => signIn(name.input.value, pass.input.value, opts));
        screen.remove();
        resolve(me);
      } catch (e) {
        if (e instanceof FamilyLoginError && e.need === 'confirm' && e.candidates.length && mode === 'login') {
          showCandidates(e.candidates);
        } else if (e instanceof FamilyLoginError && e.need === 'birth_year' && mode === 'login') {
          year.wrap.hidden = false;
          fail(e.message, year.input);
        } else {
          fail(friendlyLoginError(e));
          if (mode === 'login') pass.input.select();
        }
      } finally {
        from.disabled = false;
        btn.textContent = 'Войти';
      }
    }

    function showCandidates(list: Candidate[]) {
      confirmList.replaceChildren();
      newYear.input.value = year.input.value;
      for (const c of list) {
        const li = el('li');
        const b = el('button', 'admin-pick');
        b.type = 'button';
        b.dataset.id = c.id;
        b.appendChild(el('span', 'admin-pick-name', c.fio));
        if (c.birth_year) b.appendChild(el('span', 'admin-pick-meta', `${c.birth_year} г. р.`));
        b.addEventListener('click', () => {
          err.hidden = true;
          void attempt({ confirmPersonId: c.id }, b);
        });
        li.appendChild(b);
        confirmList.appendChild(li);
      }
      setMode('confirm');
      confirmList.querySelector('button')?.focus();
    }

    notMe.addEventListener('click', () => {
      err.hidden = true;
      const y = yearOf(newYear.input);
      if (y === null) return fail('Год рождения — четыре цифры, например 1985', newYear.input);
      void attempt({ createNew: true, ...(y ? { birthYear: y } : {}) }, notMe);
    });

    card.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      if (mode !== 'login') return;
      if (!name.input.value.trim()) return fail('Введите имя и фамилию', name.input);
      if (!pass.input.value) return fail('Введите пароль', pass.input);
      const y = year.wrap.hidden ? undefined : yearOf(year.input);
      if (y === null) return fail('Год рождения — четыре цифры, например 1985', year.input);
      await attempt(y ? { birthYear: y } : {});
    });
  });
}
