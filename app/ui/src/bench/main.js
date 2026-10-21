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
import { h, put, btn, $, fmtT, basename, plural, hex } from './util.js';

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
function toast(m) {
  S.bridge.toast(m);
}

// ───────────────────────── small UI pieces ─────────────────────────

function tabStrip(list, onSel, cls) {
  const el = h('div', { class: 'ptabs ' + (cls || ''), role: 'tablist' });
  const btns = {};
  for (const [key, label, title] of list) {
    const b = h('button', { type: 'button', class: 'ptab', role: 'tab', title: title || '' }, label, h('span', { class: 'dot', hidden: true }));
    b.addEventListener('click', () => onSel(key));
    btns[key] = b;
    el.append(b);
  }
  return {
    el,
    btns,
    select(k) {
      for (const key in btns) btns[key].setAttribute('aria-selected', String(key === k));
      if (btns[k]) btns[k].querySelector('.dot').hidden = true;
    },
    dot(k, on) {
      if (btns[k]) btns[k].querySelector('.dot').hidden = !on;
    },
    show(k, on) {
      if (btns[k]) btns[k].hidden = !on;
    },
  };
}

function splitter(kind, onDrag) {
  const el = h('div', { class: 'split split-' + kind, role: 'separator', 'aria-orientation': kind === 'v' ? 'vertical' : 'horizontal' });
  el.addEventListener('mousedown', ev => {
    ev.preventDefault();
    const start = kind === 'v' ? ev.clientX : ev.clientY;
    const begin = onDrag(0, true);
    document.body.classList.add(kind === 'v' ? 'dragging-v' : 'dragging-h');
    const move = e => onDrag((kind === 'v' ? e.clientX : e.clientY) - start, false, begin);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging-v', 'dragging-h');
      persist();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return el;
}

let menuEl = null;
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function menu(x, y, items) {
  closeMenu();
  menuEl = h('div', { class: 'bmenu', role: 'menu' }, items.filter(Boolean).map(([label, fn, danger]) => {
    const b = h('button', { type: 'button', role: 'menuitem', class: danger ? 'danger' : '' }, label);
    b.addEventListener('click', () => { closeMenu(); fn(); });
    return b;
  }));
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menuEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(ev) {
    if (menuEl && !menuEl.contains(ev.target)) { closeMenu(); document.removeEventListener('mousedown', off); }
  }), 0);
}

// ───────────────────────── building the bench ─────────────────────────

