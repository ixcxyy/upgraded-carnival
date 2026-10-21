/* ───────── ui-app: clue popover, title screen, menu, profiles, author tools, boot ───────── */

/* ── clue popover: an observation, then ask / note / let it go ── */
function closePop() { if (G.pop) { G.pop.remove(); G.pop = null; G.popAnchor = null; } }
/* Keep the popover pinned to its detail while the stream scrolls; close it once the detail leaves view. */
function followPop(scroller) {
  if (!G.pop || !G.popAnchor || window.innerWidth <= 560) return;
  const a = G.popAnchor.getBoundingClientRect(), box = scroller.getBoundingClientRect();
  if (!G.popAnchor.isConnected || a.bottom < box.top || a.top > box.bottom) { closePop(); return; }
  placePop(G.pop, G.popAnchor);
}
function openClue(id, anchor) {
  const info = G.engine.notice(id);
  if (!info) return;
  closePop();
  const act = a => () => {
    closePop();
    G.engine.act(id, a.id);
    if (a.id === 'ask' && isNarrow() && G.ui.view !== 'story') setView('story');
    after(true);
    if (a.id === 'note') toast('Noted. It’s on the case board.');
  };
  const acts = info.actions.map(a => btn(fill(a.label), a.id === 'ask' ? 'primary small' : 'ghost small', act(a)));
  const state = info.status === 'asked' ? 'In the notebook · you asked'
    : info.status === 'noted' ? 'In the notebook'
      : info.letgo ? 'You let this go once. It stays open until the chapter ends.' : '';
  const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'What you notice' },
    h('div', { class: 'pop-k' }, 'You notice · ' + info.track),
    h('p', { class: 'pop-obs' }, fill(info.obs)),
    acts.length ? h('div', { class: 'row' }, acts) : null,
    state ? h('div', { class: 'pop-state' }, state) : null);
  document.body.append(pop);
  G.pop = pop;
  G.popAnchor = anchor;
  placePop(pop, anchor);
  const first = pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
  refreshHotspots();
  persist();
}
function placePop(pop, anchor) {
  if (window.innerWidth <= 560) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.min(Math.max(16, r.left), window.innerWidth - pw - 16);
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 16) top = Math.max(16, r.top - ph - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

/* ── title screen ── */
let traceRaf = 0;
function splitTitle(t) {
  const i = String(t).indexOf('/');
  return i < 0 ? [t, null] : [t.slice(0, i).trim(), t.slice(i + 1).trim()];
}
function renderBrand() {
  const [a, b] = splitTitle(fill(G.S.meta.title || ''));
  put($('#brand'), a, b ? h('span', { class: 'slash' }, '/') : null, b || null);
}
function showTitle() {
  closePop();
  closeSheet();
  renderTitle();
  $('#title').hidden = false;
  startTrace();
}
function hideTitle() {
  const t = $('#title');
  if (document.activeElement && t.contains(document.activeElement)) document.activeElement.blur();
  t.hidden = true;
  cancelAnimationFrame(traceRaf);
  traceRaf = 0;
}
function renderTitle() {
  const S = G.S, m = S.meta, st = G.engine.state;
  const [a, b] = splitTitle(fill(m.title || 'Untitled'));
  const has = st.started;
  const C = has && st.chapter ? S.chapterMap[st.chapter] : null;
  put($('#title-inner'),
    m.subtitle ? h('p', { class: 'sub' }, fill(m.subtitle)) : null,
    h('h1', null, a, b ? [h('span', { class: 'slash' }, '/'), b] : null),
    h('div', { class: 'trace' }, h('span', { class: 'nm' }, fill(m.trace || '')), h('canvas', { id: 'trace-cv', 'aria-hidden': 'true' })),
    h('p', { class: 'cut' }, ['First cut', plural(S.chapters.length, 'chapter'), plural(S.order.tasks.length, 'task'), 'C on an emulated ' + fill(m.mcu || 'chip')].join(' · ')),
    G.init && G.init.toolchain && !G.init.toolchain.ok ? h('p', { class: 'note bad' }, 'The C compiler was not found: ' + G.init.toolchain.error) : null,
    h('div', { class: 'acts' },
      has ? btn(st.ended ? 'Back to the ending' : 'Continue', 'primary', resume) : btn('Begin', 'primary', newGame),
      has ? btn('New game', 'ghost', () => { G.ui.confirm = 'new'; renderTitle(); startTrace(); }) : null,
      has && C && !st.ended ? h('span', { class: 'resume' }, C.label + ' · ' + fill(C.title)) : null),
    G.ui.confirm === 'new' ? h('div', { class: 'confirm', style: 'max-width:34rem;margin-top:1rem' },
      h('p', null, 'Start over as ' + G.profile + '? This profile’s progress is replaced. Other profiles keep theirs.'),
      h('div', { class: 'row' },
        btn('Start over', 'primary small', () => { G.ui.confirm = null; newGame(); }),
        btn('Keep playing', 'ghost small', () => { G.ui.confirm = null; renderTitle(); startTrace(); }))) : null,
    h('div', { class: 'meta' },
      h('span', null, 'Playing as ', h('b', null, G.profile)),
      linkBtn('Profiles, saves and settings', () => openSheet('main')),
      linkBtn('Clue ledger', () => openSheet('ledger')),
      window.K28.desktop ? linkBtn('Quit', () => window.K28.quit()) : null),
    h('p', { class: 'note' }, 'When a detail in the text catches your eye, click it. The ones that matter are mostly quiet. Text never moves on without you: Space or Enter continues, number keys choose.'),
    G.custom ? h('p', { class: 'note' }, 'You’re playing from story files you loaded. The built-in story is in the menu under Story files.') : null);
}

/* The title card's trace: the heartbeat from J4.7, in real time. Purely visual. */
function startTrace() {
  cancelAnimationFrame(traceRaf);
  const cv = $('#trace-cv');
  if (!cv) return;
  let colors = null, stamp = -1e9;
  const edges = [[0, 1], [80, 0], [200, 1], [280, 0]];
  const draw = now => {
    if (!cv.isConnected || $('#title').hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, ht = cv.clientHeight;
    if (w && ht) {
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(ht * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr); }
      if (!colors || now - stamp > 1000) {
        const cs = getComputedStyle(document.documentElement);
        colors = { ink: cs.getPropertyValue('--trace').trim() || '#1D5AA6', grid: cs.getPropertyValue('--rule').trim() || '#CBD3CC' };
        stamp = now;
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, ht);
      const span = Math.min(9000, Math.max(4000, w * 8));
      const tEnd = REDUCED ? 5290 : now;
      const t0 = tEnd - span;
      const X = t => ((t - t0) / span) * w;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      for (let s = Math.ceil(t0 / 1000) * 1000; s <= tEnd; s += 1000) {
        const x = Math.round(X(s)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, ht - 6); ctx.stroke();
      }
      const hi = 10, lo = ht - 10;
      const f0 = ((t0 % 1000) + 1000) % 1000;
      let v = (f0 < 80 || (f0 >= 200 && f0 < 280)) ? 1 : 0;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(0, v ? hi : lo);
      for (let fs = Math.floor(t0 / 1000) * 1000; fs <= tEnd; fs += 1000) {
        for (const [dt, nv] of edges) {
          const t = fs + dt;
          if (t <= t0 || t > tEnd) continue;
          const x = X(t);
          ctx.lineTo(x, v ? hi : lo);
          ctx.lineTo(x, nv ? hi : lo);
          v = nv;
        }
      }
      ctx.lineTo(w, v ? hi : lo);
      ctx.stroke();
      ctx.globalCompositeOperation = 'destination-out';
      const g = ctx.createLinearGradient(0, 0, w * 0.35, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w * 0.35, ht);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!REDUCED) traceRaf = requestAnimationFrame(draw);
  };
  traceRaf = requestAnimationFrame(draw);
}

function newGame() {
  G.engine = new E.Engine(G.S);
  Object.assign(G.ui, { draft: {}, own: {}, ticket: null, doc: null, tab: 'work', codex: 'people', seen: {}, confirm: null });
  resetStream();
  hideTitle();
  G.engine.start();
  if (isNarrow()) setView('story');
  after(true);
  persist(true);
}
function resume() {
  hideTitle();
  if (!G.engine.state.started) { newGame(); return; }
  after(false);
}

/* ── menu sheet ── */
function openSheet(page) {
  closePop();
  G.ui.sheet = page || 'main';
  renderSheet();
  if (G.ui.sheet === 'main') refreshProfiles().then(() => { if (G.ui.sheet === 'main') renderSheet(); });
}
function closeSheet() {
  G.ui.sheet = null;
  const b = $('#backdrop');
  if (b) b.remove();
}
function renderSheet() {
  let b = $('#backdrop');
  if (!b) {
    b = h('div', { class: 'backdrop', id: 'backdrop' });
    b.addEventListener('click', ev => { if (ev.target === b) closeSheet(); });
    document.body.append(b);
  }
  const page = G.ui.sheet;
  const titles = { main: 'Menu', ledger: 'Clue ledger', files: 'Story files', save: 'Save file' };
  const body = page === 'ledger' ? ledgerPage() : page === 'files' ? filesPage() : page === 'save' ? savePage() : mainPage();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, titles[page] || 'Menu'),
      h('div', { class: 'row' }, page !== 'main' ? btn('Back', 'ghost small', () => openSheet('main')) : null, btn('Close', 'ghost small', closeSheet))),
    body);
  b.replaceChildren(sheet);
  const f = sheet.querySelector('button');
  if (f) f.focus({ preventScroll: true });
}

