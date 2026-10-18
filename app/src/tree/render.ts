// Отрисовка раскладки в SVG: карточки людей, линии брака, линии к детям, оверлеи.
// Тексты ставятся только через textContent — имена из базы никогда не идут в разметку.
import type { FamilyData } from './graph';
import type { TreeLayout } from './layout';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export interface TreeView {
  svg: SVGSVGElement;
  /** Группа, которую двигает зум. */
  viewport: SVGGElement;
  /** Подсветить найденного человека (null — снять подсветку). */
  highlight(id: string | null): void;
  /** Центр карточки в координатах раскладки. */
  centerOf(id: string): { x: number; y: number } | null;
}

const LABEL_MAX_CHARS = 13; // при 19px serif в карточке 168px

function fit(text: string): string {
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…` : text;
}

/** Делит имя на две строки: первое слово и остаток. */
function splitName(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}

const pathD = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

export function renderTree(host: HTMLElement, family: FamilyData, layout: TreeLayout, rootId?: string): TreeView {
  const names = new Map(family.persons.map((p) => [p.id, p.name]));
  const rects = new Map(layout.nodes.map((n) => [n.id, n]));

  const svg = el('svg', { class: 'tree-svg', role: 'img', 'aria-label': 'Семейное дерево' });
  host.appendChild(svg);
  const viewport = el('g', { class: 'tree-viewport' }, svg);

  // Подписи островов: семьи, пока не связанные с основным деревом.
  const islandTop = new Map<number, number>();
  const islandLeft = new Map<number, number>();
  for (const n of layout.nodes) {
    if (!n.component) continue;
    islandTop.set(n.component, Math.min(islandTop.get(n.component) ?? Infinity, n.y));
    islandLeft.set(n.component, Math.min(islandLeft.get(n.component) ?? Infinity, n.x));
  }
  for (const [c, top] of islandTop) {
    const t = el('text', { class: 'island-label', x: islandLeft.get(c)!, y: top - 28 }, viewport);
    t.textContent = 'Пока не связаны с основным деревом';
  }

  const lines = el('g', { class: 'lines' }, viewport);
  for (const u of layout.unions) {
    const [x1, y1, x2, y2] = u.line;
    el('line', { class: `marriage${u.divorced ? ' divorced' : ''}${u.placeholder ? ' unknown' : ''}`, x1, y1, x2, y2 }, lines);
  }
  const drawn = new Set<string>();
  for (const e of layout.edges) {
    const k = `${e.unionId}>${e.childId}`;
    if (drawn.has(k)) continue;
    drawn.add(k);
    el('path', { class: `descent${e.adopted ? ' adopted' : ''}`, d: pathD(e.path) }, lines);
  }
  for (const u of layout.unions) {
    if (layout.edges.some((e) => e.unionId === u.id)) el('circle', { class: 'union-dot', cx: u.x, cy: u.y, r: 5 }, lines);
  }

  // Оверлеи: «воспитывал(а)», отчим/мачеха — пунктирная дуга, в раскладке не участвуют.
  const overlays = el('g', { class: 'overlays' }, viewport);
  for (const o of layout.overlays) {
    const a = rects.get(o.fromId);
    const b = rects.get(o.toId);
    if (!a || !b) continue;
    const [x1, y1] = [a.x + a.w / 2, a.y + a.h];
    const [x2, y2] = [b.x + b.w / 2, b.y];
    const midY = (y1 + y2) / 2 + Math.min(120, Math.abs(x2 - x1) * 0.08);
    const p = el('path', { class: `overlay ${o.type}`, d: `M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}` }, overlays);
    el('title', {}, p).textContent = o.type === 'raised_by' ? 'Воспитывал(а)' : 'Отчим / мачеха';
  }

  const cards = el('g', { class: 'cards' }, viewport);
  const cardOf = new Map<string, SVGGElement>();
  for (const n of layout.nodes) {
    const g = el('g', { class: `card${n.placeholder ? ' placeholder' : ''}${n.id === rootId ? ' is-root' : ''}`, transform: `translate(${n.x} ${n.y})` }, cards);
    g.dataset.id = n.id;
    el('rect', { class: 'card-bg', width: n.w, height: n.h, rx: 14 }, g);
    const [l1, l2] = n.placeholder ? ['Неизвестно', '+ добавить'] : splitName(names.get(n.id) ?? n.id);
    const cx = n.w / 2;
    const t1 = el('text', { class: 'name', x: cx, y: l2 ? n.h / 2 - 4 : n.h / 2 + 7 }, g);
    t1.textContent = fit(l1);
    if (l2) {
      const t2 = el('text', { class: 'name second', x: cx, y: n.h / 2 + 22 }, g);
      t2.textContent = fit(l2);
    }
    el('title', {}, g).textContent = n.placeholder ? 'Неизвестный родитель' : (names.get(n.id) ?? n.id);
    if (n.id === rootId) {
      const badge = el('g', { class: 'root-badge', transform: `translate(${cx} -2)` }, g);
      el('rect', { x: -44, y: -16, width: 88, height: 28, rx: 14 }, badge);
      el('text', { x: 0, y: 5 }, badge).textContent = 'Это вы';
    }
    cardOf.set(n.id, g);
  }

  let found: SVGGElement | null = null;
  return {
    svg,
    viewport,
    highlight(id) {
      found?.classList.remove('is-found');
      found = id ? (cardOf.get(id) ?? null) : null;
      found?.classList.add('is-found');
      if (found) cards.appendChild(found); // поверх соседей
    },
    centerOf(id) {
      const r = rects.get(id);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
    },
  };
}
