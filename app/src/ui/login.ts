// Экран входа: «Имя и фамилия» + пароль (свой от администратора или общий семейный). Без входа данных нет вовсе.
// Семейный пароль: тёзкам — вопрос о годе рождения; кого нет на дереве — шаг «Кем вы приходитесь родне?»
// с поиском родственника и добавлением себя рядом с ним.
import { LoginError } from '../lib/auth';
import { FamilyLoginError, searchRelatives, type Candidate, type LinkKind, type Relative } from '../lib/family-login';
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

const KINDS: [LinkKind, string][] = [
  ['child', 'я их ребёнок'], ['parent', 'я их родитель'], ['spouse', 'я их супруг(а)'], ['sibling', 'я их брат или сестра'],
];

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

function radio(group: string, value: string, text: string) {
  const wrap = el('label', 'login-choice');
  const input = el('input');
  input.type = 'radio';
  input.name = group;
  input.value = value;
  wrap.append(input, el('span', undefined, text));
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

  // ---------------------------------------------------------------- шаг 1: имя и пароль
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

  // ---------------------------------------------------------------- шаг 2: «Кем вы приходитесь родне?»
  const step2 = el('div', 'login-step');
  step2.hidden = true;
  const linkTitle = el('p', 'login-sub login-link-title', 'Вас ещё нет на дереве. Кем вы приходитесь родне?');
  const names = el('div', 'field-row');
  const given = mk('Имя', 'given_name', 'text', 'given-name');
  const surname = mk('Фамилия', 'surname', 'text', 'family-name');
  names.append(given.wrap, surname.wrap);
  const find = mk('Найдите родственника на дереве', 'relative', 'search', 'off');
  find.input.placeholder = 'имя или фамилия';
  const results = el('ul', 'admin-results');
  const chosenBox = el('p', 'admin-chosen');
  chosenBox.hidden = true;
  const kindSet = el('fieldset', 'login-choices');
  kindSet.append(el('legend', undefined, 'Кем вы приходитесь этому человеку'));
  const kindInputs = KINDS.map(([k, t]) => radio('kind', k, t));
  for (const r of kindInputs) kindSet.appendChild(r.wrap);
  const born = mk('Год или дата рождения (необязательно)', 'birth_date', 'text', 'off');
  born.input.placeholder = '1985 или 12.03.1985';
  const sexSet = el('fieldset', 'login-choices login-choices-row');
  sexSet.append(el('legend', undefined, 'Пол (необязательно)'));
  const sexInputs = [radio('sex', 'f', 'женский'), radio('sex', 'm', 'мужской')];
  for (const r of sexInputs) sexSet.appendChild(r.wrap);
  step2.append(linkTitle, names, find.wrap, results, chosenBox, kindSet, born.wrap, sexSet);

  // ---------------------------------------------------------------- «Это вы?» — похожие на дереве
  const stepConfirm = el('div', 'login-step');
  stepConfirm.hidden = true;
  const confirmList = el('ul', 'admin-results');
  const notMe = el('button', 'btn btn-soft', 'Нет, меня нет на дереве');
  notMe.type = 'button';
  stepConfirm.append(el('p', 'login-sub login-link-title', 'Это вы?'), confirmList, notMe);

  const err = el('p', 'form-error');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const btn = el('button', 'btn btn-primary btn-big', 'Войти');
  btn.type = 'submit';
  const back = el('button', 'btn btn-soft', 'Назад');
  back.type = 'button';
  back.hidden = true;

  card.append(mark, note, step1, stepConfirm, step2, err, btn, back, hint);
  screen.appendChild(card);
  host.appendChild(screen);
  name.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает

  let mode: 'login' | 'confirm' | 'link' = 'login';
  let anchor: Relative | null = null;
  const idle = () => (mode === 'link' ? 'Добавить меня и войти' : 'Войти');
  const fail = (text: string, focus?: HTMLInputElement) => {
    err.textContent = text;
    err.hidden = false;
    focus?.focus();
  };

  const setMode = (m: typeof mode) => {
    mode = m;
    step1.hidden = m !== 'login';
    stepConfirm.hidden = m !== 'confirm';
    step2.hidden = m !== 'link';
    back.hidden = m === 'login';
    btn.hidden = m === 'confirm';
    hint.hidden = m !== 'login';
    note.hidden = m !== 'login';
    btn.textContent = idle();
    if (m === 'link') {
      const parts = name.input.value.trim().split(/\s+/);
      given.input.value ||= parts[0] ?? '';
      surname.input.value ||= parts.slice(1).join(' ');
      find.input.focus();
    } else if (m === 'login') {
      name.input.focus();
    }
  };
  notMe.addEventListener('click', () => {
    err.hidden = true;
    setMode('link');
  });
  back.addEventListener('click', () => {
    err.hidden = true;
    setMode('login');
  });

  // Поиск родственника: функция отвечает только при верном семейном пароле.
  let timer = 0;
  let seq = 0;
  const choose = (p: Relative) => {
    anchor = p;
    chosenBox.textContent = `Родственник: ${p.name}${p.birth_year ? `, ${p.birth_year}` : ''}`;
    chosenBox.hidden = false;
    results.replaceChildren();
  };
  find.input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = find.input.value.trim();
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }
    timer = window.setTimeout(async () => {
      const my = ++seq;
      try {
        const found = await searchRelatives(name.input.value, pass.input.value, q);
        if (my !== seq) return;
        results.replaceChildren();
        if (!found.length) results.appendChild(el('li', 'empty-note', 'Никого не нашлось — попробуйте иначе.'));
        for (const p of found) {
          const li = el('li');
          const b = el('button', 'admin-pick');
          b.type = 'button';
          b.dataset.id = p.id;
          b.appendChild(el('span', 'admin-pick-name', p.name));
          if (p.birth_year) b.appendChild(el('span', 'admin-pick-meta', `${p.birth_year} г. р.`));
          b.addEventListener('click', () => choose(p));
          li.appendChild(b);
          results.appendChild(li);
        }
      } catch (e) {
        if (my === seq) fail(friendlyLoginError(e));
      }
    }, 300);
  });

  return new Promise((resolve) => {
    card.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const opts: SignInOptions = {};
      if (mode === 'login') {
        if (!name.input.value.trim()) return fail('Введите имя и фамилию', name.input);
        if (!pass.input.value) return fail('Введите пароль', pass.input);
        const y = year.input.value.trim();
        if (!year.wrap.hidden && y) {
          if (!/^\d{4}$/.test(y)) return fail('Год рождения — четыре цифры, например 1985', year.input);
          opts.birthYear = Number(y);
        }
      } else {
        if (!given.input.value.trim()) return fail('Укажите имя', given.input);
        if (!surname.input.value.trim()) return fail('Укажите фамилию', surname.input);
        if (!anchor) return fail('Найдите и выберите родственника на дереве', find.input);
        const kind = kindInputs.find((r) => r.input.checked)?.input.value as LinkKind | undefined;
        if (!kind) return fail('Выберите, кем вы приходитесь этому человеку');
        const sex = sexInputs.find((r) => r.input.checked)?.input.value as 'm' | 'f' | undefined;
        opts.selfAdd = {
          givenName: given.input.value.trim(), surname: surname.input.value.trim(), anchorId: anchor.id, kind,
          birthDate: born.input.value.trim() || undefined, sex,
        };
      }
      await attempt(opts);
    });

    const showCandidates = (list: Candidate[]) => {
      confirmList.replaceChildren();
      for (const c of list) {
        const li = el('li');
        const b = el('button', 'admin-pick');
        b.type = 'button';
        b.dataset.id = c.id;
        b.appendChild(el('span', 'admin-pick-name', c.fio));
        if (c.birth_year) b.appendChild(el('span', 'admin-pick-meta', `${c.birth_year} г. р.`));
        b.addEventListener('click', () => {
          err.hidden = true;
          const y = year.input.value.trim();
          void attempt({ confirmPersonId: c.id, ...(/^\d{4}$/.test(y) ? { birthYear: Number(y) } : {}) }, b);
        });
        li.appendChild(b);
        confirmList.appendChild(li);
      }
      setMode('confirm');
      confirmList.querySelector('button')?.focus();
    };

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
        } else if (e instanceof FamilyLoginError && e.need === 'link' && mode === 'login') {
          setMode('link');
        } else if (e instanceof FamilyLoginError && e.need === 'birth_year') {
          fail(e.message, born.input);
        } else {
          fail(friendlyLoginError(e));
          if (mode === 'login') pass.input.select();
        }
      } finally {
        from.disabled = false;
        btn.textContent = idle();
      }
    }
  });
}
