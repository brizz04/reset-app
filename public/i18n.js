// Internacionalización. El texto de origen de la interfaz está en español; cada idioma es un archivo
// public/locales/<código>.json con { "strings": { "texto en español": "traducción" }, "patterns": [[regex, reemplazo]] }.
// Lo que no tiene traducción se muestra en español, así que añadir un idioma nuevo puede hacerse poco a poco.
const KEY = 'reset.lang';
export const LANGS = { es: 'Español', en: 'English' };

function detect() {
  try { const saved = localStorage.getItem(KEY); if (saved && LANGS[saved]) return saved; } catch { /* sin almacenamiento */ }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}

export let lang = detect();
document.documentElement.lang = lang;
let dict = null;
const missing = new Set();
const debug = (() => { try { return localStorage.getItem('reset.debug') === '1'; } catch { return false; } })();
if (debug) window.__missing = () => [...missing].sort();

export const localeTag = () => (lang === 'es' ? 'es-ES' : 'en-GB');
export const fmtNum = (n, digits = 1) => new Intl.NumberFormat(localeTag(), { maximumFractionDigits: digits }).format(n);

// Carga el diccionario del idioma activo (con copia local para poder arrancar sin conexión)
export async function loadLocale() {
  document.documentElement.lang = lang;
  if (lang === 'es') { dict = null; return; }
  let data = null;
  try {
    const r = await fetch(`/locales/${lang}.json`);
    if (r.ok) { data = await r.json(); try { localStorage.setItem('reset.dict.' + lang, JSON.stringify(data)); } catch { /* sin espacio */ } }
  } catch { /* sin conexión */ }
  if (!data) { try { data = JSON.parse(localStorage.getItem('reset.dict.' + lang)); } catch { /* sin copia */ } }
  dict = data ? { strings: data.strings || {}, patterns: (data.patterns || []).map(([re, out]) => [new RegExp(re), out]) } : null;
}

export async function setLang(code) {
  if (!LANGS[code]) return;
  lang = code;
  try { localStorage.setItem(KEY, code); } catch { /* sin almacenamiento */ }
  await loadLocale();
}

// Traduce un texto de la interfaz (si no hay traducción, lo devuelve igual)
export function tr(s) {
  if (!dict || typeof s !== 'string' || !s || !/[A-Za-zÁ-úñ]/.test(s)) return s;
  const hit = dict.strings[s];
  if (hit !== undefined) return hit;
  const t = s.trim();
  if (t !== s && dict.strings[t] !== undefined) return s.replace(t, dict.strings[t]);
  // un emoji delante del texto (iconos de recompensas, avisos) no cambia la traducción
  const em = s.match(/^([^\p{L}\p{N}\s]+) (.+)$/u);
  if (em) { const r = tr(em[2]); if (r !== em[2]) return em[1] + ' ' + r; }
  // en el reemplazo, $1 inserta el grupo tal cual y $t1 lo inserta traducido
  for (const [re, out] of dict.patterns) {
    if (re.test(s)) return s.replace(re, (...m) => out.replace(/\$(t?)(\d)/g, (_, t, i) => (t ? tr(m[+i]) : m[+i])));
  }
  if (debug) missing.add(s);
  return s;
}
