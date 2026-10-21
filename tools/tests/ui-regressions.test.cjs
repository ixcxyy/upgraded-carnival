// Behavioral regression tests for the real frontend handlers, with deterministic
// in-memory editor/backend boundaries. These are NOT browser, Tauri or emulator tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const source = p => fs.readFileSync(path.join(ROOT, 'app/ui/src', p), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function benchHarness(call = async () => true) {
  const buffers = new Map();
  const messages = [];
  const profile = { name: 'A' };
  const data = { tasks: {}, bps: {}, layout: {}, watches: [] };
  let current = null;
  const editor = {
    has: p => buffers.has(p), isDirty: p => !!buffers.get(p)?.dirty,
    text: p => buffers.get(p)?.text ?? null, state: p => buffers.get(p)?.revision,
    markSaved(p) { if (buffers.has(p)) buffers.get(p).dirty = false; },
    close(p) { buffers.delete(p); if (current === p) current = null; },
    current: () => current, show(p) { current = p; },
    replace(p, text) { if (buffers.has(p)) Object.assign(buffers.get(p), { text, revision: {} }); },
    setPc() {},
  };
  const root = { hidden: false, classList: { add() {}, remove() {} } };
  const noop = () => {};
  const ctx = vm.createContext({
    window: { K28: { call }, addEventListener: noop },
    document: { querySelector: () => root },
    $, console, setTimeout, clearTimeout, Buffer, basename: p => p.split('/').pop(),
    __editor: editor, __messages: messages, __data: data, __profile: profile,
    __root: root, __noop: noop,
  });
  function $(s) { return root; }
  vm.runInContext(source('bench/main.js').replace(/^import .*;\r?\n/gm, '') + `
    editor = __editor;
    ui = {root: __root, own: {hidden:true}, ownBox: {checked:false}};
    S.task = '1.1';
    S.bridge = {profile: () => __profile.name, bench: () => __data,
      persist: async () => true, refresh: __noop, toast: m => __messages.push(m)};
    renderTabs = renderFiles = renderOutput = renderDisasm = refreshButtons = setBusy = showBuild = __noop;
    status = (k, m) => __messages.push(m);
    dbgPanel = { stop: __noop };
    wave = {setTrace: __noop, setEvidence: __noop, setNow: __noop};
    board = {setLevels: __noop};
    globalThis.api = {S, saveFile, saveAll, closeFile, reloadFromDisk, close,
      doBuild, doRun, doSubmit, doDebug, switchAway,
      removeFile: typeof removeFile === 'function' ? removeFile : undefined};
  `, ctx);
  const add = (p, text, dirty = true) => { buffers.set(p, { text, dirty, revision: {} }); if (!ctx.api.S.open.includes(p)) ctx.api.S.open.push(p); current = p; };
  return { ctx, api: ctx.api, editor, buffers, add, profile, data, messages };
}

test('failed writes keep a closing tab and its unsaved text recoverable', async () => {
  const h = benchHarness(async () => { throw new Error('disk full'); });
  h.add('tasks/1.1/main.c', 'unsaved code');
  await h.api.closeFile('tasks/1.1/main.c');
  assert.equal(h.editor.text('tasks/1.1/main.c'), 'unsaved code');
  assert.equal(h.editor.isDirty('tasks/1.1/main.c'), true);
});

test('a closing tab waits for its write acknowledgement', async () => {
  const gate = deferred();
  const h = benchHarness(() => gate.promise);
  h.add('tasks/1.1/main.c', 'work');
  const closing = h.api.closeFile('tasks/1.1/main.c');
  assert.equal(h.editor.has('tasks/1.1/main.c'), true);
  gate.resolve(true);
  await closing;
  assert.equal(h.editor.has('tasks/1.1/main.c'), false);
});

test('overlapping autosaves cannot write an older revision after a newer one', async () => {
  const first = deferred(); let writes = 0, disk = '';
  const h = benchHarness(async (cmd, a) => {
    if (cmd !== 'ws_write') return {};
    const n = ++writes;
    if (n === 1) await first.promise;
    disk = a.text;
    return true;
  });
  const p = 'tasks/1.1/main.c';
  h.add(p, 'old');
  const a = h.api.saveFile(p);
  h.add(p, 'new');
  const b = h.api.saveFile(p);
  await tick(); first.resolve();
  await Promise.all([a, b]);
  assert.equal(disk, 'new');
  assert.equal(h.editor.isDirty(p), false);
});

