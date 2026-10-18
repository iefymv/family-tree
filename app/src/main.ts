// DEMO: всё вымышленное дерево Ивановых, фокус и подсветка на внуке (как будто он вошёл).
// Добавление людей работает в памяти: новый человек сразу встаёт в раскладку.
import './style.css';
import { buildDemoProfiles, ensurePortrait, fullName, genderSurname, newProfile, patronymicFrom, yearOf, type Profile } from './demo/profiles';
import type { FamilyData, Gender, Person } from './tree/graph';
import { kinshipMap } from './tree/kinship';
import { layoutTree, type TreeLayout } from './tree/layout';
import { addRelative, canAdd, currentSpouse, fillUnknownParent, layoutParents, newPersonId, type AddKind } from './tree/mutate';
import { createTreeView, NODE_LAYOUT } from './tree/render';
import { findPersons } from './tree/search';
import { mountZoomControls, setupZoom } from './tree/zoom';
import { createAddDialog, type AddDraft, type AddResult } from './ui/add-dialog';
import { avatarEl, createSheet, type RelativeGroup } from './ui/sheet';
import { GRANDCHILD, ivanovBig } from '../tests/fixtures/ivanov-big';

const app = document.querySelector<HTMLDivElement>('#app')!;
const rootId = GRANDCHILD;
const profiles: Map<string, Profile> = buildDemoProfiles(ivanovBig);
ensurePortrait(profiles, rootId);
const withNames = (persons: Person[]): Person[] => persons.map((p) => ({ ...p, name: profiles.get(p.id) ? fullName(profiles.get(p.id)!) : p.name }));
let family: FamilyData = { persons: withNames(ivanovBig.persons), relations: [...ivanovBig.relations] };
let layout: TreeLayout;
let kin = new Map<string, string>();
let selectedId: string | null = null;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => window.matchMedia('(max-width: 899px)').matches;

// ——— оболочка ———
const stage = document.createElement('div');
stage.className = 'stage';
app.appendChild(stage);

const rail = document.createElement('div');
rail.className = 'gen-rail';
rail.setAttribute('aria-hidden', 'true');
app.appendChild(rail);

const toast = document.createElement('div');
toast.className = 'toast';
toast.setAttribute('role', 'status');
app.appendChild(toast);
let toastTimer = 0;
function say(text: string) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

// ——— дерево ———
const view = createTreeView(stage, {
  onCardTap(id, placeholder) {
    if (placeholder) {
      void addFlow(id.replace(/^unknown-parent:/, ''), 'fill');
      return;
    }
    openPerson(id);
  },
  onAdd(id, kind) {
    void addFlow(id, kind);
  },
  onBackgroundTap() {
    if (sheet.isOpen()) closePerson();
  },
});

let railItems: HTMLSpanElement[] = [];
function buildRail() {
  rail.replaceChildren();
  railItems = view.generations().map((g) => {
    const s = document.createElement('span');
    s.textContent = g.label;
    s.className = g.label === 'Ваше поколение' ? 'is-you' : '';
    rail.appendChild(s);
    return s;
  });
}

const zoomCtl = setupZoom(view.svg, view.viewport, {
  minScale: 0.1,
  maxScale: 2.4,
  onZoom(t) {
    const gens = view.generations();
    const H = window.innerHeight;
    railItems.forEach((el, i) => {
      const y = t.y + gens[i].y * t.k;
      const visible = y > 110 && y < H - 110 && t.k > 0.3;
      el.style.transform = `translate3d(0, ${Math.round(y)}px, 0) translateY(-50%)`;
      el.classList.toggle('hidden', !visible);
    });
  },
});

function relayout() {
  layout = layoutTree(family, rootId, NODE_LAYOUT);
  kin = kinshipMap(family, rootId);
  // Минимальный масштаб — чтобы всё дерево целиком помещалось на экран.
  const fit = Math.min(window.innerWidth / (layout.width + 200), window.innerHeight / (layout.height + 300));
  zoomCtl.setExtent(Math.min(0.5, fit), 2.4);
}

const START_SCALE = 1;

