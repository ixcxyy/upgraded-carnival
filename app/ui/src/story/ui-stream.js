/* ───────── ui-stream: the story as a play script, and the dock under it ───────── */

function line(cls, who, ...content) {
  return h('div', { class: 'line ' + cls }, h('div', { class: 'who' }, who || ''), h('div', { class: 'txt' }, ...content));
}
function sysLine(who, content, iconName) { return line('sys', who, h('span', { class: 'sysrow' }, ic(iconName || 'dot'), content)); }

function renderEntry(en, live) {
  const S = G.S;
  const f = live ? ' fresh' : '';
  switch (en.k) {
    case 'chapter': {
      const C = S.chapterMap[en.id] || {};
      return h('section', { class: 'chapter-card' },
        h('div', { class: 'eyebrow' }, [C.label, C.phase].filter(Boolean).join(' · ')),
        h('h2', null, fill(C.title || en.id)));
    }
    case 'loc': {
      const P = en.place && S.places[en.place];
      return h('div', { class: 'loc' + (en.again ? ' again' : '') + (en.cut ? ' cut' : '') },
        h('div', { class: 'rule' }),
        h('div', { class: 'txt' },
          h('span', { class: 'place' }, en.again ? null : ic('place'), (en.again ? 'Back · ' : '') + fill(en.text)),
          P && !en.again && !en.cut ? h('span', { class: 'kind' }, fill(P.type)) : null));
    }
    case 'narr': return line('narr' + f, '', rich(en.text, live));
    case 'say': return sayLine(en, live);
    case 'choice':
      if (/^["“']/.test(en.label)) return null;
      return line('choice', '', fill(en.label));
    case 'task': return stubLine(en.id, live);
    case 'passed': return passedLine(en);
    case 'hint': return hintLine(en, live);
    case 'board': return boardLines(en);
    case 'doc': {
      const D = S.docs[en.id];
      return sysLine('Documents', [fill(D.title) + ' ', linkBtn('Read it', () => openDoc(en.id))], 'doc');
    }
    case 'device': return sysLine('Devices', fill(S.devices[en.id].name), 'chip');
    case 'place': {
      const P = S.places[en.id];
      return sysLine('Places', fill(P.name) + (P.type ? ' · ' + fill(P.type) : ''), 'place');
    }
    case 'note': {
      const who = en.who ? (S.people[en.who] ? S.people[en.who].short : en.who) : (S.places[en.place] ? S.places[en.place].name : '');
      return line('margin' + f, 'Notebook', h('span', { class: 'strip' }, h('span', { class: 'of' }, fill(who)), fill(en.text)));
    }
    case 'endchapter': return endCard(en);
    case 'recall': return recallCard(en);
    case 'believe': return believeCard(en);
    case 'devices': return devicesCard(en);
    case 'ending': return endingCard();
    case 'codastart': {
      const K = S.codas[en.id];
      return h('div', { class: 'coda-mark' }, h('span', { class: 't' }, fill(K.title)), h('span', { class: 'k' }, 'Epilogue fragment · ' + fill(K.kind)));
    }
    case 'codaend': return h('div', { class: 'coda-mark end' }, 'End of fragment');
    case 'error': return errorCard(en);
  }
  return null;
}

function sayLine(en, live) {
  const me = isPlayer(en.who);
  const f = live ? ' fresh' : '';
  const { aside, rest } = splitAside(en.text);
  if (aside && /notebook/i.test(aside)) return line('notebook' + f, 'Notebook', h('span', { class: 'strip' }, rich(rest, live)));
  if (en.mode === 'text') return line('sms' + (me ? ' me' : '') + f, en.who, h('span', { class: 'bubble' }, rich(en.text, live)));
  if (en.mode === 'letter') return line('letter' + f, en.who, h('div', { class: 'paper' }, rich(en.text, live)));
  if (en.mode === 'message') return line('message' + f, en.who, h('span', { class: 'msg' }, h('span', { class: 'msg-k' }, ic('message'), 'Message'), rich(en.text, live)));
  return line('say' + (me ? ' me' : '') + f, en.who, aside ? h('span', { class: 'aside' }, aside) : null, rich(rest, live));
}

function stubState(id) {
  const T = G.S.tasks[id], ts = G.engine.state.tasks[id];
  if (!ts || ts.status !== 'passed') return h('span', { class: 'chip live' }, 'In hand');
  return h('span', { class: 'chip stamp' }, ic('check'), T.form === 'exam' ? 'Handed in' : T.form === 'lab' ? 'Passed' : 'Closed');
}
function stubLine(id, live) {
  const T = G.S.tasks[id];
  const code = T.form === 'workorder' ? fill(T.code) + (T.rev ? ' · rev ' + T.rev : '') : fill(T.code);
  const brief = T.brief || T.behavior[0] || '';
  const card = h('button', { class: 'stub-card', type: 'button', 'data-task': id, onclick: () => openTicket(id), 'aria-label': formLabel(T) + ' ' + fill(T.code) + ': ' + fill(T.title) + '. Read it.' },
    h('span', { class: 'code' }, ic('work'), code),
    h('span', { class: 'name', 'data-task-title': id }, fill(T.title)),
    h('span', { class: 'state' }, stubState(id)),
    brief ? h('span', { class: 'brief' }, E.plain(fill(brief))) : null);
  return line('stub' + (live ? ' fresh' : ''), formLabel(T), card);
}
function refreshStubs() {
  $$('.stub-card').forEach(card => {
    const slot = card.querySelector('.state');
    if (slot) slot.replaceChildren(stubState(card.dataset.task));
  });
}

function passedLine(en) {
  const T = G.S.tasks[en.id];
  const verb = T.form === 'exam' ? 'Handed in.' : T.form === 'lab' ? fill(T.code) + ' passed.' : fill(T.code) + ' closed. Satisfactory.';
  const lib = T.driver ? ' Committed to your library: ' + fill(driverName(T.driver)) + '.' : '';
  return sysLine('Checker', verb + lib + (en.extra ? ' Your own check went in with it.' : ''), 'ok');
}

function hintLine(en, live) {
  const T = G.S.tasks[en.task];
  const amend = en.tier >= 3 && T && T.form === 'workorder';
  const { aside, rest } = splitAside(en.text);
  return h('div', { class: 'line say hint' + (amend ? ' amend' : '') + (live ? ' fresh' : '') },
    h('div', { class: 'who' }, en.who || '', h('span', { class: 'tag' }, ic(amend ? 'flag' : 'hint', { size: 11 }), amend ? 'amendment' : 'hint')),
    h('div', { class: 'txt' }, aside ? h('span', { class: 'aside' }, aside) : null, fill(rest)));
}

function boardLines(en) {
  const H = G.S.hyps[en.id];
  if (!H) return null;
  if (en.what === 'demote') return sysLine('Case board', ['Crossed out: ', h('span', { class: 'struck' }, '“' + fill(H.text) + '”')], 'case');
  const out = [];
  if (en.first) out.push(sysLine('Case board', ["Your notebook has a case board now. Questions and answers go there; anything you note is pinned to what it bears on. ", linkBtn('Open it', () => showTab('board'))], 'case'));
  out.push(sysLine('Case board', fill(H.question) + ' · “' + fill(H.text) + '”', 'case'));
  return out;
}

function tallySentence(t) {
  const bits = [];
  if (t.followed) bits.push('followed up ' + t.followed);
  if (t.noticed) bits.push('stopped on ' + t.noticed + ' and let ' + (t.noticed === 1 ? 'it' : 'them') + ' go');
  if (t.missed) bits.push('walked past ' + t.missed);
  if (!bits.length) return "Nothing from this chapter made it into the notebook. Its details are closed now; the text stays in the log.";
  return 'Of the details you saw here, you ' + joinAnd(bits) + '. They are closed now; the text stays in the log.';
}
function endCard(en) {
  const C = G.S.chapterMap[en.id] || {};
  const lore = en.docs.length
    ? h('div', { class: 'lore' }, h('div', { class: 'lore-h' }, 'Unlocked in the codex'),
      en.docs.map(d => {
        const D = G.S.docs[d];
        return h('button', { class: 'lore-item', type: 'button', onclick: () => openDoc(d) }, h('span', { class: 't' }, ic('doc'), fill(D.title)), h('span', { class: 'k' }, fill(D.kind)));
      }))
    : null;
  return h('section', { class: 'card' }, h('div', { class: 'eyebrow' }, 'End of ' + (C.label || en.id)), h('h3', null, fill(C.title || '')), h('p', null, tallySentence(en.tally)), lore);
}

function recallList(items) {
  return h('ul', { class: 'recall-list' }, items.map(it => h('li', { class: it.followed ? 'f' : 'seen' }, fill(it.obs))));
}
function recallCard(en) {
  const d = en.data || { qs: [], loose: [], noise: [] };
  const el = h('section', { class: 'pad recall' }, h('div', { class: 'pad-head' }, h('span', { class: 'hand' }, 'Notebook'), h('span', { class: 'pad-sub' }, 'Everything you saw · ticked: followed up')));
  for (const q of d.qs) {
    el.append(h('div', { class: 'q' },
      h('h3', null, fill(q.q)),
      h('div', { class: 'hyps' }, q.hyps.map(x => h('div', { class: x.status }, fill(G.S.hyps[x.id] ? G.S.hyps[x.id].text : x.id)))),
      q.clues.length ? recallList(q.clues) : null));
  }
  if (d.loose.length) el.append(h('div', { class: 'q' }, h('h3', null, 'Loose ends'), recallList(d.loose)));
  if (d.noise.length) el.append(h('div', { class: 'q' }, h('h3', null, 'Noise'), recallList(d.noise)));
  if (!d.qs.length && !d.loose.length) el.append(h('p', { class: 'hand' }, 'Mostly blank. He wrote the date, and then he wrote nothing.'));
  return el;
}

function believeCard(en) {
  const st = G.engine.state;
  const answered = !(st.wait && st.wait.type === 'believe');
  const qs = en.data || [];
  const el = h('section', { class: 'pad believe' }, h('div', { class: 'pad-head' }, h('span', { class: 'hand' }, 'What do you actually believe right now?')));
  if (!qs.length) el.append(h('p', { class: 'hand' }, 'Nothing on the board to believe yet.'));
  for (const q of qs) {
    const name = 'believe-' + slug(q.q);
    const cur = answered ? (st.beliefs || {})[q.q] : G.ui.draft[q.q];
    const fs = h('fieldset', null, h('legend', null, fill(q.q)));
    for (const id of q.live) {
      fs.append(h('label', null,
        h('input', { type: 'radio', name, id: name + '-' + id, value: id, checked: cur === id, disabled: answered, onchange: () => { G.ui.draft[q.q] = id; } }),
        h('span', null, fill(G.S.hyps[id].text))));
    }
    fs.append(h('label', { class: 'no' },
      h('input', { type: 'radio', name, id: name + '-none', value: '', checked: !cur, disabled: answered, onchange: () => { delete G.ui.draft[q.q]; } }),
      h('span', null, 'Not sure yet')));
    el.append(fs);
  }
  G.live.believe = { el, en };
  return el;
}

function devicesCard(en) {
  const rows = (en.list || []).map(id => {
    const D = G.S.devices[id];
    return h('tr', null, h('td', { class: 'nm' }, fill(D.name)), h('td', { class: 'ref' }, fill(D.ref)), h('td', null, fill(D.desc)));
  });
  return h('section', { class: 'card devices-card' },
    h('div', { class: 'eyebrow' }, 'Every board, in order'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'devtable' },
      h('thead', null, h('tr', null, h('th', null, 'Board'), h('th', null, 'From'), h('th', null, 'Notes'))),
      h('tbody', null, rows))));
}

