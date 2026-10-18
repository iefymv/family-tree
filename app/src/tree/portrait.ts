// Иллюстрированные портреты-заглушки (SVG → data URI) и аватары с инициалами.
// Старшие поколения «печатаются» в сепии, середина века — выцветшей плёнкой, младшие — в цвете:
// дерево словно набирает цвет по мере приближения к нашим дням.
import { rng } from '../demo/profiles';
import type { Gender } from './graph';

export interface PortraitInput {
  seed: string;
  gender: Gender;
  birthYear?: number;
  deathYear?: number;
  todayYear: number;
}

const SKIN = ['#F2D3B8', '#EBC3A1', '#E3B190', '#D9A17C', '#CC906B', '#F5DCC7'];
const HAIR = ['#2B211C', '#3D2A20', '#5A3B28', '#7B5133', '#A57A4E', '#CFA56E', '#7A3B22'];
const GREY = ['#BEB8AF', '#D6D1C8', '#A39C93', '#E6E2DB'];
const CLOTH = ['#2F4858', '#3E6259', '#7A4E3B', '#4C5A8C', '#C9704A', '#D9A94A', '#4F7CAC', '#A65E73', '#6E8B5B', '#35374B', '#D98A6C', '#7F98AC'];
const BG: [string, string][] = [
  ['#E2EDE5', '#B9D3C4'],
  ['#F6E3D3', '#EBC1A5'],
  ['#E1E7F3', '#BCCAE3'],
  ['#F4E8CB', '#E6CD98'],
  ['#ECE1EF', '#D3BEDB'],
  ['#DCEFEC', '#B0D7D2'],
  ['#F5DEDB', '#E5B8B4'],
];

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

export type Tone = 'sepia' | 'faded' | 'color';
export const toneFor = (birthYear?: number): Tone => (birthYear === undefined ? 'color' : birthYear < 1940 ? 'sepia' : birthYear < 1972 ? 'faded' : 'color');

const cache = new Map<string, string>();

/** SVG-портрет 200×200 как data URI. */
export function portraitURI(p: PortraitInput): string {
  const key = `${p.seed}|${p.gender}|${p.birthYear}|${p.deathYear}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(portraitSVG(p))}`;
  cache.set(key, uri);
  return uri;
}