function buildUi() {
  const root = $('#bench');
  ui = { root };
  const d = (label, title, fn, cls) => btn(label, 'ghost small dbtn ' + (cls || ''), fn, { title });

  ui.back = btn('← Story', 'ghost small', () => close(), { title: 'Back to the story. Your code is saved as you type.' });
  ui.code = h('span', { class: 'bt-code' });
  ui.name = h('span', { class: 'bt-name' });
  ui.chip = h('span', { class: 'bt-chip' });
  ui.build = btn('Build', 'ghost small', () => doBuild(), { title: 'Compile and link (Ctrl+B)' });
  ui.run = btn('Run', 'ghost small', () => doRun(), { title: 'Run on the chosen seed and capture every pin (Ctrl+Enter)' });
  ui.debug = btn('Debug', 'ghost small', () => doDebug(), { title: 'Start the debugger and stop at main (F5)' });
  ui.submit = btn('Submit', 'primary small', () => doSubmit(), { title: 'Run every seed, the hidden ones too, and hand it in (Ctrl+Shift+Enter)' });
  ui.acts = h('div', { class: 'bb-acts' }, ui.build, ui.run, ui.debug, ui.submit);

  ui.dCont = d('▶ Continue', 'Continue (F5)', () => dbgCmd('continue'), 'go');
  ui.dPause = d('❚❚ Pause', 'Pause (F6)', () => dbgPause());
  ui.dOver = d('Over', 'Step over this line (F10)', () => dbgCmd('step_over'));
  ui.dInto = d('Into', 'Step into the call on this line (F11)', () => dbgCmd('step_into'));
  ui.dOut = d('Out', 'Run until this function returns (Shift+F11)', () => dbgCmd('step_out'));
  ui.dBack = d('◂ Back', 'Step back one line: time runs backwards (Shift+F10)', () => dbgCmd('step_back'));
  ui.dRestart = d('↺', 'Restart from reset; rebuilds first if the code changed (Ctrl+Shift+F5)', () => dbgRestart());
  ui.dStop = d('■ Stop', 'Stop debugging (Shift+F5)', () => dbgStop(), 'stop');
  ui.dTime = h('span', { class: 'dtime' });
  ui.dbgBar = h('div', { class: 'bb-dbg', hidden: true }, ui.dCont, ui.dPause, ui.dOver, ui.dInto, ui.dOut, ui.dBack, ui.dRestart, ui.dStop, ui.dTime);

  ui.seed = h('select', { class: 'seed-sel', title: 'The seed Run and Debug use. Submitting runs every seed.', 'aria-label': 'Seed' });
  ui.seed.addEventListener('change', () => { S.seed = +ui.seed.value; TS().seed = S.seed; persist(); });
  ui.ownBox = h('input', { type: 'checkbox' });
  ui.ownBox.addEventListener('change', () => { TS().own = ui.ownBox.checked; persist(); });
  ui.own = h('label', { class: 'own', hidden: true }, ui.ownBox, h('span', null, 'Own check'));
  ui.status = h('div', { class: 'bb-status', role: 'status', 'aria-live': 'polite' });
  ui.bar = h('div', { class: 'bb' },
    ui.back,
    h('div', { class: 'bt' }, ui.code, ui.name, ui.chip),
    ui.acts, ui.dbgBar,
    h('div', { class: 'bb-opts' }, ui.seed, ui.own),
    ui.status);

  ui.banner = h('div', { class: 'bbanner', hidden: true });

  // Files.
  ui.files = h('nav', { class: 'bfiles', 'aria-label': 'Files' });

  // Editor.
  ui.edtabs = h('div', { class: 'edtabs', role: 'tablist' });
  ui.edhost = h('div', { class: 'edhost' });
  editor = new Editor(ui.edhost, {
    onChange: onEdit,
    onBreakpoints: onBps,
    onSave: () => saveAll(),
    onKey: () => {},
  });

  // Bottom panels.
  ui.bp = {};
  for (const k of ['wave', 'output', 'console', 'results', 'disasm']) ui.bp[k] = h('div', { class: 'bpanel bp-' + k, hidden: true });
  ui.btabs = tabStrip([
    ['wave', 'Waveform', 'Every pin over time'],
    ['results', 'Results', 'What the checker said'],
    ['console', 'Console', 'What the firmware wrote to DBGCON'],
    ['output', 'Build', 'Compiler and linker output'],
    ['disasm', 'Disassembly', 'The machine code around the program counter'],
  ], k => selectBottom(k));
  wave = new Wave(ui.bp.wave, {
    onGoto: t => dbgCmd('goto_time', { t }),
  });
  ui.bottom = h('div', { class: 'bottom' }, ui.btabs.el, h('div', { class: 'bpanels' }, Object.values(ui.bp)));

  // Side panels.
  ui.sp = {};
  for (const k of ['work', 'board', 'debug', 'datasheet']) ui.sp[k] = h('div', { class: 'spanel sp-' + k, hidden: true });
  ui.stabs = tabStrip([
    ['work', 'Work order'],
    ['board', 'Board'],
    ['debug', 'Debug'],
    ['datasheet', 'Datasheet'],
  ], k => selectSide(k));
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
  ui.side = h('aside', { class: 'bside' }, ui.stabs.el, h('div', { class: 'spanels' }, Object.values(ui.sp)));

  ui.center = h('div', { class: 'bcenter' },
    ui.edtabs, ui.edhost,
    splitter('h', (d, start, begin) => {
      if (start) return L().bottom;
      L().bottom = Math.max(120, Math.min(window.innerHeight - 220, begin - d));
      applyLayout();
    }),
    ui.bottom);
  ui.body = h('div', { class: 'bb-body' },
    ui.files,
    splitter('v', (d, start, begin) => {
      if (start) return L().left;
      L().left = Math.max(130, Math.min(420, begin + d));
      applyLayout();
    }),
    ui.center,
    splitter('v', (d, start, begin) => {
      if (start) return L().right;
      L().right = Math.max(280, Math.min(Math.round(window.innerWidth * 0.55), begin - d));
      applyLayout();
    }),
    ui.side);
  root.append(ui.bar, ui.banner, ui.body);
  applyLayout();
}

