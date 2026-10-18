// Админка (только role=admin): входы родственников, создание входа для карточки, сброс пароля,
// отключение/включение, восстановление удалённых людей. Все вызовы — Edge Function admin-users и RPC.
import { AdminError, createMember, listMembers, resetPassword, setDisabled, suggestPassword, type MemberRow } from '../lib/admin';
import { listDeletedPeople, displayName } from '../lib/api';
import { findPersons } from '../tree/search';
import type { Person } from '../tree/graph';

export interface AdminDeps {
  persons(): Person[];
  /** Подсказка «кем приходится» и годы для выбора карточки. */
  describe(id: string): string;
  myPersonId: string;
  /** Скрыть админку и дождаться нажатия на карточку на дереве. */
  pickOnTree(): Promise<string | null>;
  restorePerson(id: string): Promise<void>;
  say(text: string): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(text: string, cls = 'btn btn-soft'): HTMLButtonElement {
  const b = h('button', cls, text);
  b.type = 'button';
  return b;
}
function field(label: string, name: string, type = 'text') {
  const wrap = h('label', 'field');
  wrap.appendChild(h('span', '', label));
  const input = h('input');
  input.name = name;
  input.type = type;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.spellcheck = false;
  wrap.appendChild(input);
  return { wrap, input };
}
const errText = (e: unknown) => (e instanceof AdminError || e instanceof Error ? e.message : 'Не удалось выполнить действие');

export function createAdminScreen(host: HTMLElement, deps: AdminDeps) {
  const panel = h('section', 'admin');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'admin-title');
  panel.hidden = true;
  const head = h('header', 'admin-head');
  const title = h('h2', '', 'Администрирование');
  title.id = 'admin-title';
  const close = btn('Закрыть');
  head.append(title, close);
  const body = h('div', 'admin-body');
  panel.append(head, body);
  host.appendChild(panel);

  // ——— «Создать вход» ———
  const create = h('section', 'admin-sec');
  create.appendChild(h('h3', '', 'Создать вход'));
  create.appendChild(h('p', 'hint', 'Вход привязывается к карточке человека на дереве. После входа дерево откроется с ним в центре.'));
  const who = field('Чья карточка', 'person-search', 'search');
  who.input.placeholder = 'начните вводить имя';
  const results = h('ul', 'admin-results');
  const pickBtn = btn('Выбрать на дереве');
  const chosen = h('p', 'admin-chosen');
  chosen.hidden = true;
  const login = field('Имя и фамилия для входа', 'new-login');
  const pass = field('Пароль', 'new-password');
  const gen = btn('Придумать');
  const passRow = h('div', 'field-row admin-pass');
  passRow.append(pass.wrap, gen);
  const label = field('Подпись в истории правок', 'display-name');
  label.input.placeholder = 'например, Пётр';
  const createErr = h('p', 'form-error');
  createErr.setAttribute('role', 'alert');
  createErr.hidden = true;
  const createOk = h('p', 'form-ok');
  createOk.setAttribute('role', 'status');
  createOk.hidden = true;
  const createBtn = btn('Создать вход', 'btn btn-primary btn-big');
  create.append(who.wrap, results, pickBtn, chosen, login.wrap, passRow, label.wrap, createErr, createOk, createBtn);

  // ——— «Входы» ———
  const membersSec = h('section', 'admin-sec');
  membersSec.appendChild(h('h3', '', 'Входы родственников'));
  const membersList = h('ul', 'admin-members');
  membersSec.appendChild(membersList);

  // ——— «Удалённые люди» ———
  const deletedSec = h('section', 'admin-sec');
  deletedSec.appendChild(h('h3', '', 'Удалённые люди'));
  const deletedList = h('ul', 'admin-deleted');
  deletedSec.appendChild(deletedList);

  body.append(create, membersSec, deletedSec);

  let personId: string | null = null;
  let members: MemberRow[] = [];

  const personName = (id: string) => deps.persons().find((p) => p.id === id)?.name ?? 'карточка не на дереве';

  function choose(id: string) {
    personId = id;
    const p = deps.persons().find((x) => x.id === id);
    chosen.hidden = false;
    chosen.textContent = `Карточка: ${p?.name ?? id}${deps.describe(id) ? ` · ${deps.describe(id)}` : ''}`;
    results.replaceChildren();
    who.input.value = '';
    if (p) {
      login.input.value = p.name;
      label.input.value = p.name.split(' ')[0] ?? '';
    }
    if (!pass.input.value) pass.input.value = suggestPassword();
    createErr.hidden = true;
    createOk.hidden = true;
  }

  who.input.addEventListener('input', () => {
    results.replaceChildren();
    for (const p of findPersons(deps.persons(), who.input.value, 6)) {
      const li = h('li');
      const b = btn('', 'admin-pick');
      b.dataset.id = p.id;
      b.appendChild(h('span', 'admin-pick-name', p.name));
      const d = deps.describe(p.id);
      if (d) b.appendChild(h('span', 'admin-pick-meta', d));
      b.addEventListener('click', () => choose(p.id));
      li.appendChild(b);
      results.appendChild(li);
    }
  });
  pickBtn.addEventListener('click', async () => {
    panel.hidden = true;
    const id = await deps.pickOnTree();
    panel.hidden = false;
    if (id) choose(id);
  });
  gen.addEventListener('click', () => (pass.input.value = suggestPassword()));