function mainPage() {
  const S = G.S;
  const names = (G.profiles || []).slice();
  if (names.indexOf(G.profile) < 0) names.push(G.profile);
  const snaps = S.chapters.filter(c => G.engine.snaps[c.id]);
  return h('div', null,
    h('section', null, h('h3', null, 'Profile'),
      h('p', null, 'Each profile keeps its own save and its own code, so friends can share one computer.'),
      h('div', { class: 'row' },
        h('label', { class: 'sr', for: 'profile-select' }, 'Profile'),
        h('select', { id: 'profile-select', onchange: ev => switchProfile(ev.target.value) }, names.map(n => h('option', { value: n, selected: n === G.profile }, n))),
        btn('New profile', 'ghost small', () => { G.ui.confirm = 'newprofile'; renderSheet(); }),
        names.length > 1 ? btn('Delete this one', 'ghost small', () => { G.ui.confirm = 'delprofile'; renderSheet(); }) : null),
      G.ui.confirm === 'newprofile' ? h('div', { class: 'confirm' },
        h('p', null, 'Name the new profile.'),
        h('div', { class: 'row' },
          h('label', { class: 'sr', for: 'new-profile-name' }, 'Profile name'),
          h('input', { type: 'text', id: 'new-profile-name', placeholder: 'e.g. Felix', maxlength: '32' }),
          btn('Create', 'primary small', () => {
            const v = ($('#new-profile-name').value || '').trim();
            if (!v) { toast('Give the profile a name first.'); return; }
            createProfile(v);
          }),
          btn('Cancel', 'ghost small', () => { G.ui.confirm = null; renderSheet(); }))) : null,
      G.ui.confirm === 'delprofile' ? h('div', { class: 'confirm' },
        h('p', null, 'Delete ' + G.profile + ' and its save? This can’t be undone.'),
        h('div', { class: 'row' }, btn('Delete', 'primary small', deleteProfile), btn('Keep it', 'ghost small', () => { G.ui.confirm = null; renderSheet(); }))) : null),
    h('section', null, h('h3', null, 'Replay a chapter'),
      snaps.length
        ? [h('p', null, 'Go back to the start of a chapter you’ve reached. Everything after that point in this profile is replaced, and the details you walked past are open again.'),
          h('div', { class: 'chaplist' }, snaps.map(c => h('button', { type: 'button', onclick: () => replayChapter(c.id) },
            h('span', { class: 't' }, c.label + ' · ' + fill(c.title)), h('span', { class: 'k' }, c.phase))))]
        : h('p', null, 'Chapters you reach show up here.')),
    h('section', null, h('h3', null, 'Save file and code'),
      h('p', null, 'Progress saves as you play, as plain JSON next to this profile’s code: your progress, every clue’s state, the whole log. Your C files are ordinary files in the same folder; open them in any editor you like.'),
      h('div', { class: 'row' },
        btn('Open the profile folder', 'ghost small', () => window.K28.call('reveal', { profile: G.profile }).catch(err => toast(String(err.message || err)))),
        btn('Load a save file', 'ghost small', () => $('#import-file').click()),
        btn('Show as text', 'ghost small', () => openSheet('save'))),
      h('input', { type: 'file', id: 'import-file', accept: '.json,application/json', hidden: true, onchange: ev => readFileInput(ev.target, importSave) })),
    h('section', null, h('h3', null, 'Settings'),
      h('label', { class: 'opt' },
        h('input', { type: 'checkbox', id: 'opt-casual', checked: !!G.settings.casual, onchange: ev => { G.settings.casual = ev.target.checked; applySettings(); persist(); } }),
        h('span', null, 'Casual clues', h('small', null, 'Underline every detail you can stop on, including the quiet ones.'))),
      h('div', { class: 'row' }, h('span', null, 'Text size'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Text size' }, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, label]) =>
          h('button', { type: 'button', 'aria-pressed': String(G.settings.size === k), onclick: () => { G.settings.size = k; applySettings(); persist(); renderSheet(); } }, label))))),
    h('section', null, h('h3', null, 'Author tools'),
      h('p', null, 'The story is plain-text .story files. The ledger checks every reference and plays the story through, with and without attention.'),
      h('div', { class: 'row' }, btn('Clue ledger', 'ghost small', () => openSheet('ledger')), btn('Story files', 'ghost small', () => openSheet('files'))),
      standIn()),
    h('section', null, h('div', { class: 'row' }, btn('Title screen', 'ghost small', () => { closeSheet(); showTitle(); }))));
}

