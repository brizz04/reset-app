// Cliente de Reset: PWA sin dependencias. Todo el texto se inserta con textContent (sin innerHTML).
import { sfx, sound, haptic, burst, levelUp, packOpening, ambientStart } from '/fx.js';
import { openModal } from '/modal.js';
import { tr, lang, setLang, loadLocale, LANGS, localeTag, fmtNum } from '/i18n.js';
import { cache, queue, cids, newCid, localToggle, localSkip, localMeditation, localLesson, localCreate, localUpdate, localDelete, rollState } from '/offline.js';
const $app = document.getElementById('app');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');
const dayLetters = () => (lang === 'es' ? ['D', 'L', 'M', 'X', 'J', 'V', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const AUTO_UNIT = { steps: 'pasos', exercise: 'minutos', workouts: 'entrenamientos', distance: 'km', sleep: 'horas' };
const AUTO_DEFAULT = { steps: 8000, exercise: 30, workouts: 1, distance: 3, sleep: 7 };
// Preferencias de este dispositivo (accesibilidad)
const prefs = {
  get(k, d) { try { return localStorage.getItem('reset.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('reset.' + k, v); } catch { /* sin almacenamiento */ } },
};
function applyPrefs() {
  document.documentElement.style.setProperty('--ui-zoom', prefs.get('zoom', '1'));
  document.documentElement.dataset.motion = prefs.get('motion', 'full');
}
applyPrefs();
const DIFF = { 1: ['Fácil', 10], 2: ['Medio', 20], 3: ['Difícil', 35] };
const RARITY = { common: ['Común', '#94a3b8'], rare: ['Rara', '#60a5fa'], epic: ['Épica', '#c084fc'], legendary: ['Legendaria', '#fbbf24'] };
const TABS = [['today', 'home', 'Hoy'], ['learn', 'book', 'Aprender'], ['cards', 'coins', 'Tesoro'], ['season', 'trophy', 'Temporada'], ['me', 'user', 'Perfil']];

// Iconos SVG propios (trazo de 2 px, mismo estilo) para los controles; los emojis quedan para contenido del usuario
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  coins: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4a3 3 0 0 0-5.3.6c0 2.6 5.2 1.4 5.2 4a3 3 0 0 1-5.3.7M12 6.2v1.6M12 16.2v1.6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  skip: '<path d="m5 5 9 7-9 7zM19 5v14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  flame: '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2 0-3-1-5 1-8z"/>',
};
function icon(name, size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name]; // contenido fijo de ICONS, nunca datos del usuario
  return svg;
}
// Icono de game-icons.net (CC BY 3.0) pintado con el color del texto; si no es un nombre de icono, se muestra tal cual (emoji)
function gi(name) {
  if (!/^[a-z0-9-]+$/.test(name || '')) return document.createTextNode(name || '');
  return h('span', { class: 'gi', 'aria-hidden': 'true', style: '--i:url(/icons/game/' + name + '.svg)' });
}
function bar(pct, label, cls = '') {
  const v = Math.max(0, Math.min(100, pct));
  return h('div', { class: `bar ${cls}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v) },
    h('i', { style: `width:${v}%` }));
}
const QUIT_IDEAS = [['🍬', 'Sin azúcar hoy'], ['📱', 'Sin redes sociales antes del mediodía'], ['🚬', 'Sin fumar'], ['🍺', 'Sin alcohol'], ['🛏️', 'Sin móvil en la cama'], ['🍟', 'Sin comida rápida']];
const REWARD_IDEAS = [['☕', 'Un café fuera', 50], ['📺', 'Un capítulo de mi serie', 80], ['🎮', 'Una hora de videojuegos', 120], ['🍽️', 'Cena fuera', 500]];
const MEDITATIONS = {
  caja: ['Respiración caja', [['Inspira', 4, 1], ['Mantén', 4, 1], ['Espira', 4, 0.55], ['Mantén', 4, 0.55]]],
  '478': ['4-7-8 para dormir', [['Inspira', 4, 1], ['Mantén', 7, 1], ['Espira', 8, 0.55]]],
  coherente: ['Coherente 5-5', [['Inspira', 5, 1], ['Espira', 5, 0.55]]],
};

let S = null; // estado del servidor
let T = null; // plantillas por área
let ME = null;
let tab = 'today';
let filter = 'todo';
let animateNext = true; // la entrada animada solo al abrir la app o cambiar de pestaña, no en cada toque
let vapidKey = '';

// replaceChildren acepta listas anidadas y omite null/false, igual que h()
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...kids) {
  nativeReplace.call(this, ...kids.flat(Infinity).filter((k) => k != null && k !== false));
};

const TR_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']); // atributos con texto para personas: se traducen
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, TR_ATTRS.has(k) ? tr(String(v)) : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(tr(String(kid))));
  return e;
}

// Peticiones al servidor. Si no hay conexión (o el servidor no responde en 8 s), las lecturas devuelven la última
// copia guardada en el dispositivo y las escrituras lanzan un error con offline = true.
async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'X-Lang': lang, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
  } catch { return offlineFallback(path, method); }
  if (res.status === 502 || res.status === 503 || res.status === 504) return offlineFallback(path, method); // el proxy no alcanza la app
  if (netDown) { netDown = false; updateSyncBar(); if (queue.size) scheduleFlush(300); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { cache.clear(); ME = null; renderAuth(); throw new Error('auth'); }
  if (!res.ok) throw new Error(tr(data.error || 'Error de red'));
  if (method === 'GET') cache.set(path.split('?')[0], data);
  return data;
}

// ---------- sin conexión: cola de cambios y sincronización ----------
let netDown = false;
let flushing = false;
let flushTimer = null;

function offlineFallback(path, method) {
  netDown = true;
  updateSyncBar();
  if (method === 'GET') { const c = cache.get(path.split('?')[0]); if (c != null) return c; }
  throw Object.assign(new Error('Sin conexión'), { offline: true });
}

function updateSyncBar() {
  const bar = document.getElementById('syncbar');
  if (!bar) return;
  const n = queue.size;
  const off = netDown || !navigator.onLine;
  bar.hidden = !off && !n;
  bar.textContent = off
    ? tr('Sin conexión · tus cambios se guardan en este dispositivo') + (n ? ' (' + n + ' ' + tr(n === 1 ? 'pendiente' : 'pendientes') + ')' : '')
    : tr('Sincronizando') + ' ' + n + ' ' + tr(n === 1 ? 'cambio' : 'cambios') + '…';
}
function scheduleFlush(ms = 1500) { clearTimeout(flushTimer); flushTimer = setTimeout(() => flush(), ms); }

// Reenvía los cambios pendientes en orden y, al terminar, sustituye el estado local por el real del servidor
async function flush({ render = true } = {}) {
  if (flushing || !ME) return;
  flushing = true;
  let sent = 0;
  try {
    while (queue.size) {
      const a = queue.all()[0];
      if (a.u !== ME.username) { queue.shift(); continue; }
      let path = a.path;
      const m = path.match(/\/c:([a-z0-9]+)/);
      if (m) {
        const real = cids.get()[m[1]];
        if (!real) { queue.shift(); continue; } // el hábito nunca llegó a crearse: no hay a qué aplicar el cambio
        path = path.replace(m[0], '/' + real);
      }
      try {
        const r = await api(path, a.method, a.body);
        if (a.type === 'habit-create') { const h = (r.habits || []).find((z) => z.cid === a.cid); if (h) cids.set(a.cid, h.id); }
        queue.shift(); sent++;
      } catch (e) {
        if (e.message === 'auth' || e.offline) break; // seguimos sin conexión o hay que volver a entrar: se conserva la cola
        queue.shift(); sent++;
        toast('Un cambio no se pudo sincronizar: ' + e.message);
      }
      updateSyncBar();
    }
  } finally { flushing = false; }
  updateSyncBar();
  if (sent && !queue.size) {
    try {
      S = await api('/api/state?date=' + today());
      await api('/api/lessons').catch(() => {});
      if (render && ME && S) renderApp();
    } catch { /* la próxima sincronización lo corregirá */ }
  }
}

// Ejecuta un cambio: si hay conexión, directo al servidor; si no, lo aplica en el dispositivo y lo deja en cola
async function act(type, method, path, body, local) {
  if (queue.size) await flush({ render: false });
  if (!queue.size) {
    try { return { r: await api(path, method, body) }; } catch (e) { if (!e.offline) throw e; }
  }
  local(S); // si no es posible (por ejemplo, sin saltos), lanza un error y no se guarda nada
  const cid = path.match(/\/c:([a-z0-9]+)/)?.[1];
  if (type === 'habit-delete' && cid) queue.set(queue.all().filter((a) => a.cid !== cid && !a.path.includes('/c:' + cid))); // creado y borrado sin conexión: no hay nada que enviar
  else queue.push({ type, method, path, body, u: ME.username, cid: body?.cid });
  cache.set('/api/state', S);
  updateSyncBar();
  scheduleFlush(5000);
  return { queued: true };
}

function toast(msg, ico) {
  const t = h('div', { class: 'toast' }, ico ? [gi(ico), ' '] : null, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}
function announce(ach) {
  for (const key of ach || []) {
    const a = S.achievements.find((x) => x.key === key);
    if (a) { toast(tr('Logro') + ': ' + tr(a.title), a.icon); sfx.notify(); }
  }
}
// aplica la respuesta de una acción con estado: avisa de subida de nivel y logros
function apply(r) {
  const before = S.level;
  S = r.state;
  announce(r.newAchievements);
  renderApp();
  if (S.level > before) levelUp(S.level);
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'auth') toast(e.offline ? 'Sin conexión: esto necesita internet' : '⚠️ ' + e.message); } };
const domainInfo = (d) => T?.[d] || { name: d, icon: '⭐', color: '#34d399' };

// ---------- idioma ----------
// Botones ES | EN de la pantalla de acceso (en Perfil hay un selector con los nombres completos)
function langToggle(onChange) {
  return h('div', { class: 'langtoggle', role: 'group', 'aria-label': 'Idioma' }, Object.keys(LANGS).map((code) =>
    h('button', { class: lang === code ? 'on' : '', 'aria-pressed': lang === code ? 'true' : 'false', lang: code, title: LANGS[code], onclick: async () => { await setLang(code); onChange(); } }, code.toUpperCase())));
}
function langPanel() {
  return h('div', { class: 'card gap' }, h('b', null, 'Idioma'),
    h('div', { class: 'seg', role: 'group' }, Object.entries(LANGS).map(([code, name]) =>
      h('button', { class: lang === code ? 'on' : '', 'aria-pressed': lang === code ? 'true' : 'false', lang: code, onclick: run(async () => { await setLang(code); renderApp(); }) }, name))));
}

// ---------- acceso ----------
function renderAuth(mode = 'login') {
  const err = h('div', { class: 'err', role: 'alert' });
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
  const invite = h('input', { type: 'text', autocapitalize: 'none', autocomplete: 'off' });
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const submit = async () => {
    err.textContent = '';
    try {
      const body = { username: user.value.trim(), password: pass.value, tz: TZ };
      if (mode === 'register') body.invite = invite.value.trim();
      await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', body);
      cache.clear();
      await boot();
    } catch (e) { err.textContent = tr(e.message); }
  };
  $app.replaceChildren(h('div', { class: 'auth' },
    langToggle(() => renderAuth(mode)),
    h('div', { class: 'logo' }, 'Re', h('b', null, 'set')),
    h('p', { class: 'muted' }, 'Reinicia tu vida en 66 días. Hábitos, XP, rachas y cartas, en tu propio servidor.'),
    h('label', { class: 'f' }, 'Usuario', user),
    h('label', { class: 'f' }, 'Contraseña', pass, mode === 'register' ? h('span', { class: 'small' }, 'Mínimo 8 caracteres') : null),
    mode === 'register' ? h('label', { class: 'f' }, 'Código de invitación', invite, h('span', { class: 'small' }, 'Solo si no eres la primera persona en registrarte')) : null,
    err,
    h('button', { class: 'btn block', onclick: submit }, mode === 'login' ? 'Entrar' : 'Crear cuenta'),
    h('button', { class: 'btn ghost block', onclick: () => renderAuth(mode === 'login' ? 'register' : 'login') },
      mode === 'login' ? 'Crear una cuenta' : 'Ya tengo cuenta'),
  ));
}

// ---------- bienvenida (encuesta inicial) ----------
function renderOnboarding() {
  const a = { domains: [], level: 'empezando', wake: '07:00', goal: '', values: [] };
  const VALUES = ['Salud', 'Familia', 'Libertad', 'Crecimiento', 'Disciplina', 'Creatividad', 'Calma', 'Aventura', 'Servicio', 'Honestidad'];
  let step = 0;
  const steps = [
    () => [h('h2', null, '¿Qué quieres reiniciar?'), h('p', { class: 'muted' }, 'Elige hasta 4 áreas. Crearemos hábitos de partida para ti.'),
      Object.entries(T).map(([k, d]) => h('button', {
        class: 'choice' + (a.domains.includes(k) ? ' on' : ''),
        onclick: () => { a.domains = a.domains.includes(k) ? a.domains.filter((x) => x !== k) : [...a.domains, k].slice(-4); draw(); },
      }, h('span', { style: 'font-size:26px;color:' + d.color }, gi(d.icon)), d.name))],
    () => [h('h2', null, '¿Cómo estás con los hábitos?'),
      [['empezando', 'sprout', 'Empezando de cero'], ['algo', 'flame', 'Tengo algunos'], ['avanzado', 'rocket', 'Quiero más reto']].map(([k, ico, t]) =>
        h('button', { class: 'choice' + (a.level === k ? ' on' : ''), onclick: () => { a.level = k; draw(); } }, h('span', { style: 'font-size:26px;color:var(--cyan)' }, gi(ico)), t))],
    () => [h('h2', null, '¿A qué hora te despiertas?'), h('p', { class: 'muted' }, 'Pondremos los recordatorios de la mañana a esa hora.'),
      h('input', { type: 'time', value: a.wake, onchange: (e) => { a.wake = e.target.value || '07:00'; } })],
    () => [h('h2', null, '¿Qué quieres conseguir en 66 días?'),
      h('textarea', { rows: 3, maxlength: 200, placeholder: 'Ej.: Ser alguien que entrena y duerme bien', oninput: (e) => { a.goal = e.target.value; } }, a.goal)],
    () => [h('h2', null, 'Tus valores'), h('p', { class: 'muted' }, 'Elige hasta 3.'),
      h('div', { class: 'seg' }, VALUES.map((v) => h('button', {
        class: a.values.includes(v) ? 'on' : '',
        onclick: () => { a.values = a.values.includes(v) ? a.values.filter((x) => x !== v) : [...a.values, v].slice(-3); draw(); },
      }, v)))],
  ];
  const draw = () => {
    const last = step === steps.length - 1;
    const blocked = step === 0 && !a.domains.length;
    $app.replaceChildren(h('div', { class: 'auth' },
      h('div', { class: 'dots' }, steps.map((_, i) => h('i', { class: i <= step ? 'on' : '' }))),
      steps[step](),
      h('div', { class: 'row' },
        step > 0 ? h('button', { class: 'btn ghost', onclick: () => { step--; draw(); } }, 'Atrás') : null,
        h('button', {
          class: 'btn grow', disabled: blocked,
          onclick: run(async () => {
            if (!last) { step++; draw(); return; }
            S = await api('/api/onboarding', 'POST', { ...a, date: today() });
            ME.profile = { goal: a.goal, values: a.values };
            renderApp();
          }),
        }, last ? '¡Empezar el día 1!' : 'Siguiente'),
      ),
    ));
  };
  draw();
}

// ---------- estructura ----------
function renderApp() {
  if (!S.onboarded) return renderOnboarding();
  const view = h('div', { id: 'view', class: 'gap' + (animateNext ? ' rise' : '') });
  animateNext = false;
  const nav = h('nav', { class: 'nav', 'aria-label': 'Secciones' }, h('div', null, TABS.map(([k, i, t]) =>
    h('button', { class: tab === k ? 'on' : '', 'aria-current': tab === k ? 'page' : null, onclick: () => { tab = k; animateNext = true; renderApp(); window.scrollTo(0, 0); } },
      icon(i, 24), t, k === 'cards' && S.packsAvailable ? h('b', { class: 'badge', 'aria-label': `${S.packsAvailable} packs sin abrir` }, S.packsAvailable) : null))));
  $app.replaceChildren(h('div', { class: 'app' }, h('div', { id: 'syncbar', class: 'syncbar', role: 'status', hidden: true }), header(), view), nav);
  updateSyncBar();
  cache.set('/api/state', S);
  const views = { today: viewToday, learn: viewLearn, cards: viewCards, season: viewSeason, me: viewMe };
  Promise.resolve(views[tab](view)).catch((e) => {
    if (e.message === 'auth') return;
    if (e.offline) view.replaceChildren(h('div', { class: 'card center muted' }, 'Esta sección necesita conexión. Volverá a funcionar en cuanto la recuperes.'));
    else toast('⚠️ ' + e.message);
  });
}

// títulos a dos tonos, como en las referencias
const title2 = (a, b) => h('h2', null, a, h('span', { class: 'ac' }, b));

function header() {
  return h('div', { class: 'top' },
    h('div', { class: 'tags grow' },
      h('span', { class: 'tag hot', role: 'img', 'aria-label': `Racha de ${S.streak} días` }, icon('flame', 14), S.streak),
      h('span', { class: 'tag gold', role: 'img', 'aria-label': `${S.coins} monedas` }, icon('coins', 14), S.coins),
      h('span', { class: 'tag blue', role: 'img', 'aria-label': `${S.xp} XP en total` }, `${S.xp} XP`)),
    h('div', { class: 'avatar', role: 'img', 'aria-label': ME.username }, ME.username[0].toUpperCase()));
}

// ---------- Hoy ----------
function viewToday(view) {
  const due = S.habits.filter((x) => x.due);
  const finished = due.filter((x) => x.done && !x.skipped).length;
  const counts = { todo: due.filter((x) => !x.done).length, hecho: finished, omitido: due.filter((x) => x.skipped).length };
  const pct = Math.min(100, (S.programDay / S.programTotal) * 100);
  const span = S.levelNext - S.levelFloor;
  const line = due.length && finished === due.length ? '¡Día perfecto! Sigue así.' : finished > 0 ? 'Lo estás haciendo genial. ¡Sigue así!' : 'Empieza por el más fácil.';
  const hero = h('div', { class: 'card hero gap' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'kicker' }, 'Tu reinicio'),
        h('div', { class: 'big' }, S.programDay > S.programTotal ? '¡Completado!' : `Día ${S.programDay}`, h('small', null, ` /${S.programTotal}`)),
        h('p', { class: 'muted small' }, line)),
      h('div', { class: 'tags', style: 'justify-content:flex-end' }, h('span', { class: 'tag blue' }, `${finished}/${due.length} hoy`),
        S.bonusPct ? h('span', { class: 'tag hot', title: 'Bonus de XP por racha' }, icon('flame', 14), `+${S.bonusPct}% XP`) : null)),
    bar(pct, `Día ${Math.min(S.programDay, S.programTotal)} de ${S.programTotal}`),
    h('div', { class: 'week' }, S.week.map((d) => {
      const wd = new Date(d.date + 'T00:00:00').getDay();
      const cls = d.due && d.done >= d.due ? 'full' : d.done > 0 ? 'part' : '';
      return h('div', { class: 'day' }, dayLetters()[wd], h('div', { class: `dot ${cls} ${d.date === S.date ? 'today' : ''}`, role: 'img', 'aria-label': `${d.date}: ${d.done} de ${d.due} hábitos` }, cls === 'full' ? icon('check', 16) : null));
    })),
    h('div', { class: 'lvlcard' },
      h('div', { class: 'lvlbox' }, h('b', null, S.level), h('span', null, 'NIVEL')),
      h('div', { class: 'gap', style: 'gap:6px' },
        h('div', { class: 'xpbig' }, S.xp.toLocaleString(localeTag()), h('span', { class: 'muted small', style: 'font-family:var(--body);letter-spacing:.1em' }, ' XP GANADOS')),
        bar(((S.xp - S.levelFloor) / span) * 100, 'Experiencia del nivel'),
        h('div', { class: 'small muted' }, `${span - (S.xp - S.levelFloor)} XP para el nivel ${S.level + 1}`))));
  const banner = S.packsAvailable ? h('button', { class: 'card pack row', onclick: () => { tab = 'cards'; renderApp(); } },
    h('span', { style: 'font-size:32px;color:var(--ice)' }, gi('card-draw')), h('div', { class: 'grow', style: 'text-align:left' }, h('b', null, `Tienes ${S.packsAvailable} pack${S.packsAvailable > 1 ? 's' : ''} de cartas`), h('div', { class: 'small' }, 'Toca para abrirlo'))) : null;
  const shown = due.filter((x) => (filter === 'todo' ? !x.done : filter === 'hecho' ? x.done && !x.skipped : x.skipped));
  const empty = filter === 'todo' ? (S.habits.length ? 'Hoy no te queda ningún hábito por hacer. 🎉' : 'Aún no tienes hábitos. Pulsa + para crear el primero.') : 'Nada por aquí todavía.';
  const rows = shown.length ? shown.map((x) => habitRow(x)) : [h('div', { class: 'card center muted' }, empty)];
  const other = S.habits.filter((x) => !x.due);
  view.replaceChildren(hero, banner, healthCard(), bossCard(), questsCard(),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'kicker' }, 'Sesión de hoy'), h('h3', { style: 'margin-top:6px' }, 'Hábitos')),
      h('span', { class: 'tag blue', title: 'Saltos semanales para proteger tu racha' }, icon('skip', 14), `${S.skipsLeft}/${S.skipsMax}`)),
    h('div', { class: 'segtabs', role: 'group', 'aria-label': 'Filtrar hábitos' }, [['todo', 'Por hacer'], ['hecho', 'Hecho'], ['omitido', 'Omitido']].map(([k, t]) =>
      h('button', { class: filter === k ? 'on' : '', 'aria-pressed': filter === k ? 'true' : 'false', onclick: () => { filter = k; renderApp(); } }, t, h('span', { class: 'cnt' }, counts[k])))),
    rows, other.length ? [h('h3', null, 'Otros días'), other.map((x) => habitRow(x, true))] : null,
    h('button', { class: 'fab', 'aria-label': 'Nuevo hábito', onclick: () => habitSheet() }, icon('plus', 28)));
}

function healthCard() {
  const hl = S.health;
  if (!hl?.connected) return null;
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), label);
  const vitals = [];
  if (hl.resting != null) vitals.push(stat(hl.resting, 'lpm en reposo'));
  if (hl.sleep != null) vitals.push(stat(fmtNum(hl.sleep), 'h de sueño'));
  if (hl.spo2 != null) vitals.push(stat(Math.round(hl.spo2) + '%', 'oxígeno'));
  if (hl.hrv != null) vitals.push(stat(Math.round(hl.hrv), 'ms variabilidad'));
  const extra = [
    hl.hr ? 'Pulso ' + (hl.hr.min ?? '–') + '–' + (hl.hr.max ?? '–') + ' lpm' + (hl.hr.avg != null ? ' (media ' + hl.hr.avg + ')' : '') : null,
    hl.distance ? hl.distance + ' km' : null,
    hl.kcal ? hl.kcal + ' kcal activas' : null,
  ].filter(Boolean);
  return h('div', { class: 'card gap' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'kicker' }, 'Actividad de hoy'), h('b', null, 'Móvil y reloj'))),
    h('div', { class: 'stats' }, stat(hl.steps.toLocaleString(localeTag()), 'pasos'), stat(hl.exercise, 'min ejercicio'), stat(hl.workouts, hl.workouts === 1 ? 'entreno' : 'entrenos')),
    vitals.length ? h('div', { class: 'stats' }, vitals.slice(0, 3)) : null,
    extra.length ? h('div', { class: 'muted small center' }, extra.join(' · ')) : null);
}

function bossCard() {
  const b = S.boss;
  const left = Math.max(0, b.hp - b.damage);
  // cada jefe tiene su ilustración: public/art/boss-<nombre-sin-acentos>.webp; si falta, se usa boss.webp
  const slug = b.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return h('div', { class: 'card boss gap', style: `--bossart:url(/art/boss-${slug}.webp),url(/art/boss.webp)` },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'kicker', style: 'margin-bottom:6px' }, 'Jefe de la semana'), h('b', { style: 'font:400 28px/1 var(--display);text-transform:uppercase' }, b.name)),
      h('span', { class: 'tag blue' }, gi(b.defeated ? 'skull-crossed-bones' : 'hourglass'), b.defeated ? 'Derrotado' : `${b.daysLeft + 1} d`)),
    bar((left / b.hp) * 100, `Vida del jefe: ${left} de ${b.hp}`, 'hp'),
    h('div', { class: 'row small muted' }, h('span', { class: 'grow' }, `Vida ${left} / ${b.hp} · cada hábito le quita XP`), h('span', { class: 'tags' }, h('span', { class: 'tag gold' }, icon('coins', 12), b.reward), h('span', { class: 'tag blue' }, gi('card-draw'), 'Pack'))),
    b.defeated && !b.claimed ? h('button', { class: 'btn block', onclick: run(async () => apply(await api('/api/boss/claim', 'POST', { date: S.date }))) }, '¡Reclamar botín!')
      : b.claimed ? h('div', { class: 'small muted center' }, 'Botín reclamado ✓') : null);
}

function questsCard() {
  return h('div', { class: 'card gap' }, h('b', null, 'Misiones diarias'),
    S.quests.map((q) => h('div', { class: 'quest' },
      h('span', { class: 'ico' }, gi(q.icon)),
      h('div', { class: 'grow' }, h('div', null, q.title),
        bar((q.progress / q.target) * 100, `Progreso: ${q.title}`, 'thin'),
        h('span', { class: 'muted small' }, `${q.progress}/${q.target}`)),
      q.claimed ? h('span', { class: 'tag hot' }, icon('check', 12), 'Cobrada') : q.done
        ? h('button', { class: 'btn small claim', onclick: run(async () => apply(await api('/api/quests/claim', 'POST', { date: S.date, id: q.id }))) }, 'Cobrar', icon('coins', 14), q.coins)
        : h('span', { class: 'tag gold' }, icon('coins', 12), q.coins))));
}

function habitRow(x, offDay) {
  const d = domainInfo(x.domain);
  const quit = x.kind === 'quit';
  const art = ['health', 'mind', 'career', 'discipline', 'relationships', 'learning', 'spirit'].includes(x.domain) ? x.domain : 'default';
  const skipBtn = (label, ico, tip) => h('button', { class: 'iconbtn', title: tip, 'aria-label': `${label} «${x.title}»`, onclick: run(async () => {
    const out = await act('skip', 'POST', `/api/habits/${x.id}/skip`, { date: S.date, skipped: !x.skipped }, (st) => {
      if (localSkip(st, x.id, st.date) === 'no-skips') throw new Error('No te quedan saltos esta semana');
    });
    if (out.r) apply(out.r); else renderApp();
  }) }, icon(ico, 16));
  return h('article', { class: 'habit' + (x.done ? ' done' : '') + (quit ? ' quit' : ''), style: `--c:${d.color};--art:url(/art/${art}.webp),url(/art/${art}.svg)` },
    h('div', { class: 'htop' },
      h('div', { class: 'tags' },
        x.streak ? h('span', { class: 'tag hot' }, icon('flame', 12), `${x.streak} d`) : null,
        h('span', { class: 'tag' }, quit ? 'Dejar' : d.name),
        h('span', { class: 'tag blue' }, `+${DIFF[x.difficulty][1]} XP`),
        x.reminder ? h('span', { class: 'tag' }, x.reminder) : null,
        x.auto ? h('span', { class: 'tag hot' }, 'Auto · ' + x.auto.min + ' ' + AUTO_UNIT[x.auto.metric]) : null),
      h('div', { class: 'hact' },
        !x.done && !offDay ? skipBtn('Saltar', 'skip', 'Saltar hoy sin romper la racha') : null,
        x.skipped ? skipBtn('Deshacer salto de', 'undo', 'Deshacer salto') : null,
        h('button', { class: 'iconbtn', title: 'Editar', 'aria-label': `Editar «${x.title}»`, onclick: () => habitSheet(x) }, icon('edit', 16)))),
    h('div', { class: 'hbot' },
      h('div', { class: 'ico', 'aria-hidden': 'true' }, x.icon),
      h('div', { class: 'grow' }, h('div', { class: 't' }, x.title), h('div', { class: 'sub' }, quit ? 'Marca cada día que lo evites' : '')),
      h('button', {
        class: 'check' + (x.done && !x.skipped ? ' on' : x.skipped ? ' skip' : ''), 'aria-pressed': x.done && !x.skipped ? 'true' : 'false',
        'aria-label': `${quit ? 'Evitado hoy' : 'Completar'}: ${x.title}`,
        onclick: run(async (ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          sfx.tap();
          const before = S.level;
          const target = x.skipped ? true : !x.done;
          const out = await act('toggle', 'POST', `/api/habits/${x.id}/toggle`, { date: S.date, done: target }, (st) => localToggle(st, x.id, st.date));
          if (out.r) S = out.r.state;
          const justDone = !x.done && S.habits.find((z) => z.id === x.id)?.done;
          const due = S.habits.filter((z) => z.due);
          const perfect = justDone && due.length > 0 && due.every((z) => z.done);
          if (justDone) {
            sfx.done(); haptic(20);
            burst(rect.left + rect.width / 2, rect.top + rect.height / 2, perfect ? { n: 26, spread: 120 } : {});
            if (perfect) { setTimeout(sfx.all, 250); toast('¡Día perfecto!', 'bullseye'); }
          }
          announce(out.r?.newAchievements);
          renderApp();
          if (S.level > before) levelUp(S.level);
        }),
      }, x.skipped ? icon('skip', 20) : x.done ? icon('check', 26) : null)));
}

// Diálogo modal accesible: forma parte de una pila (solo responde el de arriba, el fondo queda inerte)
function sheet(content) {
  let m, release;
  const close = () => { m?.remove(); release?.(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, content(close));
  panel.setAttribute('aria-label', panel.querySelector('h2')?.textContent || 'Diálogo');
  m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } }, panel);
  document.body.append(m);
  release = openModal(panel, { onEscape: close });
  return close;
}

function habitSheet(x) {
  const f = x ? { ...x, daysArr: DAY_ORDER.filter((d) => (x.days >> d) & 1) } : { title: '', icon: '✅', kind: 'build', domain: 'discipline', difficulty: 1, daysArr: [0, 1, 2, 3, 4, 5, 6], reminder: null, auto: null };
  sheet((close) => {
    const root = h('div', { class: 'gap' });
    const draw = () => {
      const err = h('div', { class: 'err' });
      root.replaceChildren(
        h('h2', null, x ? 'Editar hábito' : 'Nuevo hábito'),
        h('div', { class: 'seg' }, [['build', 'Construir un hábito'], ['quit', 'Dejar un mal hábito']].map(([k, t]) =>
          h('button', { class: f.kind === k ? 'on' : '', onclick: () => { f.kind = k; draw(); } }, t))),
        !x ? [h('div', { class: 'muted small' }, 'Ideas rápidas'), h('div', { class: 'seg' }, (f.kind === 'quit'
          ? QUIT_IDEAS.map(([icon, title]) => ({ icon, title, difficulty: 2 })) : T[f.domain].habits).map((t) =>
          h('button', { onclick: () => { Object.assign(f, { title: tr(t.title), icon: t.icon, difficulty: t.difficulty }); draw(); } }, `${t.icon} ${t.title}`)))] : null,
        h('label', { class: 'f' }, 'Nombre', h('input', { type: 'text', maxlength: 80, value: f.title, oninput: (e) => { f.title = e.target.value; } })),
        h('div', { class: 'row' },
          h('label', { class: 'f', style: 'width:84px' }, 'Icono', h('input', { type: 'text', maxlength: 4, value: f.icon, oninput: (e) => { f.icon = e.target.value; } })),
          h('label', { class: 'f grow' }, 'Área', h('select', { onchange: (e) => { f.domain = e.target.value; draw(); } },
            Object.entries(T).map(([k, d]) => h('option', { value: k, selected: k === f.domain }, d.name))))),
        h('div', { class: 'muted small' }, 'Dificultad'),
        h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', { class: f.difficulty === n ? 'on' : '', onclick: () => { f.difficulty = n; draw(); } }, `${DIFF[n][0]} · ${DIFF[n][1]} XP`))),
        h('div', { class: 'muted small' }, 'Días'),
        h('div', { class: 'seg' }, DAY_ORDER.map((d) => h('button', {
          class: f.daysArr.includes(d) ? 'on' : '',
          onclick: () => { f.daysArr = f.daysArr.includes(d) ? f.daysArr.filter((z) => z !== d) : [...f.daysArr, d]; draw(); },
        }, dayLetters()[d]))),
        h('label', { class: 'f' }, 'Recordatorio (opcional)', h('input', { type: 'time', value: f.reminder || '', onchange: (e) => { f.reminder = e.target.value || null; } })),
        h('div', { class: 'muted small' }, 'Completar solo con los datos de tu móvil o reloj'),
        h('div', { class: 'seg' }, [[null, 'Manual'], ['steps', 'Pasos'], ['exercise', 'Ejercicio'], ['workouts', 'Entrenos'], ['distance', 'Distancia'], ['sleep', 'Sueño']].map(([k, t]) =>
          h('button', { class: (f.auto?.metric ?? null) === k ? 'on' : '', onclick: () => { f.auto = k ? { metric: k, min: AUTO_DEFAULT[k] } : null; draw(); } }, t))),
        f.auto ? h('label', { class: 'f' }, 'Objetivo (' + AUTO_UNIT[f.auto.metric] + ' al día)', h('input', { type: 'text', inputmode: 'decimal', value: f.auto.min, oninput: (e) => { f.auto.min = Number(String(e.target.value).replace(',', '.')); } })) : null,
        err,
        h('div', { class: 'row' },
          x ? h('button', { class: 'btn danger', onclick: run(async () => {
            if (!confirm(tr('¿Archivar este hábito?'))) return;
            const out = await act('habit-delete', 'DELETE', `/api/habits/${x.id}?date=${S.date}`, {}, (st) => localDelete(st, x.id));
            if (out.r) S = out.r;
            close(); renderApp();
          }) }, 'Archivar') : null,
          h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'),
          h('button', {
            class: 'btn grow', onclick: async () => {
              try {
                const body = { title: f.title, icon: f.icon, kind: f.kind, domain: f.domain, difficulty: f.difficulty, days: f.daysArr, reminder: f.reminder, auto: f.auto, date: S.date };
                if (!body.title.trim() || body.title.length > 80) throw new Error('El nombre debe tener entre 1 y 80 caracteres');
                if (!body.days.length) throw new Error('Elige al menos un día');
                if (body.auto && !(body.auto.min > 0)) throw new Error('El objetivo debe ser mayor que 0');
                let out;
                if (x) out = await act('habit-update', 'PUT', `/api/habits/${x.id}`, body, (st) => localUpdate(st, x.id, body));
                else { const cid = newCid(); body.cid = cid; out = await act('habit-create', 'POST', '/api/habits', body, (st) => localCreate(st, body, cid)); }
                if (out.r) S = out.r;
                close(); renderApp();
              } catch (e) { err.textContent = tr(e.message); }
            },
          }, 'Guardar')));
    };
    draw();
    return root;
  });
}

// ---------- Aprender ----------
async function viewLearn(view) {
  const lessons = await api('/api/lessons');
  view.replaceChildren(
    title2('Aprende', 'cada día'),
    h('div', { class: 'card pack row', style: 'background:linear-gradient(135deg,#0f63c9,#06255a)', onclick: () => breathSheet() },
      h('span', { style: 'font-size:34px' }, gi('lotus')), h('div', { class: 'grow' }, h('b', null, 'Respirar y meditar'), h('div', { class: 'small' }, `Sesiones guiadas · +15 XP (${S.medToday}/${S.medMax} hoy)`))),
    h('h3', null, 'Lecciones'),
    lessons.map((l) => h('button', { class: 'card row', style: 'text-align:left;width:100%', onclick: () => lessonSheet(l) },
      h('span', { style: 'font-size:28px;color:var(--cyan)' }, gi(l.icon)),
      h('div', { class: 'grow' }, h('b', null, l.title), h('div', { class: 'muted small' }, `${l.subtitle} · ${l.minutes} min`)),
      l.done ? h('span', { class: 'chip' }, '✓ Leída') : h('span', { class: 'chip' }, '+25 XP'))));
}

function lessonSheet(l) {
  sheet((close) => h('div', { class: 'gap' },
    h('div', { style: 'font-size:44px;color:var(--cyan)' }, gi(l.icon)), h('h2', null, l.title), h('div', { class: 'muted' }, l.subtitle),
    l.body.map((p) => h('p', null, p)),
    h('div', { class: 'card' }, h('b', null, 'Idea clave'), h('p', null, l.takeaway)),
    h('div', { class: 'card', style: 'border-color:var(--accent)' }, h('b', null, 'Hazlo hoy'), h('p', null, l.action)),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cerrar'),
      h('button', { class: 'btn grow', disabled: l.done, onclick: run(async () => {
        const out = await act('lesson', 'POST', `/api/lessons/${l.id}/complete`, { date: S.date }, (st) => {
          const list = cache.get('/api/lessons') || [];
          localLesson(st, list, l.id);
          cache.set('/api/lessons', list);
        });
        if (out.r) { S = out.r.state; announce(out.r.newAchievements); }
        toast('+25 XP', 'open-book'); close(); renderApp();
      }) }, l.done ? 'Ya leída' : 'Marcar como leída'))));
}

function breathSheet() {
  let mins = 2, key = 'caja', timer = null, stop = false, stopAmbient = () => {};
  sheet((close) => {
    const root = h('div', { class: 'gap' });
    const finish = async (ok) => {
      stop = true; clearTimeout(timer); stopAmbient();
      if (ok) {
        try {
          let granted = true;
          const out = await act('meditation', 'POST', '/api/meditation', { date: S.date }, (st) => { granted = localMeditation(st); });
          if (out.r) { S = out.r.state; announce(out.r.newAchievements); granted = out.r.xpGranted; }
          toast(granted ? '+15 XP. ¡Bien hecho!' : 'Sesión completada (límite de XP diario alcanzado)', 'lotus');
        } catch (e) { toast('⚠️ ' + e.message); }
      }
      close(); renderApp();
    };
    const pick = () => {
      root.replaceChildren(h('h2', null, 'Respirar'),
        h('div', { class: 'gap' }, Object.entries(MEDITATIONS).map(([k, [n]]) => h('button', { class: 'choice' + (key === k ? ' on' : ''), onclick: () => { key = k; pick(); } }, n))),
        h('div', { class: 'seg' }, [2, 5, 10].map((m) => h('button', { class: mins === m ? 'on' : '', onclick: () => { mins = m; pick(); } }, `${m} min`))),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cerrar'), h('button', { class: 'btn grow', onclick: start }, 'Empezar')));
    };
    const start = () => {
      const phases = MEDITATIONS[key][1];
      const orb = h('div', { class: 'orb' }, 'Prepárate');
      const left = h('div', { class: 'muted center' });
      root.replaceChildren(h('div', { class: 'breath' }, orb), left,
        h('button', { class: 'btn ghost block', onclick: () => finish(false) }, 'Terminar ya'));
      const end = Date.now() + mins * 60000;
      let i = 0;
      ambientStart().then((f) => { stopAmbient = f; if (stop || !orb.isConnected) f(); });
      const step = () => {
        if (!orb.isConnected) { stop = true; stopAmbient(); return; } // el diálogo se cerró con Escape o tocando fuera
        if (stop) return;
        if (Date.now() >= end) return finish(true);
        const [label, secs, scale] = phases[i % phases.length];
        orb.style.transitionDuration = `${secs}s`;
        orb.style.transform = `scale(${scale})`;
        orb.textContent = tr(label);
        const rem = Math.max(0, Math.round((end - Date.now()) / 1000));
        left.textContent = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
        i++;
        timer = setTimeout(step, secs * 1000);
      };
      orb.style.transform = 'scale(.55)';
      timer = setTimeout(step, 1200);
    };
    pick();
    return root;
  });
}

// ---------- Cartas ----------
async function viewCards(view) {
  const [cards, rewards] = await Promise.all([api('/api/cards'), api('/api/rewards')]);
  const owned = cards.filter((c) => c.owned).length;
  const shop = h('div', { class: 'gap' },
    h('div', { class: 'card hero row' }, h('span', { style: 'font-size:40px;color:var(--gold)' }, icon('coins', 40)),
      h('div', { class: 'grow' }, h('div', { class: 'big' }, S.coins), h('div', { class: 'small' }, '1 moneda cada 5 XP, más misiones y jefes'))),
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Tienda de recompensas'), h('button', { class: 'btn ghost small', onclick: () => rewardSheet() }, '+ Añadir')),
    rewards.length ? rewards.map((r) => h('div', { class: 'reward' },
      h('div', { class: 'ico' }, r.icon),
      h('div', { class: 'grow' }, h('div', { class: 't' }, r.title), h('div', { class: 'muted small' }, r.bought ? `Canjeada ${r.bought} ${r.bought === 1 ? 'vez' : 'veces'}` : 'Aún sin canjear')),
      h('button', { class: 'iconbtn', title: 'Quitar', 'aria-label': `Quitar «${r.title}»`, onclick: run(async () => { if (!confirm(tr('¿Quitar esta recompensa?'))) return; await api(`/api/rewards/${r.id}`, 'DELETE', {}); renderApp(); }) }, icon('x', 18)),
      h('button', {
        class: 'btn small', disabled: S.coins < r.price,
        onclick: run(async () => { apply(await api(`/api/rewards/${r.id}/buy`, 'POST', { date: S.date })); toast(`${r.icon} ¡Disfruta: ${r.title}!`); }),
      }, icon('coins', 16), r.price)))
      : h('div', { class: 'card center muted' }, 'Crea recompensas reales (un capricho, un rato de ocio) y gana monedas para canjearlas.'));
  const pack = h('div', { class: 'card pack gap' },
    h('div', { class: 'row' }, h('span', { style: 'font-size:36px;color:var(--ice)' }, gi('card-draw')), h('div', { class: 'grow' }, h('b', null, `${S.packsAvailable} pack${S.packsAvailable === 1 ? '' : 's'} disponible${S.packsAvailable === 1 ? '' : 's'}`),
      h('div', { class: 'small' }, 'Ganas un pack al subir de nivel y con cada logro'))),
    h('button', { class: 'btn ghost block', disabled: !S.packsAvailable, onclick: run(openPack) }, 'Abrir pack'));
  view.replaceChildren(title2('Tu', 'tesoro'), shop, h('h3', null, 'Cartas'), pack, h('div', { class: 'muted small' }, `Colección: ${owned}/${cards.length}`),
    h('div', { class: 'grid2' }, cards.map((c) => c.owned ? cardEl(c) : h('div', { class: 'tcard locked', style: `--rc:${RARITY[c.rarity][1]}` }, '?'))));
}
function rewardSheet() {
  const f = { title: '', icon: '🎁', price: 100 };
  sheet((close) => {
    const root = h('div', { class: 'gap' });
    const draw = () => {
      const err = h('div', { class: 'err' });
      root.replaceChildren(h('h2', null, 'Nueva recompensa'),
        h('div', { class: 'muted small' }, 'Ideas rápidas'),
        h('div', { class: 'seg' }, REWARD_IDEAS.map(([icon, title, price]) => h('button', { onclick: () => { Object.assign(f, { icon, title: tr(title), price }); draw(); } }, `${icon} ${title}`))),
        h('label', { class: 'f' }, 'Nombre', h('input', { type: 'text', maxlength: 60, value: f.title, oninput: (e) => { f.title = e.target.value; } })),
        h('div', { class: 'row' },
          h('label', { class: 'f', style: 'width:84px' }, 'Icono', h('input', { type: 'text', maxlength: 4, value: f.icon, oninput: (e) => { f.icon = e.target.value; } })),
          h('label', { class: 'f grow' }, 'Precio en monedas', h('input', { type: 'text', inputmode: 'numeric', value: f.price, oninput: (e) => { f.price = Number(e.target.value); } }))),
        err,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'),
          h('button', { class: 'btn grow', onclick: async () => {
            try { await api('/api/rewards', 'POST', f); close(); renderApp(); } catch (e) { err.textContent = tr(e.message); }
          } }, 'Guardar')));
    };
    draw();
    return root;
  });
}

const cardEl = (c, cls = '') => h('div', { class: `tcard ${c.rarity} ${cls}`, style: `--rc:${RARITY[c.rarity][1]}` },
  h('div', { class: 'r' }, RARITY[c.rarity][0], c.isNew ? ' · NUEVA' : ''), h('div', { class: 'q' }, `“${c.content}”`), h('div', { class: 'a' }, c.author));
async function openPack() {
  const r = await api('/api/packs/open', 'POST', { date: S.date });
  S = r.state;
  await packOpening(r.cards, (c) => cardEl(c, 'reveal'));
  announce(r.newAchievements);
  renderApp();
}

// ---------- Temporada ----------
async function viewSeason(view) {
  const [season, ins, heat] = await Promise.all([api(`/api/season?date=${S.date}`), api(`/api/insights?date=${S.date}`), api(`/api/heatmap?date=${S.date}`)]);
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(localeTag(), { month: 'long' }).format(new Date(2026, i, 15)));
  const [yy, mm] = season.key.split('-').map(Number);
  const wdNames = dayLetters();
  view.replaceChildren(title2('Sube mientras', 'los demás duermen'),
    h('div', { class: 'card hero' }, h('div', { class: 'kicker' }, `Temporada de ${months[mm - 1]} ${yy}`), h('div', { class: 'big', style: 'margin-top:8px' }, `${season.daysLeft} días`), h('div', { class: 'small muted' }, 'para el final · el ranking se reinicia cada mes')),
    h('h3', null, 'Clasificación'),
    season.ranking.map((r) => h('div', { class: 'rank' + (r.you ? ' you' : '') }, h('b', null, String(r.pos).padStart(2, '0')), h('span', null, r.username + (r.you ? ' (tú)' : '')), h('b', null, `${r.xp} XP`))),
    h('h3', null, 'Maestría'),
    h('div', { class: 'card' }, S.mastery.map((m) => {
      const d = domainInfo(m.domain);
      return h('div', { class: 'srow', style: `--c:${d.color}` }, h('span', { style: 'font-size:24px;color:' + d.color, 'aria-hidden': 'true' }, gi(d.icon)),
        h('div', null, h('div', { class: 'lab' }, d.name), h('div', { class: 'muted small' }, `${m.tier} · nivel ${m.level}`),
          bar(((m.xp - m.floor) / (m.next - m.floor)) * 100, `Maestría en ${d.name}`)),
        h('div', { class: 'num' }, m.xp, h('small', null, 'XP')));
    })),
    h('h3', null, 'Calendario'),
    heatmapCard(heat),
    h('h3', null, 'Últimos 30 días'),
    h('div', { class: 'card gap' },
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', null, `${ins.rate}%`), 'cumplido'), h('div', { class: 'stat' }, h('b', null, ins.completed), 'hechos'), h('div', { class: 'stat' }, h('b', null, ins.perfectDays), 'días perfectos')),
      h('div', { class: 'muted small' }, 'Cumplimiento por día de la semana'),
      h('div', { class: 'insbars' }, [1, 2, 3, 4, 5, 6, 0].map((d) => { const w = ins.byWeekday[d]; return h('div', null, w.rate == null ? '–' : `${w.rate}`, h('i', { style: `height:${w.rate ?? 0}%` }), wdNames[d]); }))));
}

function heatmapCard(heat) {
  const cols = Math.ceil(heat.days.length / 7);
  const level = (d) => (!d.due ? 'n' : d.done === 0 ? '0' : d.done >= d.due ? '4' : d.done / d.due < 0.5 ? '1' : '2');
  const perfect = heat.days.filter((d) => d.due && d.done >= d.due).length;
  return h('div', { class: 'card gap' },
    h('div', { class: 'heat', role: 'img', 'aria-label': `Calendario de las últimas ${cols} semanas: ${perfect} días perfectos`, style: `grid-template-columns:repeat(${cols},1fr)` }, heat.days.map((d) =>
      h('i', { class: `hm l${level(d)}`, title: `${d.date}: ${d.done}/${d.due}` }))),
    h('div', { class: 'row small muted', style: 'justify-content:space-between;flex-wrap:wrap' },
      h('span', null, `${perfect} días perfectos en ${cols} semanas`),
      h('span', { class: 'legend' }, 'menos', ['0', '1', '2', '4'].map((l) => h('i', { class: `hm l${l}` })), 'más')));
}

// ---------- Perfil ----------
function prefsPanel() {
  const zoom = prefs.get('zoom', '1');
  const reduced = prefs.get('motion', 'full') === 'reduce';
  return h('div', { class: 'card gap' }, h('b', null, 'Accesibilidad'),
    h('div', { class: 'muted small' }, 'Tamaño del texto'),
    h('div', { class: 'seg' }, [['1', 'Normal'], ['1.12', 'Grande'], ['1.25', 'Muy grande']].map(([v, t]) =>
      h('button', { class: zoom === v ? 'on' : '', 'aria-pressed': zoom === v ? 'true' : 'false', onclick: () => { prefs.set('zoom', v); applyPrefs(); renderApp(); } }, t))),
    h('button', { class: 'btn ghost block', 'aria-pressed': reduced ? 'true' : 'false', onclick: () => { prefs.set('motion', reduced ? 'full' : 'reduce'); applyPrefs(); renderApp(); } },
      'Reducir animaciones: ' + (reduced ? 'sí' : 'no')));
}

function profileCard() {
  const p = ME.profile || {};
  if (!p.goal && !(p.values || []).length) return null;
  return h('div', { class: 'card hero gap' }, h('div', { class: 'kicker' }, 'Tu reinicio'),
    p.goal ? h('div', { style: 'font:400 26px/1.1 var(--display);text-transform:uppercase' }, p.goal) : null,
    (p.values || []).length ? h('div', { class: 'tags' }, p.values.map((v) => h('span', { class: 'tag blue' }, v))) : null);
}

function viewMe(view) {
  const pushBtn = h('button', { class: 'btn ghost block', onclick: run(enablePush) }, 'Activar recordatorios en este dispositivo');
  view.replaceChildren(title2('Tu perfil', ME.username),
    profileCard(),
    h('h3', null, 'Logros'),
    h('div', { class: 'grid2', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, S.achievements.map((a) => h('div', { class: 'ach' + (a.unlocked ? '' : ' lock'), title: a.desc }, h('div', { class: 'i', 'aria-hidden': 'true' }, gi(a.icon)), h('b', null, a.title), h('div', { class: 'd' }, a.desc), a.unlocked ? null : h('span', { class: 'sr-only' }, ' (bloqueado)')))),
    h('h3', null, 'Ajustes'),
    h('button', { class: 'btn ghost block', 'aria-pressed': sound.on ? 'true' : 'false', onclick: () => { sound.set(!sound.on); if (sound.on) sfx.done(); renderApp(); } }, `Sonidos: ${sound.on ? 'activados' : 'desactivados'}`),
    pushBtn,
    langPanel(),
    prefsPanel(),
    h('button', { class: 'btn ghost block', onclick: run(async () => { await api('/api/push/test', 'POST', {}).then((r) => toast(r.sent ? 'Enviada' : 'Sin dispositivos suscritos')); }) }, 'Enviar notificación de prueba'),
    h('button', { class: 'btn danger block', onclick: run(async () => { if (!confirm(tr('¿Reiniciar el contador de 66 días desde hoy?'))) return; S = await api('/api/program/restart', 'POST', { date: S.date }); toast('Nuevo día 1'); renderApp(); }) }, 'Reiniciar programa de 66 días'),
    h('h3', null, 'Salud y ejercicio'),
    healthPanel(),
    h('h3', null, 'Cuenta'),
    h('button', { class: 'btn ghost block', onclick: passwordSheet }, 'Cambiar contraseña'),
    h('button', { class: 'btn ghost block', onclick: run(downloadData) }, 'Descargar mis datos'),
    h('button', { class: 'btn danger block', onclick: deleteSheet }, 'Eliminar mi cuenta'),
    ME.admin ? [h('h3', null, 'Administración'), adminCard()] : null,
    h('button', { class: 'btn ghost block', onclick: run(async () => { await api('/api/logout', 'POST', {}); cache.clear(); ME = null; renderAuth(); }) }, 'Cerrar sesión'),
    h('p', { class: 'credits' }, 'Iconos de logros y misiones: ', h('a', { href: 'https://game-icons.net', target: '_blank', rel: 'noopener noreferrer' }, 'game-icons.net'), ' (CC BY 3.0). Sonidos de Kenney y OpenGameArt (CC0).'));
}

// ---------- salud: móvil y reloj ----------
function healthPanel() {
  const box = h('div', { class: 'card gap' }, h('div', { class: 'muted small' }, 'Cargando…'));
  const delWorkout = (id) => run(async () => {
    const r = await api('/api/health/workouts/' + id + '?date=' + S.date, 'DELETE', {});
    S = r.state;
    renderApp();
  });
  let chart = 'exercise';
  const CHARTS = [['exercise', 'Ejercicio', 'min'], ['steps', 'Pasos', 'pasos'], ['sleep', 'Sueño', 'h'], ['resting', 'Pulso en reposo', 'lpm'], ['hrv', 'Variabilidad', 'ms']];
  const draw = (d, st) => {
    const vals = d.week.map((x) => x[chart]);
    const max = Math.max(1, ...vals.filter((v) => v != null));
    const unit = CHARTS.find((c) => c[0] === chart)[2];
    box.replaceChildren(
      h('p', { class: 'muted small' }, st.token
        ? tr('Conectado · último envío: ') + (st.token.last_used ? new Date(st.token.last_used).toLocaleString(localeTag()) : tr('todavía ninguno'))
        : 'Aún no hay ningún móvil o reloj conectado. Puedes añadir entrenamientos a mano o conectar Zepp.'),
      h('div', { class: 'seg' }, CHARTS.map(([k, t]) => h('button', { class: chart === k ? 'on' : '', onclick: () => { chart = k; draw(d, st); } }, t))),
      h('div', { class: 'insbars' }, d.week.map((x) => h('div', null, x[chart] ? String(x[chart]) : '–',
        h('i', { style: 'height:' + Math.round(((x[chart] || 0) / max) * 100) + '%' }), dayLetters()[new Date(x.date + 'T12:00:00').getDay()]))),
      h('div', { class: 'muted small' }, 'Últimos 7 días (' + unit + ')'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small grow', onclick: () => healthConnectSheet(() => load()) }, st.token ? 'Ver conexión' : 'Conectar móvil o reloj'),
        h('button', { class: 'btn ghost small grow', onclick: workoutSheet }, 'Añadir entrenamiento')),
      d.workouts.length ? [h('div', { class: 'muted small' }, 'Entrenamientos recientes'),
        d.workouts.slice(0, 6).map((w) => h('div', { class: 'row' },
          h('span', { class: 'grow' }, w.type, h('span', { class: 'muted small' }, ' · ' + w.minutes + ' min' + (w.distance_km ? ' · ' + w.distance_km + ' km' : '') + (w.avg_hr ? ' · ' + w.avg_hr + ' lpm' : '') + ' · ' + w.date.slice(5))),
          w.source === 'manual' ? h('button', { class: 'iconbtn', 'aria-label': 'Borrar entrenamiento ' + w.type, onclick: delWorkout(w.id) }, icon('x', 16)) : null))] : null);
  };
  const load = () => Promise.all([api('/api/health/summary?date=' + S.date), api('/api/health/status')]).then(([d, st]) => draw(d, st))
    .catch((e) => { if (e.message !== 'auth') box.replaceChildren(h('div', { class: 'muted small' }, e.offline ? 'Necesita conexión' : 'No se pudo cargar')); });
  load();
  return box;
}

function workoutSheet() {
  sheet((close) => {
    const f = { type: tr('Caminar'), minutes: 30, distance_km: '' };
    const err = h('div', { class: 'err', role: 'alert' });
    const save = async () => {
      err.textContent = '';
      try {
        const r = await api('/api/health/workouts', 'POST', { date: S.date, type: f.type, minutes: Number(f.minutes), distance_km: f.distance_km === '' ? 0 : Number(String(f.distance_km).replace(',', '.')) });
        S = r.state;
        close();
        renderApp();
        toast('Entrenamiento guardado');
      } catch (e) { err.textContent = tr(e.offline ? 'Sin conexión: esto necesita internet' : e.message); }
    };
    return h('div', { class: 'gap' }, h('h2', null, 'Añadir entrenamiento'),
      h('div', { class: 'seg' }, ['Caminar', 'Correr', 'Bici', 'Fuerza', 'Natación', 'Yoga'].map((t) => h('button', { onclick: () => { f.type = tr(t); typeInput.value = tr(t); } }, t))),
      h('label', { class: 'f' }, 'Tipo', typeInput = h('input', { type: 'text', maxlength: 40, value: f.type, oninput: (e) => { f.type = e.target.value; } })),
      h('div', { class: 'row' },
        h('label', { class: 'f grow' }, 'Minutos', h('input', { type: 'text', inputmode: 'numeric', value: f.minutes, oninput: (e) => { f.minutes = e.target.value; } })),
        h('label', { class: 'f grow' }, 'Km (opcional)', h('input', { type: 'text', inputmode: 'decimal', value: f.distance_km, oninput: (e) => { f.distance_km = e.target.value; } }))),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'), h('button', { class: 'btn grow', onclick: save }, 'Guardar')));
  });
  var typeInput; // referencia al campo "Tipo" para los atajos
}

function healthConnectSheet(done) {
  sheet((close) => {
    const root = h('div', { class: 'gap' });
    const url = location.origin + '/api/health/ingest';
    const sample = JSON.stringify({ daily: [{ date: S.date, steps: 8000, exercise_minutes: 35, resting_hr: 58, sleep_hours: 7.4, spo2: 97 }], workouts: [{ id: 'unico-por-entreno', type: 'Running', start: S.date + 'T07:30:00+01:00', minutes: 40, distance_km: 5.2, avg_hr: 141, max_hr: 172 }] }, null, 1);
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch { toast(t); } };
    const draw = (token, status) => root.replaceChildren(
      h('h2', null, 'Conectar móvil o reloj'),
      h('p', { class: 'muted small' }, 'Zepp no tiene una conexión directa con webs, pero guarda tus datos en Apple Health (iPhone) o Health Connect (Android). Una app gratuita de tu móvil los lee de ahí y los envía a tu servidor con una clave personal. Con ellos, Reset ve tus pasos y entrenamientos y completa solos los hábitos que lo pidan.'),
      h('div', { class: 'card gap' }, h('b', null, '1 · En la app de tu reloj'),
        h('p', { class: 'small' }, 'Zepp: Perfil → Añadir cuentas → Apple Health (iPhone) o Health Connect (Android). Samsung: Samsung Health → Ajustes → Health Connect (Android). Activa todos los datos: pasos, entrenamientos, pulso, sueño y oxígeno.')),
      h('div', { class: 'card gap' }, h('b', null, '2 · Tu clave de conexión'),
        token ? [h('div', { class: 'code' }, token), h('div', { class: 'row' }, h('button', { class: 'btn small grow', onclick: () => copy(token) }, 'Copiar clave'), h('button', { class: 'btn ghost small grow', onclick: () => copy(url) }, 'Copiar dirección')),
          h('p', { class: 'muted small' }, 'Cópiala ahora: no se vuelve a mostrar. Si la pierdes, crea otra.')]
          : [h('p', { class: 'small muted' }, status?.token ? 'Ya hay una clave creada. Crear otra anula la anterior.' : 'Aún no has creado ninguna.'),
            h('button', { class: 'btn block', onclick: run(async () => { const r = await api('/api/health/token', 'POST', {}); draw(r.token, { token: { created: new Date().toISOString() } }); if (done) done(); }) }, status?.token ? 'Crear una clave nueva' : 'Crear clave de conexión')],
        h('div', { class: 'small muted' }, 'Dirección de envío: ' + url)),
      h('div', { class: 'card gap' }, h('b', null, '3 · En una app puente del móvil'),
        h('p', { class: 'small' }, 'iPhone: la app Health Auto Export. Crea una automatización de tipo API REST con esa dirección, formato JSON y la cabecera Authorization con el valor Bearer seguido de tu clave. Elige pasos, tiempo de ejercicio, distancia, energía activa, entrenamientos, pulso, pulso en reposo, variabilidad, oxígeno y sueño. Sus automatizaciones pueden requerir suscripción.'),
        h('p', { class: 'small' }, 'Android: una app que envíe los datos de Health Connect a un webhook propio (por ejemplo Life Dashboard Companion o HC Webhook), con la misma dirección y cabecera. Los menús cambian según la app; si no admite esa cabecera, dímelo y lo adapto.'),
        h('p', { class: 'small muted' }, 'Cualquier otra app puede enviar este formato sencillo:'),
        h('div', { class: 'code' }, sample)),
      status?.token && !token ? h('button', { class: 'btn danger block', onclick: run(async () => { if (!confirm(tr('¿Revocar la clave? La app puente dejará de funcionar hasta que pongas una nueva.'))) return; await api('/api/health/token', 'DELETE', {}); if (done) done(); close(); }) }, 'Revocar clave') : null,
      h('button', { class: 'btn ghost block', onclick: close }, 'Cerrar'));
    api('/api/health/status').then((st) => draw(null, st)).catch(() => draw(null, null));
    return root;
  });
}

// ---------- cuenta ----------
function passwordSheet() {
  sheet((close) => {
    const err = h('div', { class: 'err', role: 'alert' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const save = async () => {
      err.textContent = '';
      if (n1.value !== n2.value) { err.textContent = tr('Las contraseñas nuevas no coinciden'); return; }
      try {
        await api('/api/account/password', 'POST', { current: cur.value, next: n1.value });
        close();
        toast('Contraseña cambiada. Se cerraron tus otras sesiones.');
      } catch (e) { err.textContent = tr(e.message); }
    };
    return h('div', { class: 'gap' }, h('h2', null, 'Cambiar contraseña'),
      h('label', { class: 'f' }, 'Contraseña actual', cur),
      h('label', { class: 'f' }, 'Nueva contraseña', n1, h('span', { class: 'small' }, 'Mínimo 8 caracteres')),
      h('label', { class: 'f' }, 'Repite la nueva', n2), err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'), h('button', { class: 'btn grow', onclick: save }, 'Guardar')));
  });
}

async function downloadData() {
  const res = await fetch('/api/account/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('No se pudieron descargar tus datos');
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: 'reset-datos-' + ME.username + '.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Datos descargados');
}

function deleteSheet() {
  sheet((close) => {
    const err = h('div', { class: 'err', role: 'alert' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password' });
    const go = async () => {
      err.textContent = '';
      try {
        await api('/api/account/delete', 'POST', { password: pass.value });
        close();
        cache.clear(); queue.set([]);
        ME = null; S = null;
        renderAuth();
      } catch (e) { err.textContent = tr(e.message); }
    };
    return h('div', { class: 'gap' }, h('h2', null, 'Eliminar mi cuenta'),
      h('p', null, 'Se borrarán para siempre tus hábitos, tu progreso, tus cartas y tus recompensas. No se puede deshacer.'),
      h('p', { class: 'muted small' }, 'Si quieres conservar algo, descarga antes tus datos.'),
      h('label', { class: 'f' }, 'Escribe tu contraseña para confirmar', pass), err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'), h('button', { class: 'btn danger grow', onclick: go }, 'Eliminar para siempre')));
  });
}

// Invitaciones de un solo uso: solo las ve y crea quien administra la app (la primera persona registrada)
function adminCard() {
  const box = h('div', { class: 'card gap' });
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Código copiado'); } catch { toast(text); } };
  const draw = (d, fresh) => {
    box.replaceChildren(
      h('b', null, 'Invitaciones'),
      h('p', { class: 'muted small' }, 'Cada código sirve una sola vez y caduca en ' + d.days + ' días. Pásaselo a quien quieras invitar: lo escribe al crear su cuenta.'),
      fresh ? h('div', { class: 'card', style: 'border-color:var(--cyan);text-align:center' }, h('div', { class: 'kicker' }, 'Nueva invitación'), h('div', { style: 'font:400 34px/1.1 var(--display);letter-spacing:.08em' }, fresh),
        h('button', { class: 'btn small', style: 'margin-top:10px', onclick: () => copy(fresh) }, 'Copiar')) : null,
      h('button', { class: 'btn block', onclick: run(async () => { const r = await api('/api/admin/invites', 'POST', {}); draw({ ...d, invites: r.invites }, r.code); }) }, 'Crear invitación'),
      d.invites.length ? d.invites.map((i) => h('div', { class: 'row' },
        h('span', { class: 'grow', style: 'font-weight:700;letter-spacing:.08em' }, i.code, h('span', { class: 'muted small', style: 'font-weight:500;letter-spacing:0' }, ' · hasta el ' + new Date(i.expires).toLocaleDateString(localeTag()))),
        h('button', { class: 'iconbtn', 'aria-label': 'Copiar ' + i.code, onclick: () => copy(i.code) }, icon('check', 16)),
        h('button', { class: 'iconbtn', 'aria-label': 'Anular ' + i.code, onclick: run(async () => { const r = await api('/api/admin/invites/' + i.code, 'DELETE', {}); draw({ ...d, invites: r.invites }); }) }, icon('x', 16)))) : null,
      h('div', { class: 'muted small' }, 'Personas en la app'),
      h('div', { class: 'tags' }, d.members.map((m) => h('span', { class: 'tag blue' }, m.username))));
  };
  box.append(h('div', { class: 'muted small' }, 'Cargando…'));
  api('/api/admin/invites').then((d) => draw(d)).catch(() => box.replaceChildren(h('div', { class: 'muted small' }, 'No se pudo cargar')));
  return box;
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no admite notificaciones push (en iPhone, instala la app en la pantalla de inicio)');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Permiso de notificaciones denegado');
  const reg = await navigator.serviceWorker.ready;
  const raw = atob(vapidKey.replace(/-/g, '+').replace(/_/g, '/'));
  const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', 'POST', { subscription: sub.toJSON() });
  toast('Recordatorios activados');
}

// ---------- arranque ----------
function renderOffline() {
  $app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'logo' }, 'Re', h('b', null, 'set')),
    h('p', { class: 'muted' }, 'No hay conexión con el servidor y aún no hay datos guardados en este dispositivo. Abre la app una vez con conexión y después podrás usarla sin ella.'),
    h('button', { class: 'btn block', onclick: boot }, 'Reintentar')));
}

async function boot() {
  await loadLocale();
  try {
    const me = await api(`/api/me?tz=${encodeURIComponent(TZ)}`);
    ME = { ...me.user, profile: me.profile, admin: me.admin }; vapidKey = me.vapidPublicKey;
    queue.set(queue.all().filter((a) => a.u === ME.username)); // los cambios pendientes de otra persona no se mezclan
    T = await api('/api/templates');
    if (queue.size) await flush({ render: false });
    S = await api(`/api/state?date=${today()}`);
    if (S.date !== today()) rollState(S, today()); // copia local de otro día (abierta sin conexión al día siguiente)
    renderApp();
    if (queue.size) scheduleFlush(3000);
  } catch (e) {
    if (e.message === 'auth') return;
    if (e.offline) renderOffline(); else renderAuth();
  }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Al volver a la app (o cada 5 minutos con ella abierta) se refresca el estado: así aparecen solos los datos de salud
// que el móvil haya enviado entre tanto. No se refresca si hay cambios pendientes o un diálogo abierto.
let lastSync = Date.now();
async function refreshState() {
  if (!ME || !S || flushing || queue.size || document.querySelector('.modal, .fxo')) return;
  try { S = await api('/api/state?date=' + today()); lastSync = Date.now(); renderApp(); } catch { /* se reintentará */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !ME) return;
  if (S && S.date !== today()) boot();
  else if (queue.size) scheduleFlush(300);
  else if (Date.now() - lastSync > 60000) refreshState();
});
setInterval(() => { if (!document.hidden && Date.now() - lastSync > 300000) refreshState(); }, 60000);
addEventListener('online', () => { netDown = false; updateSyncBar(); scheduleFlush(300); });
addEventListener('offline', () => { netDown = true; updateSyncBar(); });
setInterval(() => { if (ME && queue.size && !flushing) flush(); }, 20000);
boot();
