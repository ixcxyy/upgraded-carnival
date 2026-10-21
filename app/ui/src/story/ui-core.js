/* ───────── ui-core: shared state, DOM helpers, hotspot text, captures, storage ───────── */
const E = window.StoryEngine;
const L = window.StoryLedger;
const KEY = 'signal-noise.active-profile';
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const G = {
  S: null, engine: null,
  files: null, builtin: null, custom: false,
  db: null, profile: 'Player 1',
  settings: { casual: false, size: 'm' },
  ui: {
    tab: 'work', codex: 'people', view: 'story', ticket: null, doc: null,
    draft: {}, own: {}, rendered: 0, lastN: 0, seen: {}, sheet: null, confirm: null, keep: null,
  },
  live: {}, pop: null, saveOk: true, dlValue: undefined, dlReal: null,
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}
function setAttrs(el, attrs) {
  if (!attrs) return;
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'value') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}
function appendKids(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}
/* Like replaceChildren, but skips null and false (replaceChildren would print them as text). */
function put(el, ...kids) {
  el.replaceChildren();
  appendKids(el, kids);
  return el;
}
function btn(label, cls, onclick, extra) {
  return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, extra || {}), label);
}
function linkBtn(label, onclick) { return btn(label, 'link', onclick); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; }
function joinAnd(bits) {
  if (bits.length <= 1) return bits.join('');
  return bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function isNarrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches); }

/* Placeholders from @@ lines, so renaming the firm or the chip changes every line at once. */
function fill(text) {
  const m = G.S ? G.S.meta : {};
  return String(text == null ? '' : text)
    .replace(/%TITLE%/g, m.title || '')
    .replace(/%FIRMSHORT%/g, m.firmshort || m.firm || '')
    .replace(/%FIRM%/g, m.firm || '')
    .replace(/%MCU%/g, m.mcu || '')
    .replace(/%CITY%/g, m.city || '');
}

function splitAside(text) {
  const m = String(text).match(/^\(([^)]+)\)\s*(.*)$/);
  return m ? { aside: m[1], rest: m[2] } : { aside: null, rest: text };
}
function personByShort(who) { const id = G.S.shortToPerson[who]; return id ? G.S.people[id] : null; }
function isPlayer(who) { const p = G.S.meta.player; return !!p && G.S.shortToPerson[who] === p; }
function driverName(d) { return String(d || '').split(' — ')[0]; }
function driverWhat(d) { const i = String(d || '').indexOf(' — '); return i >= 0 ? d.slice(i + 3) : ''; }
function formLabel(T) { return T.form === 'lab' ? 'Lab sheet' : T.form === 'exam' ? 'Exam' : 'Work order'; }

/* ── hotspots ── */
function rich(text, fresh) {
  const frag = document.createDocumentFragment();
  for (const seg of E.segments(fill(text))) {
    if (!seg.clue) { frag.append(seg.text); continue; }
    const span = h('span', { class: 'hs', 'data-clue': seg.clue }, seg.text);
    decorate(span, fresh);
    frag.append(span);
  }
  return frag;
}
function decorate(el, fresh) {
  const id = el.dataset.clue;
  const C = G.S.clues[id];
  const status = C ? G.engine.clueStatus(id) : 'missing';
  const cs = G.engine.state.clues[id];
  const wasFresh = el.classList.contains('fresh');
  const base = el.classList.contains('ch') ? 'ch hs' : 'hs';
  el.setAttribute('class', base + ' v-' + (C ? C.volume : 'whisper') + ' st-' + status + (cs && cs.letgo && status === 'open' ? ' letgo' : ''));
  const live = status !== 'pending' && status !== 'closed' && status !== 'missing';
  if (live) { el.setAttribute('role', 'button'); el.tabIndex = 0; }
  else { el.removeAttribute('role'); el.removeAttribute('tabindex'); }
  if (C && C.volume === 'murmur' && status === 'open' && (fresh || wasFresh)) {
    el.classList.add('fresh');
    if (fresh) {
      const done = () => el.classList.remove('fresh');
      el.addEventListener('animationend', done, { once: true });
      setTimeout(done, 1900);
    }
  }
}
function refreshHotspots() { $$('[data-clue]').forEach(el => decorate(el, false)); }

