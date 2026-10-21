// The workbench: where a task's firmware is written, built, run on the emulated K28, debugged
// and submitted. It opens over the story, and reports passes and failures back to it.
//
//   window.Bench.init(bridge)   once, after the story has booted
//   window.Bench.open(taskId)   show the bench for a task
//   window.Bench.close()        back to the story

import { Editor } from './editor.js';
import { Wave } from './wave.js';
import { DebugPanel } from './debug.js';
import { renderRun, renderSubmit, renderConsole } from './results.js';
import { BoardView } from './board.js';
import { Datasheet } from './datasheet.js';
import DATASHEET from '../../../../content/sdk/datasheet.html';
import { h, put, btn, ibtn, icon, $, fmtT, basename, plural, hex } from './util.js';

const call = (cmd, args) => window.K28.call(cmd, args || {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errText = err => String((err && err.message) || err);

const S = {
  bridge: null,
  task: null,
  info: null,
  files: [],
  open: [],
  diags: {},
  build: null,
  busy: null,
  dbg: null,
  version: 0,
  lastRun: null,
  lastSubmit: null,
  waveOf: null,
  seeds: [1],
  seed: 1,
  saveTimers: new Map(),
  saving: new Map(),
  opening: 0,
  resetting: false,
  suppress: false,
  traceStale: false,
  disasmStale: false,
  bpTouched: new Set(),
  fileState: new Map(), // path → 'saving' | 'failed' | 'saved' (what the last write did)
  deleting: new Set(),
  analysed: false,
};

let ui = null;
let editor = null;
let wave = null;
let dbgPanel = null;
let board = null;
let sheet = null;

// ───────────────────────── persistence ─────────────────────────

function bench() {
  const b = S.bridge.bench();
  b.tasks = b.tasks || {};
  b.bps = b.bps || {};
  b.watches = b.watches || [];
  b.layout = b.layout || {};
  return b;
}
function TS() {
  const t = bench().tasks;
  return t[S.task] || (t[S.task] = {});
}
function L() {
  const l = bench().layout;
  if (!l.left) Object.assign(l, { left: 200, right: 440, bottom: 300, btab: 'wave', stab: 'work' });
  return l;
}
function persist(now) {
  return S.bridge.persist(now);
}
function P() {
  return S.bridge.profile();
}
function toast(m, iconName) {
  S.bridge.toast(m, iconName);
}

// ───────────────────────── small UI pieces ─────────────────────────

function splitter(kind, onDrag) {
  const el = h('div', { class: 'split split-' + kind, role: 'separator', tabindex: '0', 'aria-orientation': kind === 'v' ? 'vertical' : 'horizontal',
    'aria-label': kind === 'v' ? 'Resize the panel (arrow keys)' : 'Resize the analysis area (arrow keys)' });
  el.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const start = kind === 'v' ? ev.clientX : ev.clientY;
    const begin = onDrag(0, true);
    document.body.classList.add(kind === 'v' ? 'dragging-v' : 'dragging-h');
    const move = e => onDrag((kind === 'v' ? e.clientX : e.clientY) - start, false, begin);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-v', 'dragging-h');
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', ev => {
    const keys = kind === 'v' ? { ArrowLeft: -16, ArrowRight: 16 } : { ArrowUp: -16, ArrowDown: 16 };
    if (!(ev.key in keys)) return;
    ev.preventDefault();
    onDrag(keys[ev.key], false, onDrag(0, true));
    persist();
  });
  return el;
}

let menuEl = null;
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function menu(x, y, items) {
  closeMenu();
  menuEl = h('div', { class: 'bmenu', role: 'menu' }, items.filter(Boolean).map(([label, fn, danger, iconName]) => {
    const b = h('button', { type: 'button', role: 'menuitem', class: danger ? 'danger' : '' }, iconName ? icon(iconName) : null, label);
    b.addEventListener('click', () => { closeMenu(); fn(); });
    return b;
  }));
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menuEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  const first = menuEl.querySelector('button');
  if (first) first.focus();
  menuEl.addEventListener('keydown', ev => {
    const all = Array.from(menuEl.querySelectorAll('button'));
    const i = all.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); all[(i + (ev.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus(); }
    if (ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); closeMenu(); }
  });
  setTimeout(() => document.addEventListener('mousedown', function off(ev) {
    if (menuEl && !menuEl.contains(ev.target)) { closeMenu(); document.removeEventListener('mousedown', off); }
  }), 0);
}

// ───────────────────────── building the bench ─────────────────────────

function dockBtn(name, label, kbd, onclick, cls) {
  const b = h('button', { type: 'button', class: 'dock-btn ' + (cls || ''), 'aria-label': label, 'data-tip': label, 'data-kbd': kbd || null, 'aria-keyshortcuts': kbd ? kbd.replace(/\s/g, '') : null, 'data-tip-at': 'below' },
    icon(name, { size: 17 }), h('span', { class: 'dcap' }, label.split(' ')[0]));
  b.addEventListener('click', onclick);
  return b;
}

/** A vertical icon rail of panel tabs (the inspector) or a horizontal strip (the analysis area). */
function railTabs(list, onSel, cls, vertical) {
  const el = h('div', { class: 'ptabs ' + (cls || ''), role: 'tablist', 'aria-orientation': vertical ? 'vertical' : 'horizontal' });
  const btns = {};
  for (const [key, label, iconName, title] of list) {
    const b = h('button', { type: 'button', class: 'ptab', role: 'tab', 'aria-label': vertical ? label : null, 'data-tip': title || label, 'data-tip-at': vertical ? null : 'below' },
      icon(iconName, { size: vertical ? 19 : 15 }), h('span', { class: 'pl' }, label), h('span', { class: 'dot', hidden: true }));
    b.addEventListener('click', () => onSel(key));
    btns[key] = b;
    el.append(b);
  }
  el.addEventListener('keydown', ev => {
    const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const i = keys.indexOf(ev.key);
    if (i < 0) return;
    const all = Object.values(btns).filter(b => !b.hidden);
    const at = all.indexOf(document.activeElement);
    if (at < 0) return;
    ev.preventDefault();
    all[(at + (i ? 1 : all.length - 1)) % all.length].focus();
  });
  let ind = null;
  return {
    el,
    btns,
    select(k) {
      for (const key in btns) btns[key].setAttribute('aria-selected', String(key === k));
      if (btns[k]) btns[k].querySelector('.dot').hidden = true;
      if (window.SN) {
        if (!ind) ind = window.SN.indicator(el);
        requestAnimationFrame(() => ind.move(btns[k]));
      }
    },
    refresh() { if (ind) ind.refresh(); },
    dot(k, on) {
      if (btns[k]) btns[k].querySelector('.dot').hidden = !on;
    },
    show(k, on) {
      if (btns[k]) btns[k].hidden = !on;
    },
  };
}