test('typing while a tab is saving is included before the tab closes', async () => {
  const first = deferred(); let writes = 0, disk = '';
  const h = benchHarness(async (cmd, a) => {
    if (++writes === 1) await first.promise;
    disk = a.text; return true;
  });
  const p = 'tasks/1.1/main.c';
  h.add(p, 'initial');
  const closing = h.api.closeFile(p);
  h.add(p, 'typed during save');
  first.resolve(); await closing;
  assert.equal(disk, 'typed during save');
  assert.equal(h.editor.has(p), false);
});

test('a delayed external-file read cannot replace newer local typing', async () => {
  const read = deferred();
  const h = benchHarness(cmd => cmd === 'ws_read' ? read.promise : Promise.resolve({ files: [] }));
  const p = 'tasks/1.1/main.c';
  h.add(p, 'original', false);
  const reload = h.api.reloadFromDisk();
  h.add(p, 'new local edit', true);
  read.resolve({ text: 'stale disk copy' });
  await reload;
  assert.equal(h.editor.text(p), 'new local edit');
  assert.equal(h.editor.isDirty(p), true);
});

test('a delayed external-file read cannot cross a profile boundary', async () => {
  const read = deferred();
  const h = benchHarness(cmd => cmd === 'ws_read' ? read.promise : Promise.resolve({ files: [] }));
  const p = 'tasks/1.1/main.c';
  h.add(p, 'A code', false);
  const reload = h.api.reloadFromDisk();
  h.profile.name = 'B'; h.add(p, 'B code', false);
  read.resolve({ text: 'A disk' });
  await reload;
  assert.equal(h.editor.text(p), 'B code');
});

test('Build does not compile stale disk content after a save failure', async () => {
  const commands = [];
  const h = benchHarness(async cmd => {
    commands.push(cmd);
    if (cmd === 'ws_write') throw new Error('disk full');
    return { ok: true, diags: [], ms: 0 };
  });
  h.add('tasks/1.1/main.c', 'new source');
  await h.api.doBuild();
  assert.equal(commands.includes('build'), false);
});

test('a profile reset clears task identity and cached file buffers', async () => {
  const h = benchHarness();
  h.add('tasks/1.1/main.c', 'A source', false);
  assert.equal(typeof h.ctx.window.Bench.reset, 'function');
  assert.equal(await h.ctx.window.Bench.reset(), true);
  assert.equal(h.api.S.task, null);
  assert.equal(h.editor.has('tasks/1.1/main.c'), false);
  assert.equal(h.api.S.open.length, 0);
});

test('profile reset is refused while a submission is still running', async () => {
  const h = benchHarness();
  h.api.S.busy = 'submit';
  h.add('tasks/1.1/main.c', 'A source', false);
  assert.equal(typeof h.ctx.window.Bench.reset, 'function');
  assert.equal(await h.ctx.window.Bench.reset(), false);
  assert.equal(h.editor.has('tasks/1.1/main.c'), true);
});

function storyHarness(call = async () => true) {
  const flushers = [], messages = [];
  const ctx = vm.createContext({ console, setTimeout, clearTimeout,
    window: { K28: { call, beforeQuit: f => flushers.push(f) }, matchMedia: () => ({ matches: false }) },
    document: {}, __messages: messages,
  });
  vm.runInContext(source('story/ui-core.js') + '\n' + source('story/ui-app.js').replace(/\nboot\(\);\s*$/, '\n') + `
    renderSaved = () => {};
    renderBrand = resetStream = after = closeSheet = showTitle = () => {};
    toast = m => __messages.push(m);
    G.profile = 'A'; G.S = {hash:'test'};
    G.engine = {state:{started:false}};
    globalThis.state = G;
    globalThis.api = {persist, switchProfile, createProfile, deleteProfile};
  `, ctx);
  return { ctx, state: ctx.state, api: ctx.api, flushers, messages };
}

