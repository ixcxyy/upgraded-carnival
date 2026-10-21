/* ───────── ui-panel: the clipboard — work order, case board, codex ───────── */

function currentTab() {
  if (isNarrow()) return G.ui.view === 'story' ? G.ui.tab : G.ui.view;
  return G.ui.tab;
}
function showTab(tab) {
  G.ui.tab = tab;
  if (isNarrow()) setView(tab);
  else { setPanelOpen(true); renderPanel(); updateBadges(); }
}
/* The rail: picking a destination opens the panel on it; picking the open one again folds it away. */
function railClick(tab) {
  if (!isNarrow() && G.ui.tab === tab && G.settings.panel !== 'closed') { setPanelOpen(false); return; }
  G.ui.tab = tab;
  setPanelOpen(true);
  renderPanel();
  updateBadges();
}
function setPanelOpen(open) {
  const want = open ? 'open' : 'closed';
  const changed = G.settings.panel !== want;
  G.settings.panel = want;
  $('#app').classList.toggle('panel-closed', !open);
  if (changed) { persist(); setTimeout(() => G.railInd && G.railInd.refresh(), 340); }
  const pc = $('#panel-close');
  if (pc) pc.setAttribute('aria-expanded', String(open));
}
function setView(v) {
  G.ui.view = v;
  $('#app').dataset.view = v;
  if (v !== 'story') G.ui.tab = v;
  renderPanel();
  updateBadges();
  if (v === 'story') scrollStream(false);
}
function openTicket(id) { G.ui.ticket = id; showTab('work'); }
function openDoc(id) {
  G.ui.doc = id;
  G.ui.codex = 'docs';
  G.engine.readDoc(id);
  showTab('codex');
  refreshHotspots();
  persist();
}