function buildUi() {
  const root = $('#bench');
  ui = { root };

  ui.back = h('button', { type: 'button', class: 'bh-back', 'data-tip': 'Back to the story. Your code is saved as you type.', 'data-tip-at': 'below' }, icon('back'), h('span', null, 'Story'));
  ui.back.addEventListener('click', () => close());
  ui.code = h('span', { class: 'bt-code' });
  ui.name = h('span', { class: 'bt-name' });
  ui.chip = h('span', { class: 'bt-chip' });

  ui.build = dockBtn('build', 'Build', 'Ctrl+B', () => doBuild(), 'b-build');
  ui.run = dockBtn('run', 'Run on the chosen seed', 'Ctrl+Enter', () => doRun(), 'b-run');
  ui.debug = dockBtn('debug', 'Debug from main', 'F5', () => doDebug(), 'b-debug');
  ui.submit = dockBtn('submit', 'Submit every seed', 'Ctrl+Shift+Enter', () => doSubmit(), 'b-submit');
  ui.acts = h('div', { class: 'dock-group bb-acts', role: 'toolbar', 'aria-label': 'Build, run, debug and submit' }, ui.build, ui.run, ui.debug, ui.submit);

  ui.dCont = dockBtn('continue', 'Continue', 'F5', () => dbgCmd('continue'), 'go');
  ui.dPause = dockBtn('pause', 'Pause', 'F6', () => dbgPause(), 'go');
  ui.dOver = dockBtn('step-over', 'Step over', 'F10', () => dbgCmd('step_over'));
  ui.dInto = dockBtn('step-into', 'Step into', 'F11', () => dbgCmd('step_into'));
  ui.dOut = dockBtn('step-out', 'Step out', 'Shift+F11', () => dbgCmd('step_out'));
  ui.dBack = dockBtn('step-back', 'Step back one line (time runs backwards)', 'Shift+F10', () => dbgCmd('step_back'), 'rev');
  ui.dRestart = dockBtn('restart', 'Restart from reset (rebuilds if the code changed)', 'Ctrl+Shift+F5', () => dbgRestart());
  ui.dStop = dockBtn('stop', 'Stop debugging', 'Shift+F5', () => dbgStop(), 'stop');
  ui.dTime = h('span', { class: 'dtime mono', 'aria-live': 'off' });
  ui.dbgBar = h('div', { class: 'dock-group bb-dbg', role: 'toolbar', 'aria-label': 'Debugger', hidden: true },
    ui.dCont, ui.dPause, h('span', { class: 'dock-sep' }), ui.dOver, ui.dInto, ui.dOut, ui.dBack, h('span', { class: 'dock-sep' }), ui.dRestart, ui.dStop, ui.dTime);
  ui.dock = h('div', { class: 'cmd-dock glass' }, ui.acts, ui.dbgBar);

  ui.seed = h('select', { class: 'seed-sel', 'data-tip': 'The seed Run and Debug use. Submitting runs every seed.', 'data-tip-at': 'below', 'aria-label': 'Seed' });
  ui.seed.addEventListener('change', () => { S.seed = +ui.seed.value; TS().seed = S.seed; persist(); });
  ui.ownBox = h('input', { type: 'checkbox' });
  ui.ownBox.addEventListener('change', () => { TS().own = ui.ownBox.checked; persist(); });
  ui.own = h('label', { class: 'own switch', hidden: true }, ui.ownBox, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, 'Own check'));
  ui.status = h('div', { class: 'bb-status', role: 'status', 'aria-live': 'polite' });
  ui.focusBtn = ibtn('focus', 'Focus the editor', () => toggleFocus('editor'), { kbd: 'Ctrl+Shift+E', at: 'below', cls: 'outline' });
  ui.bar = h('header', { class: 'bb' },
    ui.back,
    h('div', { class: 'bt' }, ui.code, ui.name, ui.chip),
    ui.dock,
    h('div', { class: 'bb-opts' }, h('span', { class: 'seed-wrap' }, icon('flag', { size: 14 }), ui.seed), ui.own),
    ui.status,
    ui.focusBtn);

  ui.banner = h('div', { class: 'bbanner', hidden: true, role: 'status' });

  // Files.
  ui.filesHead = h('div', { class: 'pane-h' }, h('span', { class: 'pane-t' }, icon('files'), 'Files'),
    ibtn('panel-left', 'Hide files', () => setPane('files', false), { cls: 'sm' }));
  ui.files = h('nav', { class: 'bfiles', 'aria-label': 'Files' });
  ui.filesRail = h('div', { class: 'pane-rail' }, ibtn('files', 'Show files', () => setPane('files', true), { cls: 'sm' }));
  ui.filePane = h('div', { class: 'bpane bpane-files' }, ui.filesHead, ui.files, ui.filesRail);

  // Editor.
  ui.edtabs = h('div', { class: 'edtabs', role: 'tablist', 'aria-label': 'Open files' });
  ui.edhost = h('div', { class: 'edhost' });
  editor = new Editor(ui.edhost, {
    onChange: onEdit,
    onBreakpoints: onBps,
    onSave: () => saveAll(),
    onKey: () => {},
  });

  // Bottom panels.
  ui.bp = {};
  for (const k of ['wave', 'output', 'console', 'results', 'disasm']) ui.bp[k] = h('div', { class: 'bpanel bp-' + k, hidden: true, role: 'tabpanel' });
  ui.btabs = railTabs([
    ['wave', 'Waveform', 'wave', 'Every pin over time'],
    ['results', 'Results', 'results', 'What the checker said'],
    ['console', 'Console', 'console', 'What the firmware wrote to DBGCON'],
    ['output', 'Build', 'output', 'Compiler and linker output'],
    ['disasm', 'Disassembly', 'disasm', 'The machine code around the program counter'],
  ], k => { selectBottom(k); setPane('bottom', true); }, 'btabs');
  ui.bFocus = ibtn('focus', 'Enlarge the analysis area', () => toggleFocus('wave'), { cls: 'sm', at: 'below' });
  ui.bToggle = ibtn('chev-down', 'Hide the analysis area', () => setPane('bottom', !paneOpen('bottom')), { cls: 'sm', kbd: 'Ctrl+J', at: 'below' });
  wave = new Wave(ui.bp.wave, {
    onGoto: t => dbgCmd('goto_time', { t }),
    onRun: () => doRun(),
  });
  ui.bottom = h('div', { class: 'bottom' }, h('div', { class: 'bstrip' }, ui.btabs.el, h('span', { class: 'grow' }), ui.bFocus, ui.bToggle), h('div', { class: 'bpanels' }, Object.values(ui.bp)));

  // Inspector: content, then its rail of tabs.
  ui.sp = {};
  for (const k of ['work', 'board', 'debug', 'datasheet']) ui.sp[k] = h('div', { class: 'spanel sp-' + k, hidden: true, role: 'tabpanel' });
  ui.stabs = railTabs([
    ['work', 'Work order', 'work'],
    ['board', 'Board', 'board', 'Board: pins and live levels'],
    ['debug', 'Debug', 'debug', 'Debugger: stack, variables, watches, registers'],
    ['datasheet', 'Datasheet', 'datasheet', 'K28 datasheet: search and contents'],
  ], k => {
    if (L().stab === k && paneOpen('side')) { setPane('side', false); return; }
    selectSide(k);
    setPane('side', true);
  }, 'stabs', true);
  board = new BoardView(ui.sp.board);
  dbgPanel = new DebugPanel(ui.sp.debug, {
    call,
    layout: () => L(),
    persist: () => persist(),
    toast,
    watches: () => bench().watches,
    setWatches: list => { bench().watches = list; persist(); },
    bpList,
    removeBp,
    clearBps,
    gotoLine: (p, l) => gotoLine(p, l),
    gotoFrame: (p, l) => { if (inWorkspace(p)) gotoLine(p, l, true); },
    edited: () => { S.traceStale = true; S.disasmStale = true; refreshVisibleBottom(); },
  });
  ui.sideHead = h('div', { class: 'pane-h' }, ui.sideTitle = h('span', { class: 'pane-t' }),
    ibtn('panel-right', 'Hide the inspector', () => setPane('side', false), { cls: 'sm' }));
  ui.side = h('aside', { class: 'bside' }, ui.sideHead, h('div', { class: 'spanels' }, Object.values(ui.sp)));

  ui.center = h('div', { class: 'bcenter' },
    h('div', { class: 'edpane' }, ui.edtabs, ui.edhost),
    ui.hsplit = splitter('h', (d, start, begin) => {
      if (start) return L().bottom;
      L().bottom = Math.max(150, Math.min(window.innerHeight - 220, begin - d));
      applyLayout();
    }),
    ui.bottom);
  ui.body = h('div', { class: 'bb-body' },
    ui.filePane,
    ui.lsplit = splitter('v', (d, start, begin) => {
      if (start) return L().left;
      L().left = Math.max(150, Math.min(420, begin + d));
      applyLayout();
    }),
    ui.center,
    ui.rsplit = splitter('v', (d, start, begin) => {
      if (start) return L().right;
      L().right = Math.max(300, Math.min(Math.round(window.innerWidth * 0.5), begin - d));
      applyLayout();
    }),
    ui.side,
    ui.stabs.el);
  ui.lsplit.classList.add('split-l');
  ui.rsplit.classList.add('split-r');
  root.append(ui.bar, ui.banner, ui.body);
  applyLayout();
  window.addEventListener('resize', () => { if (isOpen()) applyLayout(); });
}

/** Saved sizes, clamped to the window we have now (a layout saved on a big screen still fits a small one). */
function applyLayout() {
  const l = L();
  const W = window.innerWidth, H = window.innerHeight;
  const left = Math.max(150, Math.min(l.left, Math.round(W * 0.22)));
  const right = Math.max(300, Math.min(l.right, Math.round(W * 0.36)));
  const bottom = Math.max(150, Math.min(l.bottom, H - 260));
  ui.root.style.setProperty('--bl', left + 'px');
  ui.root.style.setProperty('--br', right + 'px');
  ui.root.style.setProperty('--bh', bottom + 'px');
  for (const k of ['files', 'side', 'bottom']) ui.root.classList.toggle('no-' + k, !paneOpen(k));
  ui.root.classList.toggle('focus-editor', l.focus === 'editor');
  ui.root.classList.toggle('focus-wave', l.focus === 'wave');
  ui.focusBtn.classList.toggle('on', l.focus === 'editor');
  ui.focusBtn.setAttribute('aria-pressed', String(l.focus === 'editor'));
  ui.focusBtn.setAttribute('data-tip', l.focus === 'editor' ? 'Bring the panels back' : 'Focus the editor');
  ui.bFocus.setAttribute('aria-pressed', String(l.focus === 'wave'));
  ui.bFocus.setAttribute('data-tip', l.focus === 'wave' ? 'Back to the normal layout' : 'Enlarge the analysis area');
  const bOpen = paneOpen('bottom');
  ui.bToggle.replaceChildren(icon(bOpen ? 'chev-down' : 'chev-up'));
  ui.bToggle.setAttribute('aria-label', bOpen ? 'Hide the analysis area' : 'Show the analysis area');
  ui.bToggle.setAttribute('data-tip', bOpen ? 'Hide the analysis area' : 'Show the analysis area');
  ui.bToggle.setAttribute('aria-expanded', String(bOpen));
  if (wave) wave.schedule();
  if (ui.btabs) ui.btabs.refresh();
  if (ui.stabs) ui.stabs.refresh();
}

/**
 * Panels: files, side (inspector), bottom (analysis). A player's explicit choice is kept in the
 * layout. The analysis area starts folded until there is something to analyse (a build, run or
 * debug session), unless the player has opened or closed it themselves.
 */
