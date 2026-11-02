import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import webpush from 'web-push';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const INVITE_CODE = process.env.INVITE_CODE || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- base de datos ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'UTC',
  program_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  onboarded INTEGER NOT NULL DEFAULT 0,
  profile TEXT NOT NULL DEFAULT '{}',
  packs_opened INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '✅',
  domain TEXT NOT NULL DEFAULT 'discipline',
  difficulty INTEGER NOT NULL DEFAULT 1,
  days INTEGER NOT NULL DEFAULT 127,
  reminder TEXT,
  created TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  date TEXT NOT NULL,
  xp INTEGER NOT NULL,
  UNIQUE (user_id, kind, ref, date)
);
CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS cards_owned (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎁',
  price INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_log (
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (habit_id, date)
);
`);

for (const sql of [
  "ALTER TABLE habits ADD COLUMN kind TEXT NOT NULL DEFAULT 'build'",
  'ALTER TABLE users ADD COLUMN bonus_packs INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE habits ADD COLUMN cid TEXT',
  'ALTER TABLE habits ADD COLUMN auto_metric TEXT',
  'ALTER TABLE habits ADD COLUMN auto_min REAL',
  "ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'es'",
]) {
  try { db.exec(sql); } catch { /* la columna ya existe */ }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS habits_cid ON habits(user_id, cid) WHERE cid IS NOT NULL');

db.exec(`
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL,
  used_by INTEGER
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS health_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  last_used TEXT
);
CREATE TABLE IF NOT EXISTS health_metrics (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  ts TEXT NOT NULL,
  date TEXT NOT NULL,
  qty REAL NOT NULL,
  PRIMARY KEY (user_id, metric, ts)
);
CREATE INDEX IF NOT EXISTS health_metrics_date ON health_metrics (user_id, date);
CREATE TABLE IF NOT EXISTS workouts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  start TEXT,
  minutes REAL NOT NULL,
  distance_km REAL NOT NULL DEFAULT 0,
  kcal REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'import',
  PRIMARY KEY (user_id, id)
);
`);

for (const sql of ['ALTER TABLE workouts ADD COLUMN avg_hr REAL', 'ALTER TABLE workouts ADD COLUMN max_hr REAL']) {
  try { db.exec(sql); } catch { /* la columna ya existe */ }
}

// ---------- claves VAPID para push ----------
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
try {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} catch {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', vapid.publicKey, vapid.privateKey);

// ---------- contenido ----------
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', f), 'utf8'));
const lessons = readJson('lessons.json');
const cards = readJson('cards.json');
const templates = readJson('templates.json');
const DOMAINS = Object.keys(templates);

// ---------- idiomas ----------
// El texto de origen está en español; public/locales/<código>.json trae las traducciones (las mismas que usa el cliente)
const LANG_CODES = ['es', 'en'];
const dicts = {};
for (const code of LANG_CODES.filter((c) => c !== 'es')) {
  try { dicts[code] = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'locales', code + '.json'), 'utf8')).strings || {}; } catch { dicts[code] = {}; }
}
const tl = (lang, s) => dicts[lang]?.[s] ?? s;
const reqLang = (req) => { const l = String(req.headers['x-lang'] || '').slice(0, 2).toLowerCase(); return LANG_CODES.includes(l) ? l : null; };
const RARITY_WEIGHT = { common: 70, rare: 22, epic: 7, legendary: 1 };
const masteryLevel = (xp) => Math.floor(Math.sqrt(xp / 40)) + 1;
const MASTERY_TIERS = [[15, 'Maestro'], [10, 'Experto'], [6, 'Adepto'], [3, 'Aprendiz'], [1, 'Novato']];
const weekStart = (date) => addDays(date, -((weekday(date) + 6) % 7));

// ---------- utilidades ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const addDays = (date, n) => isoDate(new Date(date + 'T00:00:00Z').getTime() + n * 86400000);
const diffDays = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const XP_BY_DIFFICULTY = { 1: 10, 2: 20, 3: 35 };
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 60)) + 1;
const levelFloor = (lvl) => 60 * (lvl - 1) ** 2;

function validDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return false;
  const now = Date.now();
  return date <= isoDate(now + 14 * 3600000) && date >= isoDate(now - 8 * 86400000 - 14 * 3600000);
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function safeEqual(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length < 64; } catch { return false; }
}

// ---------- logros ----------
const ACHIEVEMENTS = [
  { key: 'first_step', icon: 'sprout', title: 'Primer paso', desc: 'Completa tu primer hábito', test: (s) => s.habitEvents >= 1 },
  { key: 'streak_3', icon: 'flame', title: 'Calentando', desc: 'Racha de 3 días', test: (s) => s.streak >= 3 },
  { key: 'streak_7', icon: 'lightning-flame', title: 'Una semana', desc: 'Racha de 7 días', test: (s) => s.streak >= 7 },
  { key: 'streak_21', icon: 'rocket', title: 'Tres semanas', desc: 'Racha de 21 días', test: (s) => s.streak >= 21 },
  { key: 'streak_66', icon: 'crown', title: 'Reset completo', desc: 'Racha de 66 días', test: (s) => s.streak >= 66 },
  { key: 'hundred', icon: 'star-medal', title: 'Cien veces', desc: '100 hábitos completados', test: (s) => s.habitEvents >= 100 },
  { key: 'level_5', icon: 'round-star', title: 'Nivel 5', desc: 'Alcanza el nivel 5', test: (s) => s.level >= 5 },
  { key: 'level_10', icon: 'laurel-crown', title: 'Nivel 10', desc: 'Alcanza el nivel 10', test: (s) => s.level >= 10 },
  { key: 'reader', icon: 'open-book', title: 'Estudioso', desc: 'Lee 5 lecciones', test: (s) => s.lessonEvents >= 5 },
  { key: 'calm', icon: 'lotus', title: 'Mente en calma', desc: '10 sesiones de respiración', test: (s) => s.medEvents >= 10 },
  { key: 'xp_500', icon: 'medal', title: 'Medio millar', desc: 'Gana 500 XP', test: (s) => s.xp >= 500 },
  { key: 'xp_2000', icon: 'ribbon-medal', title: 'Veterano', desc: 'Gana 2.000 XP', test: (s) => s.xp >= 2000 },
  { key: 'xp_5000', icon: 'trophy', title: 'Leyenda', desc: 'Gana 5.000 XP', test: (s) => s.xp >= 5000 },
  { key: 'boss_1', icon: 'shining-sword', title: 'Cazajefes', desc: 'Derrota a un jefe semanal', test: (s) => s.bosses >= 1 },
  { key: 'boss_5', icon: 'sword-clash', title: 'Azote de jefes', desc: 'Derrota a 5 jefes', test: (s) => s.bosses >= 5 },
  { key: 'quest_5', icon: 'scroll-unfurled', title: 'Aventurero', desc: 'Completa 5 misiones diarias', test: (s) => s.quests >= 5 },
  { key: 'quest_25', icon: 'scroll-quill', title: 'Mercenario', desc: 'Completa 25 misiones diarias', test: (s) => s.quests >= 25 },
  { key: 'cards_10', icon: 'card-draw', title: 'Coleccionista', desc: 'Consigue 10 cartas', test: (s) => s.cards >= 10 },
  { key: 'cards_all', icon: 'card-joker', title: 'Colección completa', desc: 'Consigue todas las cartas', test: (s) => s.cards >= s.cardsTotal },
  { key: 'buy_1', icon: 'shopping-bag', title: 'Date un capricho', desc: 'Canjea tu primera recompensa', test: (s) => s.buys >= 1 },
  { key: 'buy_10', icon: 'party-popper', title: 'Te lo mereces', desc: 'Canjea 10 recompensas', test: (s) => s.buys >= 10 },
  { key: 'iron', icon: 'brick-wall', title: 'Hábito de hierro', desc: 'Un hábito con 14 días seguidos', test: (s) => s.maxHabitStreak >= 14 },
  { key: 'rock', icon: 'rock', title: 'Hábito de roca', desc: 'Un hábito con 30 días seguidos', test: (s) => s.maxHabitStreak >= 30 },
  { key: 'five_habits', icon: 'rainbow-star', title: 'Vida llena', desc: 'Ten 5 hábitos activos', test: (s) => s.habitCount >= 5 },
  { key: 'specialist', icon: 'graduate-cap', title: 'Especialista', desc: 'Nivel 5 de maestría en un área', test: (s) => s.maxMastery >= 5 },
];

// ---------- cálculo de estado ----------
const isDue = (h, date) => ((h.days >> weekday(date)) & 1) === 1 && h.created <= date;

// ---------- jefe semanal, misiones diarias y monedas ----------
const BOSS_REWARD = 100;
const BOSSES = [['El Procrastinador', '🦥'], ['Señor Pereza', '😴'], ['El Scroll Infinito', '📱'], ['Dragón del Sofá', '🐉'],
  ['Niebla Mental', '🌫️'], ['El Excusas', '🎭'], ['Gólem del Caos', '🗿'], ['Hidra de la Duda', '🐍']];
const QUEST_POOL = [
  { id: 'three', icon: 'check-mark', title: 'Completa 3 hábitos', target: 3, coins: 15, feasible: (c) => c.due.length >= 3, progress: (c) => c.doneToday },
  { id: 'five', icon: 'medal', title: 'Completa 5 hábitos', target: 5, coins: 25, feasible: (c) => c.due.length >= 5, progress: (c) => c.doneToday },
  { id: 'xp40', icon: 'power-lightning', title: 'Gana 40 XP hoy', target: 40, coins: 20, feasible: (c) => c.dueXp >= 40, progress: (c) => c.xpToday },
  { id: 'xp80', icon: 'battery-100', title: 'Gana 80 XP hoy', target: 80, coins: 30, feasible: (c) => c.dueXp >= 80, progress: (c) => c.xpToday },
  { id: 'hard', icon: 'cut-diamond', title: 'Completa un hábito difícil', target: 1, coins: 20, feasible: (c) => c.due.some((h) => h.difficulty === 3), progress: (c) => c.hardToday },
  { id: 'all', icon: 'bullseye', title: 'Completa todos los hábitos de hoy', target: 1, coins: 30, feasible: (c) => c.due.length >= 2, progress: (c) => (c.allDone ? 1 : 0) },
  { id: 'breathe', icon: 'lotus', title: 'Haz una sesión de respiración', target: 1, coins: 15, feasible: () => true, progress: (c) => c.medToday },
];
const claimed = (userId, key) => !!db.prepare('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(userId, key);

function bossFor(userId, habits, today) {
  const wk = weekStart(today);
  const [name, icon] = BOSSES[Math.floor(Date.parse(wk + 'T00:00:00Z') / (7 * 86400000)) % BOSSES.length];
  let potential = 0;
  for (let i = 0; i < 7; i++) for (const h of habits) if (isDue(h, addDays(wk, i))) potential += XP_BY_DIFFICULTY[h.difficulty];
  const hp = Math.max(30, Math.round(potential * 0.75));
  const damage = db.prepare("SELECT COALESCE(SUM(xp), 0) AS n FROM events WHERE user_id = ? AND kind = 'habit' AND date >= ? AND date <= ?").get(userId, wk, addDays(wk, 6)).n;
  return { name, icon, hp, damage, defeated: damage >= hp, claimed: claimed(userId, 'b:' + wk), reward: BOSS_REWARD, daysLeft: diffDays(addDays(wk, 6), today), week: wk };
}

function questsFor(userId, habits, date) {
  const rows = db.prepare("SELECT e.kind, e.ref, e.xp, h.difficulty FROM events e LEFT JOIN habits h ON e.kind = 'habit' AND h.id = CAST(e.ref AS INTEGER) WHERE e.user_id = ? AND e.date = ?").all(userId, date);
  const hab = rows.filter((r) => r.kind === 'habit');
  const refs = new Set(hab.map((r) => r.ref));
  const due = habits.filter((h) => isDue(h, date));
  const ctx = {
    due, dueXp: due.reduce((a, h) => a + XP_BY_DIFFICULTY[h.difficulty], 0),
    doneToday: hab.length, xpToday: hab.reduce((a, r) => a + r.xp, 0), hardToday: hab.filter((r) => r.difficulty === 3).length,
    medToday: rows.filter((r) => r.kind === 'med').length, allDone: due.length > 0 && due.every((h) => refs.has(String(h.id))),
  };
  return QUEST_POOL.filter((q) => q.feasible(ctx))
    .sort((a, b) => sha(userId + ':' + date + ':' + a.id).localeCompare(sha(userId + ':' + date + ':' + b.id)))
    .slice(0, 3)
    .map((q) => {
      const progress = Math.min(q.target, q.progress(ctx));
      return { id: q.id, icon: q.icon, title: q.title, target: q.target, coins: q.coins, progress, done: progress >= q.target, claimed: claimed(userId, `q:${date}:${q.id}`) };
    });
}

function buildState(user, today) {
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY id').all(user.id);
  const since = addDays(today, -400);
  const rows = db.prepare("SELECT kind, ref, date FROM events WHERE user_id = ? AND kind IN ('habit', 'skip') AND date >= ?").all(user.id, since);
  const done = new Map();
  const skipped = new Map();
  const mark = (m, r) => { if (!m.has(r.date)) m.set(r.date, new Set()); m.get(r.date).add(r.ref); };
  for (const r of rows) {
    mark(done, r);
    if (r.kind === 'skip') mark(skipped, r);
  }
  const habitStreak = (h) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const d = addDays(today, -i);
      if (d < h.created) break;
      if (!isDue(h, d)) continue;
      if (done.get(d)?.has(String(h.id))) n++;
      else if (i > 0) break;
    }
    return n;
  };
  const fullDay = (d) => {
    const due = habits.filter((h) => isDue(h, d));
    if (!due.length) return null;
    return due.every((h) => done.get(d)?.has(String(h.id)));
  };
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const f = fullDay(addDays(today, -i));
    if (f === null) continue;
    if (f) streak++;
    else if (i === 0) continue;
    else break;
  }
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const due = habits.filter((h) => isDue(h, d));
    week.push({ date: d, due: due.length, done: due.filter((h) => done.get(d)?.has(String(h.id))).length });
  }
  const counts = db.prepare('SELECT kind, COUNT(*) AS n, COALESCE(SUM(xp), 0) AS xp FROM events WHERE user_id = ? GROUP BY kind').all(user.id);
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c]));
  const xp = counts.reduce((a, c) => a + c.xp, 0);
  const level = levelOf(xp);
  const stats = {
    streak, level,
    habitEvents: byKind.habit?.n || 0,
    lessonEvents: byKind.lesson?.n || 0,
    medEvents: byKind.med?.n || 0,
  };
  const domainRows = db.prepare("SELECT h.domain AS domain, SUM(e.xp) AS xp FROM events e JOIN habits h ON h.id = CAST(e.ref AS INTEGER) WHERE e.user_id = ? AND e.kind = 'habit' GROUP BY h.domain").all(user.id);
  const domainXp = Object.fromEntries(domainRows.map((r) => [r.domain, r.xp]));
  const mastery = DOMAINS.map((d) => {
    const dxp = domainXp[d] || 0;
    const lvl = masteryLevel(dxp);
    return { domain: d, xp: dxp, level: lvl, tier: MASTERY_TIERS.find(([min]) => lvl >= min)[1], floor: 40 * (lvl - 1) ** 2, next: 40 * lvl ** 2 };
  });
  const wk = weekStart(today);
  const skipsUsed = db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'skip' AND date >= ? AND date <= ?").get(user.id, wk, addDays(wk, 6)).n;
  const skipsMax = 1 + Math.floor(level / 10);
  const countClaims = (prefix) => db.prepare("SELECT COUNT(*) AS n FROM claims WHERE user_id = ? AND key LIKE ?").get(user.id, prefix + '%').n;
  Object.assign(stats, {
    xp, habitCount: habits.length, maxHabitStreak: Math.max(0, ...habits.map(habitStreak)),
    maxMastery: Math.max(...mastery.map((m) => m.level)),
    bosses: countClaims('b:'), quests: countClaims('q:'),
    cards: db.prepare('SELECT COUNT(*) AS n FROM cards_owned WHERE user_id = ?').get(user.id).n, cardsTotal: cards.length,
    buys: db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'buy'").get(user.id).n,
  });
  const unlocked = new Map(db.prepare('SELECT key, date FROM achievements WHERE user_id = ?').all(user.id).map((a) => [a.key, a.date]));
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked.has(a.key) && a.test(stats)) {
      db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, date) VALUES (?, ?, ?)').run(user.id, a.key, today);
      unlocked.set(a.key, today);
      newly.push(a.key);
    }
  }
  const packsEarned = level - 1 + unlocked.size + user.bonus_packs;
  const programDay = Math.max(1, diffDays(today, user.program_start) + 1);
  const medToday = db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'med' AND date = ?").get(user.id, today).n;
  return {
    state: {
      date: today,
      xp, level, levelFloor: levelFloor(level), levelNext: levelFloor(level + 1),
      streak, programDay, programTotal: 66,
      habits: habits.map((h) => ({
        id: h.id, title: h.title, icon: h.icon, difficulty: h.difficulty, days: h.days, reminder: h.reminder,
        cid: h.cid, auto: h.auto_metric ? { metric: h.auto_metric, min: h.auto_min } : null, kind: h.kind, streak: habitStreak(h), domain: h.domain, due: isDue(h, today), done: !!done.get(today)?.has(String(h.id)), skipped: !!skipped.get(today)?.has(String(h.id)),
      })),
      week, mastery, skipsLeft: Math.max(0, skipsMax - skipsUsed), skipsMax,
      packsAvailable: Math.max(0, packsEarned - user.packs_opened),
      onboarded: !!user.onboarded,
      health: healthSummaryForState(user.id, today),
      coins: Math.floor(xp / 5) + db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM ledger WHERE user_id = ?').get(user.id).n,
      bonusPct: Math.min(50, Math.floor(streak / 7) * 10),
      boss: bossFor(user.id, habits, today),
      quests: questsFor(user.id, habits, today),
      medToday, medMax: 2,
      achievements: ACHIEVEMENTS.map((a) => ({ key: a.key, icon: a.icon, title: a.title, desc: a.desc, unlocked: unlocked.get(a.key) || null })),
    },
    newly,
  };
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
const jsonSmall = express.json({ limit: '50kb' });
app.use((req, res, next) => (req.path === '/api/health/ingest' ? next() : jsonSmall(req, res, next)));
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return res.status(415).json({ error: 'Content-Type debe ser application/json' });
  }
  next();
});

const RATE_MAX = Number(process.env.RATE_LIMIT || 10); // intentos por IP cada 15 minutos (acceso, registro y cambios de cuenta)
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < 15 * 60000);
  if (rec.length >= RATE_MAX) return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos' });
  rec.push(now);
  attempts.set(key, rec);
  next();
}

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)').run(sha(token), userId, expires);
  res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`);
}
function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?').get(sha(token), Date.now());
    if (row) {
      req.user = row; req.token = token;
      const l = reqLang(req);
      if (l && l !== row.lang) { db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(l, row.id); row.lang = l; }
      req.lang = row.lang;
      return next();
    }
  }
  res.status(401).json({ error: 'No autenticado' });
}