function applyLayout() {
  const l = L();
  ui.root.style.setProperty('--bl', l.left + 'px');
  ui.root.style.setProperty('--br', l.right + 'px');
  ui.root.style.setProperty('--bh', l.bottom + 'px');
  if (wave) wave.schedule();
}

function selectBottom(k) {
  L().btab = k;
  ui.btabs.select(k);
  for (const key in ui.bp) ui.bp[key].hidden = key !== k;
  if (k === 'wave') wave.schedule();
  refreshVisibleBottom();
}

function selectSide(k) {
  L().stab = k;
  ui.stabs.select(k);
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

function status(kind, text) {
  put(ui.status, kind === 'busy' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null, h('span', { class: 'st ' + (kind || '') }, text || ''));
}

function setBusy(kind, text) {
  S.busy = kind;
  refreshButtons();
  if (kind) status('busy', text);
  else if (ui.status.querySelector('.spin')) status('', ''); // nothing reported: don't leave a spinner behind
}

function refreshButtons() {
  const off = !!S.busy || !toolchainOk();
  for (const b of [ui.build, ui.run, ui.debug, ui.submit]) b.disabled = off;
  ui.seed.disabled = !!S.busy;
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

async function open(id) {
  if (!S.bridge) return;
  if (!ui) buildUi();
  const info = levelInfo(id);
  if (!info) { toast('There is no bench for task ' + id + '.'); return; }
  if (S.task && S.task !== id && !(await switchAway())) return false;
  const same = S.task === id;
  S.task = id;
  S.info = info;
  $('#app').classList.add('benching');
  ui.root.hidden = false;
  closeMenu();
  const t = TS();
  applyLayout();
  S.seed = t.seed || 1;
  S.seeds = Array.from(new Set([1].concat(t.seeds || [], [S.seed])));
  renderHeader();
  renderSeeds();
  board.set(info);
  ui.banner.hidden = true;
  selectSide(same ? L().stab : (L().stab === 'debug' ? 'work' : L().stab || 'work'));
  selectBottom(L().btab || 'wave');
  if (!same) {
    S.lastSubmit = S.lastSubmit && S.lastSubmit.task === id ? S.lastSubmit : null;
    wave.setTrace(null);
    wave.setEvidence(null);
    put(ui.bp.results, h('p', { class: 'dim bpad' }, 'Run the firmware (Ctrl+Enter) to check it against the visible seed, or submit it to run every seed.'));
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
  } else if (!same) status('', 'Ready. Build with Ctrl+B, run with Ctrl+Enter, debug with F5.');
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
      lastRun: null, lastSubmit: null, waveOf: null, version: 0,
      seeds: [1], seed: 1, traceStale: false, disasmStale: false });
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
    ui.chip.textContent = form === 'exam' ? 'Handed in' : form === 'lab' ? 'Passed' : 'Satisfactory';
    ui.chip.className = 'bt-chip done';
  } else {
    ui.chip.textContent = ts && ts.fails ? plural(ts.fails, 'failed submission') : form === 'exam' ? 'Exam' : 'Open';
    ui.chip.className = 'bt-chip' + (ts && ts.fails ? ' warn' : '');
  }
  const extras = S.info.extra ? S.bridge.extras(S.task) : [];
  ui.own.hidden = !extras.length;
  if (extras.length) {
    ui.own.title = 'Run and debug with the stimulus of your own check: ' + extras.map(x => fill(x.text)).join(' ') + ' Submitting always includes it.';
    ui.ownBox.checked = TS().own !== false;
  }
}