function focusPerson(id: string, scale?: number, instant = false) {
  const c = view.centerOf(id);
  if (!c) return;
  const a = sheet.isOpen() ? sheet.freeArea() : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const phone = isPhone();
  // На телефоне со шторкой фото ставим выше, чтобы под ним читались имя и даты.
  // Без шторки — фото чуть ниже центра, чтобы сверху были видны родители.
  const sy = sheet.isOpen() && phone ? a.y + a.h * 0.42 : a.y + a.h * (phone ? 0.5 : 0.56);
  zoomCtl.focusOn(c.x, c.y, { scale: scale ?? Math.max(zoomCtl.current().k, sheet.isOpen() && phone ? 0.8 : START_SCALE), instant, screen: { x: a.x + a.w / 2, y: sy } });
}

// ——— карточка человека ———
const sheet = createSheet(app, {
  onClose: () => closePerson(),
  onEdit: (id) => void actions.onSave(id),
  async onPhoto(id, file) {
    const p = profiles.get(id);
    if (!p) return;
    try {
      p.photo = { kind: 'upload', url: await actions.onUploadPhoto(id, file) };
    } catch (e) {
      say((e as Error).message);
      return;
    }
    view.update({ family, layout, profiles, rootId });
    view.select(id, canAdd(family, id));
    openPerson(id, false);
    if (id === rootId) refreshHomeThumb();
    say('Фото добавлено — пока только на этом устройстве');
  },
  onAdd: (id, kind) => void addFlow(id, kind),
  onNavigate(id) {
    openPerson(id);
  },
});

function relativesOf(id: string): RelativeGroup[] {
  const P = (x: string) => ({ profile: profiles.get(x)!, relation: kin.get(x) });
  const parents = layoutParents(family, id).filter((x) => profiles.has(x));
  const spouses = family.relations.filter((r) => r.kind === 'spouse' && (r.aId === id || r.bId === id)).map((r) => (r.kind === 'spouse' ? (r.aId === id ? r.bId : r.aId) : ''));
  const children = family.relations.filter((r) => r.kind === 'parent' && r.parentId === id && r.type !== 'step').map((r) => (r.kind === 'parent' ? r.childId : ''));
  const siblings = new Set<string>();
  for (const p of parents) for (const r of family.relations) if (r.kind === 'parent' && r.parentId === p && r.childId !== id && r.type !== 'raised_by' && r.type !== 'step') siblings.add(r.childId);
  const uniq = (xs: string[]) => [...new Set(xs)].filter((x) => profiles.has(x));
  return [
    { title: 'Родители', people: uniq(parents).map(P) },
    { title: spouses.length > 1 ? 'Супруги' : 'Супруг(а)', people: uniq(spouses).map(P) },
    { title: 'Дети', people: uniq(children).map(P) },
    { title: 'Братья и сёстры', people: uniq([...siblings]).map(P) },
  ];
}

function openPerson(id: string, fly = true) {
  const p = profiles.get(id);
  if (!p) return;
  selectedId = id;
  view.highlight(null);
  view.select(id, canAdd(family, id));
  sheet.open(p, { isRoot: id === rootId, relation: kin.get(id), can: canAdd(family, id), relatives: relativesOf(id) });
  if (fly) requestAnimationFrame(() => focusPerson(id));
}

function closePerson() {
  sheet.close();
  selectedId = null;
  view.select(rootId, canAdd(family, rootId));
}

// ——— действия с данными ———
// Сейчас всё в памяти. При подключении сервера (lib/api.ts) меняются только тела этих трёх функций:
// они получают то, что ввёл человек, и возвращают id / адрес фото; перерисовкой занимается вызывающий код.
const actions = {
  /** Добавить родственника; kind = 'fill' — заполнить «Неизвестно» у детей targetId. Возвращает id нового человека. */
  async onAdd(targetId: string, kind: AddKind | 'fill', res: AddResult): Promise<string> {
    const id = newPersonId();
    const prof = newProfile(id, res.gender, res.surname, res.given, res.patronymic, res.birthDate, res.birthPlace);
    const person: Person = { id, gender: res.gender, name: fullName(prof) };
    family = kind === 'fill' ? fillUnknownParent(family, targetId, person) : addRelative(family, targetId, kind, person);
    profiles.set(id, prof);
    return id;
  },
  /** Редактирование анкеты — пока заглушка. */
  async onSave(_id: string): Promise<void> {
    say('Редактирование появится в следующей версии');
  },
  /** Загрузить фото; возвращает адрес, который можно показать. Сейчас — локально, без отправки. */
  async onUploadPhoto(_id: string, file: File): Promise<string> {
    return URL.createObjectURL(file);
  },
};

