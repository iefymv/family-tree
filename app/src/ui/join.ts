// «Присоединиться к дереву»: человек вошёл семейным паролем и получил карточку без связей.
// Пока связей нет — баннер сверху, своя карточка стоит рядом с основным деревом (а не далёким островом),
// а у любого выбранного человека — крупные кнопки «Это мой папа / брат / ребёнок / супруг».
// Нажатие → подтверждение → RPC link_relative; как только связь есть — баннер исчезает.
import { fullName, type Profile } from '../demo/profiles';
import type { FamilyData, Gender } from '../tree/graph';
import type { TreeLayout } from '../tree/layout';
import type { LinkKind } from '../lib/link';
import './join.css';

export const JOIN_BANNER = 'Вы пока не связаны с деревом. Найдите родного человека и покажите, кто он вам';

/** Есть ли у человека хоть одна связь (родитель, ребёнок, супруг). */
export function isLinked(family: FamilyData, id: string): boolean {
  return family.relations.some((r) => (r.kind === 'parent' ? r.parentId === id || r.childId === id : r.aId === id || r.bId === id));
}

/**
 * Карточку без связей (свой остров) ставит над левым верхним углом основного дерева,
 * сдвигая всё остальное вниз: человек видит себя рядом с деревом, а не где-то внизу среди островов.
 */
export function pinBesideMain(layout: TreeLayout, id: string, gap = 160): TreeLayout {
  const self = layout.nodes.find((n) => n.id === id);
  const main = layout.nodes.filter((n) => n.component === 0 && n.id !== id);
  if (!self || self.component === 0 || !main.length) return layout;
  const x0 = Math.min(...main.map((n) => n.x));
  const y0 = Math.min(...main.map((n) => n.y));
  const dy = self.h + gap;
  const mv = ([x, y]: [number, number]): [number, number] => [x, y + dy];
  const nodes = layout.nodes.map((n) => (n.id === id ? { ...n, x: x0, y: y0 } : { ...n, y: n.y + dy }));
  const width = Math.max(...nodes.map((n) => n.x + n.w));
  const height = Math.max(...nodes.map((n) => n.y + n.h));
  return {
    ...layout,
    nodes,
    edges: layout.edges.map((e) => ({ ...e, path: e.path.map(mv) })),
    unions: layout.unions.map((u) => ({ ...u, y: u.y + dy, line: [u.line[0], u.line[1] + dy, u.line[2], u.line[3] + dy] })),
    width,
    height,
    focus: layout.focus?.id === id ? { id, x: x0 + self.w / 2, y: y0 + self.h / 2 } : layout.focus && { ...layout.focus, y: layout.focus.y + dy },
  };
}

const BY_GENDER: Record<LinkKind, [string, string, string]> = {
  // мужской, женский, неизвестно
  parent: ['папа', 'мама', 'родитель'],
  sibling: ['брат', 'сестра', 'брат или сестра'],
  child: ['сын', 'дочь', 'ребёнок'],
  spouse: ['муж', 'жена', 'супруг(а)'],
};
const QUESTION: Record<LinkKind, [string, string, string]> = {
  parent: ['ваш отец', 'ваша мать', 'ваш родитель'],
  sibling: ['ваш брат', 'ваша сестра', 'ваш брат или сестра'],
  child: ['ваш сын', 'ваша дочь', 'ваш ребёнок'],
  spouse: ['ваш муж', 'ваша жена', 'ваш супруг или супруга'],
};
const gi = (g: Gender) => (g === 'male' ? 0 : g === 'female' ? 1 : 2);

/** «Это моя мама», «Это мой брат», «Мой брат или сестра». */
export function linkLabel(kind: LinkKind, g: Gender): string {
  const w = BY_GENDER[kind][gi(g)];
  if (g === 'unknown') return `Мой ${w}`;
  return `${g === 'female' ? 'Это моя' : 'Это мой'} ${w}`;
}

/** «Петров Борис — ваш отец?» (фамилия и имя). */
export function linkQuestion(p: Profile, kind: LinkKind): string {
  const name = [p.surname, p.given].filter(Boolean).join(' ') || fullName(p);
  return `${name} — ${QUESTION[kind][gi(p.gender)]}?`;
}

export interface JoinDeps {
  selfId: string;
  family(): FamilyData;
  profiles(): Map<string, Profile>;
  link(otherId: string, kind: LinkKind): Promise<void>;
  /** После связи: перечитать дерево и встать на себя. */
  linked(): Promise<void>;
  say(text: string): void;
  confirm(text: string): boolean;
}

export function createJoin(host: HTMLElement, deps: JoinDeps) {
  const banner = document.createElement('section');
  banner.className = 'join-banner';
  banner.setAttribute('aria-live', 'polite');
  banner.hidden = true;
  const text = document.createElement('p');
  text.className = 'join-text';
  text.textContent = JOIN_BANNER;
  const who = document.createElement('p');
  who.className = 'join-who';
  who.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'join-actions';
  actions.hidden = true;
  banner.append(text, who, actions);
  host.appendChild(banner);

  let chosen: string | null = null;
  let busy = false;
  const active = () => deps.profiles().has(deps.selfId) && !isLinked(deps.family(), deps.selfId);

  const place = () => {
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 80;
    banner.style.top = `${Math.round(top - 8)}px`;
  };
  window.addEventListener('resize', place);

  function parentsOf(id: string) {
    return deps.family().relations.filter((r) => r.kind === 'parent' && r.childId === id).length;
  }

  function render() {
    banner.hidden = !active();
    if (banner.hidden) return;
    place();
    const p = chosen && chosen !== deps.selfId ? deps.profiles().get(chosen) : undefined;
    who.hidden = !p;
    actions.hidden = !p;
    actions.replaceChildren();
    if (!p) return;
    who.textContent = `Кто вам ${fullName(p)}?`;
    const kinds: LinkKind[] = ['parent', 'sibling', 'child', 'spouse'];
    for (const kind of kinds) {
      if (kind === 'child' && parentsOf(p.id) >= 2) continue; // у него уже двое родителей
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary';
      b.dataset.kind = kind;
      b.textContent = linkLabel(kind, p.gender);
      b.addEventListener('click', () => void link(p, kind));
      actions.appendChild(b);
    }
  }

  async function link(p: Profile, kind: LinkKind) {
    if (busy || !deps.confirm(linkQuestion(p, kind))) return;
    busy = true;
    try {
      await deps.link(p.id, kind);
    } catch (e) {
      busy = false;
      deps.say(e instanceof Error && e.message ? e.message : 'Не получилось связать. Попробуйте ещё раз.');
      return;
    }
    busy = false;
    chosen = null;
    await deps.linked();
    render();
    deps.say('Готово — вы на дереве');
  }

  return {
    /** Пока связей нет (рисовать свою карточку рядом с деревом, показывать баннер). */
    active,
    /** Выбран человек на дереве (или снят выбор). */
    select(id: string | null) {
      chosen = id;
      render();
    },
    /** Перечитать состояние после загрузки дерева. */
    update: render,
  };
}
