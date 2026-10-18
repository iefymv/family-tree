// Форма «Редактировать»: ФИО, девичья фамилия, пол, даты и места, чем занимался, история жизни,
// интересные факты (добавить/убрать), «нужно уточнить». Даты — текстом в свободной форме.
import type { EditResult, PersonForm } from '../app/backend';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function field(label: string, name: string, opts: { placeholder?: string; area?: boolean } = {}) {
  const wrap = h('label', 'field');
  wrap.appendChild(h('span', '', label));
  const input = opts.area ? h('textarea') : h('input');
  input.name = name;
  if (input instanceof HTMLInputElement) input.type = 'text';
  input.autocomplete = 'off';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (input instanceof HTMLTextAreaElement) input.rows = 6;
  wrap.appendChild(input);
  return { wrap, input };
}

export function createEditForm(host: HTMLElement) {
  const dlg = h('dialog', 'add-dialog edit-dialog');
  dlg.setAttribute('aria-labelledby', 'edit-title');
  const form = h('form');
  form.method = 'dialog';
  form.noValidate = true;
  const head = h('header');
  const title = h('h2', '', 'Редактировать');
  title.id = 'edit-title';
  const sub = h('p');
  head.append(title, sub);

  const seg = h('div', 'segmented');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Пол');
  const radios = {} as Record<'f' | 'm', HTMLInputElement>;
  for (const [g, label] of [['f', 'Женщина'], ['m', 'Мужчина']] as const) {
    const l = h('label');
    const r = h('input');
    r.type = 'radio';
    r.name = 'sex';
    r.value = g;
    l.append(r, h('span', '', label));
    seg.appendChild(l);
    radios[g] = r;
  }

  const surname = field('Фамилия', 'surname');
  const given = field('Имя', 'given');
  const patronymic = field('Отчество', 'patronymic');
  const maiden = field('Девичья фамилия', 'maiden', { placeholder: 'если менялась при замужестве' });
  const DATE_HINT = 'например, 12.03.1955 или 20–25 мая 1919';
  const birth = field('Дата рождения', 'birth', { placeholder: DATE_HINT });
  const birthPlace = field('Место рождения', 'birthPlace');
  const death = field('Дата смерти', 'death', { placeholder: 'если человека уже нет' });
  const deathPlace = field('Место смерти', 'deathPlace');
  const occupation = field('Чем занимался', 'occupation', { placeholder: 'профессия, дело жизни' });
  const story = field('История жизни', 'story', { area: true, placeholder: 'Как жил, что запомнилось родным' });
  const row = (a: HTMLElement, b: HTMLElement) => {
    const r = h('div', 'field-row');
    r.append(a, b);
    return r;
  };

  // Интересные факты: список с «Убрать факт» и поле «Новый факт».
  const factsBox = h('fieldset', 'facts-edit');
  factsBox.appendChild(h('legend', '', 'Интересные факты'));
  const factList = h('ul', 'fact-edit-list');
  const newFact = field('Новый факт', 'newFact', { placeholder: 'например, пел в хоре' });
  const addFactBtn = h('button', 'btn btn-soft', 'Добавить факт');
  addFactBtn.type = 'button';
  const factRow = h('div', 'fact-add');
  factRow.append(newFact.wrap, addFactBtn);
  factsBox.append(factList, factRow);

  const check = h('label', 'check');
  const needs = h('input');
  needs.type = 'checkbox';
  needs.name = 'needsCheck';
  check.append(needs, h('span', '', 'Нужно уточнить — данные неточные'));

  const err = h('p', 'form-error');
  err.setAttribute('role', 'alert');
  err.hidden = true;

  const actions = h('div', 'dialog-actions');
  const cancel = h('button', 'btn btn-soft', 'Отмена');
  cancel.type = 'button';
  const ok = h('button', 'btn btn-primary', 'Сохранить');
  ok.type = 'submit';
  actions.append(cancel, ok);

  form.append(
    head, seg, surname.wrap, given.wrap, patronymic.wrap, maiden.wrap,
    row(birth.wrap, birthPlace.wrap), row(death.wrap, deathPlace.wrap), occupation.wrap, story.wrap,
    factsBox, check, err, actions,
  );
  dlg.appendChild(form);
  host.appendChild(dlg);

  let initial: PersonForm | null = null;
  let facts: { id: string; text: string }[] = [];
  let added: string[] = [];
  let removed: string[] = [];
  let resolve: ((r: EditResult | null) => void) | null = null;

  function drawFacts() {
    factList.replaceChildren();
    const all = [...facts.filter((f) => !removed.includes(f.id)).map((f) => ({ key: f.id, text: f.text, isNew: false })), ...added.map((t, i) => ({ key: `new-${i}`, text: t, isNew: true }))];
    for (const f of all) {
      const li = h('li');
      li.appendChild(h('span', 'fact-text', f.text));
      const rm = h('button', 'btn btn-mini');
      rm.type = 'button';
      rm.textContent = 'Убрать факт';
      rm.addEventListener('click', () => {
        if (f.isNew) added = added.filter((_, i) => `new-${i}` !== f.key);
        else removed = [...removed, f.key];
        drawFacts();
      });
      li.appendChild(rm);
      factList.appendChild(li);
    }
  }
  const pushFact = () => {
    const t = newFact.input.value.trim();
    if (!t) return;
    added = [...added, t];
    newFact.input.value = '';
    drawFacts();
  };
  addFactBtn.addEventListener('click', pushFact);
  newFact.input.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') {
      ev.preventDefault();
      pushFact();
    }
  });

  const finish = (r: EditResult | null) => {
    const f = resolve;
    resolve = null;
    if (dlg.open) dlg.close();
    f?.(r);
  };
  cancel.addEventListener('click', () => finish(null));
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    finish(null);
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!given.input.value.trim() && !surname.input.value.trim()) {
      err.textContent = 'Укажите хотя бы имя или фамилию';
      err.hidden = false;
      given.input.focus();
      return;
    }
    if (newFact.input.value.trim()) pushFact(); // написанный, но не добавленный факт не теряем
    finish({
      form: {
        surname: surname.input.value, given: given.input.value, patronymic: patronymic.input.value, maidenName: maiden.input.value,
        sex: radios.m.checked ? 'm' : radios.f.checked ? 'f' : (initial?.sex ?? 'u'),
        birthDate: birth.input.value, birthPlace: birthPlace.input.value, deathDate: death.input.value, deathPlace: deathPlace.input.value,
        occupation: occupation.input.value, lifeStory: story.input.value, needsCheck: needs.checked, facts,
      },
      newFacts: added,
      removedFactIds: removed,
    });
  });

  return {
    ask(p: PersonForm, subtitle: string): Promise<EditResult | null> {
      initial = p;
      facts = p.facts;
      added = [];
      removed = [];
      sub.textContent = subtitle;
      err.hidden = true;
      radios.m.checked = p.sex === 'm';
      radios.f.checked = p.sex === 'f';
      surname.input.value = p.surname;
      given.input.value = p.given;
      patronymic.input.value = p.patronymic;
      maiden.input.value = p.maidenName;
      birth.input.value = p.birthDate;
      birthPlace.input.value = p.birthPlace;
      death.input.value = p.deathDate;
      deathPlace.input.value = p.deathPlace;
      occupation.input.value = p.occupation;
      story.input.value = p.lifeStory;
      needs.checked = p.needsCheck;
      newFact.input.value = '';
      drawFacts();
      dlg.showModal();
      form.scrollTop = 0;
      surname.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает
      return new Promise((r) => (resolve = r));
    },
  };
}