/* Author tool: stand in for the checker on the task in hand (to test the story, or to get unstuck). */
function standIn() {
  const st = G.engine.state;
  const id = st.wait && st.wait.type === 'task' ? st.wait.id : null;
  if (!id) return null;
  const T = G.S.tasks[id];
  return h('div', { class: 'row', style: 'margin-top:8px' },
    h('span', null, 'Stand in for the checker on ' + fill(T.title) + ':'),
    btn('Record a failed submission', 'ghost small', () => { G.engine.failRun(id); closeSheet(); after(true); }),
    btn('Pass it', 'ghost small', () => { G.engine.pass(id, false); closeSheet(); if (window.Bench) window.Bench.close(); after(true); }));
}

function applySettings() {
  const root = document.documentElement;
  root.classList.remove('size-s', 'size-l');
  if (G.settings.size === 's') root.classList.add('size-s');
  if (G.settings.size === 'l') root.classList.add('size-l');
  document.body.classList.toggle('casual', !!G.settings.casual);
}

/* ── profiles: one folder each, managed by the app ── */
async function refreshProfiles() {
  try { G.profiles = (await window.K28.call('profile_list', {})).map(p => p.name); } catch (err) { G.profiles = G.profiles || []; }
}
async function readProfile(name) {
  G.profile = name;
  try { window.localStorage.setItem(KEY, name); } catch (err) { /* private mode */ }
  let blob = null;
  try {
    const raw = await window.K28.call('save_read', { profile: name });
    blob = raw ? JSON.parse(raw) : null;
  } catch (err) { blob = null; }
  const custom = !!(blob && Array.isArray(blob.files) && blob.files.length);
  G.files = custom ? blob.files : G.builtin;
  G.custom = custom;
  G.S = E.parseStory(G.files);
  G.settings = Object.assign({ casual: false, size: 'm' }, (blob && blob.settings) || {});
  G.bench = (blob && blob.bench) || {};
  applySettings();
  try { G.engine = new E.Engine(G.S, (blob && blob.save) || null); } catch (err) { G.engine = new E.Engine(G.S); }
  G.saveOk = null;
  G.saving = false;
  renderSaved();
}
async function loadProfile(name) {
  await readProfile(name);
  Object.assign(G.ui, { seen: {}, confirm: null, ticket: null, doc: null, draft: {}, own: {} });
  renderBrand();
  resetStream();
  after(false);
}
let profileChanging = false;
async function changeProfile(action) {
  if (profileChanging) return;
  profileChanging = true;
  try {
    // Keep the old profile current until its buffers and save are durable.
    if (window.Bench && !(await window.Bench.reset())) return;
    if ((await persist(true)) === false) {
      toast('Could not save this profile. Resolve the save error before changing profiles.');
      return;
    }
    await action();
  } catch (err) {
    toast(String(err.message || err));
  } finally {
    profileChanging = false;
  }
}
async function switchProfile(name) {
  if (name === G.profile) return;
  return changeProfile(async () => {
    await loadProfile(name);
    closeSheet();
    showTitle();
  });
}
async function createProfile(name) {
  return changeProfile(async () => {
    await window.K28.call('profile_create', { name });
    await refreshProfiles();
    await loadProfile(name);
    closeSheet();
    showTitle();
  });
}
async function deleteProfile() {
  return changeProfile(async () => {
    const gone = G.profile;
    await window.K28.call('profile_delete', { profile: gone });
    await refreshProfiles();
    let next = (G.profiles || []).find(n => n !== gone);
    if (!next) {
      next = 'Player 1';
      await window.K28.call('profile_create', { name: next });
      await refreshProfiles();
    }
    await loadProfile(next);
    closeSheet();
    showTitle();
  });
}
function replayChapter(ch) {
  if (!G.engine.restoreChapter(ch)) return;
  Object.assign(G.ui, { draft: {}, own: {}, doc: null, seen: {} });
  resetStream();
  closeSheet();
  hideTitle();
  if (isNarrow()) setView('story');
  after(false);
  persist(true);
  toast('Back to the start of ' + G.S.chapterMap[ch].label + '.');
}