function paneOpen(k) {
  const l = L();
  if (l.focus === 'editor') return false;
  if (k === 'files') return l.filesOpen !== false && !(window.innerWidth < 1200 && l.filesOpen !== true);
  if (k === 'side') return l.sideOpen !== false;
  if (k === 'bottom') return l.focus === 'wave' || (l.bottomOpen !== undefined ? l.bottomOpen : !!S.analysed);
  return true;
}
function setPane(k, open) {
  const l = L();
  if (l.focus === 'editor' && open) l.focus = null;
  if (k === 'files') l.filesOpen = !!open;
  if (k === 'side') l.sideOpen = !!open;
  if (k === 'bottom') { l.bottomOpen = !!open; if (!open && l.focus === 'wave') l.focus = null; }
  persist();
  applyLayout();
}
/** Something worth showing in the analysis area happened; unfold it unless the player folded it. */
function analysed() {
  if (S.analysed) return;
  S.analysed = true;
  if (ui) applyLayout();
}
function toggleFocus(which) {
  const l = L();
  l.focus = l.focus === which ? null : which;
  if (which === 'wave' && l.focus) selectBottom(L().btab || 'wave');
  persist();
  applyLayout();
  if (l.focus === 'editor') editor.focus();
}

function selectBottom(k) {
  L().btab = k;
  ui.btabs.select(k);
  for (const key in ui.bp) ui.bp[key].hidden = key !== k;
  if (k === 'wave') wave.schedule();
  refreshVisibleBottom();
}

const SIDE_TITLES = { work: ['work', 'Work order'], board: ['board', 'Board'], debug: ['debug', 'Debugger'], datasheet: ['datasheet', 'Datasheet'] };
function selectSide(k) {
  L().stab = k;
  ui.stabs.select(k);
  const t = SIDE_TITLES[k] || SIDE_TITLES.work;
  put(ui.sideTitle, icon(t[0]), t[1]);
  for (const key in ui.sp) ui.sp[key].hidden = key !== k;
  if (k === 'datasheet') {
    if (!sheet) sheet = new Datasheet(ui.sp.datasheet, DATASHEET);
    sheet.load();
  }
  if (k === 'work') renderWork();
}

function refreshVisibleBottom() {
  const k = L().btab;
  if (!S.dbg || S.dbg.running) return;
  if ((k === 'wave' || k === 'console') && S.traceStale) refreshLiveTrace();
  if (k === 'disasm' && S.disasmStale) refreshDisasm();
}

// ───────────────────────── status ─────────────────────────

const STATUS_ICON = { ok: 'ok', bad: 'fail', warn: 'warn', busy: 'spinner', '': 'info' };
/** The readout next to the dock: one short line, the whole text in its tooltip. */
function status(kind, text) {
  const k = kind || '';
  put(ui.status, text ? icon(STATUS_ICON[k] || 'info', { size: 15, class: k === 'busy' ? 'rot' : '' }) : null, h('span', { class: 'st' }, text || ''));
  ui.status.className = 'bb-status ' + k + (text ? '' : ' empty');
  if (text) ui.status.setAttribute('data-tip', text); else ui.status.removeAttribute('data-tip');
  ui.status.setAttribute('data-tip-at', 'below');
  if (window.SN && text) {
    window.SN.refreshTip(ui.status);
    window.SN.motion.animate(ui.status, [{ opacity: 0.4, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { dur: 200, key: 'st' });
  }
}

function setBusy(kind, text) {
  S.busy = kind;
  refreshButtons();
  if (kind) status('busy', text);
  else if (ui.status.classList.contains('busy')) status('', ''); // nothing reported: don't leave a spinner behind
}

/**
 * What the dock points at: the running action while one runs, otherwise the next sensible
 * step for this task (run after a change, submit after a passing run). Never a requirement:
 * Submit stays available without a passing run, because failed submissions earn hints.
 */
function emphasis() {
  if (S.busy) return { build: ui.build, run: ui.run, submit: ui.submit, debug: ui.debug }[S.busy] || null;
  if (S.dbg) return null;
  const r = S.lastRun;
  if (r && r.result && r.result.pass && r.version === S.version) return ui.submit;
  return ui.run;
}

function refreshButtons() {
  const off = !!S.busy || !toolchainOk();
  for (const b of [ui.build, ui.run, ui.debug, ui.submit]) {
    b.disabled = off;
    b.classList.toggle('busy', S.busy && b === emphasis());
  }
  ui.seed.disabled = !!S.busy;
  if (window.SN) {
    if (!ui.dockInd) ui.dockInd = window.SN.indicator(ui.acts, 'dock-ind');
    const e = emphasis();
    for (const b of [ui.build, ui.run, ui.debug, ui.submit]) b.classList.toggle('emph', b === e);
    requestAnimationFrame(() => ui.dockInd.move(ui.acts.hidden ? null : e));
  }
}

function toolchainOk() {
  const i = S.bridge.init();
  return !!(i && i.toolchain && i.toolchain.ok);
}

// ───────────────────────── opening and closing ─────────────────────────

function levelInfo(id) {
  const i = S.bridge.init();
  return ((i && i.levels) || []).find(l => l.id === id) || null;
}

function storyTask(id) {
  const st = S.bridge.story();
  return st && st.tasks ? st.tasks[id] : null;
}

async function open(id, opts) {
  if (!S.bridge) return;
  if (!ui) buildUi();
  const info = levelInfo(id);
  if (!info) { toast('There is no bench for task ' + id + '.', 'alert'); return; }
  // Where the task's title was on the story side, before the story is covered.
  const from = opts && opts.from && opts.from.isConnected ? opts.from : null;
  const fromRect = from ? from.getBoundingClientRect() : null;
  if (S.task && S.task !== id && !(await switchAway())) return false;
  const same = S.task === id;
  const entering = ui.root.hidden;
  S.task = id;
  S.info = info;
  if (entering && S.bridge.keepScroll) S.bridge.keepScroll();
  $('#app').classList.add('benching');
  ui.root.hidden = false;
  closeMenu();
  const t = TS();
  if (!same) S.analysed = false;
  applyLayout();
  S.seed = t.seed || 1;
  S.seeds = Array.from(new Set([1].concat(t.seeds || [], [S.seed])));
  renderHeader();
  if (entering && window.SN) {
    // Continuity: the bench rises into place and the task's title flies into its header.
    window.SN.motion.animate(ui.root, [{ opacity: 0, transform: 'translateY(10px) scale(0.995)' }, { opacity: 1, transform: 'none' }], { dur: 320, ease: window.SN.motion.EASE.soft, key: 'enter' });
    if (fromRect) window.SN.motion.morph(fromRect, from, ui.name, { dur: 440 });
  }
  renderSeeds();
  board.set(info);
  ui.banner.hidden = true;
  selectSide(same ? L().stab : (L().stab === 'debug' ? 'work' : L().stab || 'work'));
  selectBottom(L().btab || 'wave');
  if (!same) {
    S.lastSubmit = S.lastSubmit && S.lastSubmit.task === id ? S.lastSubmit : null;
    wave.setTrace(null);
    wave.setEvidence(null);
    put(ui.bp.results, h('div', { class: 'pempty' }, icon('results', { size: 22 }), h('b', null, 'No verdict yet'),
      h('span', null, 'Run the firmware to check it against one seed, or submit it to run every seed, the hidden ones too.'),
      h('span', { class: 'row' }, h('span', { class: 'kbd' }, 'Ctrl+Enter'), ' run · ', h('span', { class: 'kbd' }, 'Ctrl+Shift+Enter'), ' submit')));
    renderConsole(ui.bp.console, null);
    S.build = null;
    S.diags = {};
    renderOutput();
    renderDisasm(null);
  }
  refreshButtons();
  if (!toolchainOk()) {
    const tc = S.bridge.init().toolchain || {};
    status('bad', 'No C compiler: ' + (tc.error || 'not found'));
  } else if (!same) status('', 'Ready. Build Ctrl+B · run Ctrl+Enter · debug F5.');
  try {
    const r = await call('task_prepare', { profile: P(), task: id });
    S.files = r.files;
  } catch (err) {
    status('bad', errText(err));
    return;
  }
  const main = 'tasks/' + id + '/main.c';
  const exists = p => S.files.some(f => f.path === p);
  let want = (t.open || []).filter(exists);
  if (!want.length) want = [exists(main) ? main : (S.files.find(f => f.kind === 'task') || S.files[0] || {}).path].filter(Boolean);
  for (const p of want) await openFile(p, false);
  const active = t.active && exists(t.active) ? t.active : want[0];
  if (active) await openFile(active, true);
  renderFiles();
  renderTabs();
  if (!same && S.lastSubmit && S.lastSubmit.task === id) renderSubmit(ui.bp.results, S.lastSubmit, resCtx);
  setTimeout(() => editor.focus(), 30);
}

/** Leaving one task for another: save, stop the debugger, close its files. */
async function switchAway() {
  if (!(await saveAll())) return false;
  if (S.dbg) await dbgStop(true);
  for (const p of S.open.slice()) editor.close(p);
  S.open = [];
  S.lastRun = null;
  S.waveOf = null;
  return true;
}

async function close() {
  closeMenu();
  if (!ui || ui.root.hidden) return true;
  if (!(await saveAll())) return false;
  if (S.dbg) await dbgStop(true);
  if (S.task) {
    TS().open = S.open.slice();
    TS().active = editor.current();
  }
  if ((await persist(true)) === false) return false;
  $('#app').classList.remove('benching');
  ui.root.hidden = true;
  S.bridge.refresh();
  if (window.SN) window.SN.motion.animate($('.main'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { dur: 260, key: 'back' });
  return true;
}

/** A profile owns the buffers as well as the saved layout, even for the same task ID. */
async function reset() {
  if (S.busy || S.opening || S.resetting) {
    toast('Wait for the current workbench operation before changing profiles.');
    return false;
  }
  S.resetting = true;
  try {
    if (!(await close()) || !(await switchAway())) return false;
    for (const timer of S.saveTimers.values()) clearTimeout(timer);
    S.saveTimers.clear();
    Object.assign(S, { task: null, info: null, files: [], diags: {}, build: null,
      lastRun: null, lastSubmit: null, waveOf: null, version: 0, analysed: false,
      seeds: [1], seed: 1, traceStale: false, disasmStale: false });
    S.fileState.clear();
    S.bpTouched.clear();
    return true;
  } finally {
    S.resetting = false;
  }
}

function isOpen() {
  return !!ui && !ui.root.hidden;
}

// ───────────────────────── header, seeds, work order ─────────────────────────

function renderHeader() {
  const T = storyTask(S.task);
  const fill = t => S.bridge.fill(t || '');
  ui.code.textContent = S.task;
  ui.name.textContent = T ? fill(T.title) : S.info.title;
  const ts = S.bridge.engine().state.tasks[S.task];
  const form = T ? T.form : 'workorder';
  if (ts && ts.status === 'passed') {
    put(ui.chip, icon('check', { size: 13 }), form === 'exam' ? 'Handed in' : form === 'lab' ? 'Passed' : 'Satisfactory');
    ui.chip.className = 'bt-chip done';
  } else {
    put(ui.chip, ts && ts.fails ? plural(ts.fails, 'failed submission') : form === 'exam' ? 'Exam' : 'Open');
    ui.chip.className = 'bt-chip' + (ts && ts.fails ? ' warn' : ' live');
  }
  ui.name.setAttribute('data-task-title', S.task);
  const extras = S.info.extra ? S.bridge.extras(S.task) : [];
  ui.own.hidden = !extras.length;
  if (extras.length) {
    ui.own.setAttribute('data-tip', 'Run and debug with the stimulus of your own check. Submitting always includes it; it only adds.');
    ui.own.setAttribute('data-tip-at', 'below');
    ui.ownBox.checked = TS().own !== false;
  }
}

function renderSeeds() {
  const failed = new Set();
  if (S.lastSubmit && S.lastSubmit.task === S.task) for (const s of S.lastSubmit.base) if (!s.pass) failed.add(s.seed);
  put(ui.seed, S.seeds.map(s => h('option', { value: String(s), selected: s === S.seed },
    'Seed ' + s + (s === 1 ? ' · visible' : ' · hidden') + (failed.has(s) ? ' · failed' : ''))));
  ui.seed.value = String(S.seed);
}

function ownOn() {
  return !ui.own.hidden && ui.ownBox.checked;
}

function renderWork() {
  if (!S.task || !ui) return;
  let el;
  try {
    el = S.bridge.ticketEl(S.task);
  } catch (err) {
    el = h('p', { class: 'dim' }, 'The work order is not available: ' + errText(err));
  }
  put(ui.sp.work, h('div', { class: 'workv' }, el));
}

// ───────────────────────── files and tabs ─────────────────────────

function inWorkspace(p) {
  return !!p && /^(tasks|lib|sdk)\//.test(p);
}

const FILE_ICON = { c: 'file', h: 'file', s: 'chip', ld: 'output', txt: 'doc' };
function fileStateIcon(p) {
  const st = S.fileState.get(p);
  if (st === 'failed') return h('span', { class: 'fstate bad', 'data-tip': 'Not saved: the last write failed. Your text is kept; it retries on the next edit or Ctrl+S.' }, icon('alert', { size: 13 }));
  if (st === 'saving') return h('span', { class: 'fstate busy', 'data-tip': 'Saving…' }, icon('spinner', { size: 13, class: 'rot' }));
  if (editor.isDirty(p)) return h('span', { class: 'fstate dirty', 'data-tip': 'Changed; saves in a moment' }, h('i'));
  return null;
}

function renderFiles() {
  if (!S.task) return;
  const errCount = p => (S.diags[p] || []).filter(d => d.severity === 'error').length;
  const warnCount = p => (S.diags[p] || []).filter(d => d.severity === 'warning').length;
  const group = (kind, title, note, canAdd, iconName) => {
    const list = S.files.filter(f => f.kind === kind);
    const prefix = kind === 'task' ? 'tasks/' + S.task + '/' : 'lib/';
    const head = h('div', { class: 'fg-h' }, h('span', { class: 'fg-t' }, icon(iconName, { size: 13 }), title),
      canAdd ? ibtn('file-new', 'New file in ' + prefix, () => newFile(prefix), { cls: 'sm' }) : null,
      kind === 'sdk' ? h('span', { class: 'ro-tag', 'data-tip': 'The SDK is read-only' }, icon('lock', { size: 12 })) : null);
    const ul = h('ul', { class: 'fl' + (note ? ' muted' : ''), role: 'list' }, list.map(f => {
      const e = errCount(f.path), w = warnCount(f.path);
      const x = (/\.([A-Za-z]+)$/.exec(f.name) || [, ''])[1].toLowerCase();
      const li = h('li', { class: (editor.current() === f.path ? 'on' : '') + (S.open.includes(f.path) ? ' open' : ''), tabindex: '0', 'data-tip': f.path + (f.readonly ? ' · read-only' : '') + ' · right-click for more', 'aria-current': editor.current() === f.path ? 'true' : null },
        icon(FILE_ICON[x] || 'file', { size: 14, class: 'fi ' + ext(f.name) }),
        h('span', { class: 'fn' }, f.name),
        e ? h('span', { class: 'badge err', 'aria-label': plural(e, 'error') }, String(e)) : w ? h('span', { class: 'badge warn', 'aria-label': plural(w, 'warning') }, String(w)) : null,
        fileStateIcon(f.path));
      li.addEventListener('click', () => openFile(f.path, true));
      li.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') openFile(f.path, true);
        if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) { ev.preventDefault(); const r = li.getBoundingClientRect(); fileMenu(f, r.left + 20, r.bottom); }
        if (ev.key === 'F2' && !f.readonly) renameFile(f);
        if (ev.key === 'Delete' && !f.readonly) deleteFile(f);
      });
      li.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        fileMenu(f, ev.clientX, ev.clientY);
      });
      return li;
    }));
    return h('div', { class: 'fg' }, head, note ? h('p', { class: 'fg-note' }, note) : null, ul,
      !list.length && kind === 'lib' ? h('p', { class: 'fg-note' }, 'Drivers you write once and reuse. Every .c here is linked into every task except the exam.') : null);
  };
  put(ui.files,
    group('task', 'Task ' + S.task, null, true, 'work'),
    group('lib', 'Library', S.info.library ? null : 'Not linked into this task: exam rules.', true, 'library'),
    group('sdk', 'SDK', null, false, 'chip'),
    h('div', { class: 'fg-foot' }, btn('Open the folder', 'quiet small', () => call('reveal', { profile: P(), path: 'tasks/' + S.task + '/main.c' }).catch(err => toast(errText(err), 'alert')), null, 'folder-open')));
}

