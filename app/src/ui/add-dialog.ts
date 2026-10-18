// Форма «Новый родственник»: фамилия, имя, отчество, пол, дата и место рождения.
import type { Gender } from '../tree/graph';

export interface AddDraft {
  title: string;
  subtitle: string;
  surname: string;
  given?: string;
  patronymic: string;
  /** Подсказка отчества по полу (от имени отца), если отец известен. */
  patronymicFor?: (g: Gender) => string;
  surnameFor?: (g: Gender) => string;
  gender?: Gender;
  /** Пол зафиксирован (например, «мать» не бывает мужчиной) — не показываем выбор. */
  lockGender?: boolean;
}

export interface AddResult {
  gender: Gender;
  surname: string;
  given: string;
  patronymic: string;
  birthDate?: string;
  birthPlace?: string;
}

function field(label: string, name: string, type = 'text', required = false): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.required = required;
  input.autocomplete = 'off';
  wrap.append(span, input);
  return { wrap, input };
}

export function createAddDialog(host: HTMLElement) {
  const dlg = document.createElement('dialog');
  dlg.className = 'add-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const head = document.createElement('header');
  const title = document.createElement('h2');
  const sub = document.createElement('p');
  head.append(title, sub);

  const seg = document.createElement('div');
  seg.className = 'segmented';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Пол');
  const radios: Record<'male' | 'female', HTMLInputElement> = {} as never;
  for (const [g, label] of [
    ['female', 'Женщина'],
    ['male', 'Мужчина'],
  ] as const) {
    const l = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'gender';
    r.value = g;
    const s = document.createElement('span');
    s.textContent = label;
    l.append(r, s);
    seg.appendChild(l);
    radios[g] = r;
  }

  const surname = field('Фамилия', 'surname', 'text', true);
  const given = field('Имя', 'given', 'text', true);
  const patronymic = field('Отчество', 'patronymic');
  // Дата текстом в свободной форме: «12.03.1955», «1919», «20–25 мая 1919» (без mm/dd/yyyy браузера).
  const birth = field('Дата рождения', 'birth');
  birth.input.placeholder = 'например, 12.03.1955 или 1919';
  birth.input.inputMode = 'text';
  const place = field('Место рождения', 'place');
  const row = document.createElement('div');
  row.className = 'field-row';
  row.append(birth.wrap, place.wrap);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-soft';
  cancel.textContent = 'Отмена';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'btn btn-primary';
  ok.textContent = 'Добавить';
  actions.append(cancel, ok);

  form.append(head, seg, surname.wrap, given.wrap, patronymic.wrap, row, actions);
  dlg.appendChild(form);
  host.appendChild(dlg);

  let resolve: ((r: AddResult | null) => void) | null = null;
  let draft: AddDraft | null = null;
  let touched = { surname: false, patronymic: false };
  surname.input.addEventListener('input', () => (touched.surname = true));
  patronymic.input.addEventListener('input', () => (touched.patronymic = true));
  const genderNow = (): Gender => (radios.male.checked ? 'male' : radios.female.checked ? 'female' : 'unknown');
  const syncByGender = () => {
    const g = genderNow();
    if (!draft || g === 'unknown') return;
    if (draft.surnameFor && !touched.surname) surname.input.value = draft.surnameFor(g);
    if (draft.patronymicFor && !touched.patronymic) patronymic.input.value = draft.patronymicFor(g);
  };
  radios.male.addEventListener('change', syncByGender);
  radios.female.addEventListener('change', syncByGender);

  const finish = (r: AddResult | null) => {
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
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) finish(null); // клик по затемнению
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const g = genderNow();
    if (g === 'unknown') {
      seg.classList.add('need');
      seg.querySelector('input')?.focus();
      return;
    }
    finish({
      gender: g,
      surname: surname.input.value.trim(),
      given: given.input.value.trim(),
      patronymic: patronymic.input.value.trim(),
      birthDate: birth.input.value.trim() || undefined,
      birthPlace: place.input.value.trim() || undefined,
    });
  });

  return {
    ask(d: AddDraft): Promise<AddResult | null> {
      draft = d;
      touched = { surname: false, patronymic: false };
      title.textContent = d.title;
      sub.textContent = d.subtitle;
      seg.classList.remove('need');
      seg.hidden = !!d.lockGender;
      radios.male.checked = d.gender === 'male';
      radios.female.checked = d.gender === 'female';
      surname.input.value = d.surname;
      given.input.value = d.given ?? '';
      patronymic.input.value = d.patronymic;
      birth.input.value = '';
      place.input.value = '';
      syncByGender();
      dlg.showModal();
      given.input.focus(); // сразу, без rAF: иначе фокус перескакивает, пока человек уже печатает
      return new Promise((r) => (resolve = r));
    },
  };
}
