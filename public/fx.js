// Efectos propios de Reset: sonidos sintetizados con Web Audio (sin archivos), partículas y pantallas de celebración.
import { openModal } from '/modal.js';
import { tr } from '/i18n.js';
const KEY = 'reset.sound';
// movimiento reducido: ajuste del sistema o interruptor de la app (Perfil → Accesibilidad)
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

export const sound = {
  get on() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } },
  set(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } },
};

let ctx;
function audio() {
  if (!sound.on) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(c, { f, to, t = 0, d = 0.15, type = 'sine', g = 0.12 }) {
  const o = c.createOscillator(), v = c.createGain(), t0 = c.currentTime + t;
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
  v.gain.setValueAtTime(0.0001, t0);
  v.gain.exponentialRampToValueAtTime(g, t0 + 0.01);
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(v).connect(c.destination);
  o.start(t0);
  o.stop(t0 + d + 0.05);
}

function noise(c, { t = 0, d = 0.3, g = 0.1, from = 800, to = 4000 }) {
  const len = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), flt = c.createBiquadFilter(), v = c.createGain(), t0 = c.currentTime + t;
  src.buffer = buf;
  flt.type = 'bandpass';
  flt.Q.value = 1.2;
  flt.frequency.setValueAtTime(from, t0);
  flt.frequency.exponentialRampToValueAtTime(to, t0 + d);
  v.gain.setValueAtTime(g, t0);
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  src.connect(flt).connect(v).connect(c.destination);
  src.start(t0);
}

const play = (fn) => { const c = audio(); if (c) { try { fn(c); } catch { /* el audio nunca debe romper la app */ } } };

// Sonidos grabados (public/sfx/<nombre>.mp3). Si un archivo falta o no ha cargado, suena el sintetizado de abajo.
const FILES = ['tap', 'done', 'all-done', 'level-up', 'pack-charge', 'pack-tear', 'pack-slam', 'reveal-common', 'reveal-rare', 'reveal-epic', 'reveal-legendary', 'notification'];
const buffers = new Map();
let loading;
function preload() {
  const c = audio();
  if (!c || loading) return;
  loading = Promise.all(FILES.map(async (n) => {
    try {
      const r = await fetch(`/sfx/${n}.mp3`);
      if (r.ok) buffers.set(n, await c.decodeAudioData(await r.arrayBuffer()));
    } catch { /* se usará el sintetizado */ }
  }));
}
addEventListener('pointerdown', preload, { once: true });

function playFile(name, gain = 1) {
  const c = audio();
  const b = c && buffers.get(name);
  if (!b) return false;
  try {
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = b;
    g.gain.value = gain;
    s.connect(g).connect(c.destination);
    s.start();
    return true;
  } catch { return false; }
}

// Ambiente de la respiración guiada: bucle con entrada y salida suaves. Devuelve la función para pararlo.
export async function ambientStart() {
  const c = audio();
  if (!c) return () => {};
  try {
    let b = buffers.get('ambient');
    if (!b) {
      b = await c.decodeAudioData(await (await fetch('/sfx/ambient-breathing.mp3')).arrayBuffer());
      buffers.set('ambient', b);
    }
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = b;
    s.loop = true;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.5, c.currentTime + 2.5);
    s.connect(g).connect(c.destination);
    s.start();
    return () => {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + 1.2);
      setTimeout(() => { try { s.stop(); } catch { /* ya parado */ } }, 1300);
    };
  } catch { return () => {}; }
}

const synth = {
  tap: () => play((c) => tone(c, { f: 520, d: 0.06, type: 'triangle', g: 0.08 })),
  done: () => play((c) => { tone(c, { f: 660, d: 0.12, type: 'triangle' }); tone(c, { f: 990, t: 0.08, d: 0.2, type: 'triangle' }); }),
  all: () => play((c) => [523, 659, 784, 1047].forEach((f, i) => tone(c, { f, t: i * 0.09, d: 0.3, type: 'triangle', g: 0.13 }))),
  level: () => play((c) => {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone(c, { f, t: i * 0.1, d: 0.35, type: 'sawtooth', g: 0.07 }));
    noise(c, { d: 0.8, g: 0.06, from: 300, to: 6000 });
  }),
  charge: (power = 1) => play((c) => {
    tone(c, { f: 120, to: 120 * (3 + power), d: 1.1, type: 'sawtooth', g: 0.06 });
    noise(c, { d: 1.1, g: 0.03 * (1 + power), from: 400, to: 5000 });
  }),
  tear: () => play((c) => { noise(c, { d: 0.35, g: 0.12, from: 6000, to: 1500 }); tone(c, { f: 200, to: 60, d: 0.3, type: 'square', g: 0.05 }); }),
  slam: () => play((c) => { tone(c, { f: 110, to: 40, d: 0.35, g: 0.3 }); noise(c, { d: 0.15, g: 0.1, from: 2000, to: 300 }); }),
  reveal: (rarity) => play((c) => {
    const base = { common: 523, rare: 659, epic: 784, legendary: 988 }[rarity] || 523;
    tone(c, { f: base, d: 0.25, type: 'triangle' });
    tone(c, { f: base * 1.5, t: 0.07, d: 0.3, type: 'triangle', g: 0.1 });
    if (rarity === 'epic' || rarity === 'legendary') {
      tone(c, { f: base * 2, t: 0.14, d: 0.5, g: 0.12 });
      noise(c, { d: 0.4, g: 0.05, from: 3000, to: 9000 });
    }
  }),
};