/* "Chapters 1–4" when the labels follow "Chapter N"; otherwise the story's own title. */
function chaptersRange() {
  const cs = G.S.chapters;
  if (!cs.length) return fill(G.S.meta.title || '');
  const a = String(cs[0].label).match(/^(\D+?)\s*(\d+)$/), b = String(cs[cs.length - 1].label).match(/^(\D+?)\s*(\d+)$/);
  if (a && b && a[1] === b[1]) return a[1] + (cs.length > 1 ? 's ' + a[2] + '–' + b[2] : ' ' + a[2]);
  return fill(G.S.meta.title || '');
}
function stat(v, k) { return h('div', { class: 'stat' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, k)); }
function endingCard() {
  const el = h('section', { class: 'card ending' });
  G.live.ending = el;
  fillEnding(el);
  return el;
}
function fillEnding(el) {
  const e = G.engine, st = e.state, S = G.S;
  const sm = e.summary();
  const believed = st.beliefs ? Object.keys(st.beliefs) : [];
  const beliefRows = [];
  const B = e.board();
  for (const q of B.questions) {
    const said = st.beliefs && st.beliefs[q.question];
    const lead = q.hyps.find(x => x.leading) || null;
    if (!said && !lead) continue;
    beliefRows.push(h('p', { class: 'believed' }, h('span', { class: 'q' }, fill(q.question)),
      said ? 'You said: “' + fill(S.hyps[said].text) + '”' : 'You didn’t commit.',
      lead && lead.id !== said ? ' The board now leans: “' + fill(lead.text) + '”' : ''));
  }
  put(el,
    h('div', { class: 'eyebrow' }, 'End of the first cut'),
    h('h2', null, chaptersRange()),
    h('p', null, 'The main ending asks nothing of you but the work. The fragments below open for attention: for things you stopped on, people you answered, and sometimes something you wrote into the firmware.'),
    h('div', { class: 'stats' },
      stat(sm.passed + '/' + sm.tasks, 'tasks passed'),
      stat(sm.clues.followed, 'details followed up'),
      stat(sm.clues.missed, 'walked past'),
      stat(sm.hints, sm.hints === 1 ? 'hint taken' : 'hints taken')),
    beliefRows.length ? h('div', { class: 'lore' }, h('div', { class: 'lore-h' }, believed.length ? 'What you said you believed, and the board now' : 'The board now'), beliefRows) : null,
    h('div', { class: 'lore' }, h('div', { class: 'lore-h' }, 'Epilogue fragments'),
      e.codaList().map(k => h('div', { class: 'frag' + (k.open ? '' : ' locked') },
        h('div', null, h('span', { class: 't' }, fill(k.title)), h('span', { class: 'kk' }, fill(k.kind))),
        k.played ? h('span', { class: 'chip done' }, ic('check'), 'Read')
          : k.open ? btn('Read it', 'primary small', () => { e.playCoda(k.id); after(true); })
            : h('span', { class: 'chip' }, ic('lock'), 'Locked'),
        !k.open ? h('div', { class: 'h' }, fill(k.hint)) : null))),
    h('div', { class: 'row' }, btn('Replay a chapter', 'ghost small', () => openSheet('main'), null, 'undo'), btn('Title screen', 'ghost small', showTitle, null, 'back')));
}