// ——— добавление ———
const dialog = createAddDialog(app);
const opposite = (g: Gender): Gender | undefined => (g === 'male' ? 'female' : g === 'female' ? 'male' : undefined);
const birthSurname = (p: Profile) => p.maidenName ?? p.surname;

function draftFor(target: Profile, kind: AddKind | 'fill'): AddDraft {
  const name = fullName(target);
  const father = (ids: string[]) => ids.map((x) => profiles.get(x)).find((x) => x?.gender === 'male');
  if (kind === 'child') {
    const sp = currentSpouse(family, target.id);
    const dad = target.gender === 'male' ? target : sp ? profiles.get(sp) : undefined;
    const fam = dad?.gender === 'male' ? birthSurname(dad) : birthSurname(target);
    return {
      title: 'Новый ребёнок',
      subtitle: `${name}${sp && profiles.get(sp) ? ` и ${fullName(profiles.get(sp)!)}` : ''}`,
      surname: '',
      patronymic: '',
      surnameFor: (g) => genderSurname(fam, g),
      patronymicFor: (g) => (dad?.gender === 'male' ? patronymicFrom(dad.given, g) : ''),
    };
  }
  if (kind === 'spouse') {
    const g = opposite(target.gender);
    return {
      title: 'Супруг или супруга',
      subtitle: `для: ${name}`,
      surname: '',
      patronymic: '',
      gender: g,
      surnameFor: (gg) => (gg === 'female' && target.gender === 'male' ? genderSurname(target.surname, 'female') : ''),
    };
  }
  if (kind === 'parent') {
    const existing = layoutParents(family, target.id).map((x) => profiles.get(x)!);
    const g: Gender | undefined = existing.length ? opposite(existing[0].gender) : 'male';
    return {
      title: existing.length ? 'Второй родитель' : 'Родитель',
      subtitle: `для: ${name}`,
      surname: '',
      patronymic: '',
      gender: g,
      surnameFor: (gg) => genderSurname(birthSurname(target), gg),
    };
  }
  if (kind === 'sibling') {
    const dad = father(layoutParents(family, target.id));
    return {
      title: 'Брат или сестра',
      subtitle: `для: ${name}`,
      surname: '',
      patronymic: '',
      surnameFor: (g) => genderSurname(birthSurname(target), g),
      patronymicFor: (g) => (dad ? patronymicFrom(dad.given, g) : ''),
    };
  }
  // «Неизвестно» — второй родитель детей target.
  const g = opposite(target.gender);
  return {
    title: 'Второй родитель',
    subtitle: `для детей: ${name}`,
    surname: '',
    patronymic: '',
    gender: g,
    surnameFor: (gg) => (gg === 'female' && target.gender === 'male' ? genderSurname(target.surname, 'female') : ''),
  };
}

async function addFlow(targetId: string, kind: AddKind | 'fill') {
  const target = profiles.get(targetId);
  if (!target) return;
  if (kind !== 'fill' && !canAdd(family, targetId)[kind]) {
    say(kind === 'parent' ? 'Оба родителя уже на дереве' : 'Сначала добавьте родителя');
    return;
  }
  const res = await dialog.ask(draftFor(target, kind));
  if (!res) return;
  let id: string;
  try {
    id = await actions.onAdd(targetId, kind, res);
  } catch (e) {
    say((e as Error).message);
    return;
  }
  relayout();
  view.update({ family, layout, profiles, rootId, animate: true, fresh: new Set([id]) });
  buildRail();
  openPerson(id, false);
  window.setTimeout(() => focusPerson(id), reduceMotion() ? 0 : 120);
  say('Добавлено на дерево');
}

// ——— поиск «Найти родственника» ———
const header = document.createElement('header');
header.className = 'topbar';
const brand = document.createElement('div');
brand.className = 'brand';
brand.innerHTML =
  '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 29v-9"/><path d="M16 20c-6 0-10-4-10-9 0-4 3-7 7-7 1-1 2-1 3-1s2 0 3 1c4 0 7 3 7 7 0 5-4 9-10 9Z"/><path d="M16 20l-4-4M16 17l4-4"/></svg></span>';
