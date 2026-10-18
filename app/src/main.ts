// DEMO: всё вымышленное дерево Ивановых, фокус и подсветка на внуке (как будто он вошёл).
import './style.css';
import { layoutTree } from './tree/layout';
import { renderTree } from './tree/render';
import { findPersons } from './tree/search';
import { mountZoomControls, setupZoom } from './tree/zoom';
import { GRANDCHILD, ivanovBig } from '../tests/fixtures/ivanov-big';

const app = document.querySelector<HTMLDivElement>('#app')!;
const family = ivanovBig;
const rootId = GRANDCHILD;

const layout = layoutTree(family, rootId);
const view = renderTree(app, family, layout, rootId);
// Минимальный масштаб — чтобы всё дерево целиком помещалось на экран.
const fit = Math.min(app.clientWidth / layout.width, app.clientHeight / layout.height);
const zoomCtl = setupZoom(view.svg, view.viewport, { minScale: Math.min(0.5, fit * 0.9), maxScale: 2.5 });
const START_SCALE = 1; // карточка 168px на старте (≥160px)

const goHome = () => {
  view.highlight(null);
  if (layout.focus) zoomCtl.focusOn(layout.focus.x, layout.focus.y, START_SCALE);
};
mountZoomControls(app, zoomCtl, goHome);

// Старт без анимации: сразу центр на вошедшем.
if (layout.focus) zoomCtl.focusOn(layout.focus.x, layout.focus.y, START_SCALE, true);

// Поиск «Найти родственника».
const form = document.createElement('form');
form.className = 'search';
form.setAttribute('role', 'search');
const input = document.createElement('input');
input.type = 'search';
input.placeholder = 'Найти родственника';
input.setAttribute('aria-label', 'Найти родственника');
input.autocomplete = 'off';
const list = document.createElement('ul');
list.hidden = true;
form.append(input, list);
app.appendChild(form);

const show = (id: string) => {
  const c = view.centerOf(id);
  if (!c) return;
  view.highlight(id);
  zoomCtl.focusOn(c.x, c.y, Math.max(zoomCtl.current().k, START_SCALE));
  list.hidden = true;
  input.blur();
};

input.addEventListener('input', () => {
  const found = findPersons(family.persons, input.value);
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
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
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
