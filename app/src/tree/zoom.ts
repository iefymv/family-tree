// Пан и зум (мышь, колесо, щипок двумя пальцами) через d3-zoom и кнопки «−», «+», «Ко мне».
// Перелёт к человеку — по траектории «отдалиться и приблизиться» (interpolateZoom), как в картах.
import { interpolateZoom } from 'd3-interpolate';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';

export interface FocusOptions {
  scale?: number;
  instant?: boolean;
  /** Точка экрана, куда поставить (x, y); по умолчанию — центр. Нужна, когда часть экрана закрыта панелью. */
  screen?: { x: number; y: number };
}

export interface ZoomController {
  focusOn(x: number, y: number, opts?: FocusOptions): void;
  zoomBy(factor: number): void;
  current(): ZoomTransform;
  setExtent(minScale: number, maxScale: number): void;
}

export interface ZoomOptions {
  minScale: number;
  maxScale: number;
  onZoom?: (t: ZoomTransform) => void;
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function setupZoom(svg: SVGSVGElement, viewport: SVGGElement, opts: ZoomOptions): ZoomController {
  let ext: [number, number] = [opts.minScale, opts.maxScale];
  const sel = select<SVGSVGElement, unknown>(svg);
  const behavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent(ext)
    .clickDistance(8)
    .tapDistance(12)
    .on('zoom', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
      viewport.setAttribute('transform', ev.transform.toString());
      opts.onZoom?.(ev.transform);
    });
  let anim = 0;
  let pending: ZoomTransform | null = null;
  behavior.on('start', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
    if (!ev.sourceEvent) return;
    cancelAnimationFrame(anim);
    pending = null;
    svg.classList.add('is-panning');
  });
  behavior.on('end', () => svg.classList.remove('is-panning'));
  sel.call(behavior).on('dblclick.zoom', null);

  const current = () => zoomTransform(svg);
  const clampK = (k: number) => Math.min(ext[1], Math.max(ext[0], k));

  /** Анимация к цели: экранная точка `sp` должна показывать точку раскладки `(wx, wy)` при масштабе `k`. */
  const flyTo = (wx: number, wy: number, k: number, sp: { x: number; y: number }, instant = false, fly = true) => {
    cancelAnimationFrame(anim);
    const target = zoomIdentity.translate(sp.x - wx * k, sp.y - wy * k).scale(k);
    if (instant || reduceMotion()) {
      pending = null;
      behavior.transform(sel, target);
      return;
    }
    pending = target;
    const from = current();
    // Точка раскладки, которая сейчас в той же экранной точке sp.
    const fx = (sp.x - from.x) / from.k;
    const fy = (sp.y - from.y) / from.k;
    const { width } = svg.getBoundingClientRect();
    const interp = (interpolateZoom as unknown as { rho(r: number): typeof interpolateZoom }).rho(1.15)([fx, fy, width / from.k], [wx, wy, width / k]);
    const dur = fly ? Math.max(480, Math.min(1500, interp.duration * 0.7)) : 320;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const [cx, cy, w] = interp(easeInOutCubic(t));
      const kk = width / w;
      behavior.transform(sel, zoomIdentity.translate(sp.x - cx * kk, sp.y - cy * kk).scale(kk));
      if (t < 1) anim = requestAnimationFrame(step);
      else pending = null;
    };
    anim = requestAnimationFrame(step);
  };

  return {
    focusOn(x, y, o = {}) {
      const { width, height } = svg.getBoundingClientRect();
      const k = clampK(o.scale ?? current().k);
      flyTo(x, y, k, o.screen ?? { x: width / 2, y: height / 2 }, o.instant);
    },
    zoomBy(factor) {
      const { width, height } = svg.getBoundingClientRect();
      const cur = pending ?? current();
      const k = clampK(cur.k * factor);
      const sp = { x: width / 2, y: height / 2 };
      flyTo((sp.x - cur.x) / cur.k, (sp.y - cur.y) / cur.k, k, sp, false, false);
    },
    current,
    setExtent(min, max) {
      ext = [min, max];
      behavior.scaleExtent(ext);
    },
  };
}

const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';

/** Кнопки «−», «+», «Ко мне» (56px, удобно пальцем). У «Ко мне» — миниатюра своего фото. */
export function mountZoomControls(host: HTMLElement, ctl: ZoomController, onHome: () => void, homeThumb?: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'zoom-controls';
  const group = document.createElement('div');
  group.className = 'zoom-pair';
  const button = (parent: HTMLElement, html: string, aria: string, onClick: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `zoom-btn ${cls}`.trim();
    b.innerHTML = html; // статичная иконка, без данных пользователя
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };
  button(group, ICON_MINUS, 'Уменьшить', () => ctl.zoomBy(1 / 1.45));
  button(group, ICON_PLUS, 'Увеличить', () => ctl.zoomBy(1.45));
  bar.appendChild(group);
  const home = button(bar, '', 'Показать меня', onHome, 'home');
  if (homeThumb) home.appendChild(homeThumb);
  const span = document.createElement('span');
  span.textContent = 'Ко мне';
  home.appendChild(span);
  host.appendChild(bar);
  return bar;
}