function ext(name) {
  const m = /\.([A-Za-z]+)$/.exec(name);
  return m ? 'x-' + m[1].toLowerCase() : '';
}

function fileMenu(f, x, y) {
  const items = [['Open', () => openFile(f.path, true), false, 'file']];
  if (!f.readonly) {
    items.push(['Rename…', () => renameFile(f), false, 'rename']);
    items.push(['Delete…', () => deleteFile(f), true, 'delete']);
  }
  items.push(['Show in folder', () => call('reveal', { profile: P(), path: f.path }).catch(err => toast(errText(err), 'alert')), false, 'folder-open']);
  menu(x, y, items);
}

async function refreshFiles() {
  try {
    const r = await call('ws_list', { profile: P(), task: S.task });
    S.files = r.files;
  } catch (err) { toast(errText(err), 'alert'); }
  renderFiles();
}

/* File operations ask in the game's own dialogs. A refusal from the backend (a taken name, a
   bad extension, a disk error) is shown in the dialog, which stays open for another try. */
async function newFile(prefix) {
  const profile = P(), task = S.task;
  const made = await window.SN.dialog.prompt({
    title: 'New file', icon: 'file-new', ok: 'Create', label: 'Name, in ' + prefix,
    input: { value: prefix.startsWith('lib') ? 'gpio.c' : 'util.c', mono: true, hint: 'Ends in .c, .h, .S or .txt.' },
    validate: v => !v ? 'Give the file a name.' : /[\\/]/.test(v) ? 'Just a name, without folders.' : null,
    onSubmit: async n => {
      if (P() !== profile || S.task !== task) throw new Error('The workbench changed task meanwhile.');
      await call('ws_create', { profile, path: prefix + n });
    },
  });
  if (made === null || P() !== profile || S.task !== task) return;
  await refreshFiles();
  await openFile(prefix + made, true);
}

async function renameFile(f) {
  const dir = f.path.slice(0, f.path.length - f.name.length);
  const profile = P();
  let to = null;
  const name = await window.SN.dialog.prompt({
    title: 'Rename ' + f.name, icon: 'rename', ok: 'Rename', label: 'New name', input: { value: f.name, mono: true },
    validate: v => !v ? 'Give the file a name.' : /[\\/]/.test(v) ? 'Just a name, without folders.' : null,
    onSubmit: async n => {
      if (n === f.name) return;
      if (P() !== profile) throw new Error('The profile changed meanwhile.');
      if (!(await saveFile(f.path))) throw new Error('Could not save ' + f.name + ' first; nothing was renamed.');
      await call('ws_rename', { profile, from: f.path, to: dir + n });
      to = dir + n;
    },
  });
  if (name === null || !to || P() !== profile) return;
  const wasOpen = S.open.includes(f.path);
  const bps = bench().bps[f.path];
  delete bench().bps[f.path];
  if (bps) bench().bps[to] = bps;
  if (wasOpen) await closeFile(f.path, true);
  S.fileState.delete(f.path);
  await refreshFiles();
  if (wasOpen) await openFile(to, true);
  persist();
}

