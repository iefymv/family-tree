// Карточка человека: нижняя шторка на телефоне (тянется пальцем), боковая панель на компьютере.
// Все данные — через textContent; innerHTML только для статичных иконок.
import { fullName, yearOf, TODAY_YEAR, type DocTile, type Profile } from '../demo/profiles';
import { initials, initialsGradient } from '../tree/portrait';
import { photoURL } from '../tree/render';
import type { AddKind } from '../tree/mutate';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function longDate(date: string): string {
  const [y, m, d] = date.split('-');
  return m && d ? `${+d} ${MONTHS[+m - 1]} ${y}` : `${y} год`;
}

export function yearsWord(n: number): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return `${n} год`;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return `${n} года`;
  return `${n} лет`;
}

const ICONS = {
  birth: '<svg viewBox="0 0 24 24"><path d="M12 21c4-3 6-6.2 6-9.5A6 6 0 0 0 6 11.5C6 14.8 8 18 12 21Z"/><circle cx="12" cy="11" r="2.2"/></svg>',
  death: '<svg viewBox="0 0 24 24"><path d="M12 3c1.8 2.2 2.6 3.9 2.6 5.3a2.6 2.6 0 0 1-5.2 0C9.4 6.9 10.2 5.2 12 3Z"/><path d="M9 12.5h6V21H9z"/></svg>',
  maiden: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="4.5"/><circle cx="15" cy="12" r="4.5"/></svg>',
  job: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19l7-7"/></svg>',
  certificate: '<svg viewBox="0 0 48 48"><rect x="9" y="7" width="30" height="34" rx="3"/><path d="M15 15h18M15 21h18M15 27h10"/><circle cx="31" cy="32" r="4"/></svg>',
  letter: '<svg viewBox="0 0 48 48"><rect x="7" y="12" width="34" height="24" rx="3"/><path d="M8 14l16 12 16-12"/></svg>',
  photo: '<svg viewBox="0 0 48 48"><rect x="8" y="10" width="32" height="28" rx="3"/><circle cx="18" cy="20" r="3.5"/><path d="M9 34l10-9 7 6 5-4 8 7"/></svg>',
  diploma: '<svg viewBox="0 0 48 48"><path d="M10 12h28v24H10z"/><path d="M16 19h16M16 25h16"/><path d="M30 31l3 7 2-3 3 1-3-6"/></svg>',
} as const;

const ADD_ITEMS: [AddKind, string][] = [
  ['parent', 'Родителя'],
  ['spouse', 'Супруга'],
  ['child', 'Ребёнка'],
  ['sibling', 'Брата / сестру'],
];

export interface RelativeGroup {
  title: string;
  people: { profile: Profile; relation?: string }[];
}

export interface SheetContext {
  isRoot: boolean;
  /** Кем приходится вошедшему. */
  relation?: string;
  can: Record<AddKind, boolean>;
  relatives: RelativeGroup[];
}

export interface SheetHandlers {
  onClose(): void;
  onEdit(id: string): void;
  onPhoto(id: string, file: File): void;
  onAdd(id: string, kind: AddKind): void;
  onNavigate(id: string): void;
}

export interface Sheet {
  open(p: Profile, ctx: SheetContext): void;
  close(): void;
  isOpen(): boolean;
  /** Свободная от панели часть экрана — туда ставим выбранного человека. */
  freeArea(): { x: number; y: number; w: number; h: number };
}