function errorCard(en) {
  return h('section', { class: 'card error-card' },
    h('div', { class: 'eyebrow' }, 'The story data has a problem'),
    h('p', null, en.text),
    h('div', { class: 'row' }, btn('Restart this chapter', 'primary small', restartChapter), btn('Open the clue ledger', 'ghost small', () => openSheet('ledger'))));
}

/* ── syncing the log into the page ── */
function resetStream() {
  $('#stream-inner').replaceChildren();
  G.ui.rendered = 0;
  G.ui.lastN = 0;
  G.live = {};
}
function syncStream(live) {
  const log = G.engine.state.log;
  if (G.ui.rendered > log.length || (G.ui.rendered && log[G.ui.rendered - 1].n !== G.ui.lastN)) resetStream();
  const frag = document.createDocumentFragment();
  for (let i = G.ui.rendered; i < log.length; i++) {
    const en = log[i];
    const node = renderEntry(en, live);
    if (Array.isArray(node)) frag.append(...node.filter(Boolean));
    else if (node) frag.append(node);
    if (live && en.k === 'task') { G.ui.ticket = en.id; if (!isNarrow()) G.ui.tab = 'work'; }
  }
  G.ui.rendered = log.length;
  G.ui.lastN = log.length ? log[log.length - 1].n : 0;
  $('#stream-inner').append(frag);
}
function refreshLive() {
  if (G.live.ending && G.live.ending.isConnected) fillEnding(G.live.ending);
  const b = G.live.believe;
  if (b && b.el.isConnected) {
    const answered = !(G.engine.state.wait && G.engine.state.wait.type === 'believe');
    if (answered && !b.el.dataset.answered) {
      const fresh = believeCard(b.en);
      fresh.dataset.answered = '1';
      b.el.replaceWith(fresh);
    }
  }
}
function scrollStream(smooth) {
  const s = $('#stream');
  s.scrollTo({ top: s.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
}

/* ── the dock: continue, choices, and whatever the story is waiting on ── */
function renderDock() {
  const dock = $('#dock-inner');
  const e = G.engine, st = e.state;
  const before = dock.dataset.mode || '';
  dock.replaceChildren();
  const mode = st.error ? 'error' : !st.wait ? 'continue' : st.wait.type;
  dock.dataset.mode = mode;
  if (st.error) {
    dock.append(h('div', { class: 'dock-row' }, h('span', { class: 'dock-msg grow' }, 'The story stopped on a problem in its data.'), btn('Restart this chapter', 'primary', restartChapter, null, 'restart')));
  } else if (!st.wait) {
    dock.append(h('div', { class: 'dock-row' },
      btn(['Continue', h('span', { class: 'kbd', 'aria-hidden': 'true' }, 'Space')], 'primary', onContinue, { id: 'btn-continue', 'aria-keyshortcuts': 'Space Enter' }, 'run'),
      h('span', { class: 'grow' }),
      btn('Skip to next choice', 'quiet small', onSkip, { 'data-tip': 'Advance until the story asks you something. Nothing is skipped from the log.' }, 'skip')));
  } else if (st.wait.type === 'menu') {
    const opts = e.options();
    dock.append(h('div', { class: 'choices', role: 'group', 'aria-label': 'Choose' }, opts.map((o, k) =>
      h('button', { class: 'choice', type: 'button', onclick: () => onChoose(o.i), 'aria-keyshortcuts': String(k + 1) },
        h('span', { class: 'n', 'aria-hidden': 'true' }, String(k + 1)),
        h('span', null, fill(o.label)),
        o.kind === '+' ? h('span', { class: 'k' }, ic('message'), 'ask') : h('span')))));
  } else if (st.wait.type === 'task') {
    const T = G.S.tasks[st.wait.id];
    dock.append(h('div', { class: 'dock-task' },
      h('span', { class: 'who', 'aria-hidden': 'true' }, ic('work', { size: 20 })),
      h('span', { class: 'dock-msg grow' }, h('b', null, fill(T.title)), ' is in hand. Write it, run it on the ' + fill(G.S.meta.mcu || 'chip') + ', submit it when it behaves.'),
      btn('Read the ' + formLabel(T).toLowerCase(), 'ghost', () => openTicket(st.wait.id), null, 'doc'),
      btn('Open the workbench', 'primary', ev => openBench(st.wait.id, ev.currentTarget), null, 'board')));
  } else if (st.wait.type === 'recall') {
    dock.append(h('div', { class: 'dock-row' }, h('span', { class: 'dock-msg grow' }, 'The whole notebook, above. Take your time.'), btn('Close the notebook', 'primary', () => { e.finishRecall(); after(true); }, null, 'note')));
  } else if (st.wait.type === 'believe') {
    dock.append(h('div', { class: 'dock-row' }, h('span', { class: 'dock-msg grow' }, 'One per question, or leave it open.'), btn('That’s my answer', 'primary', onBelieve, null, 'check')));
  } else if (st.wait.type === 'ending') {
    dock.append(h('div', { class: 'dock-row' }, h('span', { class: 'dock-msg grow' }, 'End of the first cut. Epilogue fragments are in the card above.'), btn('Title screen', 'ghost', showTitle, null, 'back')));
  }
  // The dock changes shape with what the story waits for: a short, soft settle, never a block.
  if (before && before !== mode && dock.firstChild && SNX()) {
    SNX().motion.animate(dock, [{ opacity: 0.6, transform: 'translateY(6px) scale(0.99)' }, { opacity: 1, transform: 'none' }], { dur: 260, ease: SNX().motion.EASE.spring, key: 'dock' });
  }
}

/* Open the bench for a task; the task's title flies from where the player clicked into the bench header. */
function openBench(id, fromEl) {
  closePop();
  let src = null;
  const card = $('[data-task-title="' + id + '"]', $('#panel-body')) || $$('[data-task-title="' + id + '"]').pop();
  if (card && card.offsetParent !== null) src = card;
  else if (fromEl && fromEl.offsetParent !== null) src = fromEl;
  G.ui.streamScroll = $('#stream').scrollTop;
  return window.Bench.open(id, { from: src });
}

/* One refresh after every action: new lines, hotspot states, the dock, the side panel, the save. */
function after(live) {
  try {
    syncStream(live !== false);
    refreshHotspots();
    refreshStubs();
    refreshLive();
    renderDock();
    renderTopbar();
    renderPanel();
    updateBadges();
    scrollStream(live !== false);
    persist();
  } catch (err) {
    console.error(err);
    toast('Something went wrong on the page: ' + err.message);
  }
}

function onContinue() {
  closePop();
  G.engine.advance();
  after(true);
}
function onSkip() {
  closePop();
  const e = G.engine;
  for (let n = 0; n < 400 && !e.state.wait && !e.state.error; n++) {
    const before = e.state.log.length;
    e.advance();
    if (e.state.log.slice(before).some(x => x.k === 'endchapter' || x.k === 'devices' || x.k === 'hint')) break;
  }
  after(true);
}
function onChoose(i) {
  closePop();
  G.engine.choose(i);
  after(true);
}
function onBelieve() {
  G.engine.submitBeliefs(G.ui.draft);
  G.ui.draft = {};
  after(true);
}
function restartChapter() {
  const st = G.engine.state;
  const ch = st.chapter || (G.S.chapters[0] && G.S.chapters[0].id);
  closeSheet();
  if (ch && G.engine.snaps[ch]) {
    G.engine.restoreChapter(ch);
    resetStream();
    after(false);
    toast('Back to the start of ' + (G.S.chapterMap[ch] ? G.S.chapterMap[ch].label : ch) + '.');
  } else newGame();
}
