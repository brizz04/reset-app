// Pila de diálogos: solo el de arriba recibe teclado y Escape, el resto de la app queda inerte
// (no se puede enfocar ni tocar), el foco se queda dentro y vuelve al botón que abrió el diálogo.
const stack = [];
const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function syncInert() {
  const app = document.getElementById('app');
  if (app) app.inert = stack.length > 0;
}

document.addEventListener('keydown', (e) => {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.onEscape?.(); return; }
  if (e.key !== 'Tab') return;
  const items = [...top.el.querySelectorAll(FOCUSABLE)].filter((x) => !x.hidden && x.getClientRects().length);
  if (!items.length) { e.preventDefault(); top.el.focus(); return; }
  const first = items[0], last = items.at(-1);
  if (!top.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Devuelve la función que cierra el diálogo (la que quita el bloqueo y devuelve el foco)
export function openModal(el, { onEscape } = {}) {
  const entry = { el, onEscape, opener: document.activeElement };
  stack.push(entry);
  syncInert();
  (el.querySelector('input:not([type=hidden]), textarea, select') || el.querySelector(FOCUSABLE) || el).focus({ preventScroll: true });
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    syncInert();
    if (entry.opener && document.contains(entry.opener)) entry.opener.focus({ preventScroll: true });
  };
}
