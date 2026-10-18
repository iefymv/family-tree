// Экран дерева: всё дерево с вошедшим в центре, поиск, карточка человека, «+» на дереве, правка, история,
// документы, меню и админка. Данные — через Backend (сервер или демо).
import { fullName, genderSurname, patronymicFrom, yearOf, type DocTile, type Profile } from '../demo/profiles';
import type { FamilyData, Gender } from '../tree/graph';
import { kinshipMap } from '../tree/kinship';
import { layoutTree, type TreeLayout } from '../tree/layout';
import { canAdd, currentSpouse, layoutParents, type AddKind } from '../tree/mutate';
import { createTreeView, NODE_LAYOUT } from '../tree/render';
import { findPersons } from '../tree/search';
import { mountZoomControls, setupZoom } from '../tree/zoom';
import { createAddDialog, type AddDraft } from '../ui/add-dialog';
import { createAdminScreen } from '../ui/admin';
import { createEditForm } from '../ui/edit-form';
import { avatarEl, createSheet, type RelativeGroup } from '../ui/sheet';
import { createViewer } from '../ui/viewer';
import { invalidate } from '../lib/signedUrls';
import type { Backend } from './backend';

const MENU_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const LEAF = '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 29v-9"/><path d="M16 20c-6 0-10-4-10-9 0-4 3-7 7-7 1-1 2-1 3-1s2 0 3 1c4 0 7 3 7 7 0 5-4 9-10 9Z"/><path d="M16 20l-4-4M16 17l4-4"/></svg></span>';

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Не получилось. Попробуйте ещё раз.');