async function deleteFile(f) {
  const ok = await window.SN.dialog.confirm({
    title: 'Delete ' + f.name + '?', icon: 'delete', danger: true, ok: 'Delete', cancel: 'Keep it',
    body: f.path + ' is removed from your workspace folder. This cannot be undone.',
  });
  if (!ok) return;
  await removeFile(f);
}

/** Delete without asking. No autosave of this file, queued or in flight, may land after the delete. */
async function removeFile(f) {
  S.deleting.add(f.path);
  try {
    const t = S.saveTimers.get(f.path);
    if (t) { clearTimeout(t); S.saveTimers.delete(f.path); }
    // A write in flight may be followed by a newer one; wait until the whole chain is done.
    while (S.saving.has(f.path)) await S.saving.get(f.path);
    try {
      await call('ws_delete', { profile: P(), path: f.path });
    } catch (err) { toast(errText(err), 'alert'); return false; }
    delete bench().bps[f.path];
    S.fileState.delete(f.path);
    if (S.open.includes(f.path)) await closeFile(f.path, true);
    persist();
    await refreshFiles();
    return true;
  } finally {
    S.deleting.delete(f.path);
  }
}

async function openFile(path, show) {
  if (!path) return false;
  if (!editor.has(path)) {
    let r;
    try {
      r = await call('ws_read', { profile: P(), path });
    } catch (err) {
      toast(errText(err));
      return false;
    }
    if (!editor.has(path)) {
      const cur = editor.current();
      editor.open(path, r.text, r.readonly, bench().bps[path] || []);
      if (!show && cur) editor.show(cur);
      editor.setDiagnostics(path, S.diags[path] || []);
    }
  }
  if (!S.open.includes(path)) S.open.push(path);
  if (show) editor.show(path);
  if (S.dbg && S.dbg.state && S.dbg.state.file === path) editor.setPc(path, S.dbg.state.line);
  if (S.task) {
    TS().open = S.open.slice();
    TS().active = editor.current();
    persist();
  }
  renderTabs();
  renderFiles();
  return true;
}

async function closeFile(path, noSave) {
  if (!noSave && !(await saveFile(path))) return false;
  const i = S.open.indexOf(path);
  if (i < 0) return;
  S.open.splice(i, 1);
  const wasCurrent = editor.current() === path;
  editor.close(path);
  if (wasCurrent && S.open.length) editor.show(S.open[Math.min(i, S.open.length - 1)]);
  TS().open = S.open.slice();
  TS().active = editor.current();
  persist();
  renderTabs();
  renderFiles();
  return true;
}

function renderTabs() {
  put(ui.edtabs, S.open.map(p => {
    const f = S.files.find(x => x.path === p);
    const st = S.fileState.get(p);
    const dirty = editor.isDirty(p);
    const errs = (S.diags[p] || []).filter(d => d.severity === 'error').length;
    const on = p === editor.current();
    const stateLabel = st === 'failed' ? 'not saved' : st === 'saving' ? 'saving' : dirty ? 'changed' : '';
    const el = h('div', { class: 'etab' + (on ? ' on' : '') + (st === 'failed' ? ' bad' : ''), role: 'tab', tabindex: on ? '0' : '-1', 'data-tip': p + (stateLabel ? ' · ' + stateLabel : ''), 'data-tip-at': 'below', 'aria-selected': String(on) },
      icon('file', { size: 13, class: 'fi ' + ext(p) }),
      h('span', { class: 'nm' }, basename(p)),
      f && f.readonly ? h('span', { class: 'ro', 'aria-label': 'read-only' }, icon('lock', { size: 11 })) : null,
      errs ? h('span', { class: 'errdot', 'aria-label': plural(errs, 'build error') }) : null,
      fileStateIcon(p),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Close ' + basename(p), tabindex: '-1' }, icon('close', { size: 13 })));
    el.addEventListener('mousedown', ev => { if (ev.button === 1) { ev.preventDefault(); closeFile(p); } });
    el.addEventListener('click', ev => {
      if (ev.target.closest('.x')) closeFile(p);
      else { editor.show(p); TS().active = p; persist(); renderTabs(); renderFiles(); }
    });
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') editor.focus();
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        const i = S.open.indexOf(p) + (ev.key === 'ArrowRight' ? 1 : -1);
        const q = S.open[(i + S.open.length) % S.open.length];
        editor.show(q); TS().active = q; renderTabs(); renderFiles();
        const t = ui.edtabs.querySelector('.etab.on');
        if (t) t.focus();
      }
    });
    return el;
  }));
  if (!S.open.length) ui.edtabs.append(h('span', { class: 'etab-empty' }, 'Open a file from the list on the left.'));
}

// ───────────────────────── saving ─────────────────────────

function onEdit(path) {
  if (S.suppress) return;
  S.version++;
  const t = S.saveTimers.get(path);
  if (t) clearTimeout(t);
  S.saveTimers.set(path, setTimeout(() => saveFile(path), 600));
  // Mark the tab changed at once without rebuilding the strip on every keystroke.
  const tab = ui.edtabs.querySelector('.etab.on');
  if (tab && !tab.querySelector('.fstate') && !S.fileState.has(path)) {
    tab.insertBefore(h('span', { class: 'fstate dirty', 'data-tip': 'Changed; saves in a moment' }, h('i')), tab.querySelector('.x'));
  }
  if (S.dbg && !S.dbg.staleShown) {
    S.dbg.staleShown = true;
    status('warn', 'The code changed: the debugger still runs the old build. Restart rebuilds it.');
  }
  refreshButtons();
}

async function saveFile(path) {
  const t = S.saveTimers.get(path);
  if (t) clearTimeout(t);
  S.saveTimers.delete(path);
  // A newer revision must never overtake a write already in flight.
  const pending = S.saving.get(path);
  if (pending) {
    if (!(await pending)) return false;
    return saveFile(path);
  }
  if (S.deleting.has(path)) return true; // the file is going away; never write it back
  if (!editor.has(path) || !editor.isDirty(path)) return true;
  const text = editor.text(path);
  if (text === null) return true;
  const profile = P();
  S.fileState.set(path, 'saving');
  const write = (async () => {
    try {
      await call('ws_write', { profile, path, text });
      if (P() === profile && editor.text(path) === text) editor.markSaved(path);
      if (P() === profile) S.fileState.delete(path);
      return true;
    } catch (err) {
      if (P() === profile) S.fileState.set(path, 'failed');
      status('bad', 'Could not save ' + basename(path) + ': ' + errText(err) + '. Your text is kept.');
      return false;
    }
  })();
  S.saving.set(path, write);
  const ok = await write;
  if (S.saving.get(path) === write) S.saving.delete(path);
  renderTabs();
  renderFiles();
  // Typing can continue during a save. Flush that newer revision before a
  // caller closes the tab, switches profiles, or compiles from disk.
  if (ok && P() === profile && editor.isDirty(path)) return saveFile(path);
  return ok;
}

async function saveAll() {
  if (!editor) return true;
  const paths = S.open.filter(p => editor.isDirty(p));
  return (await Promise.all(paths.map(saveFile))).every(Boolean);
}

/** Pick up edits made outside the game (another editor) for files with no unsaved changes. */
async function reloadFromDisk() {
  if (!isOpen() || S.resetting) return;
  const profile = P();
  for (const p of S.open.slice()) {
    if (editor.isDirty(p) || p.startsWith('sdk/')) continue;
    const before = editor.state(p);
    try {
      const r = await call('ws_read', { profile, path: p });
      // A focus-triggered read may finish after typing, closing/reopening the
      // buffer, or changing profiles. Only refresh the exact clean snapshot.
      if (P() !== profile || S.resetting || !editor.has(p) ||
          editor.isDirty(p) || editor.state(p) !== before) continue;
      if (r.text !== editor.text(p)) {
        S.suppress = true;
        try { editor.replace(p, r.text); } finally { S.suppress = false; }
        editor.markSaved(p);
        S.version++;
      }
    } catch (err) {
      // Deleted outside: leave the buffer; saving recreates it.
    }
  }
  if (P() === profile && !S.resetting) refreshFiles();
}

// ───────────────────────── diagnostics and build output ─────────────────────────

function showBuild(b) {
  if (!b) return;
  S.build = b;
  const by = {};
  for (const d of b.diags) {
    const f = d.file || '';
    (by[f] = by[f] || []).push(d);
  }
  S.diags = by;
  for (const p of S.open) editor.setDiagnostics(p, by[p] || []);
  if (b.sizes) board.setSizes(b.sizes);
  analysed();
  renderOutput();
  renderFiles();
  renderTabs();
}

function failBuild() {
  const b = S.build;
  const errs = b ? b.diags.filter(d => d.severity === 'error') : [];
  status('bad', 'Build failed' + (errs.length ? ': ' + plural(errs.length, 'error') : '') + '.');
  selectBottom('output');
  ui.btabs.dot('output', L().btab !== 'output');
  const first = errs.find(d => inWorkspace(d.file));
  if (first) gotoLine(first.file, first.line);
}

