// Página para escuchar los sonidos candidatos de cada momento y anotar la elección.
const WHEN = {
  tap: ['Toque', 'Al pulsar el botón de completar un hábito. Corto y seco.'],
  done: ['Hábito completado', 'Cuando marcas un hábito. Recompensa pequeña que oirás muchas veces.'],
  'all-done': ['Día perfecto', 'Cuando completas todos los hábitos del día. Más celebración.'],
  'level-up': ['Subida de nivel', 'Pantalla de nivel con rayos azules. Tiene que ser épico.'],
  'pack-charge': ['Pack: carga', 'El sobre vibra y se carga (1,1 s). Tiene que subir en tensión.'],
  'pack-tear': ['Pack: rasgado', 'El sobre se rompe con un destello.'],
  'pack-slam': ['Pack: golpe', 'Suena a la vez que el rasgado: impacto grave.'],
  'reveal-common': ['Carta común', 'Revelado de una carta común. Sencillo.'],
  'reveal-rare': ['Carta rara', 'Revelado de una carta rara. Algo más especial.'],
  'reveal-epic': ['Carta épica', 'Revelado de una carta épica. Brillante y misterioso.'],
  'reveal-legendary': ['Carta legendaria', 'Revelado de una carta legendaria. El sonido más especial.'],
  notification: ['Aviso / logro', 'Cuando desbloqueas un logro. Amable y memorable.'],
  'ambient-breathing': ['Ambiente de respiración', 'De fondo en la respiración guiada, en bucle.'],
};

const lab = document.getElementById('lab');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const choice = {};
let current = null;

function play(btn, file) {
  if (current) {
    current.audio.pause();
    current.btn.textContent = '▶';
    const same = current.file === file;
    current = null;
    if (same) return;
  }
  const audio = new Audio(file);
  audio.addEventListener('ended', () => { btn.textContent = '▶'; current = null; });
  audio.play();
  btn.textContent = '■';
  current = { audio, btn, file };
}

const data = await (await fetch('/sfx/candidates.json', { cache: 'no-store' })).json();
for (const [slot, info] of Object.entries(data)) {
  const [title, desc] = WHEN[slot] || [slot, ''];
  choice[slot] = info.active;
  const card = el('section', 'card gap');
  card.append(el('b', null, title), el('div', 'muted small', desc));
  for (const o of info.options) {
    const row = el('label', 'choice');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = slot;
    radio.checked = o.id === info.active;
    radio.addEventListener('change', () => { choice[slot] = o.id; });
    const btn = el('button', 'iconbtn', '▶');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Escuchar ${o.label}`);
    btn.addEventListener('click', (e) => { e.preventDefault(); play(btn, o.file); });
    const name = el('span', 'grow', o.label);
    row.append(radio, btn, name, el('span', 'muted small', o.seconds ? `${o.seconds} s` : ''));
    card.append(row);
  }
  lab.append(card);
}

const out = el('textarea');
out.rows = 15;
out.readOnly = true;
const copy = el('button', 'btn block', 'Copiar mi elección');
copy.addEventListener('click', async () => {
  out.value = Object.entries(choice).map(([k, v]) => `${k}: ${v}`).join('\n');
  try { await navigator.clipboard.writeText(out.value); copy.textContent = 'Copiado ✓ pégalo en el chat'; } catch { copy.textContent = 'Selecciona el texto y cópialo'; out.select(); }
});
lab.append(copy, out);