/* ── save files ── */
function saveObject() {
  return { format: 'signal-noise-save', version: 1, profile: G.profile, story: G.S.hash, exported: new Date().toISOString(), settings: G.settings, save: G.engine.serialize() };
}
function savePage() {
  const json = G.ui.saveText || JSON.stringify(saveObject(), null, 2);
  G.ui.saveText = null;
  const ta = h('textarea', { id: 'save-text', spellcheck: 'false', 'aria-label': 'Save file as text' });
  ta.value = json;
  return h('div', null,
    h('p', null, 'The whole save, as text. Copy it somewhere safe, or paste a save here and load it.'),
    ta,
    h('div', { class: 'row', style: 'margin-top:10px' },
      btn('Select all', 'ghost small', () => { ta.focus(); ta.select(); }),
      btn('Load this text', 'primary small', () => importSave(ta.value))));
}
function importSave(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (err) { toast('That isn’t valid JSON.'); return; }
  const save = obj && obj.format === 'signal-noise-save' ? obj.save : (obj && obj.state ? obj : null);
  if (!save || !save.state || !Array.isArray(save.state.log)) { toast('That doesn’t look like a save from this game.'); return; }
  G.engine = new E.Engine(G.S, save);
  if (obj.settings) { G.settings = Object.assign({ casual: false, size: 'm' }, obj.settings); applySettings(); }
  Object.assign(G.ui, { seen: {}, draft: {}, own: {}, doc: null, ticket: null });
  resetStream();
  closeSheet();
  hideTitle();
  after(false);
  persist(true);
  toast(save.state.story && save.state.story !== G.S.hash ? 'Save loaded. It was made with different story files, so it continues where it can.' : 'Save loaded.');
}
function readFileInput(input, cb) {
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { input.value = ''; cb(String(r.result || '')); };
  r.onerror = () => toast('Couldn’t read that file.');
  r.readAsText(f);
}

