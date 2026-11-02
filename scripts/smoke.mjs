// Prueba de humo: arranca el servidor con datos temporales y recorre la API.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'));
const port = 3100 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/server.js'], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dir, INVITE_CODE: 'abc123', RATE_LIMIT: '200' }, stdio: 'inherit',
});
const base = `http://localhost:${port}`;
const jar = {};
async function call(who, method, url, body) {
  const res = await fetch(base + url, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && set.startsWith('sid=') && !set.startsWith('sid=;')) jar[who] = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const date = new Date().toLocaleDateString('en-CA');

try {
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  assert.equal((await call('a', 'GET', '/api/me')).status, 401);
  assert.equal((await call('a', 'POST', '/api/register', { username: 'ana', password: 'corta' })).status, 400);
  assert.equal((await call('a', 'POST', '/api/register', { username: 'ana', password: 'contraseña-larga', tz: 'Europe/Madrid' })).status, 200);
  assert.equal((await call('b', 'POST', '/api/register', { username: 'bea', password: 'contraseña-larga', invite: 'mal' })).status, 403);
  assert.equal((await call('b', 'POST', '/api/register', { username: 'bea', password: 'contraseña-larga', invite: 'abc123' })).status, 200);

  let st = (await call('a', 'GET', `/api/state?date=${date}`)).data;
  assert.equal(st.onboarded, false);
  st = (await call('a', 'POST', '/api/onboarding', { date, domains: ['health', 'mind'], wake: '07:30', level: 'empezando', values: ['Calma'] })).data;
  assert.equal(st.onboarded, true);
  assert.equal(st.habits.length, 4);
  assert.equal(st.mastery.length, 7);

  const id = st.habits[0].id;
  let r = (await call('a', 'POST', `/api/habits/${id}/toggle`, { date })).data;
  assert.ok(r.state.xp > 0, 'gana XP');
  assert.ok(r.newAchievements.includes('first_step'), 'logro primer paso');
  const xpDone = r.state.xp;
  r = (await call('a', 'POST', `/api/habits/${id}/toggle`, { date })).data;
  assert.equal(r.state.xp, xpDone - (xpDone - r.state.xp)); // desmarcar devuelve el XP
  assert.equal(r.state.xp, 0);

  const id2 = st.habits[1].id;
  r = (await call('a', 'POST', `/api/habits/${id2}/skip`, { date })).data;
  assert.equal(r.state.skipsLeft, 0);
  assert.equal(r.state.habits.find((h) => h.id === id2).skipped, true);
  assert.equal((await call('a', 'POST', `/api/habits/${st.habits[2].id}/skip`, { date })).status, 400, 'sin saltos');

  // CSRF: cuerpo que no es JSON se rechaza
  const bad = await fetch(base + '/api/habits', { method: 'POST', headers: { Cookie: jar.a, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(bad.status, 415);

  // aislamiento entre usuarios
  assert.equal((await call('b', 'POST', `/api/habits/${id}/toggle`, { date })).status, 404);

  // lecciones, meditación, cartas, temporada, insights
  r = (await call('a', 'POST', '/api/lessons/bucle/complete', { date })).data;
  assert.equal(r.state.xp, 25);
  r = (await call('a', 'POST', '/api/meditation', { date })).data;
  assert.equal(r.state.xp, 40);
  assert.ok(r.state.packsAvailable >= 1, `hay pack (${r.state.packsAvailable})`);
  const pack = (await call('a', 'POST', '/api/packs/open', { date })).data;
  assert.equal(pack.cards.length, 3);
  assert.equal(new Set(pack.cards.map((c) => c.id)).size, 3);
  const col = (await call('a', 'GET', '/api/cards')).data;
  assert.equal(col.filter((c) => c.owned).length, 3);
  assert.equal(col.find((c) => !c.owned).content, undefined, 'las cartas no obtenidas no filtran su texto');
  const season = (await call('a', 'GET', `/api/season?date=${date}`)).data;
  assert.equal(season.ranking[0].username, 'ana');
  assert.equal((await call('a', 'GET', `/api/insights?date=${date}`)).status, 200);

  // jefe semanal, misiones, monedas, tienda, calendario, hábitos a dejar
  let cur = (await call('a', 'GET', `/api/state?date=${date}`)).data;
  assert.ok(cur.boss.hp >= 30 && cur.boss.damage >= 0 && !cur.boss.defeated);
  assert.equal((await call('a', 'POST', '/api/boss/claim', { date })).status, 400, 'jefe aún en pie');
  assert.equal(cur.quests.length, 3);
  const open = cur.quests.find((q) => !q.done);
  if (open) assert.equal((await call('a', 'POST', '/api/quests/claim', { date, id: open.id })).status, 400);
  const finished = cur.quests.find((q) => q.done);
  if (finished) {
    const before = cur.coins;
    r = (await call('a', 'POST', '/api/quests/claim', { date, id: finished.id })).data;
    assert.equal(r.state.coins, before + finished.coins);
    const again = (await call('a', 'POST', '/api/quests/claim', { date, id: finished.id })).data;
    assert.equal(again.state.coins, r.state.coins, 'no se cobra dos veces');
    cur = r.state;
  }
  assert.equal((await call('a', 'POST', '/api/rewards', { title: 'Capricho', icon: '🍰', price: 5 })).status, 200);
  assert.equal((await call('a', 'POST', '/api/rewards', { title: 'Viaje', price: 5000 })).status, 200);
  assert.equal((await call('a', 'POST', '/api/rewards', { title: 'Mal', price: 1 })).status, 400);
  const shop = (await call('a', 'GET', '/api/rewards')).data;
  assert.equal(shop.length, 2);
  r = (await call('a', 'POST', `/api/rewards/${shop[0].id}/buy`, { date })).data;
  assert.equal(r.state.coins, cur.coins - 5);
  assert.equal((await call('a', 'POST', `/api/rewards/${shop[1].id}/buy`, { date })).status, 400, 'sin monedas');
  assert.equal((await call('b', 'POST', `/api/rewards/${shop[0].id}/buy`, { date })).status, 404, 'recompensa ajena');
  const quit = (await call('a', 'POST', '/api/habits', { date, title: 'Sin azúcar', icon: '🍬', domain: 'health', difficulty: 2, days: [0, 1, 2, 3, 4, 5, 6], kind: 'quit' })).data;
  assert.equal(quit.habits.find((h) => h.title === 'Sin azúcar').kind, 'quit');
  const heat = (await call('a', 'GET', `/api/heatmap?date=${date}`)).data;
  assert.equal(heat.days.at(-1).date, date);
  assert.equal(new Date(heat.start + 'T00:00:00Z').getUTCDay(), 1, 'empieza en lunes');
  assert.ok(heat.days.some((d) => d.done > 0));
  assert.ok(typeof quit.habits[0].streak === 'number');

  assert.equal((await call('a', 'POST', '/api/habits', { date, title: 'x', days: [] })).status, 400);
  // sincronización sin conexión: los reintentos con estado deseado no duplican ni "desmarcan"
  const syncId = st.habits[3].id;
  const xpBefore = (await call('a', 'GET', `/api/state?date=${date}`)).data.xp;
  const t1 = (await call('a', 'POST', `/api/habits/${syncId}/toggle`, { date, done: true })).data;
  const t2 = (await call('a', 'POST', `/api/habits/${syncId}/toggle`, { date, done: true })).data;
  assert.equal(t2.state.xp, t1.state.xp, 'repetir done:true no suma XP otra vez');
  assert.ok(t1.state.xp > xpBefore);
  const t3 = (await call('a', 'POST', `/api/habits/${syncId}/toggle`, { date, done: false })).data;
  const t4 = (await call('a', 'POST', `/api/habits/${syncId}/toggle`, { date, done: false })).data;
  assert.equal(t4.state.xp, t3.state.xp);
  assert.equal(t3.state.xp, xpBefore, 'done:false devuelve el XP');
  const cid = 'abc123def456';
  const mk = { date, title: 'Creado sin conexión', icon: '🛰️', domain: 'mind', difficulty: 1, days: [0, 1, 2, 3, 4, 5, 6], cid };
  const c1 = (await call('a', 'POST', '/api/habits', mk)).data;
  const c2 = (await call('a', 'POST', '/api/habits', mk)).data;
  assert.equal(c2.habits.filter((h) => h.cid === cid).length, 1, 'reintentar la creación no duplica el hábito');
  assert.equal(c2.habits.length, c1.habits.length);
  const sk = c2.habits.find((h) => h.cid === cid).id;
  await call('a', 'POST', `/api/habits/${id2}/skip`, { date, skipped: false }); // libera el salto semanal gastado antes
  const s1 = (await call('a', 'POST', `/api/habits/${sk}/skip`, { date, skipped: true })).data;
  const s2 = (await call('a', 'POST', `/api/habits/${sk}/skip`, { date, skipped: true })).data;
  assert.equal(s2.state.skipsLeft, s1.state.skipsLeft, 'repetir skipped:true no gasta otro salto');
  const s3 = (await call('a', 'POST', `/api/habits/${sk}/skip`, { date, skipped: false })).data;
  assert.equal(s3.state.skipsLeft, s1.state.skipsLeft + 1);

  // salud: clave personal, recepción de datos del móvil/reloj y hábitos que se completan solos
  const ingest = (token, body) => fetch(base + '/api/health/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  assert.equal((await ingest(null, {})).status, 401, 'sin clave no entra');
  assert.equal((await ingest('rst_clave-inventada-0123456789', {})).status, 401);
  const hToken = (await call('a', 'POST', '/api/health/token', {})).data.token;
  assert.match(hToken, /^rst_[0-9a-f]{48}$/);
  const walk = (await call('a', 'POST', '/api/habits', { date, title: 'Caminar', icon: '🚶', domain: 'health', difficulty: 2, days: [0, 1, 2, 3, 4, 5, 6], auto: { metric: 'steps', min: 5000 } })).data;
  const walkId = walk.habits.find((h) => h.title === 'Caminar').id;
  assert.deepEqual(walk.habits.find((h) => h.id === walkId).auto, { metric: 'steps', min: 5000 });
  const gym = (await call('a', 'POST', '/api/habits', { date, title: 'Entrenar', icon: '🏋️', domain: 'health', difficulty: 3, days: [0, 1, 2, 3, 4, 5, 6], auto: { metric: 'exercise', min: 30 } })).data;
  const gymId = gym.habits.find((h) => h.title === 'Entrenar').id;
  const xpBeforeHealth = (await call('a', 'GET', `/api/state?date=${date}`)).data.xp;
  const payload = {
    data: {
      metrics: [{ name: 'step_count', units: 'count', data: [{ date: date + ' 09:00:00 +0100', qty: 3500 }, { date: date + ' 18:00:00 +0100', qty: 2800 }] }],
      workouts: [{ id: 'W-1', name: 'Running', start: date + ' 07:30:00 +0100', end: date + ' 08:10:00 +0100', duration: 2400, distance: { qty: 5.2, units: 'km' }, activeEnergyBurned: { qty: 410, units: 'kcal' } }],
    },
  };
  const r1 = await (await ingest(hToken, payload)).json();
  assert.equal(r1.metrics, 2);
  assert.equal(r1.workouts, 1);
  assert.deepEqual(r1.completed_habits.sort(), ['Caminar', 'Entrenar']);
  const hs = (await call('a', 'GET', `/api/state?date=${date}`)).data;
  assert.equal(hs.health.steps, 6300);
  assert.equal(hs.health.exercise, 40);
  assert.equal(hs.health.workouts, 1);
  assert.equal(hs.health.distance, 5.2);
  assert.ok(hs.habits.find((h) => h.id === walkId).done && hs.habits.find((h) => h.id === gymId).done, 'los hábitos con regla se completan solos');
  assert.ok(hs.xp > xpBeforeHealth);
  const r2 = await (await ingest(hToken, payload)).json(); // repetir el envío no duplica pasos, entrenamientos ni XP
  assert.deepEqual(r2.completed_habits, []);
  const hs2 = (await call('a', 'GET', `/api/state?date=${date}`)).data;
  assert.equal(hs2.health.steps, 6300);
  assert.equal(hs2.health.workouts, 1);
  assert.equal(hs2.xp, hs.xp);
  const simple = await (await ingest(hToken, { daily: [{ date, steps: 9000, exercise_minutes: 45 }], workouts: [{ id: 'S-1', type: 'Yoga', start: date + 'T19:00:00+01:00', minutes: 30 }] })).json();
  assert.equal(simple.workouts, 1);
  // ritmo cardiaco, reposo, variabilidad, oxígeno, sueño y frecuencia por entrenamiento
  await call('a', 'POST', '/api/habits', { date, title: 'Dormir 7 h', icon: '😴', domain: 'health', difficulty: 2, days: [0, 1, 2, 3, 4, 5, 6], auto: { metric: 'sleep', min: 7 } });
  const vit = await (await ingest(hToken, {
    data: {
      metrics: [
        { name: 'heart_rate', units: 'count/min', data: [{ date: date + ' 10:00:00 +0100', Min: 58, Avg: 72, Max: 120 }, { date: date + ' 11:00:00 +0100', Min: 60, Avg: 80, Max: 150 }, { date: date + ' 12:00:00 +0100', Min: 5, Avg: 900, Max: 999 }] },
        { name: 'resting_heart_rate', units: 'count/min', data: [{ date: date + ' 00:00:00 +0100', qty: 56 }] },
        { name: 'heart_rate_variability', units: 'ms', data: [{ date: date + ' 03:00:00 +0100', qty: 62 }] },
        { name: 'blood_oxygen_saturation', units: '%', data: [{ date: date + ' 03:00:00 +0100', qty: 0.97 }] },
        { name: 'sleep_analysis', units: 'hr', data: [{ date: date + ' 00:00:00 +0100', asleep: 7.4, deep: 1.2, rem: 1.8 }] },
      ],
      workouts: [{ id: 'W-2', name: 'Ciclismo', start: date + ' 17:00:00 +0100', end: date + ' 17:45:00 +0100', avgHeartRate: { qty: 141, units: 'count/min' }, maxHeartRate: { qty: 172, units: 'count/min' } }],
    },
  })).json();
  assert.ok(vit.completed_habits.includes('Dormir 7 h'), 'el hábito de sueño se completa solo');
  const sd = (await call('a', 'GET', `/api/state?date=${date}`)).data.health;
  assert.deepEqual(sd.hr, { avg: 76, min: 58, max: 150 }, 'los valores imposibles se descartan');
  assert.equal(sd.resting, 56);
  assert.equal(sd.hrv, 62);
  assert.equal(sd.spo2, 97, 'el oxígeno enviado como fracción se pasa a porcentaje');
  assert.equal(sd.sleep, 7.4);
  assert.equal(sd.sleepDeep, 1.2);
  const cyc = (await call('a', 'GET', `/api/health/summary?date=${date}`)).data.workouts.find((w) => w.id === 'W-2');
  assert.equal(cyc.avg_hr, 141);
  assert.equal(cyc.max_hr, 172);
  const big = { data: { metrics: [{ name: 'step_count', units: 'count', data: Array.from({ length: 3000 }, (_, i) => ({ date: '2026-01-05 ' + String(i % 24).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + ':' + String(Math.floor(i / 60) % 60).padStart(2, '0') + ' +0100', qty: 1 })) }] } };
  assert.equal((await ingest(hToken, big)).status, 200, 'admite cargas grandes de historial');
  const sum = (await call('a', 'GET', `/api/health/summary?date=${date}`)).data;
  assert.equal(sum.week.length, 7);
  assert.ok(sum.workouts.length >= 2);
  const man = (await call('a', 'POST', '/api/health/workouts', { date, type: 'Bici', minutes: 50, distance_km: 18 })).data;
  assert.ok(man.state.health.workouts >= 3);
  assert.equal((await call('a', 'POST', '/api/health/workouts', { date, type: 'Bici', minutes: 0 })).status, 400);
  assert.equal((await call('b', 'GET', `/api/health/summary?date=${date}`)).data.workouts.length, 0, 'los datos de salud son de cada persona');
  const manId = (await call('a', 'GET', `/api/health/summary?date=${date}`)).data.workouts.find((w) => w.type === 'Bici').id;
  assert.equal((await call('a', 'DELETE', `/api/health/workouts/${manId}?date=${date}`, {})).status, 200);
  assert.equal((await call('a', 'DELETE', '/api/health/token', {})).status, 200);
  assert.equal((await ingest(hToken, payload)).status, 401, 'una clave revocada deja de valer');

  // cuenta: contraseña, exportación, invitaciones de un solo uso y borrado
  assert.equal((await call('a', 'POST', '/api/account/password', { current: 'mala', next: 'otra-contraseña-1' })).status, 403);
  assert.equal((await call('a', 'POST', '/api/account/password', { current: 'contraseña-larga', next: 'corta' })).status, 400);
  assert.equal((await call('a', 'POST', '/api/account/password', { current: 'contraseña-larga', next: 'nueva-contraseña-1' })).status, 200);
  assert.equal((await call('a2', 'POST', '/api/login', { username: 'ana', password: 'nueva-contraseña-1' })).status, 200);
  assert.equal((await call('a3', 'POST', '/api/login', { username: 'ana', password: 'contraseña-larga' })).status, 401, 'la antigua ya no vale');
  const exp = await fetch(base + '/api/account/export', { headers: { Cookie: jar.a } });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  const dump = await exp.json();
  assert.ok(dump.habits.length >= 4 && dump.records.length > 0 && dump.user.name === 'ana');
  assert.equal((await call('b', 'POST', '/api/admin/invites', {})).status, 403, 'bea no administra');
  assert.equal((await call('b', 'GET', '/api/admin/invites')).status, 403);
  const inv = (await call('a', 'POST', '/api/admin/invites', {})).data.code;
  assert.match(inv, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.equal((await call('a', 'GET', '/api/admin/invites')).data.invites.length, 1);
  assert.equal((await call('c', 'POST', '/api/register', { username: 'cai', password: 'contraseña-larga', invite: inv.toLowerCase() })).status, 200);
  assert.equal((await call('d', 'POST', '/api/register', { username: 'dan', password: 'contraseña-larga', invite: inv })).status, 403, 'un solo uso');
  assert.equal((await call('a', 'GET', '/api/admin/invites')).data.members.length, 3);
  assert.equal((await call('c', 'POST', '/api/account/delete', { password: 'mala' })).status, 403);
  assert.equal((await call('c', 'POST', '/api/account/delete', { password: 'contraseña-larga' })).status, 200);
  assert.equal((await call('c', 'GET', '/api/me')).status, 401, 'cuenta borrada');
  assert.equal((await call('a', 'GET', '/api/admin/invites')).data.members.length, 2);

  assert.equal((await call('a', 'POST', '/api/logout', {})).status, 200);
  assert.equal((await call('a', 'GET', '/api/me')).status, 401);
  assert.equal((await fetch(base + '/')).status, 200);
  console.log('OK: todas las comprobaciones pasan');
} catch (e) {
  console.error('FALLO:', e);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => { srv.once('exit', resolve); srv.kill(); });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows aún puede retener el archivo */ }
}