test('profile switching waits for editor flush/reset before reading the next save', async () => {
  const gate = deferred(), reads = [];
  const h = storyHarness();
  h.ctx.window.Bench = { close: () => gate.promise, reset: () => gate.promise };
  h.ctx.__read = name => { reads.push(name); h.state.profile = name; };
  vm.runInContext('readProfile = __read;', h.ctx);
  const switching = h.api.switchProfile('B');
  await tick();
  assert.deepEqual(reads, []);
  gate.resolve(true); await switching;
  assert.deepEqual(reads, ['B']);
});

test('profile switching aborts if the editor cannot be saved', async () => {
  const h = storyHarness(); const reads = [];
  h.ctx.window.Bench = { close: async () => false, reset: async () => false };
  h.ctx.__read = name => { reads.push(name); h.state.profile = name; };
  vm.runInContext('readProfile = __read;', h.ctx);
  await h.api.switchProfile('B');
  assert.deepEqual(reads, []);
  assert.equal(h.state.profile, 'A');
});

test('profile save writes are serialized and the latest snapshot wins', async () => {
  const gate = deferred(); let count = 0, disk;
  const h = storyHarness(async (cmd, a) => {
    if (++count === 1) await gate.promise;
    disk = JSON.parse(a.data); return true;
  });
  h.state.settings.size = 's'; const a = h.api.persist(true);
  await tick(); h.state.settings.size = 'l'; const b = h.api.persist(true);
  await tick(); gate.resolve(); await Promise.all([a, b]);
  assert.equal(disk.settings.size, 'l');
});

test('quit flush waits for a profile save that is already in flight', async () => {
  const gate = deferred(); const h = storyHarness(() => gate.promise);
  const saving = h.api.persist(true);
  let done = false;
  const flushing = Promise.resolve(h.flushers[0]()).then(() => { done = true; });
  await tick(); assert.equal(done, false);
  gate.resolve(true); await saving; await flushing;
  assert.equal(done, true);
});

test('quit flush rejects failed persistence instead of silently closing', async () => {
  const ctx = vm.createContext({ window: {}, setTimeout, clearTimeout, fetch() {} });
  vm.runInContext(source('api.js'), ctx);
  ctx.window.K28.beforeQuit(async () => false);
  await assert.rejects(ctx.window.K28.flush());
});

test('a failed file save can be retried without losing or falsely clearing the buffer', async () => {
  let fail = true, disk;
  const h = benchHarness(async (cmd, a) => {
    if (fail) throw new Error('disk full');
    disk = a.text; return true;
  });
  const p = 'tasks/1.1/main.c';
  h.add(p, 'recoverable');
  assert.equal(await h.api.saveAll(), false);
  fail = false;
  assert.equal(await h.api.saveAll(), true);
  assert.equal(disk, 'recoverable');
  assert.equal(h.editor.isDirty(p), false);
});

test('an unchanged clean buffer still picks up external edits', async () => {
  const h = benchHarness(async cmd => cmd === 'ws_read' ? {text: 'external edit'} : {files: []});
  const p = 'tasks/1.1/main.c';
  h.add(p, 'original', false);
  await h.api.reloadFromDisk();
  assert.equal(h.editor.text(p), 'external edit');
  assert.equal(h.editor.isDirty(p), false);
});

for (const [name, fn, command] of [['Run', 'doRun', 'run'], ['Submit', 'doSubmit', 'submit'], ['Debug', 'doDebug', 'dbg_start']]) {
  test(name + ' does not proceed with stale code after a failed save', async () => {
    const commands = [];
    const h = benchHarness(async cmd => { commands.push(cmd); throw new Error('disk full'); });
    h.add('tasks/1.1/main.c', 'unsaved');
    await h.api[fn]();
    assert.equal(commands.includes(command), false);
  });
}

test('failed profile reset preserves task and buffers for recovery', async () => {
  const h = benchHarness(async () => { throw new Error('disk full'); });
  h.add('tasks/1.1/main.c', 'unsaved');
  assert.equal(await h.ctx.window.Bench.reset(), false);
  assert.equal(h.api.S.task, '1.1');
  assert.equal(h.editor.text('tasks/1.1/main.c'), 'unsaved');
});