/* ── author tools: the clue ledger and loading edited .story files ── */
function issueList(R) {
  const rows = [].concat(
    R.errors.map(x => ['error', x]), R.warnings.map(x => ['warning', x]), R.notes.map(x => ['note', x]));
  if (!rows.length) return h('p', null, 'No problems found.');
  return h('ul', { class: 'issues' }, rows.map(([lv, x]) => h('li', null, h('span', { class: 'lv ' + lv }, lv), h('span', null, x.msg, h('span', { class: 'where' }, x.where)))));
}
function ledgerPage() {
  const wrap = h('div', { class: 'ledger' });
  if (!G.ui.ledger || G.ui.ledger.hash !== G.S.hash) {
    wrap.append(h('p', null, 'Checking the story, then playing it through 120 times…'));
    setTimeout(() => {
      let R;
      try { R = L.runLedger(G.S, { runs: 40 }); } catch (err) { R = { errors: [{ where: 'ledger', msg: err.message }], warnings: [], notes: [], keys: [], gates: [], runs: null, ms: 0, story: { files: [], hash: G.S.hash } }; }
      G.ui.ledger = { hash: G.S.hash, R };
      if (G.ui.sheet === 'ledger') renderSheet();
    }, 40);
    return wrap;
  }
  const R = G.ui.ledger.R;
  wrap.append(h('div', { class: 'sum' },
    h('span', null, h('b', null, String(R.errors.length)), 'errors'),
    h('span', null, h('b', null, String(R.warnings.length)), 'warnings'),
    h('span', null, h('b', null, String(R.notes.length)), 'notes'),
    h('span', null, 'story ' + G.S.hash + ' · ' + R.ms + ' ms')));
  wrap.append(h('section', null, h('h3', null, 'Issues'), issueList(R)));
  if (R.runs) {
    wrap.append(h('section', null, h('h3', null, 'Simulated playthroughs'),
      h('div', { class: 'tablewrap' }, h('table', { class: 'mini' },
        h('thead', null, h('tr', null, h('th', null, 'Run'), h('th', null, 'Ended'), h('th', null, 'Followed'), h('th', null, 'Hints'))),
        h('tbody', null, R.runs.groups.map(g => h('tr', null, h('td', null, g.label), h('td', { class: 'num' }, g.ok + '/' + g.n), h('td', { class: 'num' }, String(g.followed)), h('td', { class: 'num' }, String(g.hints))))))),
      h('p', null, 'Scene coverage ' + R.runs.coverage.covered + '/' + R.runs.coverage.total + ' · same seed, same log: ' + (R.runs.deterministic ? 'yes' : 'no'))));
  }
  wrap.append(h('section', null, h('h3', null, 'Epilogue gates'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'mini' },
      h('thead', null, h('tr', null, h('th', null, 'Fragment'), h('th', null, 'Requires'), h('th', null, 'Slack'), R.runs ? h('th', null, 'Opened') : null)),
      h('tbody', null, R.gates.map(g => h('tr', null,
        h('td', null, fill(g.title)),
        h('td', null, g.atoms.map(a => h('div', null, a.src, h('span', { class: 'where' }, a.detail)))),
        h('td', { class: 'num' }, String(g.minSlack === Infinity ? '—' : g.minSlack)),
        R.runs ? h('td', { class: 'num' }, ['zero', 'attentive', 'mixed'].map(k => R.runs.codaRates[g.id][k] || 0).join(' / ')) : null))))),
    R.runs ? h('p', null, 'Opened: zero-click / every hotspot / half the hotspots, out of ' + R.runs.groups[0].n + ' runs each.') : null));
  wrap.append(h('section', null, h('h3', null, 'Hypotheses'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'mini' },
      h('thead', null, h('tr', null, h('th', null, 'Answer'), h('th', null, 'For'), h('th', null, 'Against'), h('th', null, 'Phases'))),
      h('tbody', null, R.keys.map(k => h('tr', null,
        h('td', null, fill(k.text), h('span', { class: 'where' }, fill(k.question) + (k.key ? ' · key' : k.trail ? ' · false trail' : ''))),
        h('td', { class: 'num' }, String(k.pro)), h('td', { class: 'num' }, String(k.con)), h('td', null, k.phases.join(', ') || '—'))))))));
  wrap.append(h('section', null, h('div', { class: 'row' }, btn('Run it again', 'ghost small', () => { G.ui.ledger = null; renderSheet(); }))));
  return wrap;
}

