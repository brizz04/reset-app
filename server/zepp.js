// Cliente de la nube de Zepp (Amazfit) para leer los datos de TU cuenta.
// Zepp no tiene una API pública: esto usa la misma interfaz que su web, sin documentar, así que puede dejar de
// funcionar cuando Zepp la cambie. Solo lee; no escribe nada en la cuenta.
import crypto from 'node:crypto';

const USER_URL = () => process.env.ZEPP_USER_URL || 'https://api-user.huami.com';
const API_URL = () => process.env.ZEPP_API_URL || 'https://api-mifit.zepp.com';
const APP = 'com.huami.webapp';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class ZeppError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; } // kind: 'login' | 'auth' | 'net'
}

async function call(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new ZeppError('No se pudo conectar con Zepp', 'net');
  }
  return res;
}

const form = (o) => new URLSearchParams(o).toString();
const webHeaders = () => ({ app_name: APP, appname: APP, appplatform: 'web', origin: 'https://user.zepp.com', referer: 'https://user.zepp.com/', 'user-agent': WEB_UA, 'x-request-id': crypto.randomUUID() });

// Inicia sesión con correo y contraseña (la identidad web no cierra la sesión de la app del móvil)
export async function login(email, password, country = 'US') {
  const cc = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : 'US';
  const r1 = await call(`${USER_URL()}/registrations/${encodeURIComponent(email)}/tokens`, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...webHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: 'HuaMi', country_code: cc, json_response: 'true', name: email, password, redirect_uri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html', state: 'REDIRECTION', token: 'access' }),
  });
  let code = null;
  const loc = r1.headers.get('location');
  if (loc) { try { code = new URL(loc, 'https://x.invalid').searchParams.get('access'); } catch { /* sin Location útil */ } }
  if (!code && r1.ok) { const j = await r1.json().catch(() => ({})); code = j.access || j.code || null; }
  if (!code) throw new ZeppError('Zepp no ha aceptado ese correo y contraseña', 'login');

  const r2 = await call(`${API_URL()}/v2/client/login`, {
    method: 'POST',
    headers: { ...webHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ allow_registration: 'false', app_name: APP, app_version: '1.0.0', code, country_code: cc, device_id: 'web_' + crypto.randomUUID(), device_model: 'web', dn: 'api-mifit.zepp.com,api-user.zepp.com,api-watch.zepp.com,auth.zepp.com', grant_type: 'access_token', source: APP, third_name: 'huami' }),
  });
  const j2 = await r2.json().catch(() => ({}));
  const loginToken = j2?.token_info?.login_token;
  const userId = j2?.token_info?.user_id;
  if (!loginToken || !userId) throw new ZeppError('Zepp no ha devuelto una sesión válida', 'login');

  const q = form({ app_name: APP, dn: 'api-mifit.zepp.com,api-user.zepp.com,auth.zepp.com', login_token: loginToken });
  const r3 = await call(`${API_URL()}/v1/client/app_tokens?${q}`, { headers: webHeaders() });
  const j3 = await r3.json().catch(() => ({}));
  const appToken = j3?.token_info?.app_token;
  if (!appToken) throw new ZeppError('Zepp no ha devuelto un token de acceso', 'login');
  return { appToken, userId: String(userId) };
}

const dataHeaders = (token) => ({
  apptoken: token, appname: 'com.huami.midong', appplatform: 'android_phone', 'user-agent': 'Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)',
  v: '2.0', vn: '9.12.5', cv: '9.12.5', lang: 'en_US', country: 'US', 'x-request-id': crypto.randomUUID(),
});