test('desktop close waits for writes; a failure stays open and a retry can close', async () => {
  const gate = deferred(); let handler, destroyed = 0, alerts = 0, next = gate.promise;
  const w = { onCloseRequested(f) { handler = f; }, async destroy() { destroyed++; } };
  const ctx = vm.createContext({ setTimeout, clearTimeout,
    window: { __TAURI__: {core:{invoke() {}}, window:{getCurrentWindow: () => w}}, alert() { alerts++; } } });
  vm.runInContext(source('api.js'), ctx);
  ctx.window.K28.beforeQuit(() => next);
  const closing = handler({preventDefault() {}});
  await tick(); assert.equal(destroyed, 0);
  gate.resolve(false); await closing;
  assert.equal(destroyed, 0); assert.equal(alerts, 1);
  next = Promise.resolve(true);
  await handler({preventDefault() {}});
  assert.equal(destroyed, 1);
});

test('an autosave chain in flight cannot recreate a file after it is deleted', async () => {
  const first = deferred(); const log = []; let disk = 'exists';
  const h = benchHarness(async (cmd, a) => {
    log.push(cmd);
    if (cmd === 'ws_write') { if (log.filter(c => c === 'ws_write').length === 1) await first.promise; disk = a.text; return true; }
    if (cmd === 'ws_delete') { disk = null; return true; }
    return { files: [] };
  });
  const p = 'tasks/1.1/util.c';
  h.add(p, 'v1');
  const saving = h.api.saveFile(p);        // write of v1 is in flight
  h.add(p, 'v2');                          // newer typing: the chain would write v2 next
  const removing = h.api.removeFile({ path: p, name: 'util.c' });
  await tick(); first.resolve();
  await Promise.all([saving, removing]);
  assert.equal(disk, null);
  assert.equal(log.lastIndexOf('ws_write') < log.indexOf('ws_delete'), true);
});

test('starting the debugger drops evidence and cursors that belong to an earlier run', async () => {
  const calls = [];
  const h = benchHarness(async cmd => cmd === 'dbg_start' ? { ok: true, state: { now: 0 }, build: {} } : {});
  vm.runInContext(`
    wave = {setTrace: __noop, setNow: __noop, setEvidence: e => __calls.push(['evidence', e]), clearCursors: () => __calls.push(['cursors'])};
    enterDebugUi = __noop; onStop = async () => {}; updateDbgUi = __noop;
    dbgPanel = { stop: __noop, armWatches: async () => {} };
    ui.own = {hidden: true}; S.seed = 1;
  `, Object.assign(h.ctx, { __calls: calls }));
  await h.api.doDebug();
  assert.equal(JSON.stringify(calls), JSON.stringify([['evidence', null], ['cursors']]));
});

function renderHarness(file, exports) {
  const h = (tag, attrs, ...children) => ({
    tag, attrs, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false),
    append(...kids) { this.children.push(...kids); },
    get textContent() { return this.children.map(x => typeof x === 'object' ? x.textContent : String(x)).join(''); },
  });
  const put = (host, ...kids) => { host.children = kids.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false); };
  // icon() renders nothing without ui.js, exactly as util.js does when window.SN is absent.
  const ctx = vm.createContext({ h, put, btn: () => h('button'), icon: () => null, ibtn: () => h('button'), fmtT: String, hex: String, plural: (n, word) => n + ' ' + word, basename: String });
  vm.runInContext(source(file).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\n globalThis.api = {' + exports + '};', ctx);
  return { api: ctx.api, host: h('div') };
}

test('changing the board clears the previous task build-size readout', () => {
  const h = renderHarness('bench/board.js', 'BoardView');
  const board = new h.api.BoardView(h.host);
  board.set({pins: [], startup:true, library:true, hidden_seeds:3});
  board.setSizes({flash:10, ram:5, text:10, rodata:0, data:0, bss:5});
  assert.match(h.host.textContent, /Last build/);
  board.set({pins: [], startup:false, library:false, hidden_seeds:4});
  assert.doesNotMatch(h.host.textContent, /Last build/);
});

test('a passing replay of a hidden seed is not described as the visible seed', () => {
  const h = renderHarness('bench/results.js', 'renderRun');
  h.api.renderRun(h.host, {result:{seed:42, pass:true, rules:[], end:100}, wall_ms:1}, {});
  assert.match(h.host.textContent, /seed 42 only/i);
  assert.doesNotMatch(h.host.textContent, /visible seed only/i);
  h.api.renderRun(h.host, {result:{seed:1, pass:true, rules:[], end:100}, wall_ms:1}, {});
  assert.match(h.host.textContent, /visible seed only/i);
});