function filesPage() {
  const wrap = h('div');
  wrap.append(h('p', null, G.custom ? 'Playing from story files you loaded:' : 'Playing the built-in story:'),
    h('ul', { class: 'filelist' }, G.files.map(f => h('li', null, f.name + ' · ' + (f.text.length / 1024).toFixed(1) + ' KB'))),
    h('p', null, 'Edit the .story files in any text editor, then load them here. A file with the same name replaces the one in play; new names are added. Loaded files stay in this browser until you switch back.'),
    h('div', { class: 'row' },
      btn('Load .story files', 'primary small', () => $('#story-files').click()),
      G.custom ? btn('Use the built-in story', 'ghost small', () => applyStory(G.builtin, false, false)) : null),
    h('input', { type: 'file', id: 'story-files', multiple: true, accept: '.story,.txt,text/plain', hidden: true, onchange: ev => loadStoryFiles(ev.target) }));
  const P = G.ui.pending;
  if (P) {
    wrap.append(h('div', { class: 'confirm' },
      h('p', null, 'Read ' + plural(P.loaded.length, 'file') + ': ' + P.loaded.join(', ') + '. ' + (P.errors ? plural(P.errors, 'error') + ' in the story data' : 'No errors') + ', ' + plural(P.warnings, 'warning') + '.'),
      P.first ? h('p', null, P.first.where + ': ' + P.first.msg) : null,
      h('div', { class: 'row' },
        btn('Play them, keep my progress', 'primary small', () => applyStory(P.files, true, false)),
        btn('Start a new game with them', 'ghost small', () => applyStory(P.files, true, true)),
        btn('Cancel', 'ghost small', () => { G.ui.pending = null; renderSheet(); }))));
  }
  return wrap;
}
function loadStoryFiles(input) {
  const list = Array.from(input.files || []);
  if (!list.length) return;
  Promise.all(list.map(f => f.text().then(text => ({ name: f.name, text })))).then(files => {
    input.value = '';
    const byName = {};
    for (const f of G.files) byName[f.name] = f;
    for (const f of files) byName[f.name] = f;
    const merged = Object.keys(byName).sort().map(n => byName[n]);
    const R = L.runLedger(E.parseStory(merged), { runs: 0 });
    G.ui.pending = { files: merged, loaded: files.map(f => f.name), errors: R.errors.length, warnings: R.warnings.length, first: R.errors[0] || R.warnings[0] || null };
    renderSheet();
  }).catch(() => toast('Couldn’t read those files.'));
}
function applyStory(files, custom, fresh) {
  const save = fresh ? null : (G.engine && G.engine.state.started ? G.engine.serialize() : null);
  G.files = files;
  G.custom = custom;
  G.S = E.parseStory(files);
  G.engine = new E.Engine(G.S, save);
  Object.assign(G.ui, { pending: null, ledger: null, seen: {}, doc: null, ticket: null });
  renderBrand();
  resetStream();
  after(false);
  persist(true);
  closeSheet();
  showTitle();
  toast(custom ? 'Story files loaded.' : 'Back to the built-in story.');
}

