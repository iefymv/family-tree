// Отрисовка раскладки в SVG: карточки с портретами, плавные «ветви» к детям, кольца браков,
// полосы поколений, кнопки «+» вокруг выбранной карточки.
// Тексты ставятся только через textContent — имена из базы никогда не идут в разметку.
import type { FamilyData } from './graph';
import type { LayoutOptions, NodeRect, TreeLayout } from './layout';
import { fullName, yearOf, TODAY_YEAR, type LifeEvent, type Profile } from '../demo/profiles';
import { initials, initialsGradient, INITIAL_GRADIENTS, portraitURI } from './portrait';
import type { AddKind } from './mutate';

const SVG_NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/** Геометрия узла: круглое фото с тонким кольцом, под ним ФИО и даты. */
export const NODE = { w: 220, h: 262, photo: 136, ring: 6, photoTop: 8 } as const;
const PHOTO_CY = NODE.photoTop + NODE.photo / 2;
const PHOTO_BOTTOM = NODE.photoTop + NODE.photo;
const TEXT = {
  surnameY: PHOTO_BOTTOM + 40,
  nameY: [PHOTO_BOTTOM + 66, PHOTO_BOTTOM + 89],
  datesY: PHOTO_BOTTOM + 116,
  surnameFont: '600 20px Onest, system-ui, sans-serif',
  nameFont: '400 18px Onest, system-ui, sans-serif',
  datesFont: '500 18px Onest, system-ui, sans-serif',
  maxW: NODE.w - 8,
};
/** Параметры раскладки под эти узлы. */
export const NODE_LAYOUT: Partial<LayoutOptions> = { nodeWidth: NODE.w, nodeHeight: NODE.h, gapX: 36, spouseGap: 60, gapY: 128, islandGap: 240 };

const GEN_LABELS: Record<number, string> = {
  [-4]: 'Прапрадеды',
  [-3]: 'Прадеды',
  [-2]: 'Бабушки и дедушки',
  [-1]: 'Родители',
  0: 'Ваше поколение',
  1: 'Дети',
  2: 'Внуки',
  3: 'Правнуки',
};