function renderPanel() {
  const body = $('#panel-body');
  const tab = currentTab();
  $$('#panel-tabs .rail-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('#mtabs .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === G.ui.view)));
  const titles = { work: ['work', 'Work order'], board: ['case', 'Case board'], codex: ['codex', 'Codex'] };
  const t = titles[tab] || titles.work;
  put($('#panel-title'), ic(t[0]), t[1]);
  if (window.SN) {
    if (!G.railInd) G.railInd = window.SN.indicator($('#panel-tabs'));
    if (!G.mInd) G.mInd = window.SN.indicator($('#mtabs'));
    G.railInd.move($('#panel-tabs .rail-btn[aria-selected="true"]'));
    G.mInd.move($('#mtabs .tab[aria-selected="true"]'));
  }
  const key = tab + ':' + (tab === 'work' ? G.ui.ticket : tab === 'codex' ? G.ui.codex + ':' + G.ui.doc : '');
  const keep = G.ui.keep === key ? body.scrollTop : 0;
  body.replaceChildren(tab === 'work' ? workView() : tab === 'board' ? boardView() : codexView());
  body.scrollTop = keep;
  G.ui.keep = key;
}

function counts() {
  const st = G.engine.state;
  let hints = 0;
  for (const k in st.tasks) hints += st.tasks[k].hints;
  const demoted = Object.keys(st.hyps).filter(k => st.hyps[k] === 'demoted').length;
  return {
    work: st.taskOrder.length + hints,
    board: st.hypOrder.length + st.followOrder.length + demoted,
    codex: st.docOrder.length + st.devices.length + Object.keys(st.notes).length + Object.keys(st.met).length + st.placeOrder.length,
  };
}
function updateBadges() {
  const c = counts();
  const vis = isNarrow() ? (G.ui.view === 'story' ? null : G.ui.view) : G.ui.tab;
  for (const k of ['work', 'board', 'codex']) {
    if (G.ui.seen[k] === undefined) G.ui.seen[k] = c[k];
    if (k === vis) G.ui.seen[k] = c[k];
    const dot = c[k] > G.ui.seen[k];
    $$('[data-tab="' + k + '"] .dot, [data-view="' + k + '"] .dot').forEach(d => { d.hidden = !dot; });
  }
}

function renderTopbar() {
  const st = G.engine.state;
  const C = st.chapter && G.S.chapterMap[st.chapter];
  const w = $('#where');
  w.replaceChildren();
  if (st.ended) w.append(h('span', { class: 'lbl' }, 'Epilogue'), h('span', { class: 'ttl' }, 'End of the first cut'));
  else if (C) w.append(h('span', { class: 'lbl' }, C.label), h('span', { class: 'ttl' }, fill(C.title)));
}

/* ── work order ── */
function workView() {
  const st = G.engine.state, S = G.S;
  const wrap = h('div');
  if (!st.taskOrder.length) {
    wrap.append(h('div', { class: 'empty' }, ic('work'), 'Nothing in hand yet. Lab sheets, the exam and work orders land here when someone hands them over.'));
    return wrap;
  }
  const active = st.wait && st.wait.type === 'task' ? st.wait.id : null;
  const cur = G.ui.ticket && st.tasks[G.ui.ticket] ? G.ui.ticket : (active || st.taskOrder[st.taskOrder.length - 1]);
  wrap.append(h('h3', { class: 'ph' }, 'Issued so far'),
    h('div', { class: 'tix', role: 'group', 'aria-label': 'Issued so far' }, st.taskOrder.map(id => {
      const T = S.tasks[id];
      const n = String(T.code).match(/\d+/);
      const label = T.form === 'workorder' ? T.title : T.form === 'exam' ? 'Exam' : 'Lab ' + (n ? n[0] : id);
      return h('button', { type: 'button', 'aria-pressed': String(id === cur), class: st.tasks[id].status === 'active' ? 'live' : st.tasks[id].status === 'passed' ? 'passed' : '', onclick: () => { G.ui.ticket = id; renderPanel(); } }, fill(label));
    })));
  wrap.append(ticketEl(cur));
  return wrap;
}
function field(k, v, cls) { return h('div', { class: 'field ' + (cls || '') }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
function sec(title, ...kids) { return h('section', { class: 'sec' }, h('h4', null, title), ...kids); }
/* Secondary sections fold away; what the checker requires never does. */
function fold(title, open, ...kids) {
  return h('details', { class: 'sec', open: open || null }, h('summary', null, ic('chev-right', { size: 13 }), title), ...kids);
}
function levelOf(id) {
  const i = G.init && G.init.levels;
  return i ? i.find(l => l.id === id) || null : null;
}
/* The pins as the level defines them (pin, label, direction, note): drawn from data, nothing invented. */
function pinMap(id) {
  const L = levelOf(id);
  if (!L || !L.pins || !L.pins.length) return null;
  const rows = [];
  for (const p of L.pins) {
    rows.push(h('span', { class: 'chip-side' }, p.name),
      h('span', { class: 'wire ' + (p.dir === 'in' ? 'in' : 'out'), 'aria-hidden': 'true' }),
      h('span', { class: 'dest' }, h('b', null, p.label), h('span', { class: 'dir' }, p.dir === 'in' ? 'in, driven by the board' : 'out, driven by the chip'), p.note ? h('span', { class: 'note' }, p.note) : null));
  }
  return h('div', null, h('div', { class: 'pinmap', role: 'table', 'aria-label': 'Pin map' }, rows),
    h('p', { class: 'pinmap-cap' }, fill(G.S.meta.mcu || 'K28') + ' pins on the left; arrows show which side drives the line.'));
}

function ticketEl(id, inBench) {
  const e = G.engine, S = G.S, T = S.tasks[id], ts = e.state.tasks[id] || { status: 'active', fails: 0, hints: 0, extra: false };
  e.seeTask(id);
  const head = T.form === 'workorder' ? fill(S.meta.firm || '') + ' · Work order' : T.form === 'exam' ? 'Examination' : 'Lab sheet';
  const el = h('article', { class: 'ticket form-' + T.form, 'aria-label': fill(T.title) });
  const passed = ts.status === 'passed';
  el.append(h('div', { class: 'ticket-head' }, h('span', { class: 'firm' }, ic(T.form === 'exam' ? 'flag' : 'work'), head),
    h('span', { class: 'code' }, fill(T.code))));
  el.append(h('div', { class: 'ticket-title' }, h('span', { class: 'name', 'data-task-title': inBench ? null : id }, fill(T.title)),
    passed ? h('span', { class: 'chip stamp' }, ic('check'), T.form === 'exam' ? 'Handed in' : T.form === 'lab' ? 'Passed' : 'Closed')
      : ts.fails ? h('span', { class: 'chip warn' }, plural(ts.fails, 'failed submission')) : h('span', { class: 'chip live' }, 'Open'),
    T.rev ? h('span', { class: 'rev' }, 'rev ' + T.rev) : null));
  if (T.brief) el.append(h('p', { class: 'summary' }, rich(T.brief)));
  const fields = [field('Board', fill(T.board), 'wide')];
  if (T.form === 'workorder') {
    fields.push(field('Issued by', fill(S.meta.handler || '')), field('Status', passed ? 'Closed' : 'Open'), field('Purpose', '', 'wide purpose'));
  }
  el.append(h('div', { class: 'fields' }, fields));
  if (T.behavior.length) el.append(h('section', { class: 'sec req' }, h('h4', null, ic('flag', { size: 13 }), 'Required behaviour'), h('ul', null, T.behavior.map(l => h('li', null, rich(l))))));
  if (T.rules.length) el.append(h('section', { class: 'sec req' }, h('h4', null, ic('results', { size: 13 }), 'Acceptance'), h('ul', null, T.rules.map(l => h('li', null, rich(l))))));
  const pm = pinMap(id);
  if (T.schematic.length || pm) {
    el.append(sec(T.form === 'workorder' ? 'Interfaces' : 'Board', pm, T.schematic.length ? h('pre', { class: 'schem' }, T.schematic.map(fill).join('\n')) : null));
  }
  if (T.capture) el.append(sec('Capture', captureEl(T)));
  if (T.provided) el.append(sec('Provided', h('p', null, fill(T.provided))));
  if (T.driver) el.append(sec(T.form === 'workorder' ? 'Driver contract' : 'Goes into your library', h('p', null, h('code', { class: 'mono' }, fill(driverName(T.driver))), driverWhat(T.driver) ? ' — ' + fill(driverWhat(T.driver)) : '')));
  const extras = e.extraFor(id);
  if (extras.length) el.append(h('section', { class: 'sec' }, h('h4', null, 'Your own check', h('span', { class: 'optional' }, 'optional')), extras.map(x => h('p', { class: 'own' }, fill(x.text)))));
  const said = T.hints.slice(0, ts.hints);
  if (said.length) {
    el.append(sec('Around the bench', said.map((x, i) => {
      const { aside, rest } = splitAside(x.text);
      if (i === 2 && T.form === 'workorder') return h('div', { class: 'amend' }, h('div', { class: 'who' }, 'Amendment · ' + (x.who || '')), h('p', null, fill(rest)));
      return h('p', { class: 'said' }, h('span', { class: 'who' }, x.who || ''), aside ? h('span', { class: 'aside' }, '(' + aside + ') ') : null, fill(rest));
    })));
  }
  if (T.datasheet.length) el.append(fold('Datasheet excerpt', false, T.datasheet.map(l => h('p', { class: 'mono', style: 'font-size:0.8rem' }, fill(l)))));
  if (T.parts) el.append(fold('Parts list', false, h('p', null, rich(T.parts))));
  if (T.remark) el.append(fold('Remark', true, h('p', { class: 'remark' }, fill(T.remark))));
  if (!inBench) el.append(passed ? passedRow(T, ts) : heldBox(T, ts, extras));
  return el;
}

function benchLast(id) {
  const b = G.bench && G.bench.tasks && G.bench.tasks[id];
  return b && b.last ? b.last : null;
}
function heldBox(T, ts, extras) {
  const id = T.id;
  const next = E.HINT_AT[Math.min(ts.hints, E.HINT_AT.length - 1)];
  const last = benchLast(id);
  const box = h('div', { class: 'held' },
    h('div', { class: 'held-h' }, ic('board'), T.form === 'exam' ? 'Exam bench' : 'On the bench'),
    h('p', null, T.form === 'exam'
      ? 'Write it from scratch: your library stays in your bag. Run it on the exam board as often as you like, then hand it in.'
      : 'Write the C, run it on the emulated ' + fill(G.S.meta.mcu || 'chip') + ' and watch the pins, debug it line by line, and submit it when it behaves. Submitting runs hidden seeds as well.'),
    last ? h('p', { class: 'runs' }, last) : null,
    h('div', { class: 'runs' },
      ts.fails ? plural(ts.fails, 'failed submission') + '.' : 'Nothing submitted yet.',
      ts.hints < T.hints.length ? ' Someone steps in once ' + next + ' submissions have failed.' : ' Every hint for this one is out.'),
    extras.length ? h('p', { class: 'runs' }, 'Your own check runs too when you submit. It only adds: the task passes without it.') : null);
  box.append(h('div', { class: 'row' }, btn(T.form === 'exam' ? 'Open the exam bench' : 'Open the workbench', 'primary', ev => openBench(id, ev.currentTarget), null, 'board')));
  return box;
}
function passedRow(T, ts) {
  return h('div', { class: 'passed-row' },
    h('span', { class: 'chip stamp' }, ic('check'), T.form === 'exam' ? 'Handed in' : T.form === 'lab' ? 'Passed' : 'Satisfactory'),
    h('span', null, ts.fails ? 'after ' + plural(ts.fails, 'failed submission') : 'first submission'),
    ts.extra ? h('span', null, '· with your own check') : null,
    btn('Open the workbench', 'link', ev => openBench(T.id, ev.currentTarget)));
}

/* ── case board: Elias's notebook ── */
function pinList(items, key, neutral) {
  if (!items.length) return null;
  const st = G.engine.state;
  G.ui.open = G.ui.open || {};
  const folded = key && items.length > 4 && !G.ui.open[key];
  const shown = folded ? items.slice(0, 3) : items;
  const ul = h('ul', { class: 'pins' + (neutral ? ' neutral' : '') }, shown.map(({ id, con }) => {
    const cs = st.clues[id] || {};
    return h('li', { class: con ? 'con' : '' }, fill(cs.obs || G.engine.observation(id)), h('span', { class: 'how' }, cs.followed || ''));
  }));
  if (!folded) return ul;
  return [ul, btn('Show ' + (items.length - 3) + ' more', 'link more', () => { G.ui.open[key] = true; renderPanel(); })];
}
function dots(n, cls) {
  const out = [];
  for (let i = 0; i < Math.min(n, 8); i++) out.push(h('i', { class: cls }));
  if (n > 8) out.push(h('b', null, '+' + (n - 8)));
  return out;
}
function boardView() {
  const e = G.engine;
  const B = e.board();
  const pad = h('div', { class: 'pad board' }, h('div', { class: 'pad-head' }, h('span', { class: 'hand' }, 'Case board'), h('span', { class: 'pad-sub' }, 'The notebook')));
  if (!B.questions.length && !B.loose.length && !B.noise.length) {
    pad.append(h('p', { class: 'hand' }, 'Nothing here yet. When something doesn’t add up, the question goes here.'),
      h('p', { class: 'board-leg' }, 'Details you note in the story get pinned to the answers they support or weaken.'));
    return pad;
  }
  for (const q of B.questions) {
    pad.append(h('section', { class: 'q' }, h('h3', null, ic('case'), fill(q.question)), q.hyps.map(x =>
      h('div', { class: 'hyp ' + x.status + (x.leading ? ' leading' : '') },
        h('div', { class: 'line1' },
          h('span', { class: 't' }, h('span', { class: 'tx' }, fill(x.text)),
            x.leading ? h('span', { class: 'state' }, 'ahead on evidence') : x.status === 'demoted' ? h('span', { class: 'state' }, 'ruled out') : null),
          h('span', { class: 'ev', role: 'img', 'aria-label': x.pro.length + ' for, ' + x.con.length + ' against' }, dots(x.pro.length, 'pro'), dots(x.con.length, ''))),
        pinList(x.pro.map(id => ({ id, con: false })).concat(x.con.map(id => ({ id, con: true }))), x.id)))));
  }
  if (B.loose.length) pad.append(h('section', { class: 'q' }, h('h3', null, 'Loose ends'), pinList(B.loose.map(id => ({ id, con: false })), 'loose', true)));
  if (B.noise.length) pad.append(h('section', { class: 'q' }, h('h3', null, 'Noise'), pinList(B.noise.map(id => ({ id, con: false })), 'noise', true)));
  pad.append(h('p', { class: 'board-leg' }, 'Filled dot, +: supports. Hollow dot, −: weakens. Counts are the details you followed up, nothing more. Struck through: ruled out, still readable.'));
  return pad;
}

/* ── codex ── */
function codexView() {
  const e = G.engine, st = e.state, S = G.S;
  const met = S.order.people.filter(id => st.met[id]);
  const seenClues = st.seenOrder.filter(id => S.clues[id] && (st.clues[id].noticed || st.chapters[S.clues[id].chapter] === 'done'));
  const tabs = [
    ['people', 'People', met.length, 'people'], ['docs', 'Documents', st.docOrder.length, 'doc'], ['clues', 'Clues', seenClues.length, 'clue'],
    ['places', 'Places', st.placeOrder.length, 'place'], ['devices', 'Devices', st.devices.length, 'chip'], ['library', 'Library', st.library.length, 'library'],
  ];
  if (G.ui.doc && G.ui.codex === 'docs') return readerView(G.ui.doc);
  const wrap = h('div');
  const strip = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Codex' }, tabs.map(([k, label, n, icn]) =>
    h('button', { class: 'subtab', role: 'tab', type: 'button', 'aria-selected': String(G.ui.codex === k), onclick: () => { G.ui.codex = k; G.ui.doc = null; renderPanel(); } }, ic(icn), label, h('span', { class: 'n' }, String(n)))));
  wrap.append(strip);
  if (window.SN) requestAnimationFrame(() => { if (strip.isConnected) window.SN.indicator(strip).move($('[aria-selected="true"]', strip), true); });
  const k = G.ui.codex;
  if (k === 'people') {
    for (const id of met) {
      const P = S.people[id];
      const notes = e.activeNotes(id);
      wrap.append(h('div', { class: 'entry' }, h('h3', null, fill(P.name)), h('div', { class: 'role' }, fill(P.role)), h('p', null, fill(P.desc)),
        notes.length ? h('ul', { class: 'notes' }, notes.map(n => h('li', null, fill(n.text)))) : null));
    }
  } else if (k === 'docs') {
    if (!st.docOrder.length) wrap.append(h('div', { class: 'empty' }, ic('doc'), 'No documents yet. Chapters unlock them when they end.'));
    wrap.append(h('div', { class: 'doclist' }, st.docOrder.map(id => {
      const D = S.docs[id];
      return h('button', { type: 'button', class: st.docs[id].read ? '' : 'unread', onclick: () => openDoc(id) },
        h('span', { class: 'di' }, ic('doc')), h('span', { class: 't' }, fill(D.title)), h('span', { class: 'k' }, fill(D.kind)), D.from ? h('span', { class: 'f' }, fill(D.from)) : null);
    })));
  } else if (k === 'clues') {
    wrap.append(clueListView(seenClues));
  } else if (k === 'places') {
    for (const id of st.placeOrder) {
      const P = S.places[id];
      const notes = e.activeNotes(id);
      wrap.append(h('div', { class: 'entry' }, h('h3', null, fill(P.name)), h('div', { class: 'role' }, fill(P.type) + (st.places[id] === 'seen' ? ' · seen, not entered' : '')), h('p', null, fill(P.desc)),
        notes.length ? h('ul', { class: 'notes' }, notes.map(n => h('li', null, fill(n.text)))) : null));
    }
  } else if (k === 'devices') {
    if (!st.devices.length) wrap.append(h('div', { class: 'empty' }, ic('chip'), 'Every board you touch ends up here.'));
    else {
      wrap.append(h('div', { class: 'tablewrap' }, h('table', { class: 'devtable' },
        h('thead', null, h('tr', null, h('th', null, 'Board'), h('th', null, 'From'), h('th', null, 'Notes'))),
        h('tbody', null, st.devices.map(id => {
          const D = S.devices[id];
          return h('tr', null, h('td', { class: 'nm' }, fill(D.name)), h('td', { class: 'ref' }, fill(D.ref)), h('td', null, fill(D.desc)));
        })))));
    }
  } else if (k === 'library') {
    if (!st.library.length) wrap.append(h('div', { class: 'empty' }, ic('library'), 'Drivers you pass are committed here, and later work links against them.'));
    wrap.append(h('ul', { class: 'lib' }, st.library.map(x => {
      const T = S.tasks[x.task];
      return h('li', null, h('code', null, fill(driverName(x.driver))), h('span', { class: 'd' }, fill(driverWhat(x.driver))), h('span', { class: 'from' }, fill(T ? T.code + ' · ' + T.title : x.task)));
    })));
  }
  return wrap;
}

function clueListView(ids) {
  const e = G.engine, st = e.state, S = G.S;
  const wrap = h('div', { class: 'cluelist' });
  if (!ids.length) {
    wrap.append(h('div', { class: 'empty' }, ic('clue'), 'Details you stop on are listed here. When a chapter ends, so is everything you walked past.'));
    return wrap;
  }
  for (const ch of S.chapters) {
    const mine = ids.filter(id => S.clues[id].chapter === ch.id);
    if (!mine.length) continue;
    wrap.append(h('h4', null, ch.label + ' · ' + fill(ch.title) + (st.chapters[ch.id] === 'done' ? ' · closed' : '')));
    for (const id of mine) {
      const cs = st.clues[id];
      const label = cs.followed === 'asked' ? 'Asked' : cs.followed === 'noted' ? 'Noted' : cs.letgo ? 'Let go' : cs.noticed ? 'Noticed' : 'Walked past';
      const icn = cs.followed === 'asked' ? 'message' : cs.followed === 'noted' ? 'note' : cs.letgo ? 'letgo' : cs.noticed ? 'clue' : 'dot';
      wrap.append(h('div', { class: 'cl' + (cs.followed ? ' f' : '') },
        h('span', { class: 's' }, ic(icn), label),
        h('span', { class: 'o' }, cs.noticed ? fill(cs.obs || e.observation(id)) : '', cs.text ? h('span', { class: 'src' }, '“' + fill(cs.text) + '”') : null)));
    }
  }
  return wrap;
}

function readerView(id) {
  const D = G.S.docs[id];
  const wrap = h('div', { class: 'reader' });
  wrap.append(btn('All documents', 'ghost small back', () => { G.ui.doc = null; renderPanel(); }, null, 'back'));
  const paper = h('article', { class: 'docpaper kind-' + slug(D.kind || 'doc') },
    h('div', { class: 'k' }, fill(D.kind)),
    h('h3', null, fill(D.title)),
    D.from ? h('div', { class: 'from' }, 'From ' + fill(D.from)) : null,
    D.paras.map(p => h('p', null, rich(p))));
  wrap.append(paper);
  return wrap;
}