export function portraitSVG(p: PortraitInput): string {
  const r = rng(`portrait:${p.seed}`);
  const born = p.birthYear ?? p.todayYear - 35;
  const end = p.deathYear ?? p.todayYear;
  const life = end - born;
  // Возраст «на фотографии»: живых — сейчас, ушедших — в зрелые годы.
  const age = p.deathYear ? Math.min(life, 48 + Math.floor(r() * 18)) : life;
  const tone = toneFor(p.birthYear);
  const female = p.gender === 'female';
  const child = age < 14;
  const elder = age >= 60;

  const skin = pick(r, SKIN);
  const skinD = shade(skin, -0.14);
  const hair = elder ? pick(r, GREY) : pick(r, HAIR);
  const cloth = pick(r, CLOTH);
  const [bg1, bg2] = pick(r, BG);
  const ink = '#2A211C';

  const headCy = child ? 96 : 90;
  const headRx = child ? 35 : 31;
  const headRy = child ? 37 : 38;
  const eyeY = headCy + (child ? 6 : 4);

  let back = '';
  let front = '';
  if (female) {
    const style = child ? pick(r, ['pigtails', 'bob']) : elder ? (born < 1915 ? 'kerchief' : pick(r, ['bun', 'bob'])) : pick(r, ['long', 'bob', 'bun', 'long']);
    if (style === 'long') {
      back = `<path d="M60 92C56 50 84 38 100 38C126 38 146 56 140 98C142 132 148 160 142 182L58 182C52 152 58 128 60 92Z" fill="${hair}"/>`;
      front = `<path d="M67 94C64 60 84 47 102 48C121 48 135 62 134 94C125 73 112 63 97 66C85 70 75 79 67 94Z" fill="${hair}"/>`;
    } else if (style === 'bob') {
      back = `<path d="M61 90C59 52 85 42 100 42C124 42 142 56 139 92L141 ${headCy + 38}C131 ${headCy + 44} 120 ${headCy + 42} 117 ${headCy + 34}L83 ${headCy + 34}C80 ${headCy + 42} 69 ${headCy + 44} 59 ${headCy + 38}Z" fill="${hair}"/>`;
      front = `<path d="M66 ${headCy + 4}C64 ${headCy - 30} 86 ${headCy - 42} 104 ${headCy - 41}C122 ${headCy - 40} 136 ${headCy - 28} 134 ${headCy + 4}C128 ${headCy - 16} 116 ${headCy - 24} 104 ${headCy - 24}C92 ${headCy - 18} 78 ${headCy - 14} 66 ${headCy + 4}Z" fill="${hair}"/>`;
    } else if (style === 'bun') {
      back = `<circle cx="100" cy="${headCy - 42}" r="17" fill="${hair}"/>`;
      front = `<path d="M68 ${headCy + 2}C66 ${headCy - 32} 84 ${headCy - 40} 100 ${headCy - 40}C116 ${headCy - 40} 134 ${headCy - 32} 132 ${headCy + 2}C126 ${headCy - 20} 114 ${headCy - 28} 100 ${headCy - 26}C86 ${headCy - 28} 74 ${headCy - 20} 68 ${headCy + 2}Z" fill="${hair}"/>`;
    } else if (style === 'kerchief') {
      const k = pick(r, ['#8E3B2F', '#2F4858', '#6E5A2E', '#4E5D3A']);
      back = `<path d="M58 100C54 50 84 34 100 34C116 34 146 50 142 100C140 126 122 140 100 142C78 140 60 126 58 100Z" fill="${k}"/><path d="M86 136L100 162L114 136Z" fill="${shade(k, -0.15)}"/>`;
      front = `<path d="M64 88C68 58 86 50 100 50C114 50 132 58 136 88C126 70 114 64 100 64C86 64 74 70 64 88Z" fill="${k}"/>${[0, 1, 2, 3, 4]
        .map((i) => `<circle cx="${74 + i * 13}" cy="${60 + Math.abs(2 - i) * 5}" r="2.2" fill="${shade(k, 0.45)}"/>`)
        .join('')}`;
    } else {
      // pigtails
      back = `<circle cx="58" cy="${headCy + 8}" r="13" fill="${hair}"/><circle cx="142" cy="${headCy + 8}" r="13" fill="${hair}"/>`;
      front = `<path d="M64 ${headCy + 2}C62 ${headCy - 34} 86 ${headCy - 42} 100 ${headCy - 42}C116 ${headCy - 42} 138 ${headCy - 34} 136 ${headCy + 2}C128 ${headCy - 18} 114 ${headCy - 22} 100 ${headCy - 22}C86 ${headCy - 22} 72 ${headCy - 18} 64 ${headCy + 2}Z" fill="${hair}"/>`;
    }
  } else {
    const style = child ? 'tousled' : elder && r() < 0.55 ? 'receding' : pick(r, ['short', 'side', 'short']);
    if (style === 'short') {
      front = `<path d="M68 ${headCy - 2}C66 ${headCy - 36} 86 ${headCy - 44} 102 ${headCy - 43}C122 ${headCy - 42} 136 ${headCy - 30} 132 ${headCy - 2}C128 ${headCy - 16} 118 ${headCy - 24} 100 ${headCy - 24}C86 ${headCy - 24} 74 ${headCy - 18} 68 ${headCy - 2}Z" fill="${hair}"/>`;
    } else if (style === 'side') {
      front = `<path d="M68 ${headCy}C63 ${headCy - 38} 96 ${headCy - 50} 116 ${headCy - 41}C132 ${headCy - 35} 136 ${headCy - 18} 132 ${headCy}C128 ${headCy - 14} 120 ${headCy - 21} 111 ${headCy - 23}C99 ${headCy - 18} 84 ${headCy - 20} 72 ${headCy - 12}Z" fill="${hair}"/>`;
    } else if (style === 'receding') {
      front = `<path d="M69 ${headCy + 8}C66 ${headCy - 6} 70 ${headCy - 16} 77 ${headCy - 20}L80 ${headCy + 2}Z" fill="${hair}"/><path d="M131 ${headCy + 8}C134 ${headCy - 6} 130 ${headCy - 16} 123 ${headCy - 20}L120 ${headCy + 2}Z" fill="${hair}"/>`;
    } else {
      front = `<path d="M64 ${headCy}C60 ${headCy - 40} 90 ${headCy - 50} 104 ${headCy - 46}C126 ${headCy - 46} 142 ${headCy - 32} 136 ${headCy}C130 ${headCy - 12} 124 ${headCy - 18} 116 ${headCy - 16}C112 ${headCy - 24} 104 ${headCy - 22} 98 ${headCy - 18}C90 ${headCy - 24} 80 ${headCy - 16} 72 ${headCy - 10}Z" fill="${hair}"/>`;
    }
  }

  const ears = female ? '' : `<ellipse cx="${100 - headRx}" cy="${eyeY + 2}" rx="5" ry="8" fill="${skinD}"/><ellipse cx="${100 + headRx}" cy="${eyeY + 2}" rx="5" ry="8" fill="${skinD}"/>`;
  const smiling = r() < 0.45;
  const eyes = smiling
    ? `<path d="M84 ${eyeY}q5.5 -5.5 11 0M105 ${eyeY}q5.5 -5.5 11 0" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    : `<circle cx="89.5" cy="${eyeY}" r="2.9" fill="${ink}"/><circle cx="110.5" cy="${eyeY}" r="2.9" fill="${ink}"/>`;
  const browC = elder ? shade(hair, -0.35) : shade(hair, -0.1);
  const brows = `<path d="M83 ${eyeY - 9}q6 -3 12 -0.5M105 ${eyeY - 9.5}q6 -2.5 12 0.5" stroke="${browC}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const nose = `<path d="M100 ${eyeY + 4}q-3.5 8 1.5 10" stroke="${skinD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const mouth = `<path d="M92 ${eyeY + 20}q8 ${smiling ? 7 : 4.5} 16 0" stroke="#9B4E44" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const cheeks = female || child ? `<circle cx="82" cy="${eyeY + 13}" r="6.5" fill="#E7897A" opacity=".28"/><circle cx="118" cy="${eyeY + 13}" r="6.5" fill="#E7897A" opacity=".28"/>` : '';
  const glasses =
    elder && r() < 0.5
      ? `<g stroke="#3B3633" stroke-width="2" fill="rgba(255,255,255,.12)"><circle cx="89.5" cy="${eyeY}" r="9"/><circle cx="110.5" cy="${eyeY}" r="9"/></g><path d="M98.5 ${eyeY}h3" stroke="#3B3633" stroke-width="2"/>`
      : '';
  const facial =
    !female && !child && r() < (elder ? 0.45 : 0.22)
      ? r() < 0.5
        ? `<path d="M90 ${eyeY + 16}q10 -6 20 0q-10 3 -20 0Z" fill="${shade(hair, -0.05)}"/>`
        : `<path d="M${100 - headRx + 3} ${eyeY + 2}C${100 - headRx + 4} ${eyeY + 38} 90 ${headCy + headRy + 6} 100 ${headCy + headRy + 6}C110 ${headCy + headRy + 6} ${100 + headRx - 4} ${eyeY + 38} ${100 + headRx - 3} ${eyeY + 2}C${100 + headRx - 8} ${eyeY + 22} 112 ${eyeY + 24} 100 ${eyeY + 24}C88 ${eyeY + 24} ${100 - headRx + 8} ${eyeY + 22} ${100 - headRx + 3} ${eyeY + 2}Z" fill="${hair}"/><path d="M92 ${eyeY + 20}q8 4 16 0" stroke="#9B4E44" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      : '';

  const bodyTop = child ? 150 : 140;
  const body = `<path d="M${child ? 34 : 22} 202C${child ? 38 : 26} ${bodyTop + 22} ${child ? 64 : 56} ${bodyTop} 100 ${bodyTop}C${child ? 136 : 144} ${bodyTop} ${child ? 162 : 174} ${bodyTop + 22} ${child ? 166 : 178} 202Z" fill="${cloth}"/>`;
  const neck = `<path d="M87 ${headCy + headRy - 10}L87 ${bodyTop + 2}Q100 ${bodyTop + 10} 113 ${bodyTop + 2}L113 ${headCy + headRy - 10}Z" fill="${skinD}"/>`;
  let collar = '';
  if (!female && !child) {
    collar =
      elder || r() < 0.4
        ? `<path d="M100 ${bodyTop + 6}L76 ${bodyTop + 2}L88 202ZM100 ${bodyTop + 6}L124 ${bodyTop + 2}L112 202Z" fill="${shade(cloth, -0.25)}"/><path d="M88 ${bodyTop}L100 ${bodyTop + 18}L112 ${bodyTop}L106 ${bodyTop - 2}L100 ${bodyTop + 8}L94 ${bodyTop - 2}Z" fill="#F4F1EA"/>`
        : `<path d="M86 ${bodyTop - 1}L100 ${bodyTop + 14}L114 ${bodyTop - 1}L109 ${bodyTop - 3}L100 ${bodyTop + 6}L91 ${bodyTop - 3}Z" fill="${shade(cloth, 0.55)}"/>`;
  } else if (female) {
    collar = `<path d="M85 ${bodyTop}Q100 ${bodyTop + 18} 115 ${bodyTop}" fill="${skinD}"/>${r() < 0.4 ? `<path d="M86 ${bodyTop + 2}Q100 ${bodyTop + 22} 114 ${bodyTop + 2}" stroke="#F3E6C8" stroke-width="2" fill="none" stroke-dasharray="0.1 5" stroke-linecap="round"/>` : ''}`;
  }

  const filter =
    tone === 'sepia'
      ? `<filter id="t" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.29 0.57 0.11 0 0.06  0.25 0.49 0.095 0 0.06  0.2 0.39 0.075 0 0.05  0 0 0 1 0"/><feComponentTransfer><feFuncR type="linear" slope="1.08" intercept="-0.02"/><feFuncG type="linear" slope="1.08" intercept="-0.03"/><feFuncB type="linear" slope="1.06" intercept="-0.03"/></feComponentTransfer></filter>`
      : tone === 'faded'
        ? `<filter id="t" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.55"/><feComponentTransfer><feFuncR type="linear" slope="0.9" intercept="0.08"/><feFuncG type="linear" slope="0.88" intercept="0.07"/><feFuncB type="linear" slope="0.82" intercept="0.06"/></feComponentTransfer></filter>`
        : '';
  const grain =
    tone === 'color'
      ? ''
      : `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${Math.floor(r() * 99)}"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.24  0 0 0 0 0.16  0 0 0 0.5 0"/></filter><radialGradient id="v" cx="50%" cy="45%" r="70%"><stop offset="60%" stop-color="#3a2a18" stop-opacity="0"/><stop offset="100%" stop-color="#3a2a18" stop-opacity="${tone === 'sepia' ? 0.38 : 0.2}"/></radialGradient>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400"><defs><linearGradient id="b" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>${filter}${grain}</defs><g${filter ? ' filter="url(#t)"' : ''}><rect width="200" height="200" fill="url(#b)"/><circle cx="150" cy="40" r="70" fill="#fff" opacity=".18"/>${back}${body}${neck}${collar}${ears}<ellipse cx="100" cy="${headCy}" rx="${headRx}" ry="${headRy}" fill="${skin}"/>${facial}${front}${brows}${eyes}${glasses}${nose}${facial ? '' : mouth}${cheeks}</g>${grain ? `<rect width="200" height="200" filter="url(#g)" opacity="${tone === 'sepia' ? 0.35 : 0.2}"/><rect width="200" height="200" fill="url(#v)"/>` : ''}</svg>`;
}

/** Градиент аватара-инициалов: тёплые и спокойные пары, без кислотных цветов. */
const INITIAL_GRADS: [string, string, string][] = [
  ['#2F6B57', '#5E9C7F', '#F4FBF7'],
  ['#B6643E', '#E39B6C', '#FFF7F1'],
  ['#3D5A80', '#6F8FB8', '#F3F7FC'],
  ['#8A5A83', '#B98AB2', '#FBF4FA'],
  ['#9C7A2E', '#CDAE5E', '#FFFAEC'],
  ['#2E6E73', '#5FA3A6', '#F1FBFB'],
  ['#8E4B4B', '#C47F75', '#FFF4F2'],
];

export function initialsGradient(seed: string): { from: string; to: string; ink: string; index: number } {
  const r = rng(`grad:${seed}`);
  const index = Math.floor(r() * INITIAL_GRADS.length);
  const [from, to, ink] = INITIAL_GRADS[index];
  return { from, to, ink, index };
}

export const INITIAL_GRADIENTS = INITIAL_GRADS;

export function initials(surname: string, given: string): string {
  return `${given.charAt(0)}${surname.charAt(0)}`.toUpperCase();
}
