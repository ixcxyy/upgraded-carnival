/* ───────── ui-app: clue popover, title screen, menu, profiles, author tools, boot ───────── */

/* ── clue popover: an observation, then ask / note / let it go ──
   The opaline card grows out of the phrase the player chose and retracts into it. The phrase
   itself never moves; the card's sheen follows the pointer. */
function closePop(instant) {
  const pop = G.pop, anchor = G.popAnchor;
  if (!pop) return;
  G.pop = null;
  G.popAnchor = null;
  if (anchor) anchor.classList.remove('is-open');
  const hadFocus = pop.contains(document.activeElement);
  if (hadFocus && anchor && anchor.isConnected && anchor.getAttribute('tabindex') === '0') anchor.focus({ preventScroll: true });
  if (instant || reducedMotion() || !SNX() || !anchor || !anchor.isConnected || window.innerWidth <= 560) { pop.remove(); return; }
  pop.style.pointerEvents = 'none';
  SNX().motion.animate(pop, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.6, 0.3)' }], { dur: 170, ease: SNX().motion.EASE.in, key: 'grow' })
    .then(() => pop.remove());
}
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
  closePop(true);
  const act = a => () => {
    closePop();
    G.engine.act(id, a.id);
    if (a.id === 'ask' && isNarrow() && G.ui.view !== 'story') setView('story');
    after(true);
    if (a.id === 'note') toast('Noted. It’s on the case board.', 'note');
  };
  const icons = { ask: 'message', note: 'note', letgo: 'letgo' };
  const acts = info.actions.map(a => btn(fill(a.label), a.id === 'ask' ? 'primary small' : 'ghost small', act(a), null, icons[a.id]));
  const state = info.status === 'asked' ? 'In the notebook · you asked'
    : info.status === 'noted' ? 'In the notebook'
      : info.letgo ? 'You let this go once. It stays open until the chapter ends.' : '';
  const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'What you notice', 'aria-describedby': 'pop-obs' },
    h('div', { class: 'pop-k' }, ic('clue'), 'You notice · ' + info.track),
    h('p', { class: 'pop-obs', id: 'pop-obs' }, fill(info.obs)),
    acts.length ? h('div', { class: 'row' }, acts) : null,
    state ? h('div', { class: 'pop-state' }, ic(info.status === 'open' ? 'letgo' : 'note'), state) : null,
    ibtn('close', 'Close (Esc)', () => closePop(), { cls: 'sm pop-x' }));
  pop.addEventListener('keydown', ev => {
    if (ev.key === 'Tab' && SNX()) SNX().trapTab(pop)(ev);
  });
  document.body.append(pop);
  G.pop = pop;
  G.popAnchor = anchor;
  anchor.classList.add('is-open');
  placePop(pop, anchor);
  if (SNX()) {
    SNX().motion.sheen(pop);
    if (window.innerWidth > 560) {
      const a = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect();
      pop.style.transformOrigin = (a.left + a.width / 2 - p.left).toFixed(1) + 'px ' + (a.top + a.height / 2 - p.top).toFixed(1) + 'px';
      SNX().motion.animate(pop, [
        { opacity: 0, transform: 'scale(' + Math.min(0.5, Math.max(0.15, a.width / p.width)).toFixed(3) + ', 0.12)', borderRadius: '10px' },
        { opacity: 1, transform: 'none', borderRadius: '18px' },
      ], { dur: 380, ease: SNX().motion.EASE.spring, key: 'grow' });
    } else {
      SNX().motion.animate(pop, [{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 300, ease: SNX().motion.EASE.spring, key: 'grow' });
    }
    Array.from(pop.children).forEach((c, i) => SNX().motion.animate(c, [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { dur: 240, delay: 90 + i * 35, key: 'kid', fill: 'backwards' }));
  }
  const first = pop.querySelector('.row button') || pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
  refreshHotspots();
  persist();
}
function placePop(pop, anchor) {
  if (window.innerWidth <= 560) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.min(Math.max(16, r.left + Math.min(r.width, 60) / 2 - 36), window.innerWidth - pw - 16);
  let top = r.bottom + 10;
  if (top + ph > window.innerHeight - 16) top = Math.max(16, r.top - ph - 10);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

/* ── title screen ── */
let traceRaf = 0;
function splitTitle(t) {
  const i = String(t).indexOf('/');
  return i < 0 ? [t, null] : [t.slice(0, i).trim(), t.slice(i + 1).trim()];
}
function brandMark() { return h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, ic('mark')); }
function renderBrand() {
  const [a, b] = splitTitle(fill(G.S.meta.title || ''));
  put($('#brand-word'), a, b ? h('span', { class: 'slash' }, '/') : null, b || null);
  const m = $('#brand .brand-mark');
  if (m && !m.firstChild) m.append(ic('mark'));
  const pn = $('#profile-name');
  if (pn) pn.textContent = G.profile;
  const pb = $('#profile-btn');
  if (pb) pb.setAttribute('aria-label', 'Profile ' + G.profile + ': profiles, saves and settings');
}
function showTitle() {
  closePop(true);
  closeSheet();
  renderTitle();
  $('#title').hidden = false;
  $('#title').setAttribute('data-modal', 'open');
  startTrace();
  const p = $('#title .acts .btn.primary');
  if (p) p.focus({ preventScroll: true });
}
function hideTitle() {
  const t = $('#title');
  if (document.activeElement && t.contains(document.activeElement)) document.activeElement.blur();
  t.hidden = true;
  t.removeAttribute('data-modal');
  cancelAnimationFrame(traceRaf);
  traceRaf = 0;
}
function confirmNewGame() {
  if (!SNX()) { newGame(); return; }
  SNX().dialog.confirm({
    title: 'Start over?', icon: 'restart', danger: true, ok: 'Start over', cancel: 'Keep playing',
    body: 'Start over as ' + G.profile + '? This profile’s progress is replaced. Your code stays in its folder. Other profiles keep theirs.',
  }).then(ok => { if (ok) newGame(); });
}
function renderTitle() {
  const S = G.S, m = S.meta, st = G.engine.state;
  const [a, b] = splitTitle(fill(m.title || 'Untitled'));
  const has = st.started;
  const C = has && st.chapter ? S.chapterMap[st.chapter] : null;
  const first = !G.ui.titleSeen;
  const rv = n => first ? 'reveal d' + n : '';
  const inner = $('#title-inner');
  put(inner,
    h('div', { class: 'title-top' },
      h('div', { class: 'title-badge' }, brandMark(), fill(m.mcu || 'K28') + ' · first cut'),
      h('div', { class: 'title-icons' },
        ibtn('profile', 'Profiles and saves', () => openSheet('main')),
        ibtn('settings', 'Settings', () => openSheet('main', 'settings')),
        window.K28.desktop ? ibtn('quit', 'Quit', () => window.K28.quit()) : null)),
    m.subtitle ? h('p', { class: 'sub ' + rv(1) }, fill(m.subtitle)) : null,
    h('h1', null, a, b ? [h('span', { class: 'slash' }, '/'), b] : null),
    h('div', { class: 'trace ' + rv(1) }, h('span', { class: 'nm' }, fill(m.trace || ''), h('small', null, 'decorative')), h('canvas', { id: 'trace-cv', 'aria-hidden': 'true' })),
    h('div', { class: 'cut ' + rv(2) }, ['First cut', plural(S.chapters.length, 'chapter'), plural(S.order.tasks.length, 'task'), 'C on an emulated ' + fill(m.mcu || 'chip')].map(x => h('span', null, x))),
    G.init && G.init.toolchain && !G.init.toolchain.ok ? h('p', { class: 'note bad' }, ic('alert'), 'The C compiler was not found: ' + G.init.toolchain.error) : null,
    h('div', { class: 'acts ' + rv(2) },
      has ? btn(st.ended ? 'Back to the ending' : 'Continue', 'primary large', resume, null, 'run') : btn('Begin', 'primary large', newGame, null, 'run'),
      has ? btn('New game', 'ghost large', confirmNewGame, null, 'restart') : null,
      has && C && !st.ended ? h('span', { class: 'resume' }, h('span', null, C.label), h('b', null, fill(C.title))) : null),
    h('div', { class: 'meta ' + rv(3) },
      h('span', null, 'Playing as ', h('b', null, G.profile)),
      linkBtn('Profiles, saves and settings', () => openSheet('main'))),
    h('p', { class: 'note ' + rv(3) }, ic('info'), 'When a detail in the text catches your eye, click it. The ones that matter are mostly quiet. Text never moves on without you: Space or Enter continues, number keys choose.'),
    G.custom ? h('p', { class: 'note' }, ic('doc'), 'You’re playing from story files you loaded. The built-in story is in the menu under Author tools.') : null);
  if (SNX()) SNX().motion.sheen(inner.querySelector('h1'));
}

/* The title card's trace: the heartbeat from J4.7 — a decorative line, labelled so, never telemetry.
   On the first showing, short noisy marks resolve into the clean pulse in about 600 ms; the
   buttons are live from the first frame. Reduced motion draws one still frame. */
function startTrace() {
  cancelAnimationFrame(traceRaf);
  const cv = $('#trace-cv');
  if (!cv) return;
  const still = reducedMotion();
  const reveal = !G.ui.titleSeen && !still;
  G.ui.titleSeen = true;
  let colors = null, stamp = -1e9, t0Reveal = null;
  const edges = [[0, 1], [80, 0], [200, 1], [280, 0]];
  const REVEAL = 620;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const draw = now => {
    traceRaf = 0;
    if (!cv.isConnected || $('#title').hidden || document.hidden) return;
    if (t0Reveal === null) t0Reveal = now;
    const p = reveal ? Math.min(1, (now - t0Reveal) / REVEAL) : 1;
    const ease = 1 - Math.pow(1 - p, 3);
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, ht = cv.clientHeight;
    if (w && ht) {
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(ht * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr); }
      if (!colors || now - stamp > 1000) {
        const cs = getComputedStyle(document.documentElement);
        colors = { ink: cs.getPropertyValue('--sig').trim() || '#8ED6FF', grid: cs.getPropertyValue('--line').trim() || 'rgba(255,255,255,0.08)', noise: cs.getPropertyValue('--text-3').trim() || '#888' };
        stamp = now;
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, ht);
      const span = Math.min(9000, Math.max(4000, w * 8));
      const tEnd = still ? 5290 : now;
      const t0 = tEnd - span;
      const X = t => ((t - t0) / span) * w;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      for (let s = Math.ceil(t0 / 1000) * 1000; s <= tEnd; s += 1000) {
        const x = Math.round(X(s)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, ht - 6); ctx.stroke();
      }
      const hi = 10, lo = ht - 10, mid = (hi + lo) / 2;
      if (p < 1) {
        // Noise: short marks scattered about the midline, fewer and smaller as the pulse resolves.
        ctx.strokeStyle = colors.noise;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1 - ease;
        ctx.beginPath();
        const n = Math.round(160 * (1 - ease)) + 8;
        for (let k = 0; k < n; k++) {
          const x = rnd() * w, amp = (rnd() * 0.5 + 0.2) * (lo - hi) * (1 - ease * 0.7);
          ctx.moveTo(x, mid - amp / 2);
          ctx.lineTo(x + rnd() * 6, mid + amp / 2);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const f0 = ((t0 % 1000) + 1000) % 1000;
      let v = (f0 < 80 || (f0 >= 200 && f0 < 280)) ? 1 : 0;
      const yOf = l => mid + ((l ? hi : lo) - mid) * ease;
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = 0.25 + 0.75 * ease;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.shadowColor = colors.ink;
      ctx.shadowBlur = 6 * ease;
      ctx.beginPath();
      ctx.moveTo(0, yOf(v));
      for (let fs = Math.floor(t0 / 1000) * 1000; fs <= tEnd; fs += 1000) {
        for (const [dt, nv] of edges) {
          const t = fs + dt;
          if (t <= t0 || t > tEnd) continue;
          const x = X(t);
          ctx.lineTo(x, yOf(v));
          ctx.lineTo(x, yOf(nv));
          v = nv;
        }
      }
      ctx.lineTo(w, yOf(v));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      const g = ctx.createLinearGradient(0, 0, w * 0.3, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w * 0.3, ht);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!still) traceRaf = requestAnimationFrame(draw);
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
function openSheet(page, focusSection) {
  closePop(true);
  if (!G.ui.sheet) G.sheetReturn = document.activeElement;
  G.ui.sheet = page || 'main';
  G.ui.sheetFocus = focusSection || null;
  renderSheet(true);
  if (G.ui.sheet === 'main') refreshProfiles().then(() => { if (G.ui.sheet === 'main') renderSheet(); });
}
function closeSheet() {
  G.ui.sheet = null;
  const b = $('#backdrop');
  if (!b) return;
  b.removeAttribute('data-modal');
  const done = () => b.remove();
  const sheet = b.firstChild;
  if (SNX() && sheet) {
    SNX().motion.animate(sheet, [{ transform: 'none' }, { transform: 'translateX(40px)', opacity: 0 }], { dur: 180, ease: SNX().motion.EASE.in, key: 'sheet' });
    SNX().motion.animate(b, [{ opacity: 1 }, { opacity: 0 }], { dur: 200, key: 'fade' }).then(done);
  } else done();
  const r = G.sheetReturn;
  G.sheetReturn = null;
  if (r && r.isConnected && r.focus) r.focus({ preventScroll: true });
}
function renderSheet(entering) {
  let b = $('#backdrop');
  const fresh = !b || !b.hasAttribute('data-modal');
  if (b && fresh) { b.remove(); b = null; }
  if (!b) {
    b = h('div', { class: 'backdrop', id: 'backdrop', 'data-modal': 'open' });
    b.addEventListener('mousedown', ev => { if (ev.target === b) closeSheet(); });
    b.addEventListener('keydown', ev => { if (SNX()) SNX().trapTab(b)(ev); });
    document.body.append(b);
  }
  const page = G.ui.sheet;
  const titles = { main: ['settings', 'Menu'], ledger: ['case', 'Clue ledger'], files: ['doc', 'Story files'], save: ['save', 'Save file'] };
  const t = titles[page] || titles.main;
  const body = page === 'ledger' ? ledgerPage() : page === 'files' ? filesPage() : page === 'save' ? savePage() : mainPage();
  const scroll = !entering && b.firstChild ? b.firstChild.scrollTop : 0;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, ic(t[0], { size: 18 }), t[1]),
      h('div', { class: 'row' }, page !== 'main' ? btn('Back', 'ghost small', () => openSheet('main'), null, 'back') : null, ibtn('close', 'Close (Esc)', closeSheet))),
    body);
  b.replaceChildren(sheet);
  sheet.scrollTop = scroll;
  if (fresh && SNX()) {
    SNX().motion.animate(b, [{ opacity: 0 }, { opacity: 1 }], { dur: 200, key: 'fade' });
    SNX().motion.animate(sheet, [{ transform: 'translateX(48px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { dur: 340, ease: SNX().motion.EASE.spring, key: 'sheet' });
  }
  if (entering) {
    const target = G.ui.sheetFocus ? sheet.querySelector('[data-sec="' + G.ui.sheetFocus + '"] button, [data-sec="' + G.ui.sheetFocus + '"] input') : null;
    const f = target || sheet.querySelector('.sheet-head button');
    if (f) f.focus({ preventScroll: true });
    if (target) target.scrollIntoView({ block: 'center' });
  }
}

function segmented(label, options, current, onPick) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([k, text, icn]) =>
    h('button', { type: 'button', 'aria-pressed': String(current === k), onclick: () => onPick(k) }, icn ? ic(icn, { size: 14 }) : null, text)));
  if (SNX()) requestAnimationFrame(() => { if (seg.isConnected) SNX().indicator(seg).move($('[aria-pressed="true"]', seg), true); });
  return seg;
}
function setSetting(k, v) {
  G.settings[k] = v;
  applySettings();
  persist();
  renderSheet();
}

function mainPage() {
  const S = G.S;
  const names = (G.profiles || []).slice();
  if (names.indexOf(G.profile) < 0) names.push(G.profile);
  const snaps = S.chapters.filter(c => G.engine.snaps[c.id]);
  return h('div', null,
    h('section', { 'data-sec': 'profile' }, h('h3', null, ic('profile'), 'Profile'),
      h('p', null, 'Each profile keeps its own save and its own code, so friends can share one computer.'),
      h('div', { class: 'row' },
        h('label', { class: 'sr', for: 'profile-select' }, 'Profile'),
        h('select', { id: 'profile-select', onchange: ev => switchProfile(ev.target.value) }, names.map(n => h('option', { value: n, selected: n === G.profile }, n))),
        btn('New profile', 'ghost small', askNewProfile, null, 'plus'),
        names.length > 1 ? btn('Delete this one', 'ghost small', askDeleteProfile, null, 'delete') : null)),
    h('section', { 'data-sec': 'settings' }, h('h3', null, ic('settings'), 'Appearance and reading'),
      h('div', { class: 'setrow' }, h('span', null, 'Theme'),
        segmented('Theme', [['dark', 'Instrument'], ['light', 'Daylight'], ['system', 'System']], G.settings.theme || 'dark', v => setSetting('theme', v))),
      h('div', { class: 'setrow' }, h('span', null, 'Text size'),
        segmented('Text size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], G.settings.size, v => setSetting('size', v))),
      h('div', { class: 'setrow' }, h('span', null, 'Motion'),
        segmented('Motion', [['system', 'Follow system'], ['reduced', 'Reduced']], G.settings.motion === 'reduced' ? 'reduced' : 'system', v => setSetting('motion', v))),
      h('label', { class: 'opt switch' },
        h('span', null, h('span', { class: 'ol' }, 'Casual clues'), h('small', null, 'Underline every detail you can stop on, including the quiet ones.')),
        h('input', { type: 'checkbox', id: 'opt-casual', checked: !!G.settings.casual, onchange: ev => { G.settings.casual = ev.target.checked; applySettings(); persist(); } }),
        h('span', { class: 'track', 'aria-hidden': 'true' }))),
    h('section', null, h('h3', null, ic('undo'), 'Replay a chapter'),
      snaps.length
        ? [h('p', null, 'Go back to the start of a chapter you’ve reached. Everything after that point in this profile is replaced, and the details you walked past are open again.'),
          h('div', { class: 'chaplist' }, snaps.map(c => h('button', { type: 'button', onclick: () => askReplay(c.id) },
            h('span', { class: 't' }, c.label + ' · ' + fill(c.title)), h('span', { class: 'k' }, c.phase))))]
        : h('p', null, 'Chapters you reach show up here.')),
    h('section', null, h('h3', null, ic('save'), 'Save file and code'),
      h('p', null, 'Progress saves as you play, as plain JSON next to this profile’s code: your progress, every clue’s state, the whole log. Your C files are ordinary files in the same folder; open them in any editor you like.'),
      h('div', { class: 'row' },
        btn('Open the profile folder', 'ghost small', () => window.K28.call('reveal', { profile: G.profile }).catch(err => toast(String(err.message || err), 'alert')), null, 'folder-open'),
        btn('Load a save file', 'ghost small', () => $('#import-file').click(), null, 'file'),
        btn('Show as text', 'ghost small', () => openSheet('save'), null, 'doc')),
      h('input', { type: 'file', id: 'import-file', accept: '.json,application/json', hidden: true, onchange: ev => readFileInput(ev.target, importSave) })),
    h('section', null,
      h('details', { class: 'author', open: G.ui.authorOpen || null, ontoggle: ev => { G.ui.authorOpen = ev.target.open; } },
        h('summary', null, ic('chev-right', { size: 14 }), 'Author tools'),
        h('p', null, 'The story is plain-text .story files. The ledger checks every reference and plays the story through, with and without attention.'),
        h('div', { class: 'row' }, btn('Clue ledger', 'ghost small', () => openSheet('ledger'), null, 'case'), btn('Story files', 'ghost small', () => openSheet('files'), null, 'doc')),
        standIn())),
    h('section', null, h('div', { class: 'row' }, btn('Title screen', 'ghost small', () => { closeSheet(); showTitle(); }, null, 'back'),
      window.K28.desktop ? btn('Quit', 'ghost small', () => window.K28.quit(), null, 'quit') : null)));
}

function askNewProfile() {
  SNX().dialog.prompt({
    title: 'New profile', icon: 'profile', ok: 'Create', label: 'Name',
    input: { placeholder: 'e.g. Felix', maxlength: 32, hint: 'A profile has its own save and its own code folder.' },
    validate: v => !v ? 'Give the profile a name first.' : (G.profiles || []).indexOf(v) >= 0 ? 'There is already a profile called ' + v + '.' : null,
    onSubmit: async v => {
      const ok = await createProfile(v);
      if (ok === false) throw new Error(G.profileErr || 'Could not create the profile.');
    },
  });
}
function askDeleteProfile() {
  SNX().dialog.confirm({
    title: 'Delete ' + G.profile + '?', icon: 'delete', danger: true, ok: 'Delete', cancel: 'Keep it',
    body: 'Delete ' + G.profile + ', its save and its code folder? This can’t be undone.',
  }).then(ok => { if (ok) deleteProfile(); });
}
function askReplay(ch) {
  const C = G.S.chapterMap[ch];
  SNX().dialog.confirm({
    title: 'Replay ' + C.label + '?', icon: 'undo', ok: 'Replay from here', cancel: 'Keep my place',
    body: 'Everything after the start of ' + C.label + ' in this profile is replaced, and the details you walked past are open again.',
  }).then(ok => { if (ok) replayChapter(ch); });
}

/* Author tool: stand in for the checker on the task in hand (to test the story, or to get unstuck). */
function standIn() {
  const st = G.engine.state;
  const id = st.wait && st.wait.type === 'task' ? st.wait.id : null;
  if (!id) return null;
  const T = G.S.tasks[id];
  return h('div', { class: 'row', style: 'margin-top:10px' },
    h('span', { style: 'font-size:0.86rem;color:var(--text-2)' }, 'Stand in for the checker on ' + fill(T.title) + ':'),
    btn('Record a failed submission', 'ghost small', () => { G.engine.failRun(id); closeSheet(); after(true); }),
    btn('Pass it', 'ghost small', () => { G.engine.pass(id, false); closeSheet(); if (window.Bench) window.Bench.close(); after(true); }));
}

function applySettings() {
  const root = document.documentElement;
  root.classList.remove('size-s', 'size-l');
  if (G.settings.size === 's') root.classList.add('size-s');
  if (G.settings.size === 'l') root.classList.add('size-l');
  root.dataset.theme = G.settings.theme === 'light' || G.settings.theme === 'system' ? G.settings.theme : 'dark';
  if (G.settings.motion === 'reduced') root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
  document.body.classList.toggle('casual', !!G.settings.casual);
  $('#app').classList.toggle('panel-closed', G.settings.panel === 'closed');
  if (window.Bench && window.Bench.setAppearance) window.Bench.setAppearance();
}

/* ── profiles: one folder each, managed by the app ── */
/* Settings added by the redesign (theme, motion, panel) are optional: older saves get these defaults. */
function defaultSettings() { return { casual: false, size: 'm', theme: 'dark', motion: 'system', panel: 'open' }; }
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
  G.settings = Object.assign(defaultSettings(), (blob && blob.settings) || {});
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
/* Resolves true when the action ran; false (with G.profileErr) when it was refused or failed. */
async function changeProfile(action) {
  if (profileChanging) return false;
  profileChanging = true;
  G.profileErr = null;
  try {
    // Keep the old profile current until its buffers and save are durable.
    if (window.Bench && !(await window.Bench.reset())) { G.profileErr = 'The workbench is busy or could not save. Try again when it is idle.'; return false; }
    if ((await persist(true)) === false) {
      G.profileErr = 'Could not save this profile. Resolve the save error before changing profiles.';
      toast(G.profileErr, 'alert');
      return false;
    }
    await action();
    return true;
  } catch (err) {
    G.profileErr = String(err.message || err);
    toast(G.profileErr, 'alert');
    return false;
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
  toast('Back to the start of ' + G.S.chapterMap[ch].label + '.', 'undo');
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
  if (obj.settings) { G.settings = Object.assign(defaultSettings(), obj.settings); applySettings(); }
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
  if (SNX() && SNX().modalOpen() && !G.ui.sheet && $('#title').hidden) return; // an in-app dialog has the keyboard
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
  for (const el of $$('[data-icon]')) { const i = ic(el.dataset.icon); if (i) el.replaceWith(i); }
  $('#brand').addEventListener('click', showTitle);
  $('#menu-btn').addEventListener('click', () => openSheet('main'));
  $('#profile-btn').addEventListener('click', () => openSheet('main', 'profile'));
  $('#panel-close').addEventListener('click', () => setPanelOpen(false));
  $$('#panel-tabs .rail-btn').forEach(b => b.addEventListener('click', () => railClick(b.dataset.tab)));
  $$('#mtabs .tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  // Keyboard: arrows move between rail destinations, as in any vertical tab list.
  $('#panel-tabs').addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const list = $$('#panel-tabs .rail-btn');
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    list[(i + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
  });
  // The opaline hover on a clue follows the pointer across the phrase.
  $('#app').addEventListener('pointermove', ev => {
    const t = ev.target.closest && ev.target.closest('.hs.st-open');
    if (!t) return;
    const r = t.getBoundingClientRect();
    if (r.width) t.style.setProperty('--mx', ((ev.clientX - r.left) / r.width).toFixed(2));
  }, { passive: true });
  $('#stream').addEventListener('scroll', ev => followPop(ev.currentTarget), { passive: true });
  $('#panel-body').addEventListener('scroll', ev => followPop(ev.currentTarget), { passive: true });
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    const n = isNarrow();
    if (n === wasNarrow) return;
    wasNarrow = n;
    closePop(true);
    if (!n) { G.ui.view = 'story'; $('#app').dataset.view = 'story'; }
    renderPanel();
    updateBadges();
  });
  window.addEventListener('resize', () => { if (G.railInd) G.railInd.refresh(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    // A hidden window draws nothing; coming back picks the decorative loop up again.
    if (!document.hidden && !$('#title').hidden && !traceRaf) startTrace();
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
  toast: (m, i) => toast(m, i),
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
  refresh() {
    renderPanel();
    updateBadges();
    // Back from the bench: the reading position is where the player left it.
    if (G.ui.streamScroll !== undefined) { $('#stream').scrollTop = G.ui.streamScroll; G.ui.streamScroll = undefined; }
  },
  /** The story column's scroll position, kept while the bench covers it. */
  keepScroll() { if (G.ui.streamScroll === undefined) G.ui.streamScroll = $('#stream').scrollTop; },
  modalOpen: () => !!(SNX() && SNX().modalOpen()),
  isNarrow: () => isNarrow(),
};

boot();