export async function mountTreeApp(app: HTMLElement, backend: Backend): Promise<void> {
  const live = backend.mode === 'live';
  const admin = live && backend.me.role === 'admin';
  let { family, profiles } = await backend.load();
  let rootId = profiles.has(backend.me.personId) ? backend.me.personId : family.persons[0]?.id ?? backend.me.personId;
  let layout!: TreeLayout;
  let kin = new Map<string, string>();
  let selectedId: string | null = null;
  let picking: ((id: string | null) => void) | null = null;

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
  const toastText = document.createElement('span');
  const toastBtn = document.createElement('button');
  toastBtn.type = 'button';
  toastBtn.className = 'toast-btn';
  toastBtn.hidden = true;
  toast.append(toastText, toastBtn);
  app.appendChild(toast);
  let toastTimer = 0;
  let toastAction: (() => void) | null = null;
  toastBtn.addEventListener('click', () => {
    const a = toastAction;
    toast.classList.remove('show');
    toastAction = null;
    a?.();
  });
  function say(text: string, action?: { label: string; run: () => void }) {
    toastText.textContent = text;
    toastAction = action?.run ?? null;
    toastBtn.hidden = !action;
    toastBtn.textContent = action?.label ?? '';
    toast.classList.add('show');
    toast.classList.toggle('has-action', !!action);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), action ? 10000 : 3200);
  }

  // ——— дерево ———
  const view = createTreeView(stage, {
    onCardTap(id, placeholder) {
      if (picking) {
        if (!placeholder) finishPick(id);
        return;
      }
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

  /** Подпись поколения прячется, если на неё наезжает зелёный «+» у выбранной карточки. */
  function railAvoidChips() {
    const chips = [...stage.querySelectorAll<SVGGElement>('.add-chip')].map((c) => c.getBoundingClientRect());
    for (const el of railItems) {
      if (el.classList.contains('hidden')) {
        el.classList.remove('covered');
        continue;
      }
      const r = el.getBoundingClientRect();
      const hit = chips.some((c) => c.left < r.right + 6 && c.right > r.left - 6 && c.top < r.bottom + 6 && c.bottom > r.top - 6);
      el.classList.toggle('covered', hit);
    }
  }

  const zoomCtl = setupZoom(view.svg, view.viewport, {
    minScale: 0.1,
    maxScale: 2.4,
    onZoom(t) {
      const gens = view.generations();
      const H = window.innerHeight;
      railItems.forEach((el, i) => {
        if (!gens[i]) return;
        const y = t.y + gens[i].y * t.k;
        const visible = y > 110 && y < H - 110 && t.k > 0.3;
        el.style.transform = `translate3d(0, ${Math.round(y)}px, 0) translateY(-50%)`;
        el.classList.toggle('hidden', !visible);
      });
      railAvoidChips();
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

  function select(id: string | null) {
    view.select(id, id ? canAdd(family, id) : undefined);
    requestAnimationFrame(railAvoidChips);
  }

  // ——— данные: перечитать после правки ———
  async function reload(fresh?: Set<string>) {
    const d = await backend.load();
    family = d.family;
    profiles = d.profiles;
    if (!profiles.has(rootId)) rootId = family.persons[0]?.id ?? rootId;
    relayout();
    view.update({ family, layout, profiles, rootId, animate: !!fresh, fresh });
    buildRail();
    updateCount();
    refreshHomeThumb();
  }

  // ——— карточка человека ———
  const viewer = createViewer(app);
  const sheet = createSheet(app, {
    onClose: () => closePerson(),
    onEdit: (id) => void editFlow(id),
    async onPhoto(id, file) {
      say('Загружаем фото…');
      try {
        await backend.uploadPhoto(id, file);
        await reload();
      } catch (e) {
        say(errMsg(e));
        return;
      }
      select(id);
      openPerson(id, false);
      say(live ? 'Фото добавлено' : 'Фото добавлено — только на этом устройстве (демо)');
    },
    onAdd: (id, kind) => void addFlow(id, kind),
    onNavigate(id) {
      openPerson(id);
    },
    async onUploadDocs(id, files) {
      if (!live) return say('В демо-режиме документы не сохраняются');
      say(files.length > 1 ? `Загружаем документы: ${files.length}…` : 'Загружаем документ…');
      try {
        await backend.uploadDocuments(id, files);
      } catch (e) {
        say(errMsg(e));
        return;
      }
      say(files.length > 1 ? `Добавлено документов: ${files.length}` : 'Документ добавлен');
      openPerson(id, false);
    },
    async onOpenDoc(_id, doc: DocTile) {
      if (!doc.path) return;
      const path = doc.path;
      const open = async (retry: boolean) => {
        const url = await backend.documentUrl(path);
        if (!url) return say('Не удалось открыть документ');
        viewer.show(url, doc.title, doc.mime, retry ? () => {
          invalidate(path); // ссылка истекла — берём новую один раз
          void open(false);
        } : undefined);
      };
      try {
        await open(true);
      } catch (e) {
        say(errMsg(e));
      }
    },
    async onRemoveFact(id, factId) {
      try {
        await backend.removeFact(factId);
      } catch (e) {
        return say(errMsg(e));
      }
      say('Факт убран. Если по ошибке — администратор вернёт его в «Истории».');
      openPerson(id, false);
    },
    async onRemoveRelation(id, otherId) {
      const other = profiles.get(otherId);
      if (!window.confirm(`Убрать связь с человеком «${other ? fullName(other) : ''}»? Сами люди останутся на дереве.`)) return;
      try {
        await backend.removeRelation(id, otherId);
        await reload();
      } catch (e) {
        return say(errMsg(e));
      }
      say('Связь убрана');
      if (profiles.has(id)) openPerson(id, false);
      else closePerson();
    },
    async onDeletePerson(id) {
      const p = profiles.get(id);
      if (!p || !window.confirm(`Удалить человека «${fullName(p)}» с дерева? Его связи, факты и документы тоже скроются.`)) return;
      try {
        await backend.deletePerson(id);
        closePerson();
        await reload();
      } catch (e) {
        return say(errMsg(e));
      }
      say('Человек удалён', {
        label: 'Восстановить',
        run: () => void restore(id),
      });
    },
    loadHistory: (id) => backend.history(id, (x) => (profiles.get(x) ? fullName(profiles.get(x)!) : undefined)),
    async onRevert(id, item) {
      try {
        let r = await backend.revert(item.id);
        if (!r.ok && r.conflict) {
          if (!window.confirm('С тех пор это поле уже меняли. Всё равно вернуть как было?')) return;
          r = await backend.revert(item.id, true);
        }
        await reload();
      } catch (e) {
        return say(errMsg(e));
      }
      say('Вернули как было');
      if (profiles.has(id)) openPerson(id, false);
      else closePerson();
    },
  });

  async function restore(id: string) {
    try {
      await backend.restorePerson(id);
      await reload(new Set([id]));
    } catch (e) {
      return say(errMsg(e));
    }
    say('Человек восстановлен');
    if (profiles.has(id)) openPerson(id);
  }

  function relativesOf(id: string): RelativeGroup[] {
    const P = (x: string) => ({ profile: profiles.get(x)!, relation: kin.get(x) });
    const parents = layoutParents(family, id).filter((x) => profiles.has(x));
    const spouses = family.relations.filter((r) => r.kind === 'spouse' && (r.aId === id || r.bId === id)).map((r) => (r.kind === 'spouse' ? (r.aId === id ? r.bId : r.aId) : ''));
    const children = family.relations.filter((r) => r.kind === 'parent' && r.parentId === id && r.type !== 'step').map((r) => (r.kind === 'parent' ? r.childId : ''));
    const siblings = new Set<string>();
    for (const p of parents) for (const r of family.relations) if (r.kind === 'parent' && r.parentId === p && r.childId !== id && r.type !== 'raised_by' && r.type !== 'step') siblings.add(r.childId);
    const uniq = (xs: string[]) => [...new Set(xs)].filter((x) => profiles.has(x));
    return [
      { title: 'Родители', people: uniq(parents).map(P), direct: true },
      { title: spouses.length > 1 ? 'Супруги' : 'Супруг(а)', people: uniq(spouses).map(P), direct: true },
      { title: 'Дети', people: uniq(children).map(P), direct: true },
      { title: 'Братья и сёстры', people: uniq([...siblings]).map(P) },
    ];
  }

  let openSeq = 0;
  function openPerson(id: string, fly = true) {
    const p = profiles.get(id);
    if (!p) return;
    selectedId = id;
    view.highlight(null);
    select(id);
    const ctx = () => ({ isRoot: id === rootId, relation: kin.get(id), can: canAdd(family, id), relatives: relativesOf(id), admin, live });
    sheet.open(p, ctx());
    if (fly) requestAnimationFrame(() => focusPerson(id));
    // Полная карточка (факты, документы) догружается и подменяет краткую.
    const seq = ++openSeq;
    backend.detail(id).then(
      (full) => {
        if (seq !== openSeq || selectedId !== id || !full || !sheet.isOpen()) return;
        sheet.open({ ...full, photo: profiles.get(id)?.photo ?? full.photo }, ctx());
      },
      (e: unknown) => say(errMsg(e)),
    );
  }

  function closePerson() {
    sheet.close();
    selectedId = null;
    openSeq++;
    select(rootId);
  }

  // ——— правка ———
  const editForm = createEditForm(app);
  async function editFlow(id: string) {
    const p = profiles.get(id);
    let form;
    try {
      form = await backend.formFor(id);
    } catch (e) {
      return say(errMsg(e));
    }
    if (!form || !p) return say('Человек не найден — обновите страницу');
    const res = await editForm.ask(form, fullName(p));
    if (!res) return;
    try {
      await backend.save(id, res);
      await reload();
    } catch (e) {
      return say(errMsg(e));
    }
    say('Сохранено');
    if (profiles.has(id)) openPerson(id, false);
  }

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
      const existing = layoutParents(family, target.id).map((x) => profiles.get(x)).filter((x): x is Profile => !!x);
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
    // «Неизвестно» — второй родитель детей target. Отцу фамилия — по фамилии детей при рождении.
    const g = opposite(target.gender);
    const kid = family.persons
      .map((x) => x.id)
      .filter((x) => {
        const ps = layoutParents(family, x);
        return ps.length === 1 && ps[0] === target.id;
      })
      .map((x) => profiles.get(x))
      .find((x): x is Profile => !!x);
    return {
      title: 'Второй родитель',
      subtitle: `для детей: ${name}`,
      surname: '',
      patronymic: '',
      gender: g,
      surnameFor: (gg) =>
        gg === 'male' ? (kid ? genderSurname(birthSurname(kid), 'male') : target.gender === 'female' ? genderSurname(birthSurname(target), 'male') : '') : target.gender === 'male' ? genderSurname(target.surname, 'female') : '',
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
      id = await backend.addRelative(targetId, kind, res, family);
      await reload(new Set([id]));
    } catch (e) {
      say(errMsg(e));
      return;
    }
    openPerson(id, false);
    window.setTimeout(() => focusPerson(id), reduceMotion() ? 0 : 120);
    say('Добавлено на дерево');
  }

  // ——— верхняя панель: название, поиск, меню ———
  const header = document.createElement('header');
  header.className = 'topbar';
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = LEAF; // статичная иконка
  const brandText = document.createElement('div');
  brandText.className = 'brand-text';
  const bt = document.createElement('strong');
  bt.textContent = backend.title;
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
  input.placeholder = isPhone() ? 'Найти родню' : 'Найти родственника';
  input.setAttribute('aria-label', 'Найти родственника');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  const list = document.createElement('ul');
  list.className = 'search-results';
  list.hidden = true;
  form.append(sIcon, input, list);

  // Меню: кто вошёл, админка, выход.
  const menuWrap = document.createElement('div');
  menuWrap.className = 'menu';
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'menu-btn';
  menuBtn.setAttribute('aria-label', 'Меню');
  menuBtn.setAttribute('aria-haspopup', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.innerHTML = MENU_ICON;
  const menu = document.createElement('div');
  menu.className = 'menu-pop';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const who = document.createElement('p');
  who.className = 'menu-who';
  who.textContent = live ? `Вы вошли как ${backend.me.displayName}` : 'Демо: всё дерево вымышленное';
  menu.appendChild(who);
  const menuItem = (text: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitem');
    b.textContent = text;
    b.addEventListener('click', () => {
      toggleMenu(false);
      run();
    });
    menu.appendChild(b);
    return b;
  };
  const toggleMenu = (v = menu.hidden) => {
    if (v && sheet.isOpen()) closePerson(); // меню поверх дерева, а не под карточкой
    menu.hidden = !v;
    menuBtn.setAttribute('aria-expanded', String(v));
  };
  menuBtn.addEventListener('click', () => toggleMenu());
  menuWrap.append(menuBtn, menu);

  header.append(brand, form, menuWrap);
  app.appendChild(header);

  const adminScreen = admin
    ? createAdminScreen(app, {
        persons: () => family.persons.filter((p) => profiles.has(p.id) && !/^unknown-parent:/.test(p.id)),
        describe: (id) => {
          const p = profiles.get(id);
          const y = yearOf(p?.birth);
          return [kin.get(id), y ? `род. ${y}` : ''].filter(Boolean).join(' · ');
        },
        myPersonId: backend.me.personId,
        pickOnTree: () => startPick(),
        restorePerson: (id) => restore(id),
        say,
      })
    : null;
  if (adminScreen) menuItem('Администрирование', () => adminScreen.open());
  menuItem(live ? 'Выйти' : 'Выйти из демо', () => void logout());

  async function logout() {
    try {
      await backend.logout();
    } catch {
      /* сессия всё равно будет забыта перезагрузкой */
    }
    location.hash = '';
    location.reload();
  }

  // Выбор человека на дереве для админки.
  const pickBar = document.createElement('div');
  pickBar.className = 'pick-bar';
  pickBar.hidden = true;
  const pickText = document.createElement('span');
  pickText.textContent = 'Нажмите на карточку человека';
  const pickCancel = document.createElement('button');
  pickCancel.type = 'button';
  pickCancel.className = 'btn btn-soft';
  pickCancel.textContent = 'Отмена';
  pickBar.append(pickText, pickCancel);
  app.appendChild(pickBar);
  function startPick(): Promise<string | null> {
    if (sheet.isOpen()) closePerson();
    pickBar.hidden = false;
    document.body.classList.add('picking');
    return new Promise((r) => (picking = r));
  }
  function finishPick(id: string | null) {
    const r = picking;
    picking = null;
    pickBar.hidden = true;
    document.body.classList.remove('picking');
    r?.(id);
  }
  pickCancel.addEventListener('click', () => finishPick(null));

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
    select(id);
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
      nm.textContent = prof ? fullName(prof) : p.name;
      tx.appendChild(nm);
      const meta = [kin.get(p.id), prof && yearOf(prof.birth) ? (prof.death && yearOf(prof.death) ? `${yearOf(prof.birth)} – ${yearOf(prof.death)}` : `род. ${yearOf(prof.birth)}`) : ''].filter(Boolean).join(' · ');
      if (meta) {
        const m = document.createElement('span');
        m.className = 'sr-meta';
        m.textContent = meta;
        tx.appendChild(m);
      }
      b.appendChild(tx);
      b.addEventListener('click', () => {
        input.value = nm.textContent ?? p.name;
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
      if (!menu.hidden) toggleMenu(false);
      else if (!list.hidden) list.hidden = true;
      else if (picking) finishPick(null);
      else if (sheet.isOpen()) closePerson();
    }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!form.contains(ev.target as Node)) list.hidden = true;
    if (!menuWrap.contains(ev.target as Node)) toggleMenu(false);
  });

  // ——— кнопки «−», «+», «Ко мне» ———
  const homeThumb = document.createElement('span');
  homeThumb.className = 'home-thumb';
  function refreshHomeThumb() {
    const me = profiles.get(rootId);
    if (me) homeThumb.replaceChildren(avatarEl(me, 'home-av'));
  }
  refreshHomeThumb();
  const goHome = () => {
    view.highlight(null);
    if (sheet.isOpen()) sheet.close();
    selectedId = null;
    select(rootId);
    requestAnimationFrame(() => focusPerson(rootId, START_SCALE));
  };
  mountZoomControls(app, zoomCtl, goHome, homeThumb);

  // ——— старт: дождаться шрифтов (измерение текста), отрисовать, встать на «Это вы» ———
  try {
    await Promise.race([Promise.all([document.fonts.load('600 20px Onest'), document.fonts.load('400 18px Onest'), document.fonts.load('500 18px Onest')]), new Promise((r) => setTimeout(r, 1800))]);
  } catch {
    /* шрифт не загрузился — рисуем системным */
  }
  relayout();
  view.update({ family, layout, profiles, rootId, intro: true });
  buildRail();
  updateCount();
  select(rootId);
  focusPerson(rootId, START_SCALE, true);
  document.body.classList.add('ready');
  document.body.dataset.mode = backend.mode;

  // #/person/<id> — открыть человека (ссылка работает только после входа).
  const m = /^#\/person\/([0-9a-z-]+)$/i.exec(location.hash);
  if (m && profiles.has(m[1])) openPerson(m[1]);

  window.addEventListener('resize', () => {
    relayout();
    if (selectedId) focusPerson(selectedId);
  });

  new MutationObserver(updateCount).observe(rail, { childList: true });
}