async function getJson(url, token) {
  const res = await call(url, { headers: dataHeaders(token) });
  if (res.status === 401 || res.status === 403) throw new ZeppError('La sesión de Zepp ha caducado', 'auth');
  if (!res.ok) throw new ZeppError('Zepp respondió con el error ' + res.status, 'net');
  return res.json().catch(() => { throw new ZeppError('Zepp envió una respuesta que no se entiende', 'net'); });
}

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Resumen diario: pasos, distancia, sueño y pulso en reposo. Cada día llega como JSON en base64.
export async function fetchDays(session, from, to) {
  const q = form({ query_type: 'summary', device_type: 'android_phone', userid: session.userId, from_date: from, to_date: to });
  const j = await getJson(`${API_URL()}/v1/data/band_data.json?${q}`, session.appToken);
  const out = [];
  for (const row of Array.isArray(j?.data) ? j.data : []) {
    const date = String(row.date_time || row.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.summary) continue;
    let s = row.summary;
    if (typeof s === 'string') { try { s = JSON.parse(Buffer.from(s, 'base64').toString('utf8')); } catch { continue; } }
    if (!s || typeof s !== 'object') continue;
    const day = { date };
    const steps = int(s.stp?.ttl);
    const dis = int(s.stp?.dis); // metros
    if (steps !== null && steps >= 0) day.steps = steps;
    if (dis !== null && dis >= 0) day.distance_km = Math.round(dis) / 1000;
    const dp = int(s.slp?.dp);
    const lt = int(s.slp?.lt);
    const rem = int(s.slp?.dt);
    if ((dp || 0) + (lt || 0) + (rem || 0) > 0) {
      day.sleep_hours = Math.round(((dp || 0) + (lt || 0) + (rem || 0)) / 6) / 10;
      if (dp) day.sleep_deep_hours = Math.round(dp / 6) / 10;
      if (rem) day.sleep_rem_hours = Math.round(rem / 6) / 10;
    }
    const rhr = int(s.slp?.rhr);
    if (rhr) day.resting_hr = rhr;
    out.push(day);
  }
  return out;
}

const SPORTS = { 1: 'Correr', 6: 'Caminar', 7: 'Correr', 8: 'Cinta de correr', 9: 'Bici', 10: 'Bici', 11: 'Elíptica', 12: 'Elíptica', 14: 'Natación', 15: 'Natación', 22: 'Senderismo', 49: 'Fuerza' };

function localIso(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// Entrenamientos recientes (la lista llega de más nuevo a más viejo); se queda con los de los últimos `days` días
export async function fetchWorkouts(session, days, tz) {
  const since = Date.now() - days * 86400000;
  const out = [];
  let cursor = null;
  for (let page = 0; page < 4; page++) {
    const q = form({ source: 'run.mi.com', userid: session.userId, count: '100', ...(cursor ? { trackid: cursor } : {}) });
    const j = await getJson(`${API_URL()}/v1/sport/run/history.json?${q}`, session.appToken);
    let items = j?.data?.summary ?? j?.data?.items ?? [];
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
    if (items && !Array.isArray(items) && Array.isArray(items.data)) items = items.data;
    if (!Array.isArray(items)) items = [];
    let reachedOld = false;
    for (const it of items) {
      const start = int(it.trackid);
      const secs = int(it.run_time);
      if (start === null || secs === null || secs <= 0) continue;
      if (start * 1000 < since) { reachedOld = true; continue; }
      const dist = int(it.dis ?? it.highPrecisionDistance);
      const w = { id: 'zepp-' + start, type: SPORTS[it.type] || 'Entrenamiento', start: localIso(start * 1000, tz), minutes: Math.round(secs / 6) / 10 };
      if (dist !== null && dist > 0) w.distance_km = Math.round(dist) / 1000;
      const kcal = int(it.calorie);
      if (kcal !== null && kcal > 0) w.calories = kcal;
      const avg = int(it.avg_heart_rate);
      const max = int(it.max_heart_rate);
      if (avg) w.avg_hr = avg;
      if (max) w.max_hr = max;
      out.push(w);
    }
    const next = j?.data?.next;
    if (reachedOld || !items.length || next == null || next === -1 || next === '-1' || next === 0 || next === '0') break;
    cursor = String(next);
  }
  return out;
}