const brandText = document.createElement('div');
brandText.className = 'brand-text';
const bt = document.createElement('strong');
bt.textContent = 'Семья Ивановых';
const bs = document.createElement('span');
brandText.append(bt, bs);
brand.appendChild(brandText);

const form = document.createElement('form');
form.className = 'search';
form.setAttribute('role', 'search');
const sIcon = document.createElement('span');
sIcon.className = 'search-ico';
sIcon.setAttribute('aria-hidden', 'true');
sIcon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
const input = document.createElement('input');
input.type = 'search';
input.placeholder = 'Найти родственника';
input.setAttribute('aria-label', 'Найти родственника');
input.autocomplete = 'off';
input.enterKeyHint = 'search';
const list = document.createElement('ul');
list.className = 'search-results';
list.hidden = true;
form.append(sIcon, input, list);
header.append(brand, form);
app.appendChild(header);

const updateCount = () => {
  const n = family.persons.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'человек' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'человека' : 'человек';
  bs.textContent = `${n} ${word} · ${view.generations().length} поколений`;
};

function show(id: string) {
  list.hidden = true;
  input.blur();
  if (sheet.isOpen()) sheet.close();
  selectedId = null;
  view.select(id, canAdd(family, id));
  view.highlight(id);
  requestAnimationFrame(() => focusPerson(id, Math.max(zoomCtl.current().k, START_SCALE)));
}

input.addEventListener('input', () => {
  const found = findPersons(family.persons, input.value, 7);
  list.replaceChildren();
  list.hidden = !input.value.trim();
  if (!found.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Никого не нашли';
    list.appendChild(li);
    return;
  }
  for (const p of found) {
    const prof = profiles.get(p.id);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    if (prof) b.appendChild(avatarEl(prof, 'sr-av'));
    const tx = document.createElement('span');
    tx.className = 'sr-text';
    const nm = document.createElement('span');
    nm.className = 'sr-name';
    nm.textContent = p.name;
    tx.appendChild(nm);
    const meta = [kin.get(p.id), prof && yearOf(prof.birth) ? (prof.death ? `${yearOf(prof.birth)} – ${yearOf(prof.death)}` : `род. ${yearOf(prof.birth)}`) : ''].filter(Boolean).join(' · ');
    if (meta) {
      const m = document.createElement('span');
      m.className = 'sr-meta';
      m.textContent = meta;
      tx.appendChild(m);
    }
    b.appendChild(tx);
    b.addEventListener('click', () => {
      input.value = p.name;
      show(p.id);
    });
    li.appendChild(b);
    list.appendChild(li);
  }
});
form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const [first] = findPersons(family.persons, input.value, 1);
  if (first) show(first.id);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!list.hidden) list.hidden = true;
    else if (sheet.isOpen()) closePerson();
  }
});
document.addEventListener('pointerdown', (ev) => {
  if (!form.contains(ev.target as Node)) list.hidden = true;
});

// ——— кнопки «−», «+», «Ко мне» ———
const homeThumb = document.createElement('span');
homeThumb.className = 'home-thumb';
function refreshHomeThumb() {
  homeThumb.replaceChildren(avatarEl(profiles.get(rootId)!, 'home-av'));
}
refreshHomeThumb();
const goHome = () => {
  view.highlight(null);
  if (sheet.isOpen()) sheet.close();
  selectedId = null;
  view.select(rootId, canAdd(family, rootId));
  requestAnimationFrame(() => focusPerson(rootId, START_SCALE));
};
mountZoomControls(app, zoomCtl, goHome, homeThumb);

// ——— старт: дождаться шрифтов (измерение текста), отрисовать, встать на «Это вы» ———
async function start() {
  try {
    await Promise.race([Promise.all([document.fonts.load('600 20px Onest'), document.fonts.load('400 18px Onest'), document.fonts.load('500 18px Onest')]), new Promise((r) => setTimeout(r, 1800))]);
  } catch {
    /* шрифт не загрузился — рисуем системным */
  }
  relayout();
  view.update({ family, layout, profiles, rootId, intro: true });
  buildRail();
  updateCount();
  view.select(rootId, canAdd(family, rootId));
  focusPerson(rootId, START_SCALE, true);
  document.body.classList.add('ready');
}
void start();

window.addEventListener('resize', () => {
  relayout();
  if (selectedId) focusPerson(selectedId);
});

new MutationObserver(updateCount).observe(rail, { childList: true });