// ——— измерение текста ———
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
function ellipsize(text: string, font: string, max: number): string {
  if (textWidth(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** «12.03.1928» или «1928», если известен только год. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-');
  return m && d ? `${pad2(+d)}.${m}.${y}` : y;
}

/** Дата события для подписи: как написана в семье, иначе разобранная; места не показываем. */
const eventText = (e?: LifeEvent): string => (e ? e.label ?? (e.date ? shortDate(e.date) : '') : '');

export function datesLine(p: Profile, font = TEXT.datesFont, max = TEXT.maxW): string {
  const b = eventText(p.birth);
  const d = eventText(p.death);
  if (!b && !d) return '';
  if (!d) {
    if (p.death) return b ? `${b} – ?` : '';
    const line = `род. ${b}`;
    return textWidth(line, font) <= max || !yearOf(p.birth) ? line : `род. ${yearOf(p.birth)}`;
  }
  const full = `${b || '?'} – ${d}`;
  if (textWidth(full, font) <= max) return full;
  return `${yearOf(p.birth) ?? '?'} – ${yearOf(p.death) ?? '?'}`;
}

/** Фото человека: загруженное, портрет-заглушка или null (тогда инициалы). */
export function photoURL(p: Profile): string | null {
  if (p.photo.kind === 'upload') return p.photo.url;
  if (p.photo.kind === 'portrait') return portraitURI({ seed: p.id, gender: p.gender, birthYear: yearOf(p.birth), deathYear: yearOf(p.death), todayYear: TODAY_YEAR });
  return null;
}

/** Мягкая тень под круглым фото: заранее размытая картинка, чтобы не считать фильтр при каждом кадре пана. */
const SHADOW_URI = (() => {
  const s = NODE.photo + 80;
  const r = NODE.photo / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><defs><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter></defs><circle cx="${s / 2}" cy="${s / 2 + 10}" r="${r - 4}" fill="rgb(40,70,30)" fill-opacity=".20" filter="url(#b)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

export interface TreeState {
  family: FamilyData;
  layout: TreeLayout;
  profiles: Map<string, Profile>;
  rootId: string;
  /** Только что добавленные — с анимацией появления. */
  fresh?: Set<string>;
  /** Анимировать переезд узлов (после добавления). */
  animate?: boolean;
  /** Первая отрисовка — «волна» появления от «Это вы». */
  intro?: boolean;
}

export interface TreeHandlers {
  onCardTap(id: string, placeholder: boolean): void;
  onAdd(id: string, kind: AddKind): void;
  onBackgroundTap(): void;
}

export interface GenerationMark {
  label: string;
  /** Высота подписи — в зазоре над фото поколения, в координатах раскладки. */
  y: number;
}

export interface TreeView {
  svg: SVGSVGElement;
  viewport: SVGGElement;
  update(state: TreeState): void;
  select(id: string | null, canAdd?: Record<AddKind, boolean>): void;
  highlight(id: string | null): void;
  /** Центр фото человека в координатах раскладки. */
  centerOf(id: string): { x: number; y: number } | null;
  rectOf(id: string): NodeRect | null;
  generations(): GenerationMark[];
}

const ADD_LABELS: Record<AddKind, string> = { parent: 'Родитель', spouse: 'Супруг(а)', child: 'Ребёнок', sibling: 'Брат, сестра' };

/** Ломаная со скруглёнными углами: чистые тонкие линии без жёстких «лесенок». */
function roundedPath(pts: [number, number][], radius: number): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  if (p.length < 2) return '';
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = x1 - ((x1 - x0) / l1) * r;
    const ay = y1 - ((y1 - y0) / l1) * r;
    const bx = x1 + ((x2 - x1) / l2) * r;
    const by = y1 + ((y2 - y1) / l2) * r;
    d += `L${ax.toFixed(1)} ${ay.toFixed(1)}Q${x1.toFixed(1)} ${y1.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const last = p[p.length - 1];
  return `${d}L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
}

export function createTreeView(host: HTMLElement, handlers: TreeHandlers): TreeView {
  const svg = el('svg', { class: 'tree-svg', role: 'application', 'aria-label': 'Семейное дерево. Перетаскивайте, чтобы смотреть; щипок или колесо — масштаб.' });
  host.appendChild(svg);
  const defs = el('defs', {}, svg);
  const R = NODE.photo / 2;
  const clip = el('clipPath', { id: 'photo-clip', clipPathUnits: 'userSpaceOnUse' }, defs);
  el('circle', { cx: NODE.w / 2, cy: PHOTO_CY, r: R - NODE.ring }, clip);
  INITIAL_GRADIENTS.forEach(([from, to], i) => {
    const g = el('linearGradient', { id: `ig${i}`, x1: 0, y1: 0, x2: 0.6, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': to }, g);
    el('stop', { offset: 1, 'stop-color': from }, g);
  });

  const viewport = el('g', { class: 'tree-viewport' }, svg);
  const decoG = el('g', { class: 'deco' }, viewport);
  const linesG = el('g', { class: 'lines' }, viewport);
  const cardsG = el('g', { class: 'cards' }, viewport);
  const chipsG = el('g', { class: 'affordances' }, viewport);

  let state: TreeState | null = null;
  let rects = new Map<string, NodeRect>();
  const cardOf = new Map<string, SVGGElement>();
  let gens: GenerationMark[] = [];
  let selected: string | null = null;
  let selectedCan: Record<AddKind, boolean> | undefined;
  let found: string | null = null;
  const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // ——— события: делегирование ———
  const act = (t: Element): boolean => {
    const chip = t.closest<SVGGElement>('[data-add]');
    if (chip) {
      handlers.onAdd(chip.dataset.for!, chip.dataset.add as AddKind);
      return true;
    }
    const card = t.closest<SVGGElement>('.card');
    if (card) {
      handlers.onCardTap(card.dataset.id!, card.classList.contains('placeholder'));
      return true;
    }
    return false;
  };
  svg.addEventListener('click', (ev) => {
    if (!act(ev.target as Element)) handlers.onBackgroundTap();
  });
  svg.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (act(ev.target as Element)) ev.preventDefault();
  });

  // ——— узел ———
  function fillCard(body: SVGGElement, n: NodeRect, s: TreeState) {
    body.replaceChildren();
    const cx = n.w / 2;
    // Невидимая подложка — чтобы по узлу было легко попасть пальцем.
    el('rect', { class: 'hit', x: 0, y: 0, width: n.w, height: n.h, rx: 24 }, body);
    if (n.placeholder) {
      el('circle', { class: 'ph-circle', cx, cy: PHOTO_CY, r: R - 2 }, body);
      const plus = el('g', { class: 'ph-plus', transform: `translate(${cx} ${PHOTO_CY})` }, body);
      el('circle', { r: 26 }, plus);
      el('path', { d: 'M-10 0H10M0 -10V10' }, plus);
      el('text', { class: 'surname muted', x: cx, y: TEXT.surnameY }, body).textContent = 'Неизвестно';
      el('text', { class: 'given muted', x: cx, y: TEXT.nameY[0] }, body).textContent = 'добавить родителя';
      return;
    }
    const p = s.profiles.get(n.id);
    if (!p) return;
    el('image', { class: 'photo-shadow', href: SHADOW_URI, x: cx - R - 40, y: PHOTO_CY - R - 40, width: NODE.photo + 80, height: NODE.photo + 80 }, body);
    el('circle', { class: 'photo-ring', cx, cy: PHOTO_CY, r: R }, body);
    const url = photoURL(p);
    if (url) {
      el('image', { class: 'photo', href: url, x: cx - R + NODE.ring, y: PHOTO_CY - R + NODE.ring, width: NODE.photo - 2 * NODE.ring, height: NODE.photo - 2 * NODE.ring, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#photo-clip)' }, body);
    } else {
      const g = initialsGradient(p.id);
      el('circle', { cx, cy: PHOTO_CY, r: R - NODE.ring, fill: `url(#ig${g.index})` }, body);
      const t = el('text', { class: 'initials', x: cx, y: PHOTO_CY + 15, fill: g.ink }, body);
      t.textContent = initials(p.surname, p.given);
    }
    el('circle', { class: 'photo-edge', cx, cy: PHOTO_CY, r: R + 0.5 }, body);
    el('circle', { class: 'focus-ring', cx, cy: PHOTO_CY, r: R + 7 }, body);

    el('text', { class: 'surname', x: cx, y: TEXT.surnameY }, body).textContent = ellipsize(p.surname, TEXT.surnameFont, TEXT.maxW);
    const gp = [p.given, p.patronymic].filter(Boolean).join(' ');
    const lines = textWidth(gp, TEXT.nameFont) <= TEXT.maxW || !p.patronymic ? [gp] : [p.given, p.patronymic];
    lines.forEach((line, i) => {
      el('text', { class: 'given', x: cx, y: TEXT.nameY[i] }, body).textContent = ellipsize(line, TEXT.nameFont, TEXT.maxW);
    });
    const d = datesLine(p);
    if (d) el('text', { class: 'dates', x: cx, y: lines.length > 1 ? TEXT.datesY : TEXT.datesY - 23 }, body).textContent = d;

    if (n.id === s.rootId) {
      const b = el('g', { class: 'you-badge', transform: `translate(${cx} ${PHOTO_BOTTOM - 2})` }, body);
      el('rect', { x: -48, y: -17, width: 96, height: 34, rx: 17 }, b);
      el('text', { x: 0, y: 6 }, b).textContent = 'Это вы';
    }
  }

  function ariaFor(n: NodeRect, s: TreeState): string {
    if (n.placeholder) return 'Неизвестный родитель — добавить';
    const p = s.profiles.get(n.id);
    if (!p) return n.id;
    const d = datesLine(p, TEXT.datesFont, 1e9);
    return `${fullName(p)}${d ? `, ${d}` : ''}${n.id === s.rootId ? ', это вы' : ''}`;
  }

  // ——— линии ———
  function drawLines(s: TreeState) {
    linesG.replaceChildren();
    const L = s.layout;
    const unionById = new Map(L.unions.map((u) => [u.id, u]));
    /** Высота линии брака: центр фото + сдвиг раскладки, если супруги стоят не рядом. */
    const unionY = (u: TreeLayout['unions'][number]) => rects.get(u.a)!.y + PHOTO_CY;

    for (const u of L.unions) {
      const ra = rects.get(u.a);
      const rb = rects.get(u.b);
      if (!ra || !rb) continue;
      const y = unionY(u);
      const [x1, , x2] = u.line;
      const xa = ra.x + ra.w / 2;
      const xb = rb.x + rb.w / 2;
      const cls = `marriage${u.divorced ? ' divorced' : ''}${u.placeholder ? ' unknown' : ''}`;
      let d: string;
      if (Math.abs(xa - xb) <= NODE.w + 80) {
        d = `M${x1 - (NODE.w / 2 - R)} ${y}H${x2 + (NODE.w / 2 - R)}`;
      } else {
        // Супруги не рядом (несколько браков): дуга над головами тех, кто стоит между ними,
        // спускается к точке союза у «внешнего» супруга.
        const [near, far] = Math.abs(xa - u.x) < Math.abs(xb - u.x) ? [xa, xb] : [xb, xa];
        const lift = 18 + 12 * Math.max(0, Math.round(Math.abs(far - u.x) / (NODE.w + 60)) - 1);
        const top = ra.y - lift;
        const cy = ra.y + PHOTO_CY;
        d = roundedPath([[far, ra.y + NODE.photoTop], [far, top], [u.x, top], [u.x, cy]], 18);
        d += `M${u.x} ${cy}H${near + (near > u.x ? -R : R)}`;
      }
      const ln = el('path', { class: cls, d }, linesG);
      ln.dataset.union = u.id;
    }

    const drawn = new Set<string>();
    for (const e of L.edges) {
      const k = `${e.unionId}>${e.childId}`;
      if (drawn.has(k)) continue;
      drawn.add(k);
      const u = unionById.get(e.unionId);
      const child = rects.get(e.childId);
      if (!u || !child) continue;
      const cx = child.x + child.w / 2;
      const top = child.y + NODE.photoTop - 1;
      const pts: [number, number][] = e.path.map(([x, y]) => [x, y]);
      pts[0] = [u.x, unionY(u)];
      pts[pts.length - 1] = [cx, top];
      if (pts.length === 2) pts.splice(1, 0, [u.x, (pts[0][1] + top) / 2], [cx, (pts[0][1] + top) / 2]);
      const path = el('path', { class: `descent${e.adopted ? ' adopted' : ''}`, d: roundedPath(pts, 22) }, linesG);
      path.dataset.union = e.unionId;
      path.dataset.child = e.childId;
    }

    // Точка союза — маленькое кольцо на линии брака.
    for (const u of L.unions) {
      if (!rects.has(u.a)) continue;
      const g = el('g', { class: `knot${u.divorced ? ' divorced' : ''}${u.placeholder ? ' unknown' : ''}`, transform: `translate(${u.x} ${unionY(u)})` }, linesG);
      g.dataset.union = u.id;
      el('circle', { r: 7 }, g);
      el('title', {}, g).textContent = u.placeholder ? 'Второй родитель неизвестен' : u.divorced ? 'Брак расторгнут' : 'Брак';
    }

    for (const o of L.overlays) {
      const a = rects.get(o.fromId);
      const b = rects.get(o.toId);
      if (!a || !b) continue;
      const [x1, y1] = [a.x + a.w / 2, a.y + a.h];
      const [x2, y2] = [b.x + b.w / 2, b.y + NODE.photoTop];
      const midY = (y1 + y2) / 2 + Math.min(140, Math.abs(x2 - x1) * 0.08);
      const p = el('path', { class: `overlay ${o.type}`, d: `M${x1} ${y1}C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}` }, linesG);
      el('title', {}, p).textContent = o.type === 'raised_by' ? 'Воспитывал(а)' : 'Отчим / мачеха';
    }
  }

  function drawDeco(s: TreeState) {
    decoG.replaceChildren();
    const root = rects.get(s.rootId);
    const layerTop = new Map<number, number>();
    for (const n of s.layout.nodes) if (n.component === 0) layerTop.set(n.layer, Math.min(layerTop.get(n.layer) ?? Infinity, n.y));
    const rootLayer = root && root.component === 0 ? root.layer : 0;
    gens = [...layerTop]
      .sort((a, b) => a[0] - b[0])
      .map(([layer, top]) => {
        const rel = layer - rootLayer;
        return { label: GEN_LABELS[rel] ?? (rel < 0 ? `${-rel} поколений назад` : `${rel} поколений вперёд`), y: top - 40 };
      });
    if (root) {
      // Мягкий светло-зелёный ореол вокруг «Это вы».
      el('circle', { class: 'you-halo', cx: root.x + root.w / 2, cy: root.y + PHOTO_CY, r: R + 46 }, decoG);
    }
    const islandTop = new Map<number, { x: number; y: number }>();
    for (const n of s.layout.nodes) {
      if (!n.component) continue;
      const cur = islandTop.get(n.component);
      islandTop.set(n.component, { x: Math.min(cur?.x ?? Infinity, n.x), y: Math.min(cur?.y ?? Infinity, n.y) });
    }
    for (const [, pos] of islandTop) {
      const g = el('g', { class: 'island-label', transform: `translate(${pos.x} ${pos.y - 70})` }, decoG);
      el('rect', { width: 408, height: 44, rx: 22 }, g);
      el('text', { x: 22, y: 29 }, g).textContent = 'Пока не связаны с основным деревом';
    }
  }

  // ——— родословная выбранного: линии к предкам и потомкам ярче ———
  function applyLineage() {
    if (!state) return;
    const focus = selected ?? state.rootId;
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    for (const r of state.family.relations) {
      if (r.kind !== 'parent' || r.type === 'raised_by' || r.type === 'step') continue;
      up.set(r.childId, [...(up.get(r.childId) ?? []), r.parentId]);
      down.set(r.parentId, [...(down.get(r.parentId) ?? []), r.childId]);
    }
    const walk = (start: string, m: Map<string, string[]>) => {
      const seen = new Set<string>();
      const st = [start];
      while (st.length) for (const x of m.get(st.pop()!) ?? []) if (!seen.has(x)) (seen.add(x), st.push(x));
      return seen;
    };
    const anc = walk(focus, up);
    const desc = walk(focus, down);
    const members = new Map(state.layout.unions.map((u) => [u.id, [u.a, u.b]]));
    const onLine = new Set<string>();
    const firstKnot = linesG.querySelector('.knot');
    for (const p of linesG.querySelectorAll<SVGElement>('.descent')) {
      const c = p.dataset.child!;
      const [a, b] = members.get(p.dataset.union!) ?? [];
      const hit = ((c === focus || anc.has(c)) && (anc.has(a) || anc.has(b))) || (desc.has(c) && (a === focus || b === focus || desc.has(a) || desc.has(b)));
      p.classList.toggle('lineage', hit);
      if (hit) {
        onLine.add(p.dataset.union!);
        linesG.insertBefore(p, firstKnot); // поверх остальных линий
      }
    }
    for (const r of linesG.querySelectorAll<SVGElement>('.knot, .marriage')) r.classList.toggle('lineage', onLine.has(r.dataset.union!));
    for (const [id, g] of cardOf) g.classList.toggle('kin', id === focus || anc.has(id) || desc.has(id));
  }

  // ——— зелёные «+» вокруг выбранного: родитель сверху, ребёнок снизу, супруг и брат/сестра по бокам ———
  function drawChips() {
    chipsG.replaceChildren();
    if (!selected || !selectedCan) return;
    const r = rects.get(selected);
    if (!r || r.placeholder) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + PHOTO_CY;
    const chip = (kind: AddKind, x: number, y: number, labelSide: 'top' | 'bottom' | 'left' | 'right', delay: number) => {
      if (!selectedCan![kind]) return;
      const label = ADD_LABELS[kind];
      const g = el('g', { class: `add-chip add-${kind}`, transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'aria-label': `Добавить: ${label.toLowerCase()}` }, chipsG);
      g.dataset.add = kind;
      g.dataset.for = selected!;
      const inner = el('g', { class: 'chip-body' }, g);
      inner.style.setProperty('--d', `${delay}ms`);
      const tw = Math.ceil(textWidth(label, '600 18px Onest, system-ui, sans-serif'));
      // Подпись в светлой «таблетке» рядом с кнопкой; вся таблетка — зона нажатия.
      const pw = tw + 28;
      const pos =
        labelSide === 'top' ? { x: -pw / 2, y: -64 } : labelSide === 'bottom' ? { x: -pw / 2, y: 32 } : labelSide === 'left' ? { x: -pw - 30, y: -16 } : { x: 30, y: -16 };
      el('rect', { class: 'chip-hit', x: Math.min(-26, pos.x), y: Math.min(-26, pos.y), width: Math.max(26, pos.x + pw) - Math.min(-26, pos.x), height: Math.max(26, pos.y + 32) - Math.min(-26, pos.y), rx: 26 }, inner);
      const lab = el('g', { class: 'chip-label', transform: `translate(${pos.x} ${pos.y})` }, inner);
      el('rect', { width: pw, height: 32, rx: 16 }, lab);
      el('text', { x: pw / 2, y: 22 }, lab).textContent = label;
      el('circle', { class: 'chip-btn', r: 22 }, inner);
      el('path', { class: 'chip-mark', d: 'M-8 0H8M0 -8V8' }, inner);
    };
    chip('parent', cx, r.y - 30, 'top', 0);
    chip('spouse', cx + R + 40, cy, 'bottom', 60);
    chip('sibling', cx - R - 40, cy, 'bottom', 90);
    chip('child', cx, r.y + r.h + 26, 'bottom', 120);
  }

  function update(s: TreeState) {
    const prev = state;
    state = s;
    rects = new Map(s.layout.nodes.map((n) => [n.id, n]));
    const animate = !!s.animate && !reduce() && !!prev;
    const rootRect = rects.get(s.rootId);

    for (const [id, g] of cardOf) {
      if (!rects.has(id)) {
        g.remove();
        cardOf.delete(id);
      }
    }
    for (const n of s.layout.nodes) {
      let g = cardOf.get(n.id);
      const isNew = !g;
      if (!g) {
        g = el('g', { class: 'card', tabindex: 0, role: 'button' }, cardsG);
        g.dataset.id = n.id;
        el('g', { class: 'card-body' }, g);
        cardOf.set(n.id, g);
      }
      g.classList.toggle('placeholder', n.placeholder);
      g.classList.toggle('is-root', n.id === s.rootId);
      g.setAttribute('aria-label', ariaFor(n, s));
      fillCard(g.firstElementChild as SVGGElement, n, s);
      g.classList.toggle('moving', animate && !isNew);
      g.style.transform = `translate(${n.x}px, ${n.y}px)`;
      if (isNew && (s.intro || s.fresh?.has(n.id)) && !reduce()) {
        const dist = rootRect ? Math.hypot(n.x - rootRect.x, n.y - rootRect.y) : 0;
        const fresh = !!s.fresh?.has(n.id);
        g.style.setProperty('--d', fresh ? '420ms' : `${Math.round(Math.min(1000, dist * 0.32))}ms`);
        g.classList.add(fresh ? 'bloom' : 'enter');
        g.addEventListener('animationend', () => g!.classList.remove('enter', 'bloom'), { once: true });
      }
    }
    if (animate) window.setTimeout(() => cardOf.forEach((g) => g.classList.remove('moving')), 700);

    drawDeco(s);
    drawLines(s);
    linesG.classList.remove('lines-in', 'lines-wait');
    if (animate) {
      linesG.classList.add('lines-wait');
      window.setTimeout(() => {
        linesG.classList.remove('lines-wait');
        linesG.classList.add('lines-in');
      }, 520);
    } else if (s.intro && !reduce()) linesG.classList.add('lines-in');
    if (selected && !rects.has(selected)) selected = null;
    applyLineage();
    drawChips();
    if (selected) cardOf.get(selected)?.classList.add('is-selected');
    if (found) cardOf.get(found)?.classList.add('is-found');
  }

  return {
    svg,
    viewport,
    update,
    select(id, can) {
      if (selected) cardOf.get(selected)?.classList.remove('is-selected');
      selected = id;
      selectedCan = can;
      if (id) {
        const g = cardOf.get(id);
        g?.classList.add('is-selected');
        if (g) cardsG.appendChild(g);
      }
      applyLineage();
      drawChips();
    },
    highlight(id) {
      if (found) cardOf.get(found)?.classList.remove('is-found');
      found = id;
      const g = id ? cardOf.get(id) : null;
      if (g) {
        void g.getBoundingClientRect();
        g.classList.add('is-found');
        cardsG.appendChild(g);
      }
    },
    centerOf(id) {
      const r = rects.get(id);
      return r ? { x: r.x + r.w / 2, y: r.y + PHOTO_CY } : null;
    },
    rectOf: (id) => rects.get(id) ?? null,
    generations: () => gens,
  };
}