const isAdmin = (u) => u.id === db.prepare('SELECT MIN(id) AS id FROM users').get().id;
function adminOnly(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo quien administra la app puede hacer esto' });
  next();
}
const publicUser = (u) => ({ id: u.id, username: u.username, tz: u.tz });
const clientDate = (req) => {
  const d = req.body?.date ?? req.query.date;
  return validDate(d) ? d : null;
};

app.post('/api/register', rateLimit, (req, res) => {
  const { username, password, invite, tz } = req.body || {};
  if (typeof username !== 'string' || !/^[a-z0-9_.-]{3,32}$/i.test(username)) return res.status(400).json({ error: 'Usuario: 3-32 caracteres (letras, números, _ . -)' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const code = typeof invite === 'string' ? invite.trim().toUpperCase() : '';
  const envOk = !!INVITE_CODE && !!code && safeEqual(invite.trim(), INVITE_CODE);
  if (!first && !envOk) {
    const valid = code && db.prepare('SELECT 1 FROM invites WHERE code = ? AND used_by IS NULL AND expires > ?').get(code, Date.now());
    if (!valid) return res.status(403).json({ error: 'Necesitas un código de invitación válido' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Ese usuario ya existe' });
  const zone = validTz(tz) ? tz : 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
  const info = db.prepare('INSERT INTO users (username, pass, tz, program_start, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), zone, today, new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  if (!first && !envOk) db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(id, code);
  startSession(res, id);
  res.json({ user: { id, username, tz: zone } });
});

app.post('/api/login', rateLimit, (req, res) => {
  const { username, password, tz } = req.body || {};
  const u = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) : null;
  const ok = u && typeof password === 'string' && checkPassword(password, u.pass);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  if (validTz(tz) && tz !== u.tz) { db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(tz, u.id); u.tz = tz; }
  startSession(res, u.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(req.token));
  res.append('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const tz = req.query.tz;
  if (validTz(tz) && tz !== req.user.tz) { db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(tz, req.user.id); req.user.tz = tz; }
  let profile = {};
  try { profile = JSON.parse(req.user.profile || '{}'); } catch { /* perfil antiguo o vacío */ }
  res.json({ user: publicUser(req.user), profile, admin: isAdmin(req.user), onboarded: !!req.user.onboarded, vapidPublicKey: vapid.publicKey });
});

// ---------- cuenta ----------
app.post('/api/account/password', auth, rateLimit, (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || !checkPassword(current, req.user.pass)) return res.status(403).json({ error: 'La contraseña actual no es correcta' });
  if (typeof next !== 'string' || next.length < 8 || next.length > 200) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, sha(req.token)); // cierra las demás sesiones
  res.json({ ok: true });
});

app.get('/api/account/export', auth, (req, res) => {
  const id = req.user.id;
  const all = (sql) => db.prepare(sql).all(id);
  let profile = {};
  try { profile = JSON.parse(req.user.profile || '{}'); } catch { /* vacío */ }
  const data = {
    exported: new Date().toISOString(),
    user: { name: req.user.username, timezone: req.user.tz, created: req.user.created_at, program_start: req.user.program_start, profile },
    habits: all('SELECT id, title, icon, domain, kind, difficulty, days, reminder, created, archived FROM habits WHERE user_id = ?'),
    records: all('SELECT kind, ref, date, xp FROM events WHERE user_id = ? ORDER BY date, id'),
    achievements: all('SELECT key, date FROM achievements WHERE user_id = ?'),
    cards: all('SELECT card_id, date FROM cards_owned WHERE user_id = ?'),
    rewards: all('SELECT id, title, icon, price, archived FROM rewards WHERE user_id = ?'),
    coins: all('SELECT delta, kind, ref, date FROM ledger WHERE user_id = ? ORDER BY id'),
    workouts: all('SELECT id, date, type, start, minutes, distance_km, kcal, avg_hr, max_hr, source FROM workouts WHERE user_id = ? ORDER BY date'),
    daily_health: all('SELECT metric, date, SUM(qty) AS qty FROM health_metrics WHERE user_id = ? GROUP BY metric, date ORDER BY date'),
  };
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="reset-datos-${req.user.username}.json"`,
  });
  res.send(JSON.stringify(data, null, 2));
});

app.post('/api/account/delete', auth, rateLimit, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !checkPassword(password, req.user.pass)) return res.status(403).json({ error: 'La contraseña no es correcta' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // borra en cascada hábitos, registros, sesiones, etc.
  res.append('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- invitaciones (solo quien administra) ----------
const INVITE_DAYS = 7;
function listInvites() {
  return db.prepare('SELECT code, expires FROM invites WHERE used_by IS NULL AND expires > ? ORDER BY expires DESC').all(Date.now());
}
app.get('/api/admin/invites', auth, adminOnly, (req, res) => {
  const members = db.prepare('SELECT username, created_at FROM users ORDER BY id').all();
  res.json({ invites: listInvites(), members, days: INVITE_DAYS });
});
app.post('/api/admin/invites', auth, adminOnly, (req, res) => {
  if (listInvites().length >= 20) return res.status(400).json({ error: 'Ya hay 20 invitaciones activas' });
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  const code = raw.slice(0, 5) + '-' + raw.slice(5);
  db.prepare('INSERT INTO invites (code, created_by, expires) VALUES (?, ?, ?)').run(code, req.user.id, Date.now() + INVITE_DAYS * 86400000);
  res.json({ code, invites: listInvites() });
});
app.delete('/api/admin/invites/:code', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(String(req.params.code).toUpperCase());
  res.json({ invites: listInvites() });
});

app.get('/api/state', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  res.json(buildState(req.user, date).state);
});

function parseHabit(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 80) return { error: 'El nombre debe tener entre 1 y 80 caracteres' };
  const icon = typeof body.icon === 'string' && body.icon.length && body.icon.length <= 8 ? body.icon : '✅';
  const difficulty = [1, 2, 3].includes(body.difficulty) ? body.difficulty : 1;
  const domain = DOMAINS.includes(body.domain) ? body.domain : 'discipline';
  if (!Array.isArray(body.days) || !body.days.length || !body.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: 'Elige al menos un día' };
  const days = body.days.reduce((m, d) => m | (1 << d), 0);
  const reminder = body.reminder == null || body.reminder === '' ? null : body.reminder;
  if (reminder !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder)) return { error: 'Hora de recordatorio inválida' };
  const kind = body.kind === 'quit' ? 'quit' : 'build';
  const a = body.auto;
  const min = a ? Number(a.min) : NaN;
  const auto = a && AUTO_METRICS[a.metric] && Number.isFinite(min) && min > 0 && min <= 200000 ? { metric: a.metric, min } : null;
  return { title, icon, domain, difficulty, days, reminder, kind, autoMetric: auto?.metric ?? null, autoMin: auto?.min ?? null };
}

app.post('/api/habits', auth, (req, res) => {
  const h = parseHabit(req.body || {});
  if (h.error) return res.status(400).json(h);
  const date = clientDate(req) || isoDate(Date.now());
  const cid = typeof req.body?.cid === 'string' && /^[a-z0-9]{6,24}$/.test(req.body.cid) ? req.body.cid : null;
  if (cid && db.prepare('SELECT 1 FROM habits WHERE user_id = ? AND cid = ?').get(req.user.id, cid)) return res.json(buildState(req.user, date).state); // ya creado: el reintento no duplica
  if (db.prepare('SELECT COUNT(*) AS n FROM habits WHERE user_id = ? AND archived = 0').get(req.user.id).n >= 50) return res.status(400).json({ error: 'Máximo 50 hábitos' });
  db.prepare('INSERT INTO habits (user_id, title, icon, domain, difficulty, days, reminder, created, kind, cid, auto_metric, auto_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, h.title, h.icon, h.domain, h.difficulty, h.days, h.reminder, date, h.kind, cid, h.autoMetric, h.autoMin);
  evaluateAuto(req.user, date);
  res.json(buildState(req.user, date).state);
});

app.put('/api/habits/:id', auth, (req, res) => {
  const h = parseHabit(req.body || {});
  if (h.error) return res.status(400).json(h);
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const r = db.prepare('UPDATE habits SET title = ?, icon = ?, domain = ?, difficulty = ?, days = ?, reminder = ?, kind = ?, auto_metric = ?, auto_min = ? WHERE id = ? AND user_id = ? AND archived = 0')
    .run(h.title, h.icon, h.domain, h.difficulty, h.days, h.reminder, h.kind, h.autoMetric, h.autoMin, req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Hábito no encontrado' });
  evaluateAuto(req.user, date);
  res.json(buildState(req.user, date).state);
});

app.delete('/api/habits/:id', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const r = db.prepare('UPDATE habits SET archived = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Hábito no encontrado' });
  res.json(buildState(req.user, date).state);
});

app.post('/api/habits/:id/toggle', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(req.params.id, req.user.id);
  if (!h) return res.status(404).json({ error: 'Hábito no encontrado' });
  const ref = String(h.id);
  const hadDone = !!db.prepare("SELECT 1 FROM events WHERE user_id = ? AND kind = 'habit' AND ref = ? AND date = ?").get(req.user.id, ref, date);
  const want = typeof req.body?.done === 'boolean' ? req.body.done : !hadDone;
  if (want) {
    db.prepare("DELETE FROM events WHERE user_id = ? AND kind = 'skip' AND ref = ? AND date = ?").run(req.user.id, ref, date);
    if (!hadDone) {
      const bonus = buildState(req.user, date).state.bonusPct;
      db.prepare("INSERT INTO events (user_id, kind, ref, date, xp) VALUES (?, 'habit', ?, ?, ?)").run(req.user.id, ref, date, Math.round(XP_BY_DIFFICULTY[h.difficulty] * (1 + bonus / 100)));
    }
  } else if (hadDone) {
    db.prepare("DELETE FROM events WHERE user_id = ? AND kind = 'habit' AND ref = ? AND date = ?").run(req.user.id, ref, date);
  }
  const { state, newly } = buildState(req.user, date);
  res.json({ state, newAchievements: newly });
});

app.get('/api/lessons', auth, (req, res) => {
  const done = new Set(db.prepare("SELECT ref FROM events WHERE user_id = ? AND kind = 'lesson'").all(req.user.id).map((r) => r.ref));
  res.json(lessons.map((l) => ({ ...l, done: done.has(l.id) })));
});

app.post('/api/lessons/:id/complete', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  if (!lessons.some((l) => l.id === req.params.id)) return res.status(404).json({ error: 'Lección no encontrada' });
  db.prepare("INSERT OR IGNORE INTO events (user_id, kind, ref, date, xp) VALUES (?, 'lesson', ?, '', 25)").run(req.user.id, req.params.id);
  const { state, newly } = buildState(req.user, date);
  res.json({ state, newAchievements: newly });
});

app.post('/api/meditation', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const n = db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'med' AND date = ?").get(req.user.id, date).n;
  if (n < 2) db.prepare("INSERT INTO events (user_id, kind, ref, date, xp) VALUES (?, 'med', ?, ?, 15)").run(req.user.id, 'm' + (n + 1), date);
  const { state, newly } = buildState(req.user, date);
  res.json({ state, newAchievements: newly, xpGranted: n < 2 });
});

app.post('/api/program/restart', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  db.prepare('UPDATE users SET program_start = ? WHERE id = ?').run(date, req.user.id);
  req.user.program_start = date;
  res.json(buildState(req.user, date).state);
});

app.post('/api/habits/:id/skip', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(req.params.id, req.user.id);
  if (!h) return res.status(404).json({ error: 'Hábito no encontrado' });
  const ref = String(h.id);
  const hadSkip = !!db.prepare("SELECT 1 FROM events WHERE user_id = ? AND kind = 'skip' AND ref = ? AND date = ?").get(req.user.id, ref, date);
  const want = typeof req.body?.skipped === 'boolean' ? req.body.skipped : !hadSkip;
  if (want && !hadSkip) {
    if (buildState(req.user, date).state.skipsLeft < 1) return res.status(400).json({ error: 'No te quedan saltos esta semana' });
    db.prepare("DELETE FROM events WHERE user_id = ? AND kind = 'habit' AND ref = ? AND date = ?").run(req.user.id, ref, date);
    db.prepare("INSERT INTO events (user_id, kind, ref, date, xp) VALUES (?, 'skip', ?, ?, 0)").run(req.user.id, ref, date);
  } else if (!want && hadSkip) {
    db.prepare("DELETE FROM events WHERE user_id = ? AND kind = 'skip' AND ref = ? AND date = ?").run(req.user.id, ref, date);
  }
  res.json({ state: buildState(req.user, date).state, newAchievements: [] });
});

app.get('/api/templates', auth, (req, res) => res.json(templates));

app.post('/api/onboarding', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const b = req.body || {};
  const picked = Array.isArray(b.domains) ? b.domains.filter((d) => DOMAINS.includes(d)).slice(0, 4) : [];
  if (!picked.length) return res.status(400).json({ error: 'Elige al menos un área' });
  const wake = /^([01]\d|2[0-3]):[0-5]\d$/.test(b.wake) ? b.wake : '07:00';
  const profile = {
    wake, goal: String(b.goal || '').slice(0, 200), domains: picked,
    values: Array.isArray(b.values) ? b.values.map(String).slice(0, 5) : [],
    level: ['empezando', 'algo', 'avanzado'].includes(b.level) ? b.level : 'empezando',
  };
  const perDomain = picked.length === 1 ? 3 : 2;
  const ins = db.prepare('INSERT INTO habits (user_id, title, icon, domain, difficulty, days, reminder, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  if (!db.prepare('SELECT 1 FROM habits WHERE user_id = ? AND archived = 0').get(req.user.id)) {
    for (const d of picked) {
      for (const t of templates[d].habits.slice(0, perDomain)) {
        ins.run(req.user.id, tl(req.lang, t.title), t.icon, d, profile.level === 'avanzado' ? Math.min(3, t.difficulty + 1) : t.difficulty, 127, t.morning ? wake : null, date);
      }
    }
  }
  db.prepare('UPDATE users SET onboarded = 1, profile = ?, program_start = ? WHERE id = ?').run(JSON.stringify(profile), date, req.user.id);
  req.user.onboarded = 1; req.user.program_start = date;
  res.json(buildState(req.user, date).state);
});

app.get('/api/cards', auth, (req, res) => {
  const owned = new Map(db.prepare('SELECT card_id, date FROM cards_owned WHERE user_id = ?').all(req.user.id).map((r) => [r.card_id, r.date]));
  res.json(cards.map((c) => (owned.has(c.id) ? { ...c, owned: owned.get(c.id) } : { id: c.id, rarity: c.rarity, owned: null })));
});

app.post('/api/packs/open', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  if (buildState(req.user, date).state.packsAvailable < 1) return res.status(400).json({ error: 'No tienes packs disponibles' });
  const owned = new Set(db.prepare('SELECT card_id FROM cards_owned WHERE user_id = ?').all(req.user.id).map((r) => r.card_id));
  const pulled = [];
  for (let i = 0; i < 3; i++) {
    const pool = cards.filter((c) => !pulled.some((p) => p.id === c.id));
    const fresh = pool.filter((c) => !owned.has(c.id));
    const base = fresh.length ? fresh : pool;
    const total = base.reduce((a, c) => a + RARITY_WEIGHT[c.rarity], 0);
    let r = crypto.randomInt(0, total);
    const card = base.find((c) => (r -= RARITY_WEIGHT[c.rarity]) < 0) || base[0];
    pulled.push({ ...card, isNew: !owned.has(card.id) });
  }
  for (const c of pulled) db.prepare('INSERT OR IGNORE INTO cards_owned (user_id, card_id, date) VALUES (?, ?, ?)').run(req.user.id, c.id, date);
  db.prepare('UPDATE users SET packs_opened = packs_opened + 1 WHERE id = ?').run(req.user.id);
  req.user.packs_opened += 1;
  res.json({ cards: pulled, state: buildState(req.user, date).state });
});

app.get('/api/season', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const start = date.slice(0, 8) + '01';
  const [y, m] = date.split('-').map(Number);
  const end = isoDate(Date.UTC(y, m, 0));
  const rows = db.prepare('SELECT u.id, u.username, COALESCE(SUM(e.xp), 0) AS xp FROM users u LEFT JOIN events e ON e.user_id = u.id AND e.date >= ? AND e.date <= ? GROUP BY u.id ORDER BY xp DESC, u.username LIMIT 25').all(start, end);
  res.json({
    key: date.slice(0, 7), start, end, daysLeft: diffDays(end, date),
    ranking: rows.map((r, i) => ({ pos: i + 1, username: r.username, xp: r.xp, you: r.id === req.user.id })),
  });
});

app.get('/api/insights', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0').all(req.user.id);
  const since = addDays(date, -29);
  const rows = db.prepare("SELECT ref, date FROM events WHERE user_id = ? AND kind IN ('habit', 'skip') AND date >= ? AND date <= ?").all(req.user.id, since, date);
  const done = new Set(rows.map((r) => r.ref + '|' + r.date));
  const byWd = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  const byDomain = {};
  let due = 0, ok = 0, perfect = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(date, -i);
    const dh = habits.filter((h) => isDue(h, d));
    if (!dh.length) continue;
    let all = true;
    for (const h of dh) {
      const hit = done.has(h.id + '|' + d);
      due++; byWd[weekday(d)].due++; (byDomain[h.domain] ||= { due: 0, done: 0 }).due++;
      if (hit) { ok++; byWd[weekday(d)].done++; byDomain[h.domain].done++; } else all = false;
    }
    if (all) perfect++;
  }
  res.json({
    rate: due ? Math.round((100 * ok) / due) : 0, completed: ok, due, perfectDays: perfect,
    byWeekday: byWd.map((w, i) => ({ weekday: i, rate: w.due ? Math.round((100 * w.done) / w.due) : null })),
    byDomain: Object.entries(byDomain).map(([domain, v]) => ({ domain, rate: Math.round((100 * v.done) / v.due), done: v.done })),
  });
});

app.post('/api/quests/claim', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0').all(req.user.id);
  const q = questsFor(req.user.id, habits, date).find((x) => x.id === req.body?.id);
  if (!q) return res.status(404).json({ error: 'Misión no encontrada' });
  if (!q.done) return res.status(400).json({ error: 'Aún no has completado la misión' });
  if (db.prepare('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(req.user.id, `q:${date}:${q.id}`).changes) {
    db.prepare("INSERT INTO ledger (user_id, delta, kind, ref, date) VALUES (?, ?, 'quest', ?, ?)").run(req.user.id, q.coins, q.id, date);
  }
  const out = buildState(req.user, date);
  res.json({ state: out.state, newAchievements: out.newly });
});

app.post('/api/boss/claim', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0').all(req.user.id);
  const boss = bossFor(req.user.id, habits, date);
  if (!boss.defeated) return res.status(400).json({ error: 'El jefe sigue en pie' });
  if (db.prepare('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(req.user.id, 'b:' + boss.week).changes) {
    db.prepare("INSERT INTO ledger (user_id, delta, kind, ref, date) VALUES (?, ?, 'boss', ?, ?)").run(req.user.id, BOSS_REWARD, boss.week, date);
    db.prepare('UPDATE users SET bonus_packs = bonus_packs + 1 WHERE id = ?').run(req.user.id);
    req.user.bonus_packs += 1;
  }
  const out = buildState(req.user, date);
  res.json({ state: out.state, newAchievements: out.newly });
});

app.get('/api/rewards', auth, (req, res) => {
  res.json(db.prepare("SELECT r.id, r.title, r.icon, r.price, (SELECT COUNT(*) FROM ledger l WHERE l.user_id = r.user_id AND l.kind = 'buy' AND l.ref = CAST(r.id AS TEXT)) AS bought FROM rewards r WHERE r.user_id = ? AND r.archived = 0 ORDER BY r.price, r.id").all(req.user.id));
});

app.post('/api/rewards', auth, (req, res) => {
  const { title, icon, price } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 60) return res.status(400).json({ error: 'El nombre debe tener entre 1 y 60 caracteres' });
  if (!Number.isInteger(price) || price < 5 || price > 5000) return res.status(400).json({ error: 'El precio debe estar entre 5 y 5000 monedas' });
  if (db.prepare('SELECT COUNT(*) AS n FROM rewards WHERE user_id = ? AND archived = 0').get(req.user.id).n >= 30) return res.status(400).json({ error: 'Máximo 30 recompensas' });
  db.prepare('INSERT INTO rewards (user_id, title, icon, price) VALUES (?, ?, ?, ?)').run(req.user.id, title.trim(), typeof icon === 'string' && icon && icon.length <= 8 ? icon : '🎁', price);
  res.json({ ok: true });
});

app.delete('/api/rewards/:id', auth, (req, res) => {
  if (!db.prepare('UPDATE rewards SET archived = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id).changes) return res.status(404).json({ error: 'Recompensa no encontrada' });
  res.json({ ok: true });
});

app.post('/api/rewards/:id/buy', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const r = db.prepare('SELECT * FROM rewards WHERE id = ? AND user_id = ? AND archived = 0').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Recompensa no encontrada' });
  if (buildState(req.user, date).state.coins < r.price) return res.status(400).json({ error: 'No tienes monedas suficientes' });
  db.prepare("INSERT INTO ledger (user_id, delta, kind, ref, date) VALUES (?, ?, 'buy', ?, ?)").run(req.user.id, -r.price, String(r.id), date);
  const out = buildState(req.user, date);
  res.json({ state: out.state, newAchievements: out.newly });
});

app.get('/api/heatmap', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0').all(req.user.id);
  const start = weekStart(addDays(date, -25 * 7));
  const rows = db.prepare("SELECT ref, date FROM events WHERE user_id = ? AND kind IN ('habit', 'skip') AND date >= ? AND date <= ?").all(req.user.id, start, date);
  const done = new Set(rows.map((r) => r.ref + '|' + r.date));
  const days = [];
  for (let d = start; d <= date; d = addDays(d, 1)) {
    const due = habits.filter((h) => isDue(h, d));
    days.push({ date: d, due: due.length, done: due.filter((h) => done.has(h.id + '|' + d)).length });
  }
  res.json({ start, days });
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'Suscripción inválida' });
  db.prepare('INSERT INTO subs (endpoint, user_id, data) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, data = excluded.data')
    .run(sub.endpoint, req.user.id, JSON.stringify(sub));
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', auth, (req, res) => {
  db.prepare('DELETE FROM subs WHERE endpoint = ? AND user_id = ?').run(String(req.body?.endpoint || ''), req.user.id);
  res.json({ ok: true });
});

async function pushToUser(userId, payload) {
  const subs = db.prepare('SELECT endpoint, data FROM subs WHERE user_id = ?').all(userId);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM subs WHERE endpoint = ?').run(s.endpoint);
    }
  }
  return sent;
}

app.post('/api/push/test', auth, async (req, res) => {
  const sent = await pushToUser(req.user.id, { title: 'Reset', body: tl(req.lang, '¡Las notificaciones funcionan! 🎉'), url: '/' });
  res.json({ sent });
});

// ---------- salud: datos del móvil y del reloj ----------
// Un navegador no puede leer Apple Health ni Health Connect, así que una app puente del móvil envía los datos
// a /api/health/ingest con una clave personal. Con ellos se calcula el ejercicio de cada día y se completan
// solos los hábitos que tengan una regla (pasos, minutos de ejercicio, entrenamientos o distancia).
const AUTO_METRICS = { steps: 'Pasos', exercise: 'Minutos de ejercicio', workouts: 'Entrenamientos', distance: 'Distancia (km)', sleep: 'Horas de sueño' };

function dayHealth(userId, date) {
  const rows = db.prepare('SELECT metric, SUM(qty) AS s, AVG(qty) AS a, MIN(qty) AS mn, MAX(qty) AS mx FROM health_metrics WHERE user_id = ? AND date = ? GROUP BY metric').all(userId, date);
  const m = Object.fromEntries(rows.map((r) => [r.metric, r]));
  const sum = (k) => m[k]?.s ?? 0;
  const avg = (k, d = 0) => (m[k] ? Math.round(m[k].a * 10 ** d) / 10 ** d : null);
  const w = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS min, COALESCE(SUM(distance_km), 0) AS km, COALESCE(SUM(kcal), 0) AS kcal, MAX(max_hr) AS max_hr, AVG(avg_hr) AS avg_hr FROM workouts WHERE user_id = ? AND date = ?').get(userId, date);
  const hasHr = !!(m.hr_avg || m.hr_min || m.hr_max || w.max_hr);
  return {
    steps: Math.round(sum('steps')),
    exercise: Math.round(Math.max(sum('exercise'), w.min)),
    workouts: w.n,
    distance: Math.round(Math.max(sum('distance'), w.km) * 10) / 10,
    kcal: Math.round(Math.max(sum('kcal'), w.kcal)),
    hr: hasHr ? { avg: m.hr_avg ? avg('hr_avg') : (w.avg_hr ? Math.round(w.avg_hr) : null), min: m.hr_min ? Math.round(m.hr_min.mn) : null, max: m.hr_max ? Math.round(m.hr_max.mx) : (w.max_hr ? Math.round(w.max_hr) : null) } : null,
    resting: avg('resting'),
    hrv: avg('hrv'),
    spo2: avg('spo2', 1),
    sleep: m.sleep ? Math.round(sum('sleep') * 10) / 10 : null,
    sleepDeep: m.sleep_deep ? Math.round(sum('sleep_deep') * 10) / 10 : null,
    sleepRem: m.sleep_rem ? Math.round(sum('sleep_rem') * 10) / 10 : null,
    vo2max: avg('vo2max', 1),
    resp: avg('resp', 1),
  };
}

function healthSummaryForState(userId, date) {
  const connected = !!db.prepare('SELECT 1 FROM health_tokens WHERE user_id = ?').get(userId)
    || !!db.prepare('SELECT 1 FROM health_metrics WHERE user_id = ? LIMIT 1').get(userId)
    || !!db.prepare('SELECT 1 FROM workouts WHERE user_id = ? LIMIT 1').get(userId);
  return { connected, ...dayHealth(userId, date) };
}

// Completa los hábitos con regla automática que ya cumplen su objetivo ese día
function evaluateAuto(user, date, notify = false) {
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 AND auto_metric IS NOT NULL').all(user.id);
  if (!habits.length) return [];
  const health = dayHealth(user.id, date);
  const completed = [];
  for (const hb of habits) {
    if (!isDue(hb, date) || !(health[hb.auto_metric] >= hb.auto_min)) continue;
    const ref = String(hb.id);
    if (db.prepare("SELECT 1 FROM events WHERE user_id = ? AND kind = 'habit' AND ref = ? AND date = ?").get(user.id, ref, date)) continue;
    db.prepare("DELETE FROM events WHERE user_id = ? AND kind = 'skip' AND ref = ? AND date = ?").run(user.id, ref, date);
    const bonus = buildState(user, date).state.bonusPct;
    db.prepare("INSERT OR IGNORE INTO events (user_id, kind, ref, date, xp) VALUES (?, 'habit', ?, ?, ?)").run(user.id, ref, date, Math.round(XP_BY_DIFFICULTY[hb.difficulty] * (1 + bonus / 100)));
    completed.push(hb);
  }
  if (notify && completed.length) pushToUser(user.id, { title: tl(user.lang, 'Hábito completado'), body: completed.map((c) => c.title).join(', '), url: '/' }).catch(() => {});
  return completed;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
// "2026-11-02 07:30:00 +0100" o "2026-11-02T07:30:00+01:00" -> día local y marca de tiempo
function tsInfo(str) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) { const d = /^(\d{4}-\d{2}-\d{2})$/.exec(t); return d ? { date: d[1], ms: null } : null; }
  let off = m[3] || 'Z';
  if (off !== 'Z' && !off.includes(':')) off = off.slice(0, 3) + ':' + off.slice(3);
  const ms = Date.parse(m[1] + 'T' + (m[2].length === 5 ? m[2] + ':00' : m[2]) + off);
  return { date: m[1], ms: Number.isNaN(ms) ? null : ms };
}
function toKm(q, units) {
  const n = num(q);
  if (n === null) return null;
  const u = String(units || 'km').toLowerCase();
  return u.startsWith('mi') ? n * 1.609344 : (u === 'm' || u.startsWith('meter')) ? n / 1000 : n;
}

// Valores razonables por métrica: lo que quede fuera (errores del sensor, unidades cambiadas) se descarta
const RANGE = { hr_avg: [20, 250], hr_min: [20, 250], hr_max: [20, 260], resting: [20, 200], hrv: [1, 500], spo2: [50, 100], sleep: [0, 24], sleep_deep: [0, 24], sleep_rem: [0, 24], vo2max: [5, 100], resp: [3, 60] };
const okMetric = (key, v) => !RANGE[key] || (v >= RANGE[key][0] && v <= RANGE[key][1]);

// Acepta el formato JSON de Health Auto Export y un formato sencillo propio para cualquier otra app
function parseIngest(body) {
  const HAE = {
    step_count: 'steps', apple_exercise_time: 'exercise', walking_running_distance: 'distance', active_energy: 'kcal',
    resting_heart_rate: 'resting', heart_rate_variability: 'hrv', heart_rate_variability_sdnn: 'hrv',
    blood_oxygen_saturation: 'spo2', vo2_max: 'vo2max', respiratory_rate: 'resp',
  };
  const data = body && typeof body === 'object' ? (body.data && typeof body.data === 'object' ? body.data : body) : {};
  const metrics = [];
  const workouts = [];
  const push = (metric, ts, date, qty) => { if (qty !== null && okMetric(metric, qty)) metrics.push({ metric, ts: String(ts).slice(0, 40), date, qty }); };
  for (const m of Array.isArray(data.metrics) ? data.metrics : []) {
    if (m?.name === 'heart_rate') {
      for (const e of Array.isArray(m.data) ? m.data : []) {
        const t = tsInfo(e?.date);
        if (!t) continue;
        const min = num(e.Min ?? e.min);
        const avgv = num(e.Avg ?? e.avg ?? e.qty);
        const max = num(e.Max ?? e.max);
        push('hr_min', e.date, t.date, min);
        push('hr_avg', e.date, t.date, avgv);
        push('hr_max', e.date, t.date, max);
      }
      continue;
    }
    if (m?.name === 'sleep_analysis') {
      const unit = String(m.units || 'hr').toLowerCase();
      const hours = (v) => { const n = num(v); return n === null ? null : (unit.startsWith('min') ? n / 60 : n); };
      for (const e of Array.isArray(m.data) ? m.data : []) {
        const t = tsInfo(e?.date ?? e?.sleepEnd ?? e?.endDate);
        if (!t) continue;
        const ts = e.date ?? e.sleepEnd ?? e.endDate;
        const parts = [hours(e.core), hours(e.deep), hours(e.rem)].filter((x) => x !== null);
        const asleep = hours(e.asleep) ?? hours(e.totalSleep) ?? (parts.length ? parts.reduce((a, b) => a + b, 0) : null);
        push('sleep', ts, t.date, asleep);
        push('sleep_deep', ts, t.date, hours(e.deep));
        push('sleep_rem', ts, t.date, hours(e.rem));
      }
      continue;
    }
    const key = HAE[m?.name];
    if (!key) continue;
    for (const e of Array.isArray(m.data) ? m.data : []) {
      const t = tsInfo(e?.date);
      const q = num(e?.qty ?? e?.value);
      if (!t || q === null) continue;
      let v = q;
      if (key === 'distance') v = toKm(q, m.units);
      if (key === 'kcal' && /kj/i.test(m.units || '')) v = q / 4.184;
      if (key === 'spo2' && v <= 1) v = v * 100; // algunas apps lo envían como fracción
      push(key, e.date, t.date, v);
    }
  }
  const DAILY = [['steps', 'steps'], ['exercise_minutes', 'exercise'], ['distance_km', 'distance'], ['calories', 'kcal'], ['resting_hr', 'resting'],
    ['hr_avg', 'hr_avg'], ['hr_min', 'hr_min'], ['hr_max', 'hr_max'], ['hrv', 'hrv'], ['spo2', 'spo2'], ['sleep_hours', 'sleep'], ['vo2max', 'vo2max']];
  for (const d of Array.isArray(data.daily) ? data.daily : []) {
    const date = tsInfo(d?.date)?.date;
    if (!date) continue;
    for (const [field, key] of DAILY) push(key, 'daily:' + date, date, num(d[field]));
  }
  for (const w of Array.isArray(data.workouts) ? data.workouts : []) {
    const st = tsInfo(w?.start);
    const en = tsInfo(w?.end);
    const date = st?.date || tsInfo(w?.date)?.date;
    if (!date) continue;
    let minutes = num(w.minutes);
    if (minutes === null && st?.ms && en?.ms && en.ms > st.ms) minutes = (en.ms - st.ms) / 60000;
    if (minutes === null && num(w.duration) !== null) minutes = num(w.duration) / 60; // la duración llega en segundos
    if (minutes === null || minutes <= 0 || minutes > 1440) continue;
    const km = w.distance_km != null ? num(w.distance_km) : (w.distance && typeof w.distance === 'object' ? toKm(w.distance.qty, w.distance.units) : null);
    const kcal = w.calories != null ? num(w.calories) : (w.activeEnergyBurned?.qty != null ? num(w.activeEnergyBurned.qty) : null);
    const avgHr = num(w.avg_hr ?? w.avgHeartRate?.qty);
    const maxHr = num(w.max_hr ?? w.maxHeartRate?.qty);
    const type = String(w.name || w.type || 'Entrenamiento').slice(0, 40);
    const id = String(w.id || sha(type + '|' + w.start).slice(0, 24)).slice(0, 64);
    workouts.push({
      id, date, type, start: typeof w.start === 'string' ? w.start.slice(0, 40) : null, minutes: Math.round(minutes * 10) / 10, km: km ?? 0, kcal: kcal ?? 0,
      avgHr: avgHr !== null && okMetric('hr_avg', avgHr) ? Math.round(avgHr) : null, maxHr: maxHr !== null && okMetric('hr_max', maxHr) ? Math.round(maxHr) : null,
    });
  }
  return { metrics, workouts };
}

const ingestHits = new Map();
function ingestAuth(req, res, next) {
  const m = /^Bearer (\S{20,128})$/.exec(req.headers.authorization || '');
  const row = m && db.prepare('SELECT u.* FROM health_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?').get(sha(m[1]));
  if (!row) return res.status(401).json({ error: 'Clave de salud no válida' });
  const now = Date.now();
  const hits = (ingestHits.get(row.id) || []).filter((t) => now - t < 3600000);
  if (hits.length >= 600) return res.status(429).json({ error: 'Demasiadas peticiones, espera un rato' });
  hits.push(now);
  ingestHits.set(row.id, hits);
  req.user = row;
  next();
}

app.post('/api/health/ingest', ingestAuth, express.json({ limit: '3mb' }), (req, res) => {
  if ((req.headers['content-type'] || '').indexOf('application/json') !== 0) return res.status(415).json({ error: 'Content-Type debe ser application/json' });
  const { metrics, workouts } = parseIngest(req.body);
  if (metrics.length > 20000 || workouts.length > 2000) return res.status(413).json({ error: 'Demasiados datos en una sola petición' });
  const today = localNow(req.user.tz).date;
  const minDate = isoDate(Date.now() - 400 * 86400000);
  const maxDate = isoDate(Date.now() + 2 * 86400000);
  const inRange = (d) => d >= minDate && d <= maxDate;
  const upM = db.prepare('INSERT INTO health_metrics (user_id, metric, ts, date, qty) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, metric, ts) DO UPDATE SET qty = excluded.qty, date = excluded.date');
  const upW = db.prepare("INSERT INTO workouts (user_id, id, date, type, start, minutes, distance_km, kcal, avg_hr, max_hr, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import') ON CONFLICT (user_id, id) DO UPDATE SET date = excluded.date, type = excluded.type, start = excluded.start, minutes = excluded.minutes, distance_km = excluded.distance_km, kcal = excluded.kcal, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr");
  const dates = new Set();
  let nm = 0;
  let nw = 0;
  db.exec('BEGIN');
  try {
    for (const m of metrics) if (inRange(m.date)) { upM.run(req.user.id, m.metric, m.ts, m.date, m.qty); dates.add(m.date); nm++; }
    for (const w of workouts) if (inRange(w.date)) { upW.run(req.user.id, w.id, w.date, w.type, w.start, w.minutes, w.km, w.kcal, w.avgHr, w.maxHr); dates.add(w.date); nw++; }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  db.prepare('UPDATE health_tokens SET last_used = ? WHERE user_id = ?').run(new Date().toISOString(), req.user.id);
  const auto = [];
  for (const d of [...dates].sort().slice(-40)) {
    const recent = diffDays(today, d) <= 1 && diffDays(today, d) >= -1; // no avisar de datos antiguos al recuperar historial
    for (const hb of evaluateAuto(req.user, d, recent)) auto.push(hb.title);
  }
  res.json({ ok: true, metrics: nm, workouts: nw, completed_habits: auto });
});

app.get('/api/health/status', auth, (req, res) => {
  const t = db.prepare('SELECT created, last_used FROM health_tokens WHERE user_id = ?').get(req.user.id);
  res.json({ token: t || null });
});
app.post('/api/health/token', auth, (req, res) => {
  const token = 'rst_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO health_tokens (user_id, token_hash, created) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created = excluded.created, last_used = NULL')
    .run(req.user.id, sha(token), new Date().toISOString());
  res.json({ token }); // solo se muestra ahora; en el servidor se guarda un resumen irreversible
});
app.delete('/api/health/token', auth, (req, res) => {
  db.prepare('DELETE FROM health_tokens WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/health/summary', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const week = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(date, -i); week.push({ date: d, ...dayHealth(req.user.id, d) }); }
  const list = db.prepare('SELECT id, date, type, minutes, distance_km, kcal, avg_hr, max_hr, source FROM workouts WHERE user_id = ? ORDER BY date DESC, start DESC LIMIT 12').all(req.user.id);
  res.json({ week, workouts: list, today: week[6] });
});

app.post('/api/health/workouts', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  const b = req.body || {};
  const minutes = Number(b.minutes);
  const km = b.distance_km == null || b.distance_km === '' ? 0 : Number(b.distance_km);
  const type = typeof b.type === 'string' && b.type.trim() ? b.type.trim().slice(0, 40) : 'Entrenamiento';
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return res.status(400).json({ error: 'Los minutos deben estar entre 1 y 1440' });
  if (!Number.isFinite(km) || km < 0 || km > 500) return res.status(400).json({ error: 'La distancia debe estar entre 0 y 500 km' });
  db.prepare("INSERT INTO workouts (user_id, id, date, type, start, minutes, distance_km, kcal, source) VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 'manual')")
    .run(req.user.id, 'm-' + crypto.randomBytes(6).toString('hex'), date, type, Math.round(minutes * 10) / 10, Math.round(km * 10) / 10);
  evaluateAuto(req.user, date);
  res.json({ state: buildState(req.user, date).state });
});
app.delete('/api/health/workouts/:id', auth, (req, res) => {
  const date = clientDate(req);
  if (!date) return res.status(400).json({ error: 'Fecha inválida' });
  if (!db.prepare('DELETE FROM workouts WHERE user_id = ? AND id = ?').run(req.user.id, String(req.params.id)).changes) return res.status(404).json({ error: 'Entrenamiento no encontrado' });
  res.json({ state: buildState(req.user, date).state });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); },
}));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

// ---------- recordatorios ----------
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

async function reminderTick() {
  const users = db.prepare('SELECT DISTINCT u.* FROM users u JOIN subs s ON s.user_id = u.id').all();
  for (const u of users) {
    const { date, time } = localNow(u.tz);
    const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 AND reminder = ?').all(u.id, time);
    for (const h of habits) {
      if (!isDue(h, date)) continue;
      if (db.prepare("SELECT 1 FROM events WHERE user_id = ? AND kind = 'habit' AND ref = ? AND date = ?").get(u.id, String(h.id), date)) continue;
      if (db.prepare('INSERT OR IGNORE INTO reminder_log (habit_id, date) VALUES (?, ?)').run(h.id, date).changes === 0) continue;
      await pushToUser(u.id, { title: `${h.icon} ${h.title}`, body: tl(u.lang, 'Es la hora de tu hábito.'), url: '/' });
    }
  }
  db.prepare('DELETE FROM reminder_log WHERE date < ?').run(isoDate(Date.now() - 3 * 86400000));
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('DELETE FROM health_metrics WHERE date < ?').run(isoDate(Date.now() - 400 * 86400000));
}
setInterval(() => reminderTick().catch((e) => console.error('recordatorios:', e)), 30000);

app.listen(PORT, () => console.log(`Reset escuchando en http://localhost:${PORT}`));