  createBtn.addEventListener('click', async () => {
    createErr.hidden = true;
    createOk.hidden = true;
    const fail = (t: string) => {
      createErr.textContent = t;
      createErr.hidden = false;
    };
    if (!personId) return fail('Сначала выберите карточку человека');
    if (!login.input.value.trim()) return fail('Введите имя и фамилию для входа');
    if (pass.input.value.length < 6) return fail('Пароль — не короче 6 символов');
    if (!label.input.value.trim()) return fail('Введите подпись для истории правок');
    createBtn.disabled = true;
    try {
      const r = await createMember({ personId, login: login.input.value, password: pass.input.value, displayName: label.input.value.trim() });
      createOk.textContent = `Вход создан. Передайте: имя «${login.input.value.trim()}», пароль «${pass.input.value}».`;
      createOk.hidden = false;
      deps.say(`Вход создан: ${r.login}`);
      personId = null;
      chosen.hidden = true;
      pass.input.value = '';
      await refreshMembers();
    } catch (e) {
      fail(errText(e));
    } finally {
      createBtn.disabled = false;
    }
  });

  async function refreshMembers() {
    membersList.replaceChildren(h('li', 'empty-note', 'Загружаем…'));
    try {
      members = await listMembers();
    } catch (e) {
      membersList.replaceChildren(h('li', 'form-error', errText(e)));
      return;
    }
    membersList.replaceChildren();
    if (!members.length) membersList.appendChild(h('li', 'empty-note', 'Входов пока нет.'));
    for (const m of members) membersList.appendChild(memberRow(m));
  }

  function memberRow(m: MemberRow): HTMLElement {
    const li = h('li', `admin-member${m.disabled ? ' is-disabled' : ''}`);
    li.dataset.login = m.login;
    const top = h('div', 'am-text');
    top.appendChild(h('span', 'am-name', `${m.display_name} — ${personName(m.person_id)}`));
    top.appendChild(h('span', 'am-meta', `вход: «${m.login}» · ${m.role === 'admin' ? 'администратор' : 'родственник'}${m.disabled ? ' · отключён' : ''}`));
    if (m.family_login) top.appendChild(h('span', 'am-badge', 'семейный вход'));
    li.appendChild(top);
    const acts = h('div', 'am-actions');
    const reset = btn('Сменить пароль');
    reset.addEventListener('click', () => {
      if (li.querySelector('.am-reset')) return;
      const box = h('div', 'am-reset field-row');
      const f = field('Новый пароль', 'reset-password');
      f.input.value = suggestPassword();
      const save = btn('Сохранить пароль', 'btn btn-primary');
      save.addEventListener('click', async () => {
        if (f.input.value.length < 6) return deps.say('Пароль — не короче 6 символов');
        save.disabled = true;
        try {
          await resetPassword(m.user_id, f.input.value);
          deps.say(`Пароль изменён. Новый: ${f.input.value}`);
          box.replaceChildren(h('p', 'form-ok', `Пароль изменён. Новый пароль: «${f.input.value}»`));
        } catch (e) {
          deps.say(errText(e));
          save.disabled = false;
        }
      });
      box.append(f.wrap, save);
      li.appendChild(box);
      f.input.focus();
    });
    acts.appendChild(reset);
    if (m.person_id !== deps.myPersonId) {
      const toggle = btn(m.disabled ? 'Включить' : 'Отключить');
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await setDisabled(m.user_id, !m.disabled);
          deps.say(m.disabled ? 'Вход включён' : 'Вход отключён');
          await refreshMembers();
        } catch (e) {
          deps.say(errText(e));
          toggle.disabled = false;
        }
      });
      acts.appendChild(toggle);
    }
    li.appendChild(acts);
    return li;
  }

  async function refreshDeleted() {
    deletedList.replaceChildren();
    try {
      const rows = await listDeletedPeople();
      if (!rows.length) deletedList.appendChild(h('li', 'empty-note', 'Удалённых нет.'));
      for (const r of rows) {
        const li = h('li', 'admin-member');
        li.appendChild(h('span', 'am-name', [r.surname, r.given_name, r.patronymic].filter(Boolean).join(' ') || displayName(r)));
        const b = btn('Восстановить');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await deps.restorePerson(r.id);
            await refreshDeleted();
          } catch (e) {
            deps.say(errText(e));
            b.disabled = false;
          }
        });
        li.appendChild(b);
        deletedList.appendChild(li);
      }
    } catch (e) {
      deletedList.appendChild(h('li', 'form-error', errText(e)));
    }
  }

  const hide = () => (panel.hidden = true);
  close.addEventListener('click', hide);
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });

  return {
    open() {
      panel.hidden = false;
      createErr.hidden = true;
      createOk.hidden = true;
      void refreshMembers();
      void refreshDeleted();
      who.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает
    },
    close: hide,
    isOpen: () => !panel.hidden,
  };
}
