// Modo sin conexión: copia local de los datos, cola de cambios pendientes y funciones que aplican esos cambios
// en el dispositivo al instante. El servidor sigue siendo la fuente de verdad: al volver la conexión se reenvía
// la cola y se sustituye el estado local por el real, así que cualquier pequeña diferencia de cálculo (XP, racha)
// se corrige sola.
const PFX = 'reset.';
const XP = { 1: 10, 2: 20, 3: 35 };
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 60)) + 1;
// el mediodía evita errores por cambios de hora de verano
const addDays = (d, n) => new Date(new Date(d + 'T12:00:00').getTime() + n * 86400000).toLocaleDateString('en-CA');
const weekday = (d) => new Date(d + 'T12:00:00').getDay();

const read = (k, fallback) => { try { const v = localStorage.getItem(PFX + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(PFX + k, JSON.stringify(v)); return true; } catch { return false; } };

// Copia de las últimas respuestas del servidor (por ruta, sin parámetros)
export const cache = {
  get: (path) => read('c:' + path, null),
  set: (path, data) => write('c:' + path, data),
  clear() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PFX + 'c:') || k === PFX + 'cids').forEach((k) => localStorage.removeItem(k));
    } catch { /* sin almacenamiento */ }
  },
};

// Cambios hechos sin conexión, en orden, pendientes de enviar
export const queue = {
  all: () => read('q', []),
  set: (q) => write('q', q),
  push(a) { const q = read('q', []); q.push(a); write('q', q); },
  shift() { const q = read('q', []); const a = q.shift(); write('q', q); return a; },
  get size() { return read('q', []).length; },
};

// Hábitos creados sin conexión: id elegido por el dispositivo -> id real en el servidor
export const cids = {
  get: () => read('cids', {}),
  set(cid, id) { const m = read('cids', {}); m[cid] = id; write('cids', m); },
};
export const newCid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);

// ---------- cambios en el estado local ----------
function addXp(st, delta) {
  const old = st.xp;
  st.xp = Math.max(0, st.xp + delta);
  const l = levelOf(st.xp);
  st.level = l;
  st.levelFloor = 60 * (l - 1) ** 2;
  st.levelNext = 60 * l ** 2;
  st.coins = Math.max(0, st.coins + Math.floor(st.xp / 5) - Math.floor(old / 5));
}
function refreshToday(st) {
  const w = st.week?.at(-1);
  if (!w) return;
  const due = st.habits.filter((h) => h.due);
  w.due = due.length;
  w.done = due.filter((h) => h.done).length;
}
function bossHit(st, xp) {
  if (!st.boss) return;
  st.boss.damage = Math.max(0, st.boss.damage + xp);
  st.boss.defeated = st.boss.damage >= st.boss.hp;
}
const habitXp = (st, h) => Math.round(XP[h.difficulty] * (1 + (st.bonusPct || 0) / 100));
const maskOf = (days) => days.reduce((m, d) => m | (1 << d), 0);

export function localToggle(st, id, date) {
  const h = st.habits.find((z) => z.id === id);
  if (!h || date !== st.date) return;
  const xp = habitXp(st, h);
  if (h.skipped) { h.skipped = false; h.done = true; addXp(st, xp); bossHit(st, xp); st.skipsLeft = Math.min(st.skipsMax, st.skipsLeft + 1); }
  else if (h.done) { h.done = false; addXp(st, -xp); bossHit(st, -xp); }
  else { h.done = true; addXp(st, xp); bossHit(st, xp); }
  refreshToday(st);
}

// devuelve 'no-skips' si ya no quedan saltos esta semana
export function localSkip(st, id, date) {
  const h = st.habits.find((z) => z.id === id);
  if (!h || date !== st.date) return null;
  if (!h.skipped) {
    if (st.skipsLeft < 1) return 'no-skips';
    if (h.done) { const xp = habitXp(st, h); addXp(st, -xp); bossHit(st, -xp); }
    h.skipped = true; h.done = true; st.skipsLeft -= 1;
  } else {
    h.skipped = false; h.done = false; st.skipsLeft += 1;
  }
  refreshToday(st);
  return null;
}

export function localMeditation(st) {
  if (st.medToday >= st.medMax) return false;
  st.medToday += 1;
  addXp(st, 15);
  return true;
}

export function localLesson(st, lessons, id) {
  const l = lessons.find((z) => z.id === id);
  if (!l || l.done) return false;
  l.done = true;
  addXp(st, 25);
  return true;
}

export function localCreate(st, body, cid) {
  st.habits.push({
    id: 'c:' + cid, cid, title: body.title.trim(), icon: body.icon || '✅', kind: body.kind === 'quit' ? 'quit' : 'build',
    domain: body.domain, difficulty: body.difficulty, days: maskOf(body.days), reminder: body.reminder || null,
    auto: body.auto || null, streak: 0, due: ((maskOf(body.days) >> weekday(st.date)) & 1) === 1, done: false, skipped: false,
  });
  refreshToday(st);
}

export function localUpdate(st, id, body) {
  const h = st.habits.find((z) => z.id === id);
  if (!h) return;
  Object.assign(h, {
    title: body.title.trim(), icon: body.icon || h.icon, kind: body.kind === 'quit' ? 'quit' : 'build', domain: body.domain,
    difficulty: body.difficulty, days: maskOf(body.days), reminder: body.reminder || null, auto: body.auto || null,
  });
  h.due = ((h.days >> weekday(st.date)) & 1) === 1;
  refreshToday(st);
}

export function localDelete(st, id) {
  st.habits = st.habits.filter((z) => z.id !== id);
  refreshToday(st);
}

// Si la copia local es de otro día (la app se abrió sin conexión al día siguiente), la adapta a hoy
export function rollState(st, date) {
  if (st.date === date) return;
  const gap = Math.max(0, Math.round((new Date(date + 'T12:00:00') - new Date(st.date + 'T12:00:00')) / 86400000));
  const known = new Map((st.week || []).map((w) => [w.date, w]));
  st.date = date;
  for (const h of st.habits) { h.due = ((h.days >> weekday(date)) & 1) === 1; h.done = false; h.skipped = false; }
  st.week = Array.from({ length: 7 }, (_, i) => { const d = addDays(date, i - 6); return known.get(d) || { date: d, due: 0, done: 0 }; });
  refreshToday(st);
  st.medToday = 0;
  st.quests = [];
  st.programDay += gap;
}
