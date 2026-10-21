// Small DOM and formatting helpers shared by the workbench.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  append(el, kids);
  return el;
}

export function setAttrs(el, attrs) {
  for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function put(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

export function btn(label, cls, onclick, extra) {
  return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, extra || {}), label);
}

export function hex(v, w = 8) {
  if (v === null || v === undefined) return '—';
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w, '0');
}

/** Cycles (10 ns) as a readable time. */
export function fmtT(c, digits) {
  if (c === null || c === undefined || !isFinite(c)) return '—';
  const a = Math.abs(c);
  const d = digits === undefined ? 3 : digits;
  if (a >= 1e8) return (c / 1e8).toFixed(Math.max(d + 1, 4)) + ' s';
  if (a >= 1e5) return (c / 1e5).toFixed(d) + ' ms';
  if (a >= 100) return (c / 100).toFixed(Math.min(d, 2)) + ' µs';
  return (c * 10).toFixed(0) + ' ns';
}

/** Frequency of a period in cycles. */
export function fmtF(period) {
  if (!period) return '';
  const hz = 1e8 / period;
  if (hz >= 1e6) return (hz / 1e6).toFixed(3) + ' MHz';
  if (hz >= 1e3) return (hz / 1e3).toFixed(3) + ' kHz';
  return hz.toFixed(3) + ' Hz';
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : (many || one + 's'));
}

export function parseNum(s) {
  const t = String(s).trim().replace(/_/g, '').toLowerCase();
  if (!t) return NaN;
  if (t.startsWith('0x')) return parseInt(t.slice(2), 16);
  if (t.startsWith('0b')) return parseInt(t.slice(2), 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

export function basename(p) {
  return String(p || '').split('/').pop();
}

export const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];

export const VECTORS = ['', 'GPIOA', 'GPIOB', 'TIMER0', 'TIMER1', 'SCI RX', 'SCI TX'];