type Tab = 'info' | 'tree' | 'gallery' | 'docs';
const TABS: [Tab, string][] = [
  ['info', 'Инфо'],
  ['tree', 'Дерево'],
  ['gallery', 'Галерея'],
  ['docs', 'Документы'],
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function icon(name: keyof typeof ICONS, cls = 'ico'): HTMLSpanElement {
  const s = h('span', cls);
  s.innerHTML = ICONS[name];
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function avatarEl(p: Profile, cls: string): HTMLElement {
  const url = photoURL(p);
  if (url) {
    const img = h('img', cls);
    img.src = url;
    img.alt = `Фото: ${fullName(p)}`;
    return img;
  }
  const g = initialsGradient(p.id);
  const d = h('div', `${cls} initials-av`, initials(p.surname, p.given));
  d.style.background = `linear-gradient(160deg, ${INITIAL_BG(g.index)})`;
  d.style.color = g.ink;
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', `Инициалы: ${fullName(p)}`);
  return d;
}
const INITIAL_BG = (i: number) =>
  [
    ['#5E9C7F', '#2F6B57'],
    ['#E39B6C', '#B6643E'],
    ['#6F8FB8', '#3D5A80'],
    ['#B98AB2', '#8A5A83'],
    ['#CDAE5E', '#9C7A2E'],
    ['#5FA3A6', '#2E6E73'],
    ['#C47F75', '#8E4B4B'],
  ][i].join(', ');

function docTile(d: DocTile): HTMLElement {
  const t = h('figure', `doc doc-${d.kind}`);
  const paper = h('div', 'doc-paper');
  paper.appendChild(icon(d.kind, 'doc-ico'));
  t.appendChild(paper);
  const cap = h('figcaption');
  cap.appendChild(h('span', 'doc-title', d.title));
  if (d.year) cap.appendChild(h('span', 'doc-year', String(d.year)));
  t.appendChild(cap);
  return t;
}

export function createSheet(host: HTMLElement, handlers: SheetHandlers): Sheet {
  const root = h('aside', 'sheet');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Карточка человека');
  root.hidden = true;
  const grab = h('button', 'sheet-grab');
  grab.type = 'button';
  grab.setAttribute('aria-label', 'Развернуть карточку');
  grab.appendChild(h('span'));
  const closeBtn = h('button', 'sheet-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.appendChild(icon('close'));
  const scroll = h('div', 'sheet-scroll');
  root.append(grab, closeBtn, scroll);
  host.appendChild(root);

  const fileInput = h('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  root.appendChild(fileInput);

  let current: Profile | null = null;
  let full = false;
  const isSide = () => window.matchMedia('(min-width: 900px)').matches;

  const setFull = (v: boolean) => {
    full = v;
    root.classList.toggle('is-full', v);
    document.body.classList.toggle('sheet-full', v);
    grab.setAttribute('aria-label', v ? 'Свернуть карточку' : 'Развернуть карточку');
  };

  grab.addEventListener('click', () => setFull(!full));
  closeBtn.addEventListener('click', () => handlers.onClose());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f && current) handlers.onPhoto(current.id, f);
    fileInput.value = '';
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') handlers.onClose();
  });

  // Перетаскивание шторки пальцем (только телефонный вид).
  let drag: { y0: number; t0: number; base: number; moved: boolean } | null = null;
  const onDown = (ev: PointerEvent) => {
    if (isSide()) return;
    if (full && scroll.scrollTop > 0 && !(ev.target as Element).closest('.sheet-grab')) return;
    drag = { y0: ev.clientY, t0: performance.now(), base: root.getBoundingClientRect().top, moved: false };
  };
  const onMove = (ev: PointerEvent) => {
    if (!drag) return;
    const dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      root.classList.add('dragging');
      root.setPointerCapture(ev.pointerId);
    }
    const restTop = window.innerHeight - root.offsetHeight;
    const top = Math.max(restTop, drag.base + dy);
    root.style.transform = `translateY(${top - restTop}px)`;
    ev.preventDefault();
  };
  const onUp = (ev: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    root.classList.remove('dragging');
    root.style.transform = '';
    const dy = ev.clientY - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0); // px/мс
    if (dy > 0 && (v > 0.6 || dy > 140)) {
      if (full) setFull(false);
      else handlers.onClose();
    } else if (dy < 0 && (v < -0.4 || dy < -80)) setFull(true);
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  let tab: Tab = 'info';

  function render(p: Profile, ctx: SheetContext) {
    scroll.replaceChildren();
    const she = p.gender === 'female';
    // Шапка: крупное круглое фото, имя, кем приходится, действия, вкладки.
    const hero = h('header', 'sheet-hero');
    const ph = h('div', 'hero-photo');
    ph.appendChild(avatarEl(p, 'hero-img'));
    const cam = h('button', 'hero-cam');
    cam.type = 'button';
    cam.setAttribute('aria-label', 'Добавить фото');
    cam.appendChild(icon('camera'));
    cam.addEventListener('click', () => fileInput.click());
    ph.appendChild(cam);
    hero.appendChild(ph);

    const name = h('h2', 'hero-name');
    name.id = 'sheet-name';
    name.appendChild(h('span', 'hn-surname', p.surname));
    name.appendChild(h('span', 'hn-given', [p.given, p.patronymic].filter(Boolean).join(' ')));
    hero.appendChild(name);
    root.setAttribute('aria-labelledby', 'sheet-name');
    const sub = ctx.isRoot ? 'Это вы' : ctx.relation;
    if (sub) hero.appendChild(h('p', `hero-rel${ctx.isRoot ? ' is-you' : ''}`, sub));

    const actions = h('div', 'hero-actions');
    const edit = h('button', 'btn btn-primary');
    edit.type = 'button';
    edit.append(icon('edit'), h('span', '', 'Редактировать'));
    edit.addEventListener('click', () => handlers.onEdit(p.id));
    const photo = h('button', 'btn btn-soft');
    photo.type = 'button';
    photo.append(icon('plus'), h('span', '', 'фото'));
    photo.setAttribute('aria-label', 'Добавить фото');
    photo.addEventListener('click', () => fileInput.click());
    actions.append(edit, photo);
    hero.appendChild(actions);

    const tabs = h('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
      const t = h('button', `tab${tab === id ? ' is-active' : ''}`, label);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(tab === id));
      t.addEventListener('click', () => {
        tab = id;
        render(p, ctx);
        if (!isSide()) setFull(true);
        scroll.querySelector('.tab.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      });
      tabs.appendChild(t);
    }
    hero.appendChild(tabs);
    scroll.appendChild(hero);

    const body = h('div', 'sheet-body');
    body.setAttribute('role', 'tabpanel');
    scroll.appendChild(body);

    if (tab === 'info') {
      const dl = h('dl', 'details');
      const row = (label: string, value: string, muted = false) => {
        const r = h('div', 'd-row');
        r.append(h('dt', '', label), h('dd', muted ? 'muted' : '', value));
        dl.appendChild(r);
      };
      row('Дата рождения', p.birth ? longDate(p.birth.date) : 'неизвестна', !p.birth);
      row('Место рождения', p.birth?.place ?? 'неизвестно', !p.birth?.place);
      if (p.death) {
        row('Дата смерти', longDate(p.death.date));
        row('Место смерти', p.death.place ?? 'неизвестно', !p.death.place);
      } else row('Дата смерти', she ? 'Жива' : 'Жив', true);
      const by = yearOf(p.birth);
      if (by) row(p.death ? 'Прожил'.replace('Прожил', she ? 'Прожила' : 'Прожил') : 'Возраст', yearsWord((yearOf(p.death) ?? TODAY_YEAR) - by));
      if (p.maidenName) row('Девичья фамилия', p.maidenName);
      row(p.death ? (she ? 'Чем занималась' : 'Чем занимался') : 'Чем занимается', p.occupation ?? 'не указано', !p.occupation);
      body.appendChild(dl);

      const fSec = section('Интересные факты');
      if (p.facts.length) {
        const ul = h('ul', 'fact-list');
        for (const f of p.facts) {
          const li = h('li');
          li.append(icon('leaf', 'fact-ico'), h('span', '', f));
          ul.appendChild(li);
        }
        fSec.appendChild(ul);
      } else fSec.appendChild(h('p', 'empty-note', 'Пока ничего не записано. Расскажите, чем запомнился этот человек.'));
      body.appendChild(fSec);

      const sSec = section('История жизни');
      if (p.story) {
        const art = h('div', 'story');
        for (const para of p.story.split('\n\n')) art.appendChild(h('p', '', para));
        sSec.appendChild(art);
      } else sSec.appendChild(h('p', 'empty-note', 'История ещё не написана — её можно добавить через «Редактировать».'));
      body.appendChild(sSec);
    } else if (tab === 'tree') {
      for (const g of ctx.relatives) {
        if (!g.people.length) continue;
        const sec = section(g.title, String(g.people.length));
        const ul = h('ul', 'rel-list');
        for (const r of g.people) {
          const li = h('li');
          const b = h('button', 'rel-row');
          b.type = 'button';
          b.appendChild(avatarEl(r.profile, 'rel-av'));
          const tx = h('span', 'rel-text');
          tx.append(h('span', 'rel-name', fullName(r.profile)));
          const yb = yearOf(r.profile.birth);
          const yd = yearOf(r.profile.death);
          const meta = [r.relation, yb ? (yd ? `${yb} – ${yd}` : `род. ${yb}`) : ''].filter(Boolean).join(' · ');
          if (meta) tx.append(h('span', 'rel-meta', meta));
          b.appendChild(tx);
          b.addEventListener('click', () => handlers.onNavigate(r.profile.id));
          li.appendChild(b);
          ul.appendChild(li);
        }
        sec.appendChild(ul);
        body.appendChild(sec);
      }
      const addSec = section('Добавить родственника');
      const grid = h('div', 'add-grid');
      for (const [kind, label] of ADD_ITEMS) {
        const b = h('button', 'add-btn');
        b.type = 'button';
        b.append(icon('plus', 'add-ico'), h('span', '', label));
        b.disabled = !ctx.can[kind];
        if (b.disabled) b.title = kind === 'parent' ? 'Оба родителя уже есть' : 'Сначала добавьте родителя';
        b.addEventListener('click', () => handlers.onAdd(p.id, kind));
        grid.appendChild(b);
      }
      addSec.appendChild(grid);
      body.appendChild(addSec);
    } else if (tab === 'gallery') {
      const grid = h('div', 'gallery-grid');
      const main = h('figure', 'g-item g-main');
      main.appendChild(avatarEl(p, 'g-img'));
      main.appendChild(h('figcaption', '', 'Главное фото'));
      grid.appendChild(main);
      const add = h('button', 'g-item g-add');
      add.type = 'button';
      add.append(icon('plus', 'g-add-ico'), h('span', '', 'Добавить фото'));
      add.addEventListener('click', () => fileInput.click());
      grid.appendChild(add);
      body.appendChild(grid);
      body.appendChild(h('p', 'empty-note', 'Здесь будут семейные фотографии. Пока можно поменять главное фото — оно сразу появится на дереве.'));
    } else {
      const docs = h('div', 'doc-grid');
      for (const d of p.docs) docs.appendChild(docTile(d));
      const addDoc = h('button', 'doc doc-add');
      addDoc.type = 'button';
      addDoc.append(icon('plus', 'doc-add-ico'), h('span', '', 'Добавить'));
      addDoc.addEventListener('click', () => handlers.onEdit(p.id));
      docs.appendChild(addDoc);
      body.appendChild(docs);
      if (!p.docs.length) body.appendChild(h('p', 'empty-note', 'Документов пока нет: метрики, письма, дипломы можно будет прикрепить сюда.'));
    }
  }

  function section(title: string, badge?: string): HTMLElement {
    const s = h('section', 'sheet-sec');
    const hh = h('h3', '', title);
    if (badge) hh.appendChild(h('span', 'sec-badge', badge));
    s.appendChild(hh);
    return s;
  }

  return {
    open(p, ctx) {
      const wasOpen = !root.hidden;
      if (current?.id !== p.id) tab = 'info';
      current = p;
      render(p, ctx);
      if (!wasOpen) {
        setFull(false);
        root.hidden = false;
        document.body.classList.add('sheet-up');
        requestAnimationFrame(() => root.classList.add('is-open'));
      }
      scroll.scrollTop = 0;
    },
    close() {
      current = null;
      root.classList.remove('is-open');
      document.body.classList.remove('sheet-up', 'sheet-full');
      setFull(false);
      const done = () => {
        if (!root.classList.contains('is-open')) root.hidden = true;
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
      else window.setTimeout(done, 380);
    },
    isOpen: () => !root.hidden && root.classList.contains('is-open'),
    freeArea() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (root.hidden) return { x: 0, y: 0, w: W, h: H };
      if (isSide()) {
        const w = root.offsetWidth + 24;
        return { x: 0, y: 0, w: W - w, h: H };
      }
      const peek = Math.round(H * 0.58);
      return { x: 0, y: 0, w: W, h: H - peek };
    },
  };
}