function renderSeeds() {
  const failed = new Set();
  if (S.lastSubmit && S.lastSubmit.task === S.task) for (const s of S.lastSubmit.base) if (!s.pass) failed.add(s.seed);
  put(ui.seed, S.seeds.map(s => h('option', { value: String(s), selected: s === S.seed },
    'Seed ' + s + (s === 1 ? ' · visible' : ' · hidden') + (failed.has(s) ? ' ✗' : ''))));
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

function renderFiles() {
  if (!S.task) return;
  const errCount = p => (S.diags[p] || []).filter(d => d.severity === 'error').length;
  const warnCount = p => (S.diags[p] || []).filter(d => d.severity === 'warning').length;
  const group = (kind, title, note, canAdd) => {
    const list = S.files.filter(f => f.kind === kind);
    const head = h('div', { class: 'fg-h' }, h('span', null, title),
      canAdd ? h('button', { type: 'button', class: 'fg-add', title: 'New file' }, '+') : null);
    if (canAdd) head.querySelector('.fg-add').addEventListener('click', () => newFile(kind === 'task' ? 'tasks/' + S.task + '/' : 'lib/'));
    const ul = h('ul', { class: 'fl' + (note ? ' muted' : '') }, list.map(f => {
      const e = errCount(f.path), w = warnCount(f.path);
      const li = h('li', { class: (editor.current() === f.path ? 'on' : '') + (S.open.includes(f.path) ? ' open' : ''), tabindex: '0', title: f.path },
        h('span', { class: 'fi ' + ext(f.name) }),
        h('span', { class: 'fn' }, f.name),
        e ? h('span', { class: 'badge err' }, String(e)) : w ? h('span', { class: 'badge warn' }, String(w)) : null,
        editor.isDirty(f.path) ? h('span', { class: 'mod', title: 'Saving…' }, '●') : null);
      li.addEventListener('click', () => openFile(f.path, true));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') openFile(f.path, true); });
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
    group('task', 'Task ' + S.task, null, true),
    group('lib', 'Library', S.info.library ? null : 'Not linked into this task: exam rules.', true),
    group('sdk', 'SDK', null, false),
    h('div', { class: 'fg-foot' }, btn('Open the folder', 'link', () => call('reveal', { profile: P(), path: 'tasks/' + S.task + '/main.c' }).catch(err => toast(errText(err))))));
}

function ext(name) {
  const m = /\.([A-Za-z]+)$/.exec(name);
  return m ? 'x-' + m[1].toLowerCase() : '';
}

function fileMenu(f, x, y) {
  const items = [['Open', () => openFile(f.path, true)]];
  if (!f.readonly) {
    items.push(['Rename…', () => renameFile(f)]);
    items.push(['Delete…', () => deleteFile(f), true]);
  }
  items.push(['Show in folder', () => call('reveal', { profile: P(), path: f.path }).catch(err => toast(errText(err)))]);
  menu(x, y, items);
}

async function refreshFiles() {
  try {
    const r = await call('ws_list', { profile: P(), task: S.task });
    S.files = r.files;
  } catch (err) { toast(errText(err)); }
  renderFiles();
}

async function newFile(prefix) {
  const name = window.prompt('New file in ' + prefix + ' — a name ending in .c or .h:', prefix.startsWith('lib') ? 'gpio.c' : 'util.c');
  if (!name) return;
  const n = name.trim();
  try {
    await call('ws_create', { profile: P(), path: prefix + n });
  } catch (err) { toast(errText(err)); return; }
  await refreshFiles();
  await openFile(prefix + n, true);
}

async function renameFile(f) {
  const dir = f.path.slice(0, f.path.length - f.name.length);
  const name = window.prompt('Rename ' + f.name + ' to:', f.name);
  if (!name || name.trim() === f.name) return;
  const to = dir + name.trim();
  if (!(await saveFile(f.path))) return;
  try {
    await call('ws_rename', { profile: P(), from: f.path, to });
  } catch (err) { toast(errText(err)); return; }
  const wasOpen = S.open.includes(f.path);
  const bps = bench().bps[f.path];
  delete bench().bps[f.path];
  if (bps) bench().bps[to] = bps;
  if (wasOpen) await closeFile(f.path, true);
  await refreshFiles();
  if (wasOpen) await openFile(to, true);
  persist();
}

async function deleteFile(f) {
  if (!window.confirm('Delete ' + f.path + '? This cannot be undone.')) return;
  const t = S.saveTimers.get(f.path);
  if (t) { clearTimeout(t); S.saveTimers.delete(f.path); }
  // Let an already-dispatched autosave finish before deleting the file.
  if (S.saving.has(f.path)) await S.saving.get(f.path);
  try {
    await call('ws_delete', { profile: P(), path: f.path });
  } catch (err) { toast(errText(err)); return; }
  delete bench().bps[f.path];
  if (S.open.includes(f.path)) await closeFile(f.path, true);
  persist();
  await refreshFiles();
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
    const dirty = editor.isDirty(p);
    const el = h('div', { class: 'etab' + (p === editor.current() ? ' on' : ''), role: 'tab', title: p, 'aria-selected': String(p === editor.current()) },
      h('span', { class: 'nm' }, basename(p)),
      f && f.readonly ? h('span', { class: 'ro' }, 'read-only') : null,
      (S.diags[p] || []).some(d => d.severity === 'error') ? h('span', { class: 'errdot', title: 'Build errors' }) : null,
      h('button', { type: 'button', class: 'x', title: dirty ? 'Saving…' : 'Close' }, dirty ? '●' : '×'));
    el.addEventListener('mousedown', ev => { if (ev.button === 1) { ev.preventDefault(); closeFile(p); } });
    el.addEventListener('click', ev => {
      if (ev.target.classList.contains('x')) closeFile(p);
      else { editor.show(p); TS().active = p; persist(); renderTabs(); renderFiles(); }
    });
    return el;
  }));
  if (!S.open.length) ui.edtabs.append(h('span', { class: 'etab-empty' }, 'Open a file on the left.'));
}

// ───────────────────────── saving ─────────────────────────

function onEdit(path) {
  if (S.suppress) return;
  S.version++;
  const t = S.saveTimers.get(path);
  if (t) clearTimeout(t);
  S.saveTimers.set(path, setTimeout(() => saveFile(path), 600));
  const tab = ui.edtabs.querySelector('.etab.on .x');
  if (tab && tab.textContent !== '●') { tab.textContent = '●'; tab.title = 'Saving…'; }
  if (S.dbg && !S.dbg.staleShown) {
    S.dbg.staleShown = true;
    status('warn', 'The code changed: the debugger is still running the old build. ↺ rebuilds and restarts.');
  }
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
  if (!editor.has(path) || !editor.isDirty(path)) return true;
  const text = editor.text(path);
  if (text === null) return true;
  const profile = P();
  const write = (async () => {
    try {
      await call('ws_write', { profile, path, text });
      if (P() === profile && editor.text(path) === text) editor.markSaved(path);
      return true;
    } catch (err) {
      status('bad', 'Could not save ' + basename(path) + ': ' + errText(err));
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
  renderOutput();
  renderFiles();
  renderTabs();
}

function failBuild() {
  const b = S.build;
  const errs = b ? b.diags.filter(d => d.severity === 'error') : [];
  status('bad', 'Build failed' + (errs.length ? ': ' + plural(errs.length, 'error') : '') + '.');
  selectBottom('output');
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
    put(ui.bp.output, h('p', { class: 'dim bpad' }, 'Build output shows up here. Every build compiles your task and library at -O0 with full debug info.'), tcLine);
    return;
  }
  const errs = b.diags.filter(d => d.severity === 'error').length;
  const warns = b.diags.filter(d => d.severity === 'warning').length;
  const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  put(ui.bp.output,
    h('div', { class: 'out-head ' + (b.ok ? 'ok' : 'bad') },
      h('b', null, b.ok ? 'Build succeeded' : 'Build failed'),
      ' · ' + plural(errs, 'error') + ', ' + plural(warns, 'warning') + ' · ' + b.ms + ' ms',
      b.sizes ? ' · flash ' + kb(b.sizes.flash) + ', RAM ' + kb(b.sizes.ram) : ''),
    b.diags.length ? h('ul', { class: 'diags' }, b.diags.map(d => {
      const li = h('li', { class: d.severity, tabindex: '0' },
        h('span', { class: 'sev' }, d.severity),
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

const resCtx = {
  async showEvidence(sr, rule, extra) {
    // The trace on screen only fits this evidence if it came from the same seed and the same code.
    const sameCode = S.lastSubmit && S.lastSubmit.version === S.waveOf?.version;
    const same = S.waveOf && !S.waveOf.live && S.waveOf.seed === sr.seed && S.waveOf.extra === !!extra && (sameCode || S.lastRun?.result === sr);
    if (same) {
      wave.setEvidence(rule.evidence);
      selectBottom('wave');
      return;
    }
    await doRun({ seed: sr.seed, extra: !!extra, keep: true, evidence: rule.id });
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
        h('span', { class: 'b-big' }, word),
        h('span', null, ' Every seed passes. The story goes on without you until you go back to it.'),
        btn('Back to the story', 'primary small', () => close()),
        btn('Stay here', 'ghost small', () => { ui.banner.hidden = true; }));
      ui.banner.className = 'bbanner pass';
      ui.banner.hidden = false;
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
        h('span', null, (hint && hint.who ? hint.who : 'Someone') + ' has looked over your shoulder. It’s on the work order.'),
        btn('Read it', 'primary small', () => { selectSide('work'); ui.banner.hidden = true; }),
        btn('Later', 'ghost small', () => { ui.banner.hidden = true; }));
      ui.banner.className = 'bbanner hint';
      ui.banner.hidden = false;
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

function enterDebugUi() {
  ui.root.classList.add('debugging');
  ui.acts.hidden = true;
  ui.dbgBar.hidden = false;
  selectSide('debug');
  updateDbgUi();
}

function exitDebugUi() {
  ui.root.classList.remove('debugging');
  ui.acts.hidden = false;
  ui.dbgBar.hidden = true;
}

function updateDbgUi() {
  if (!S.dbg) return;
  const run = S.dbg.running;
  const st = S.dbg.state;
  const over = st && (st.cpu === 'faulted' || st.stop.reason === 'end');
  for (const b of [ui.dCont, ui.dOver, ui.dInto, ui.dOut]) b.disabled = run || over;
  ui.dBack.disabled = run || !(st && st.can_step_back);
  ui.dPause.disabled = !run;
  ui.dRestart.disabled = run;
  ui.dTime.textContent = st ? 't = ' + fmtT(run ? S.dbg.now || st.now : st.now, 4) : '';
}

async function dbgCmd(cmd, args) {
  if (!S.dbg || S.dbg.running || S.dbg.busy) return;
  S.dbg.busy = true;
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
  S.dbg.state = st;
  S.dbg.now = st.now;
  updateDbgUi();
  if (st.file && inWorkspace(st.file)) {
    await openFile(st.file, true);
    editor.setPc(st.file, st.line);
    editor.gotoLine(st.file, st.line, false);
  } else {
    editor.setPc(null);
  }
  board.setLevels(st.pins);
  wave.setNow(st.now);
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
  if (!isOpen()) {
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
  open(id) {
    if (S.resetting) return Promise.resolve(false);
    S.opening++;
    return open(id).catch(err => { toast(errText(err)); return false; })
      .finally(() => { S.opening--; });
  },
  close() {
    return close().catch(err => { toast(errText(err)); return false; });
  },
  reset,
  isOpen,
};