function renderOutput() {
  const i = S.bridge.init() || {};
  const tc = i.toolchain || {};
  const tcLine = h('p', { class: 'dim small bpad' },
    tc.ok ? 'Compiler: ' + tc.name + ' · ' + (i.cflags || []).join(' ') : 'No compiler found: ' + (tc.error || '') + ' The game looks for the zig it ships with, then K28_ZIG, then zig or clang on PATH.');
  const b = S.build;
  if (!b) {
    put(ui.bp.output, h('div', { class: 'pempty' }, icon('build', { size: 22 }), h('b', null, 'Nothing built yet'),
      h('span', null, 'Every build compiles your task and library at -O0 with full debug info.'), h('span', { class: 'row' }, h('span', { class: 'kbd' }, 'Ctrl+B'), ' build')), tcLine);
    return;
  }
  const errs = b.diags.filter(d => d.severity === 'error').length;
  const warns = b.diags.filter(d => d.severity === 'warning').length;
  const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  put(ui.bp.output,
    h('div', { class: 'out-head ' + (b.ok ? 'ok' : 'bad') },
      icon(b.ok ? 'ok' : 'fail', { size: 16 }),
      h('b', null, b.ok ? 'Build succeeded' : 'Build failed'),
      ' · ' + plural(errs, 'error') + ', ' + plural(warns, 'warning') + ' · ' + b.ms + ' ms',
      b.sizes ? ' · flash ' + kb(b.sizes.flash) + ', RAM ' + kb(b.sizes.ram) : ''),
    b.diags.length ? h('ul', { class: 'diags' }, b.diags.map(d => {
      const li = h('li', { class: d.severity, tabindex: '0', 'data-tip': inWorkspace(d.file) && d.line ? 'Go to the line' : null },
        h('span', { class: 'sev' }, icon(d.severity === 'error' ? 'fail' : d.severity === 'warning' ? 'warn' : 'info', { size: 13 }), d.severity),
        h('span', { class: 'dloc' }, d.file ? basename(d.file) + (d.line ? ':' + d.line + (d.col ? ':' + d.col : '') : '') : 'linker'),
        h('span', { class: 'msg' }, d.message));
      const go = () => { if (inWorkspace(d.file) && d.line) gotoLine(d.file, d.line); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
      return li;
    })) : null,
    h('details', { class: 'log', open: !b.ok && !b.diags.length ? true : null }, h('summary', null, 'Full compiler output'), h('pre', null, b.log || '(nothing)')),
    tcLine);
}

async function gotoLine(path, line, select) {
  if (!inWorkspace(path)) return;
  if (!(await openFile(path, true))) return;
  editor.gotoLine(path, line, !!select);
  editor.focus();
}

// ───────────────────────── jobs ─────────────────────────

async function waitJob(id) {
  let delay = 40;
  for (;;) {
    await sleep(delay);
    delay = Math.min(delay * 1.5, 150);
    const j = await call('job', { id });
    if (j.done) {
      if (j.error) throw new Error(j.error);
      return j.result;
    }
    status('busy', j.label + (j.progress ? ' · ' + Math.round(j.progress * 100) + '%' : '…'));
  }
}

async function doBuild() {
  if (S.busy || S.resetting || !S.task) return;
  const task = S.task;
  setBusy('build', 'Building…');
  try {
    if (!(await saveAll())) return;
    const b = await call('build', { profile: P(), task });
    if (S.task !== task) return;
    showBuild(b);
    if (b.ok) {
      const w = b.diags.filter(d => d.severity === 'warning').length;
      status(w ? 'warn' : 'ok', 'Built in ' + b.ms + ' ms' + (w ? ' with ' + plural(w, 'warning') : '') + '.');
      if (w) selectBottom('output');
    } else failBuild();
  } catch (err) {
    status('bad', errText(err));
  } finally {
    setBusy(null);
  }
}

/** Run one seed. opts: { seed, extra, keep (leave the Results tab alone), evidence (rule id to show) } */
async function doRun(opts) {
  if (S.busy || S.resetting || !S.task) return false;
  const o = opts || {};
  const seed = o.seed === undefined ? S.seed : o.seed;
  const extra = o.extra === undefined ? ownOn() : !!o.extra;
  const task = S.task;
  setBusy('run', 'Building…');
  let ok = false;
  try {
    if (!(await saveAll())) return false;
    const r = await call('run', { profile: P(), task, seed, extra });
    if (S.task !== task) return false;
    showBuild(r.build);
    if (!r.job) { failBuild(); return false; }
    setBusy('run', 'Running seed ' + seed + '…');
    const version = S.version;
    const res = await waitJob(r.job);
    if (S.task !== task) return false; // the player moved on to another task meanwhile
    res.extra = extra;
    res.version = version;
    applyRun(res, o);
    ok = true;
  } catch (err) {
    status('bad', errText(err));
  } finally {
    setBusy(null);
  }
  return ok;
}

function applyRun(res, o) {
  S.lastRun = res;
  analysed();
  const sr = res.result;
  wave.setTrace(res.trace, { order: S.info.pins.map(p => p.pin) });
  wave.setNow(S.dbg ? S.dbg.state.now : null);
  S.waveOf = { seed: sr.seed, extra: !!res.extra, live: false, version: res.version };
  renderConsole(ui.bp.console, res.trace, conCtx, 'during this run');
  if (sr.fault && res.fault_loc && inWorkspace(res.fault_loc.file)) {
    const f = res.fault_loc.file;
    S.diags[f] = (S.diags[f] || []).concat([{ line: res.fault_loc.line, col: 1, severity: 'error', message: sr.fault.code + ': ' + sr.fault.message }]);
    if (editor.has(f)) editor.setDiagnostics(f, S.diags[f]);
    renderFiles();
  }
  const failing = sr.rules.filter(r => !r.pass);
  const line = 'Seed ' + sr.seed + (sr.pass ? ' passes' : ' fails: ' + (failing[0] ? failing[0].text : '')) + ' · ' + fmtT(sr.end, 3) + ' of emulated time in ' + res.wall_ms + ' ms.';
  status(sr.pass ? 'ok' : 'bad', line);
  if (o.evidence) {
    const rule = sr.rules.find(r => r.id === o.evidence && r.evidence);
    wave.setEvidence(rule ? rule.evidence : null);
    selectBottom('wave');
    return;
  }
  wave.setEvidence(null);
  if (!o.keep) {
    renderRun(ui.bp.results, res, resCtx);
    TS().last = 'Last run: seed ' + sr.seed + (sr.pass ? ' passed.' : ' failed — ' + (failing[0] ? failing[0].text.replace(/\.$/, '') : 'see the results') + '.');
    persist();
    selectBottom(sr.pass ? 'wave' : 'results');
    if (!sr.pass) ui.btabs.dot('wave', true);
  } else {
    selectBottom('wave');
  }
}

const conCtx = {
  cursorAt(t) {
    selectBottom('wave');
    wave.cursorTo(t);
  },
};

/** Results → waveform: the button's ghost travels to the Waveform tab as the analyser takes over. */
function evidenceHop(src) {
  if (!src || !window.SN || !src.isConnected) return;
  window.SN.motion.morph(src.getBoundingClientRect(), src, ui.btabs.btns.wave, { dur: 380 });
}

const resCtx = {
  async showEvidence(sr, rule, extra, src) {
    // The trace on screen only fits this evidence if it came from the same seed and the same code.
    const sameCode = S.lastSubmit && S.lastSubmit.version === S.waveOf?.version;
    const same = S.waveOf && !S.waveOf.live && S.waveOf.seed === sr.seed && S.waveOf.extra === !!extra && (sameCode || S.lastRun?.result === sr);
    if (same) {
      evidenceHop(src);
      wave.setEvidence(rule.evidence);
      selectBottom('wave');
      return;
    }
    const rect = src && src.isConnected ? src.getBoundingClientRect() : null;
    const ok = await doRun({ seed: sr.seed, extra: !!extra, keep: true, evidence: rule.id });
    if (ok && rect && window.SN && src) window.SN.motion.morph(rect, src, ui.btabs.btns.wave, { dur: 380 });
  },
  async replay(seed, extra) {
    if (!S.seeds.includes(seed)) S.seeds.push(seed);
    S.seed = seed;
    TS().seed = seed;
    renderSeeds();
    await doRun({ seed, extra: !!extra, keep: true });
  },
  gotoLine: (f, l) => gotoLine(f, l),
};

async function doSubmit() {
  if (S.busy || S.resetting || !S.task) return;
  const extra = !ui.own.hidden;
  const task = S.task;
  setBusy('submit', 'Building…');
  try {
    if (!(await saveAll())) return;
    const r = await call('submit', { profile: P(), task, extra });
    if (S.task === task) showBuild(r.build);
    if (!r.job) { if (S.task === task) failBuild(); return; }
    setBusy('submit', 'Running every seed…');
    const version = S.version;
    const res = await waitJob(r.job);
    res.task = task;
    res.version = version;
    applySubmit(res);
  } catch (err) {
    status('bad', errText(err));
  } finally {
    setBusy(null);
  }
}

function showBanner(kind) {
  ui.banner.className = 'bbanner ' + kind;
  ui.banner.hidden = false;
  if (window.SN) window.SN.motion.animate(ui.banner, [{ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { dur: 360, ease: window.SN.motion.EASE.spring, key: 'banner' });
  const b = ui.banner.querySelector('.btn.primary');
  if (b) b.focus({ preventScroll: true });
}
function hideBanner() {
  ui.banner.hidden = true;
  editor.focus();
}

function applySubmit(res) {
  const id = res.task;
  const eng = S.bridge.engine();
  const before = eng.state.tasks[id] ? Object.assign({}, eng.state.tasks[id]) : null;
  if (S.task !== id) {
    // The player moved on while it ran: the story still hears the verdict.
    if (res.pass) S.bridge.passed(id, res.extra_pass === true);
    else S.bridge.failed(id);
    const t = bench().tasks[id] || (bench().tasks[id] = {});
    t.last = res.pass ? 'Accepted: every seed passes.' : 'Last submission: ' + res.base.filter(s => !s.pass).length + ' of ' + res.base.length + ' seeds failed.';
    persist(true);
    toast('Task ' + id + ': ' + (res.pass ? 'accepted.' : 'not accepted.'));
    return;
  }
  S.lastSubmit = res;
  for (const s of res.base) if (!S.seeds.includes(s.seed)) S.seeds.push(s.seed);
  TS().seeds = S.seeds.filter(s => s !== 1);
  renderSeeds();
  renderSubmit(ui.bp.results, res, resCtx);
  selectBottom('results');
  const T = storyTask(id);
  if (res.pass) {
    S.bridge.passed(id, res.extra_pass === true);
    TS().last = 'Accepted: every seed passes' + (res.extra_pass === true ? ', your own check too' : '') + '.';
    status('ok', 'Accepted: all ' + res.base.length + ' seeds pass' + (res.extra_pass === true ? ', and your own check' : '') + '.');
    if (before && before.status === 'active') {
      const word = T && T.form === 'exam' ? 'Handed in.' : T && T.form === 'lab' ? 'Passed.' : 'Satisfactory.';
      put(ui.banner,
        h('span', { class: 'b-ico' }, icon('ok', { size: 20 })),
        h('span', { class: 'b-big' }, word),
        h('span', { class: 'b-txt' }, 'Every seed passes. The story goes on without you until you go back to it.'),
        btn('Back to the story', 'primary small', () => close(), null, 'back'),
        btn('Stay here', 'quiet small', () => hideBanner()));
      showBanner('pass');
    }
  } else {
    S.bridge.failed(id);
    const bad = res.base.filter(s => !s.pass);
    TS().last = 'Last submission: ' + bad.length + ' of ' + res.base.length + ' seeds failed.';
    status('bad', 'Not accepted: ' + bad.length + ' of ' + res.base.length + ' seeds fail. Replay a failing seed to see why.');
    const after = eng.state.tasks[id];
    if (before && after && after.hints > before.hints) {
      const hint = T && T.hints[after.hints - 1];
      put(ui.banner,
        h('span', { class: 'b-ico' }, icon('hint', { size: 18 })),
        h('span', { class: 'b-txt' }, (hint && hint.who ? hint.who : 'Someone') + ' has looked over your shoulder. It’s on the work order.'),
        btn('Read it', 'primary small', () => { selectSide('work'); setPane('side', true); hideBanner(); }, null, 'work'),
        btn('Later', 'quiet small', () => hideBanner()));
      showBanner('hint');
      ui.stabs.dot('work', true);
    }
  }
  persist(true);
  renderHeader();
  if (L().stab === 'work') renderWork();
}

// ───────────────────────── debugger ─────────────────────────

function allBps() {
  return bench().bps;
}

function bpList() {
  const out = [];
  for (const [path, list] of Object.entries(bench().bps)) for (const b of list) out.push({ path, line: b.line, cond: b.cond || null });
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  return out;
}

function onBps(path, list) {
  const all = bench().bps;
  if (list.length) all[path] = list.map(b => ({ line: b.line, cond: b.cond || null }));
  else delete all[path];
  persist();
  if (!S.dbg || !S.dbg.running) dbgPanel.render();
  pushBps(path);
}

function pushBps(path) {
  if (!S.dbg) return;
  if (S.dbg.running) {
    // The core is running: pause it, apply the change, carry on.
    S.bpTouched.add(path);
    if (!S.dbg.pendingBps) {
      S.dbg.pendingBps = true;
      S.dbg.resume = true;
      call('dbg_pause').catch(() => {});
    }
    return;
  }
  call('dbg_bps', { file: path, lines: bench().bps[path] || [] }).catch(err => toast(errText(err)));
}

function removeBp(path, line) {
  const list = (bench().bps[path] || []).filter(b => b.line !== line);
  if (editor.has(path)) editor.setBreakpoints(path, list);
  onBps(path, list);
}

function clearBps() {
  for (const path of Object.keys(bench().bps)) {
    if (editor.has(path)) editor.setBreakpoints(path, []);
    onBps(path, []);
  }
}

async function doDebug() {
  if (S.busy || S.resetting || !S.task) return;
  if (S.dbg) {
    if (!S.dbg.running) dbgCmd('continue');
    return;
  }
  const extra = ownOn();
  const task = S.task;
  const version = S.version;
  setBusy('debug', 'Building for the debugger…');
  try {
    if (!(await saveAll())) return;
    const r = await call('dbg_start', { profile: P(), task, seed: S.seed, extra, breakpoints: allBps(), stop_at_main: true });
    if (S.task !== task) {
      if (r.ok) call('dbg_stop').catch(() => {});
      return;
    }
    showBuild(r.build);
    if (!r.ok) { failBuild(); return; }
    S.dbg = { state: r.state, running: false, version, seed: S.seed, extra, busy: false };
    S.bpTouched.clear();
    // Evidence and cursors belong to the run they came from; the live session draws its own trace.
    wave.setEvidence(null);
    if (wave.clearCursors) wave.clearCursors();
    enterDebugUi();
    await dbgPanel.armWatches();
    await onStop(r.state);
  } catch (err) {
    status('bad', errText(err));
  } finally {
    setBusy(null);
    updateDbgUi();
  }
}

function swapDock(show, hide) {
  const from = ui.dock.getBoundingClientRect();
  hide.hidden = true;
  show.hidden = false;
  if (window.SN) {
    // The dock changes its instrument set in place: it springs to its new width.
    const to = ui.dock.getBoundingClientRect();
    window.SN.motion.animate(ui.dock, [{ width: from.width + 'px' }, { width: to.width + 'px' }], { dur: 320, ease: window.SN.motion.EASE.spring, key: 'w' });
    window.SN.motion.animate(show, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { dur: 240, ease: window.SN.motion.EASE.out, key: 'in' });
  }
}

function enterDebugUi() {
  ui.root.classList.add('debugging');
  swapDock(ui.dbgBar, ui.acts);
  selectSide('debug');
  setPane('side', true);
  analysed();
  updateDbgUi();
  refreshButtons();
}

function exitDebugUi() {
  ui.root.classList.remove('debugging');
  swapDock(ui.acts, ui.dbgBar);
  refreshButtons();
}

function updateDbgUi() {
  if (!S.dbg) return;
  const run = S.dbg.running;
  const st = S.dbg.state;
  const over = st && (st.cpu === 'faulted' || st.stop.reason === 'end');
  for (const b of [ui.dCont, ui.dOver, ui.dInto, ui.dOut]) b.disabled = run || over;
  ui.dBack.disabled = run || !(st && st.can_step_back);
  // Continue and Pause share one place: the one that applies now is shown.
  ui.dCont.hidden = run;
  ui.dPause.hidden = !run;
  ui.dPause.disabled = !run;
  ui.dRestart.disabled = run;
  ui.dTime.textContent = st ? 't = ' + fmtT(run ? S.dbg.now || st.now : st.now, 4) : '';
  ui.dbgBar.dataset.state = run ? 'running' : over ? (st.cpu === 'faulted' ? 'faulted' : 'ended') : 'stopped';
  const why = over ? (st.cpu === 'faulted' ? ' (the core faulted)' : ' (the run is over: restart or step back)') : run ? ' (running: pause first)' : '';
  for (const [b, label] of [[ui.dCont, 'Continue'], [ui.dOver, 'Step over'], [ui.dInto, 'Step into'], [ui.dOut, 'Step out']]) b.setAttribute('data-tip', label + (b.disabled ? why : ''));
  ui.dBack.setAttribute('data-tip', 'Step back one line (time runs backwards)' + (ui.dBack.disabled ? (run ? ' (running: pause first)' : ' (nothing earlier to return to)') : ''));
}

async function dbgCmd(cmd, args) {
  if (!S.dbg || S.dbg.running || S.dbg.busy) return;
  S.dbg.busy = true;
  S.dbg.lastCmd = cmd;
  S.dbg.before = S.dbg.state ? S.dbg.state.now : null;
  try {
    await call('dbg_cmd', Object.assign({ cmd }, args || {}));
  } catch (err) {
    if (S.dbg) S.dbg.busy = false;
    toast(errText(err));
    return;
  }
  if (!S.dbg) return;
  S.dbg.busy = false;
  S.dbg.running = true;
  updateDbgUi();
  let delay = 12;
  let shown = false;
  for (;;) {
    await sleep(delay);
    delay = Math.min(delay * 1.6, 120);
    if (!S.dbg) return;
    let r;
    try {
      r = await call('dbg_poll');
    } catch (err) {
      toast(errText(err));
      await dbgStop(true);
      return;
    }
    if (!S.dbg) return;
    if (r.running) {
      S.dbg.now = r.now;
      if (!shown && delay >= 60) { shown = true; dbgPanel.setRunning(r.now); status('busy', 'Running… press Pause (F6) to stop.'); }
      if (shown) {
        dbgPanel.setRunning(r.now);
        ui.dTime.textContent = 't = ' + fmtT(r.now, 4);
        wave.setNow(r.now);
      }
      continue;
    }
    S.dbg.running = false;
    if (r.error) toast(r.error);
    await onStop(r.state);
    if (S.dbg && S.dbg.pendingBps) {
      S.dbg.pendingBps = false;
      for (const p of S.bpTouched) await call('dbg_bps', { file: p, lines: bench().bps[p] || [] }).catch(() => {});
      S.bpTouched.clear();
      if (S.dbg.resume && r.state && r.state.stop.reason === 'pause') {
        S.dbg.resume = false;
        dbgCmd('continue');
      }
      S.dbg.resume = false;
    }
    return;
  }
}

async function dbgPause() {
  if (!S.dbg || !S.dbg.running) return;
  S.dbg.resume = false;
  try { await call('dbg_pause'); } catch (err) { toast(errText(err)); }
}

async function dbgRestart() {
  if (!S.dbg) return doDebug();
  if (S.dbg.running) return;
  if (S.dbg.version !== S.version) {
    await dbgStop(true);
    return doDebug();
  }
  await dbgCmd('restart');
  if (S.dbg && S.info.startup) await dbgCmd('run_to_func', { func: 'main' });
}

async function dbgStop(quiet) {
  if (!S.dbg) return;
  S.dbg = null;
  try { await call('dbg_stop'); } catch (err) { /* already gone */ }
  editor.setPc(null);
  dbgPanel.stop();
  board.setLevels(null);
  wave.setNow(null);
  exitDebugUi();
  renderDisasm(null);
  if (!quiet) status('', 'Debugger stopped.');
}

const REASON_LINE = {
  breakpoint: 'Breakpoint',
  watchpoint: 'Watchpoint',
  step: 'Stepped',
  pause: 'Paused',
  fault: 'Fault',
  end: 'The run is over',
  exited: 'The program exited',
  ebreak: 'EBREAK',
  irq: 'Interrupt',
  error: 'Could not do that',
  time: 'Travelled in time',
  start: 'Stopped',
};

async function onStop(st) {
  if (!S.dbg || !st) return;
  const before = S.dbg.before;
  // Time went backwards when the backend says so: a reverse step, or travel to an earlier time.
  const back = before !== null && before !== undefined && st.now < before;
  S.dbg.before = null;
  S.dbg.state = st;
  S.dbg.now = st.now;
  updateDbgUi();
  if (st.file && inWorkspace(st.file)) {
    await openFile(st.file, true);
    editor.setPc(st.file, st.line);
    editor.gotoLine(st.file, st.line, false);
    if (back) editor.flashPc('back');
  } else {
    editor.setPc(null);
  }
  board.setLevels(st.pins);
  wave.setNow(st.now, back ? { from: before } : null);
  if (back && window.SN) {
    ui.dTime.classList.remove('rev');
    void ui.dTime.offsetWidth;
    ui.dTime.classList.add('rev');
  }
  S.traceStale = true;
  S.disasmStale = true;
  if (!(st.file && inWorkspace(st.file)) && L().btab !== 'disasm') selectBottom('disasm');
  else refreshVisibleBottom();
  const where = st.func ? ' in ' + st.func + '()' : '';
  const kind = st.stop.reason === 'fault' || st.stop.reason === 'error' ? 'bad' : '';
  status(kind, (REASON_LINE[st.stop.reason] || st.stop.reason) + (st.stop.detail ? ': ' + st.stop.detail : '') + where + ' · t = ' + fmtT(st.now, 4));
  await dbgPanel.update(st);
  if (L().stab !== 'debug' && (st.stop.reason === 'fault' || st.stop.reason === 'watchpoint')) selectSide('debug');
}

async function refreshLiveTrace() {
  if (!S.dbg) return;
  S.traceStale = false;
  let tr;
  try {
    tr = await call('dbg_trace');
  } catch (err) {
    return;
  }
  if (!S.dbg) return;
  const hadTrace = !!wave.trace;
  wave.setTrace(tr, { order: S.info.pins.map(p => p.pin), keepView: hadTrace });
  wave.setNow(S.dbg.state.now);
  const now = S.dbg.state.now;
  if (now > wave.v0 + wave.span || now < wave.v0) wave.fit();
  S.waveOf = { seed: S.dbg.seed, extra: S.dbg.extra, live: true };
  renderConsole(ui.bp.console, tr, conCtx, 'so far');
}

async function refreshDisasm() {
  if (!S.dbg) { renderDisasm(null); return; }
  S.disasmStale = false;
  let lines;
  try {
    lines = await call('dbg_disasm', { count: 400 });
  } catch (err) {
    put(ui.bp.disasm, h('p', { class: 'err bpad' }, errText(err)));
    return;
  }
  renderDisasm(lines);
}

function renderDisasm(lines) {
  if (!ui) return;
  if (!lines) {
    put(ui.bp.disasm, h('p', { class: 'dim bpad' }, 'Start the debugger to see the machine code the compiler made from your C, instruction by instruction.'));
    return;
  }
  const pc = S.dbg ? S.dbg.state.pc : null;
  const src = (file, line) => {
    const t = file && editor.has(file) ? editor.text(file) : null;
    return t ? (t.split('\n')[line - 1] || '').trim() : '';
  };
  let lastKey = null;
  const rows = [];
  for (const l of lines) {
    const key = (l.file || '') + ':' + l.line;
    if (l.line && key !== lastKey) {
      const s = src(l.file, l.line);
      const row = h('div', { class: 'da-src', title: 'Go to the source' }, h('span', { class: 'dloc' }, (l.file ? basename(l.file) : '?') + ':' + l.line), h('span', { class: 'dsrc' }, s));
      if (inWorkspace(l.file)) row.addEventListener('click', () => gotoLine(l.file, l.line));
      rows.push(row);
    }
    lastKey = key;
    rows.push(h('div', { class: 'da-ins' + (l.addr === pc ? ' pc' : '') },
      h('span', { class: 'a' }, hex(l.addr)), h('span', { class: 'r' }, l.raw), h('span', { class: 't' }, l.text)));
  }
  const bar = h('div', { class: 'da-bar' },
    btn('Step instruction', 'ghost small', () => dbgCmd('step_instr'), { title: 'Execute exactly one instruction (interrupt entry counts as one)' }),
    btn('Back one instruction', 'ghost small', () => dbgCmd('step_back_instr')),
    h('span', { class: 'dim small' }, lines.length && lines[0].func ? lines[0].func + '()' : ''));
  const list = h('div', { class: 'da' }, rows);
  put(ui.bp.disasm, bar, list);
  const cur = list.querySelector('.pc');
  if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 0);
}

// ───────────────────────── keys ─────────────────────────

function onKey(ev) {
  const k = ev.key;
  const mod = ev.ctrlKey || ev.metaKey;
  // A desktop app must not reload itself on the browser's shortcuts.
  const reload = k === 'F5' || (mod && (k === 'r' || k === 'R')) || k === 'BrowserRefresh';
  // Nothing behind an overlay (a dialog, the menu sheet) may run, build or step.
  if (!isOpen() || (window.SN && window.SN.modalOpen())) {
    if (reload && window.K28 && window.K28.desktop) ev.preventDefault();
    return;
  }
  let handled = true;
  if (k === 'F5' && ev.shiftKey && mod) dbgRestart();
  else if (k === 'F5' && ev.shiftKey) dbgStop();
  else if (k === 'F5' && mod) doRun();
  else if (k === 'F5') doDebug();
  else if (k === 'F6') dbgPause();
  else if (k === 'F10' && ev.shiftKey) dbgCmd('step_back');
  else if (k === 'F10') dbgCmd('step_over');
  else if (k === 'F11' && ev.shiftKey) dbgCmd('step_out');
  else if (k === 'F11') dbgCmd('step_into');
  else if (mod && (k === 'b' || k === 'B') && !ev.shiftKey) doBuild();
  else if (mod && k === 'Enter' && ev.shiftKey) doSubmit();
  else if (mod && k === 'Enter') doRun();
  else if (mod && (k === 's' || k === 'S')) saveAll();
  else if (mod && (k === 'j' || k === 'J') && !ev.shiftKey) setPane('bottom', !paneOpen('bottom'));
  else if (mod && ev.shiftKey && (k === 'e' || k === 'E')) toggleFocus('editor');
  else if (reload) { /* swallowed */ }
  else if (k === 'Escape' && menuEl) closeMenu();
  else handled = false;
  if (handled) {
    ev.preventDefault();
    ev.stopPropagation();
  }
}

function onContextMenu(ev) {
  if (!window.K28 || !window.K28.desktop) return;
  const t = ev.target;
  if (t.closest && (t.closest('input, textarea, .cm-content, [contenteditable="true"]'))) return;
  ev.preventDefault();
}

// ───────────────────────── entry points ─────────────────────────

window.Bench = {
  init(bridge) {
    S.bridge = bridge;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('focus', () => reloadFromDisk());
    window.addEventListener('beforeunload', () => { if (editor) saveAll(); });
    window.K28.beforeQuit(() => (editor ? saveAll() : null));
  },
  open(id, opts) {
    if (S.resetting) return Promise.resolve(false);
    S.opening++;
    return open(id, opts).catch(err => { toast(errText(err), 'alert'); return false; })
      .finally(() => { S.opening--; });
  },
  close() {
    return close().catch(err => { toast(errText(err)); return false; });
  },
  reset,
  isOpen,
  /** The theme or text size changed: the editor and canvases follow without being rebuilt. */
  setAppearance() {
    if (!editor) return;
    editor.setDark();
    if (wave) wave.schedule();
  },
};
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => window.Bench.setAppearance());
}