/* ── wiring and boot ── */
function onDocClick(ev) {
  const t = ev.target.closest && ev.target.closest('[data-clue]');
  if (t && t.getAttribute('role') === 'button') { ev.preventDefault(); openClue(t.dataset.clue, t); return; }
  if (G.pop && !(ev.target.closest && ev.target.closest('.pop'))) closePop();
}
function onKey(ev) {
  const t = ev.target;
  if (ev.key === 'Escape') {
    if (G.pop) { closePop(); ev.preventDefault(); return; }
    if (G.ui.sheet) { closeSheet(); ev.preventDefault(); return; }
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && t && t.matches && t.matches('[data-clue][role="button"]')) { ev.preventDefault(); openClue(t.dataset.clue, t); return; }
  if (!$('#title').hidden || G.ui.sheet || G.pop) return;
  if ($('#app').classList.contains('benching')) return;
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
  const tag = ((t && t.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || (t && t.isContentEditable)) return;
  const st = G.engine.state;
  if ((ev.key === ' ' || ev.key === 'Enter') && st.started && !st.wait && !st.error) { ev.preventDefault(); onContinue(); return; }
  if (/^[1-9]$/.test(ev.key) && st.wait && st.wait.type === 'menu') {
    const o = G.engine.options()[+ev.key - 1];
    if (o) { ev.preventDefault(); onChoose(o.i); }
  }
}
function wire() {
  $('#brand').addEventListener('click', showTitle);
  $('#menu-btn').addEventListener('click', () => openSheet('main'));
  $$('#panel-tabs .tab').forEach(b => b.addEventListener('click', () => { G.ui.tab = b.dataset.tab; renderPanel(); updateBadges(); }));
  $$('#mtabs .tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#stream').addEventListener('scroll', ev => followPop(ev.currentTarget), { passive: true });
  $('#panel-body').addEventListener('scroll', ev => followPop(ev.currentTarget), { passive: true });
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    const n = isNarrow();
    if (n === wasNarrow) return;
    wasNarrow = n;
    closePop();
    if (!n) { G.ui.view = 'story'; $('#app').dataset.view = 'story'; }
    renderPanel();
    updateBadges();
  });
}
function readStoryFiles() {
  return $$('script.story-file').map(s => ({ name: s.getAttribute('data-name'), text: s.textContent.replace(/^\n/, '') }));
}
async function boot() {
  G.builtin = readStoryFiles();
  try {
    G.init = await window.K28.call('init', {});
  } catch (err) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">The game could not start its backend: ' + String((err && err.message) || err) + '</p>';
    return;
  }
  G.profiles = (G.init.profiles || []).map(p => p.name);
  let active = null;
  try { active = window.localStorage.getItem(KEY); } catch (err) { active = null; }
  if (!active || G.profiles.indexOf(active) < 0) active = G.profiles[0] || null;
  if (!active) {
    active = 'Player 1';
    try { await window.K28.call('profile_create', { name: active }); } catch (err) { /* already there */ }
    await refreshProfiles();
  }
  await readProfile(active);
  wire();
  renderBrand();
  resetStream();
  after(false);
  showTitle();
  if (window.Bench) window.Bench.init(window.StoryBridge);
}

/* What the workbench needs from the story. */
window.StoryBridge = {
  profile: () => G.profile,
  engine: () => G.engine,
  story: () => G.S,
  init: () => G.init,
  fill: t => fill(t),
  rich: t => rich(t),
  ticketEl: id => ticketEl(id, true),
  captureEl: T => captureEl(T),
  extras: id => G.engine.extraFor(id),
  bench: () => G.bench || (G.bench = {}),
  persist: now => persist(now),
  toast: m => toast(m),
  passed(id, extra) {
    G.engine.pass(id, !!extra);
    after(true);
    persist(true);
  },
  failed(id) {
    G.engine.failRun(id);
    renderPanel();
    updateBadges();
    persist(true);
  },
  refresh() { renderPanel(); updateBadges(); },
  isNarrow: () => isNarrow(),
};

boot();