/* ── captures: a logic-analyzer strip per channel, drawn from the story data ── */
function tracePath(pts, t0, t1) {
  const X = t => ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * 1000;
  const Y = v => (v ? 3 : 21);
  let v = 0;
  for (const p of pts) if (p[0] <= t0) v = p[1] ? 1 : 0;
  let d = 'M0 ' + Y(v);
  for (const p of pts) {
    const nv = p[1] ? 1 : 0;
    if (p[0] <= t0 || p[0] >= t1 || nv === v) continue;
    d += ' H' + X(p[0]).toFixed(1) + ' V' + Y(nv);
    v = nv;
  }
  return d + ' H1000';
}
function captureEl(T) {
  const cap = T.capture;
  const t0 = cap.span[0], t1 = cap.span[1];
  const dur = Math.max(1, t1 - t0);
  const secs = dur / 1000;
  const wrap = h('div', { class: 'cap' }, h('div', { class: 'cap-title' }, fill(cap.title) + ' · ' + (t0 / 1000) + '–' + secs + ' s'));
  const grid = (1000 / dur) * 100;
  for (const c of cap.channels) {
    const svg = sv('svg', { viewBox: '0 0 1000 24', preserveAspectRatio: 'none', 'aria-hidden': 'true', style: '--grid:' + grid.toFixed(3) + '%' },
      sv('path', { d: tracePath(E.wavePoints(c.wave, cap.span), t0, t1) }));
    const row = h('div', { class: 'ch' }, h('div', { class: 'nm', title: c.name }, c.name), svg);
    if (c.clue) {
      row.dataset.clue = c.clue;
      row.setAttribute('aria-label', c.name + ' trace');
      decorate(row, false);
    }
    wrap.append(row);
  }
  const step = secs > 8 ? 2 : 1;
  const axis = h('div', { class: 'axis', 'aria-hidden': 'true' });
  for (let s = Math.ceil(t0 / 1000); s * 1000 <= t1; s += step) {
    axis.append(h('span', { style: 'left:' + (((s * 1000 - t0) / dur) * 100).toFixed(2) + '%' }, s + ' s'));
  }
  wrap.append(axis);
  return wrap;
}

/* ── storage: one save file per profile, written by the app ── */
function saveBlob() {
  return JSON.stringify({
    format: 'signal-noise-save', version: 2, profile: G.profile, story: G.S.hash, updated: new Date().toISOString(),
    settings: G.settings,
    save: G.engine && G.engine.state.started ? G.engine.serialize() : null,
    bench: G.bench || {},
    files: G.custom ? G.files : undefined,
  });
}
let saveTimer = 0;
let savePending = Promise.resolve(true);
let saveRevision = 0;
function persist(now) {
  clearTimeout(saveTimer);
  const revision = ++saveRevision;
  G.saving = true;
  renderSaved();
  const go = () => {
    saveTimer = 0;
    if (!G.profile) return savePending;
    const profile = G.profile, data = saveBlob();
    // The backend atomically renames one temp file per profile. Serialize
    // requests so both that file and the newest snapshot have a single owner.
    savePending = savePending.then(() => window.K28.call('save_write', { profile, data }))
      .then(() => {
        if (G.profile === profile && revision === saveRevision) {
          G.saving = false; G.saveOk = true; G.saveErr = null; renderSaved();
        }
        return true;
      })
      .catch(err => {
        if (G.profile === profile && revision === saveRevision) {
          G.saving = false; G.saveOk = false; G.saveErr = String((err && err.message) || err); renderSaved();
        }
        return false;
      });
    return savePending;
  };
  if (now) return go();
  saveTimer = setTimeout(go, 400);
  return Promise.resolve();
}
/* A dispatched write matters just as much as a pending debounce timer. */
window.K28.beforeQuit(() => (saveTimer ? persist(true) : savePending));
function renderSaved() {
  const el = $('#saved');
  if (!el) return;
  el.textContent = G.saving ? 'Saving…' : G.saveOk === false ? 'Not saving: ' + (G.saveErr || 'error') : G.saveOk ? 'Saved' : '';
  el.classList.toggle('bad', G.saveOk === false);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}