const FILE_OF = { tap: 'tap', done: 'done', all: 'all-done', level: 'level-up', charge: 'pack-charge', tear: 'pack-tear', slam: 'pack-slam' };
const GAIN = { tap: 0.9, done: 0.9, all: 1, level: 1, charge: 1, tear: 1, slam: 1 };
export const sfx = Object.fromEntries(Object.keys(FILE_OF).map((k) => [k, (...a) => { if (!playFile(FILE_OF[k], GAIN[k])) synth[k](...a); }]));
sfx.reveal = (rarity) => { if (!playFile(`reveal-${rarity}`)) synth.reveal(rarity); };
sfx.notify = () => { if (!playFile('notification', 0.9)) synth.done(); };

export function haptic(pattern) {
  if (!reduceMotion() && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* no disponible */ } }
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = tr(text); return e; };

// Chispas azules que salen disparadas desde un punto de la pantalla
export function burst(x, y, { n = 14, spread = 70 } = {}) {
  if (reduceMotion()) return;
  const colors = ['#3fe0ff', '#1b8cff', '#cdeeff'];
  const layer = el('div', 'fx-layer');
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < n; i++) {
    const p = el('i');
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, d = spread * (0.5 + Math.random());
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--r:${Math.random() * 360}deg;background:${colors[i % colors.length]}`;
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 900);
}

export function flash(ms = 380) {
  if (reduceMotion()) return;
  const f = el('div', 'fx-flash');
  f.setAttribute('aria-hidden', 'true');
  f.style.animationDuration = `${ms}ms`;
  document.body.append(f);
  setTimeout(() => f.remove(), ms + 50);
}

function overlay(label, onEscape) {
  const o = el('div', 'fxo');
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.setAttribute('aria-label', tr(label));
  document.body.append(o);
  const release = openModal(o, { onEscape });
  return { o, close: () => { o.remove(); release(); } };
}

// Pantalla de subida de nivel: rayos giratorios, número grande y fanfarria
export function levelUp(level) {
  return new Promise((resolve) => {
    sfx.level();
    haptic([40, 40, 90]);
    flash(500);
    const { o, close } = overlay('Subes de nivel', () => { close(); resolve(); });
    o.classList.add('lvl');
    const btn = el('button', 'btn', 'Seguir');
    btn.addEventListener('click', () => { close(); resolve(); });
    const card = el('div', 'lvlup');
    card.append(el('div', 'rays'), el('div', 'k', 'Subes de nivel'), el('div', 'n', String(level)), el('p', null, 'Has ganado un pack de cartas'), btn);
    o.append(card);
    btn.focus();
  });
}

// Apertura de pack: sobre que vibra, se carga, se rasga y revela las cartas una a una
export function packOpening(cards, makeCard) {
  return new Promise((resolve) => {
    const order = ['common', 'rare', 'epic', 'legendary'];
    const best = cards.reduce((m, c) => Math.max(m, order.indexOf(c.rarity)), 0);
    const { o, close } = overlay('Abrir pack de cartas', () => { close(); resolve(); });
    const stage = el('div', 'packstage');
    const seal = el('button', 'packseal');
    seal.setAttribute('aria-label', tr('Abrir el pack'));
    seal.append(el('span', 'hint', 'Toca para abrir'));
    stage.append(seal);
    o.append(stage);
    seal.focus();

    const reveal = () => {
      stage.replaceChildren();
      const list = el('div', 'gap packlist');
      const done = el('button', 'btn block', 'Genial');
      done.hidden = true;
      done.addEventListener('click', () => { close(); resolve(); });
      stage.append(el('h2', null, '¡Pack abierto!'), list, done);
      cards.forEach((c, i) => setTimeout(() => {
        const node = makeCard(c);
        list.append(node);
        node.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
        sfx.reveal(c.rarity);
        haptic(c.rarity === 'legendary' ? [30, 30, 80] : 15);
        if (c.rarity === 'legendary' || c.rarity === 'epic') flash(300);
        if (i === cards.length - 1) { done.hidden = false; done.focus({ preventScroll: true }); }
      }, reduceMotion() ? 0 : 450 + i * 750));
    };

    seal.addEventListener('click', () => {
      seal.disabled = true;
      if (reduceMotion()) { sfx.tear(); reveal(); return; }
      seal.classList.add('charging');
      sfx.charge(best + 1);
      haptic([20, 30, 20, 30, 40]);
      setTimeout(() => {
        sfx.tear(); sfx.slam(); flash(450); haptic(60);
        seal.classList.add('torn');
        setTimeout(reveal, 450);
      }, 1100);
    }, { once: true });
  });
}
