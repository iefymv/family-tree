// Пан и зум (мышь, колесо, щипок двумя пальцами) через d3-zoom и кнопки «−», «+», «Ко мне».
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';

export interface ZoomController {
  /** Плавно сдвинуть так, чтобы точка (x, y) раскладки оказалась в центре экрана. */
  focusOn(x: number, y: number, scale?: number, instant?: boolean): void;
  zoomBy(factor: number): void;
  current(): ZoomTransform;
}

export interface ZoomOptions {
  minScale: number;
  maxScale: number;
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function setupZoom(svg: SVGSVGElement, viewport: SVGGElement, opts: ZoomOptions = { minScale: 0.08, maxScale: 2.5 }): ZoomController {
  const sel = select<SVGSVGElement, unknown>(svg);
  const behavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([opts.minScale, opts.maxScale])
    .on('zoom', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
      viewport.setAttribute('transform', ev.transform.toString());
    });
  let anim = 0;
  let pending: ZoomTransform | null = null; // цель текущей анимации: частые нажатия «+»/«−» складываются
  // Палец или мышь пользователя прерывают анимацию.
  behavior.on('start', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
    if (!ev.sourceEvent) return;
    cancelAnimationFrame(anim);
    pending = null;
  });
  sel.call(behavior).on('dblclick.zoom', null);
  const animateTo = (target: ZoomTransform, instant = false) => {
    cancelAnimationFrame(anim);
    const from = current();
    if (instant || reduceMotion()) {
      pending = null;
      behavior.transform(sel, target);
      return;
    }
    pending = target;
    const t0 = performance.now();
    const dur = 450;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const k = from.k * (target.k / from.k) ** e;
      // Интерполируем точку раскладки в центре экрана, чтобы зум не «уплывал».
      const { width, height } = svg.getBoundingClientRect();
      const fx = (width / 2 - from.x) / from.k;
      const fy = (height / 2 - from.y) / from.k;
      const tx = (width / 2 - target.x) / target.k;
      const ty = (height / 2 - target.y) / target.k;
      const cx = fx + (tx - fx) * e;
      const cy = fy + (ty - fy) * e;
      behavior.transform(sel, zoomIdentity.translate(width / 2 - cx * k, height / 2 - cy * k).scale(k));
      if (t < 1) anim = requestAnimationFrame(step);
      else pending = null;
    };
    anim = requestAnimationFrame(step);
  };

  const current = () => zoomTransform(svg);

  return {
    focusOn(x, y, scale, instant) {
      const { width, height } = svg.getBoundingClientRect();
      const k = Math.min(opts.maxScale, Math.max(opts.minScale, scale ?? current().k));
      animateTo(zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k), instant);
    },
    zoomBy(factor) {
      const { width, height } = svg.getBoundingClientRect();
      const cur = pending ?? current();
      const k = Math.min(opts.maxScale, Math.max(opts.minScale, cur.k * factor));
      const cx = (width / 2 - cur.x) / cur.k;
      const cy = (height / 2 - cur.y) / cur.k;
      animateTo(zoomIdentity.translate(width / 2 - cx * k, height / 2 - cy * k).scale(k));
    },
    current,
  };
}

/** Кнопки «−», «+», «Ко мне» (56px, удобно пальцем). */
export function mountZoomControls(host: HTMLElement, ctl: ZoomController, onHome: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'zoom-controls';
  const button = (label: string, aria: string, onClick: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `zoom-btn ${cls}`.trim();
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    bar.appendChild(b);
  };
  button('−', 'Уменьшить', () => ctl.zoomBy(1 / 1.4));
  button('+', 'Увеличить', () => ctl.zoomBy(1.4));
  button('Ко мне', 'Показать меня', onHome, 'home');
  host.appendChild(bar);
  return bar;
}
