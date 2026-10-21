/* SIGNAL / NOISE — story engine.
 * Parses .story text into a model and runs it as a state machine.
 * There is no DOM in here: the page and the clue ledger drive this same code. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLOCK_KINDS = {
    person: 'people', place: 'places', hypothesis: 'hyps', doc: 'docs', device: 'devices',
    coda: 'codas', scene: 'scenes', clue: 'clues', task: 'tasks',
  };
  const MULTI_KEYS = new Set(['schematic', 'rules', 'behavior', 'datasheet', 'capture']);
  const LIST_KEYS = new Set(['note', 'observation_if', 'extra']);
  const KNOWN_KEYS = {
    person: 'name short role note',
    place: 'name type note',
    hypothesis: 'question text key trail',
    doc: 'title kind from',
    device: 'name ref',
    coda: 'title kind requires hint scene',
    scene: 'chapter place location kind',
    clue: 'chapter volume track tags supports weakens opens payoff decoy observation observation_if ask',
    task: 'chapter form title code rev board device brief behavior schematic rules datasheet capture ' +
      'remark provided driver hint1 hint2 hint3 after parts extra',
  };
  const COMMANDS = {
    next: 1, chapter: 1, endchapter: 1, task: 1, stat: 2, flag: 1, open: 1, demote: 1,
    doc: 1, device: 1, place: 1, recall: 0, believe: 0, codex: 1, ending: 0,
  };
  const COND_KINDS = new Set(['flag', 'stat', 'seen', 'noticed', 'followed', 'tag', 'tagphases', 'solved', 'taskextra']);
  const VOLUMES = new Set(['loud', 'murmur', 'whisper']);
  const TRACKS = new Set(['technical', 'situational']);
  /* Failed runs before each hint tier appears. */
  const HINT_AT = [3, 4, 5];
  const HS_SOURCE = '\\{([^{}|]+)\\|([\\w.]+)\\}';
  const SPEAKER_RE = /^([A-Z][A-Za-z.' -]{0,30}?)(?:\s*\[(\w+)\])?:\s+(.+)$/;

  /* ─────────────── text helpers ─────────────── */

  function segments(text) {
    const re = new RegExp(HS_SOURCE, 'g');
    const out = [];
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: m[1], clue: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  function cluesIn(text) {
    const re = new RegExp(HS_SOURCE, 'g');
    const ids = [];
    let m;
    while ((m = re.exec(text || ''))) ids.push(m[2]);
    return ids;
  }
  function plain(text) { return String(text || '').replace(new RegExp(HS_SOURCE, 'g'), '$1'); }

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function cmp(x, op, n) {
    switch (op) {
      case '>=': return x >= n;
      case '<=': return x <= n;
      case '>': return x > n;
      case '<': return x < n;
      case '==': return x === n;
    }
    return false;
  }

  /* Heartbeat: 80 on, 120 off, 80 on, 720 off; every 17th frame the long gap is 700. */
  function wavePoints(w, span) {
    const t0 = span[0];
    if (!w) return [[t0, 0]];
    if (w.type === 'pts') return w.pts.slice().sort((a, b) => a[0] - b[0]);
    const pts = [[t0, 0]];
    let s = w.from, k = 0;
    while (s < w.to && s < span[1]) {
      pts.push([s, 1], [s + 80, 0], [s + 200, 1], [s + 280, 0]);
      s += (k % 17 === 16) ? 980 : 1000;
      k++;
    }
    return pts;
  }

  /* ─────────────── parser ─────────────── */

  function problem(S, level, where, msg) {
    (level === 'error' ? S.errors : S.warnings).push({ where, msg });
  }

  function parseStory(files) {
    const S = {
      meta: {}, chapters: [], chapterMap: {},
      people: {}, places: {}, hyps: {}, docs: {}, devices: {}, codas: {}, scenes: {}, clues: {}, tasks: {},
      order: { people: [], places: [], hyps: [], docs: [], devices: [], codas: [], scenes: [], clues: [], tasks: [] },
      shortToPerson: {}, sceneToCoda: {},
      errors: [], warnings: [],
      files: files.map(f => f.name), hash: '',
    };
    const blocks = [];
    let all = '';
    for (const f of files) {
      all += '\u0000' + f.name + '\u0000' + f.text;
      parseFile(S, f.name, f.text, blocks);
    }
    S.hash = hash(all);
    for (const b of blocks) buildBlock(S, b);
    S.chapters.forEach((c, i) => {
      c.index = i;
      if (S.chapterMap[c.id]) problem(S, 'error', c.where, `Chapter "${c.id}" is declared twice.`);
      S.chapterMap[c.id] = c;
    });
    for (const id of S.order.people) { const p = S.people[id]; S.shortToPerson[p.short] = id; }
    for (const id of S.order.codas) S.sceneToCoda[S.codas[id].scene] = id;
    return S;
  }

  function parseFile(S, name, text, blocks) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let blk = null, multi = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const where = name + ':' + (i + 1);
      if (multi) {
        if (raw.trim() === '@end') { multi = null; continue; }
        multi.lines.push(raw.replace(/\s+$/, ''));
        continue;
      }
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      if (t.startsWith('@@')) { parseDirective(S, t.slice(2), where); continue; }
      if (t.startsWith('===')) {
        const m = t.match(/^===\s*(\w+)\s+([\w.]+)\s*$/);
        if (!m) { problem(S, 'error', where, `This block header doesn't parse: "${t}". Use "=== kind id".`); blk = null; continue; }
        blk = { kind: m[1], id: m[2], where, props: {}, lists: {}, multi: {}, body: [] };
        blocks.push(blk);
        continue;
      }
      if (!blk) { problem(S, 'error', where, `Text outside any block: "${t}".`); continue; }
      if (t.startsWith('@')) {
        const m = t.match(/^@(\w+)(?:\s+(.*))?$/);
        if (!m) { problem(S, 'error', where, `This property doesn't parse: "${t}".`); continue; }
        const key = m[1], val = (m[2] || '').trim();
        if (key === 'end') { problem(S, 'error', where, '@end without an open @schematic, @rules, @behavior, @datasheet or @capture.'); continue; }
        if (MULTI_KEYS.has(key) && (key === 'capture' || !val)) {
          multi = { key, title: val, lines: [], where };
          blk.multi[key] = multi;
          continue;
        }
        if (LIST_KEYS.has(key)) (blk.lists[key] = blk.lists[key] || []).push({ val, where });
        else {
          if (blk.props[key]) problem(S, 'warning', where, `@${key} is set twice on ${blk.kind} "${blk.id}"; the second one wins.`);
          blk.props[key] = { val, where };
        }
        continue;
      }
      blk.body.push({ text: t, where });
    }
    if (multi) problem(S, 'error', multi.where, `@${multi.key} is never closed with @end.`);
  }

  function parseDirective(S, t, where) {
    const m = t.match(/^(\w+)\s+(.*)$/);
    if (!m) { problem(S, 'error', where, `This directive doesn't parse: "@@${t}".`); return; }
    const key = m[1], val = m[2].trim();
    if (key === 'chapter') {
      const parts = val.split('|').map(s => s.trim());
      S.chapters.push({
        id: parts[0], label: parts[1] || parts[0], title: parts[2] || '', phase: parts[3] || '',
        docs: (parts[4] || '').split(/\s+/).filter(Boolean), where,
      });
    } else S.meta[key] = val;
  }

  function parseCond(S, src, where) {
    if (!src || !src.trim()) return null;
    const atoms = [];
    for (let a of src.split('&')) {
      a = a.trim();
      if (!a) continue;
      let neg = false;
      if (a.startsWith('!')) { neg = true; a = a.slice(1).trim(); }
      const m = a.match(/^(\w+):([\w.]+)(?:\s*(>=|<=|==|>|<)\s*(-?\d+))?$/);
      if (!m) { problem(S, 'error', where, `This condition doesn't parse: "${a}".`); continue; }
      const kind = m[1];
      if (!COND_KINDS.has(kind)) problem(S, 'error', where, `Unknown condition "${kind}:". Use one of: ${Array.from(COND_KINDS).join(', ')}.`);
      if ((kind === 'stat' || kind === 'tag' || kind === 'tagphases') && !m[3]) problem(S, 'error', where, `"${a}" needs a comparison, like >=1.`);
      atoms.push({ neg, kind, key: m[2], cmp: m[3] || null, n: m[4] != null ? +m[4] : null });
    }
    return { src: src.trim(), atoms, where };
  }

  function condText(S, val, where) {
    const bar = val.indexOf('|');
    if (bar < 0) { problem(S, 'error', where, `Expected "condition | text", got "${val}".`); return null; }
    return { cond: parseCond(S, val.slice(0, bar), where), text: val.slice(bar + 1).trim(), where };
  }

  function parseSpeech(text) {
    const m = String(text || '').match(SPEAKER_RE);
    return m ? { who: m[1].trim(), mode: m[2] || null, text: m[3] } : { who: null, mode: null, text: text || '' };
  }

  function parseCapture(S, multi) {
    const cap = { title: multi.title, span: null, channels: [], where: multi.where };
    for (const raw of multi.lines) {
      const l = raw.trim();
      if (!l) continue;
      let m = l.match(/^span\s+(\d+)\s+(\d+)$/);
      if (m) { cap.span = [+m[1], +m[2]]; continue; }
      m = l.match(/^ch\s+(.+?)\s*\|\s*(.+?)(?:\s*\|\s*([\w.]+))?$/);
      if (m) {
        const spec = m[2].trim();
        let wave = null;
        const hb = spec.match(/^hb\s+(\d+)\s+(\d+)$/);
        if (hb) wave = { type: 'hb', from: +hb[1], to: +hb[2] };
        else {
          const pts = spec.split(/\s+/).map(p => p.split(':').map(Number));
          if (pts.some(p => p.length !== 2 || p.some(Number.isNaN))) problem(S, 'error', multi.where, `Capture channel "${m[1]}" has a bad point list. Use "time:level" pairs in ms.`);
          wave = { type: 'pts', pts };
        }
        cap.channels.push({ name: m[1], wave, clue: m[3] || null });
        continue;
      }
      problem(S, 'error', multi.where, `This capture line doesn't parse: "${l}".`);
    }
    if (!cap.span) {
      let end = 1000;
      for (const c of cap.channels) {
        if (c.wave.type === 'hb') end = Math.max(end, c.wave.to);
        else for (const p of c.wave.pts) end = Math.max(end, p[0]);
      }
      cap.span = [0, Math.ceil(end / 1000) * 1000];
    }
    return cap;
  }

  function parseLineOp(S, t, where) {
    if (t.startsWith('! ')) {
      const parts = t.slice(2).trim().split(/\s+/);
      return { op: 'cmd', name: parts[0], args: parts.slice(1), where };
    }
    if (t.startsWith('~ ')) return { op: 'narr', text: t.slice(2).trim(), where };
    if (t.startsWith('? ')) {
      const bar = t.indexOf('|');
      if (bar < 0) { problem(S, 'error', where, `A "?" line needs "condition | line": "${t}".`); return null; }
      const cond = parseCond(S, t.slice(2, bar), where);
      const inner = parseLineOp(S, t.slice(bar + 1).trim(), where);
      if (!inner) return null;
      if (inner.op === 'opt') { problem(S, 'error', where, 'Put a condition on a choice as "* [condition] label".'); return null; }
      return { op: 'if', cond, then: inner, where };
    }
    if (t.startsWith('* ') || t.startsWith('+ ')) {
      const kind = t[0];
      let rest = t.slice(2).trim();
      let cond = null;
      if (rest.startsWith('[')) {
        const close = rest.indexOf(']');
        if (close < 0) { problem(S, 'error', where, `Unclosed [condition] on a choice: "${t}".`); return null; }
        cond = parseCond(S, rest.slice(1, close), where);
        rest = rest.slice(close + 1).trim();
      }
      let target = null, mode = 'none';
      const m = rest.match(/^(.*?)\s*(=>|->)\s*([\w.]+)$/);
      if (m) { rest = m[1].trim(); mode = m[2] === '=>' ? 'call' : 'goto'; target = m[3]; }
      if (kind === '+' && mode !== 'call') problem(S, 'error', where, 'A "+" (ask) choice needs a "=> scene" to call.');
      return { op: 'opt', kind, cond, label: rest, mode, target, where };
    }
    const m = t.match(SPEAKER_RE);
    if (m) return { op: 'say', who: m[1].trim(), mode: m[2] || null, text: m[3], where };
    problem(S, 'error', where, `This line doesn't parse: "${t}". Lines start with "~", "?", "*", "+", "!", or "Name:".`);
    return null;
  }

  function compileScene(S, b) {
    const ops = [];
    for (const { text, where } of b.body) {
      const op = parseLineOp(S, text, where);
      if (!op) continue;
      if (op.op === 'opt') {
        const last = ops[ops.length - 1];
        if (last && last.op === 'menu' && last.open) last.options.push(op);
        else ops.push({ op: 'menu', options: [op], where, open: true });
        continue;
      }
      const last = ops[ops.length - 1];
      if (last && last.op === 'menu') last.open = false;
      ops.push(op);
    }
    for (const o of ops) if (o.op === 'menu') delete o.open;
    return ops;
  }

  function buildBlock(S, b) {
    const coll = BLOCK_KINDS[b.kind];
    if (!coll) { problem(S, 'error', b.where, `Unknown block type "${b.kind}".`); return; }
    if (S[coll][b.id]) { problem(S, 'error', b.where, `${b.kind} "${b.id}" is defined twice.`); return; }
    const known = new Set(KNOWN_KEYS[b.kind].split(' '));
    for (const k of Object.keys(b.props).concat(Object.keys(b.lists), Object.keys(b.multi))) {
      if (!known.has(k)) problem(S, 'warning', b.where, `@${k} isn't used on a ${b.kind}; it will be ignored.`);
    }
    const P = k => (b.props[k] ? b.props[k].val : '');
    const has = k => !!b.props[k];
    const words = k => P(k).split(/\s+/).filter(Boolean);
    const body = () => b.body.map(l => l.text).join(' ');
    const notes = () => (b.lists.note || []).map(n => condText(S, n.val, n.where)).filter(Boolean);
    const block = k => {
      if (!b.multi[k]) return [];
      const ls = b.multi[k].lines.slice();
      while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
      while (ls.length && !ls[0].trim()) ls.shift();
      return ls;
    };
    let o;
    switch (b.kind) {
      case 'person':
        o = { id: b.id, name: P('name') || b.id, short: P('short') || P('name') || b.id, role: P('role'), desc: body(), notes: notes() };
        break;
      case 'place':
        o = { id: b.id, name: P('name') || b.id, type: P('type'), desc: body(), notes: notes() };
        break;
      case 'hypothesis':
        o = { id: b.id, question: P('question') || 'Unsorted', text: P('text'), key: has('key'), trail: has('trail') };
        break;
      case 'doc':
        o = { id: b.id, title: P('title') || b.id, kind: P('kind'), from: P('from'), paras: b.body.map(l => l.text) };
        break;
      case 'device':
        o = { id: b.id, name: P('name') || b.id, ref: P('ref'), desc: body() };
        break;
      case 'coda':
        o = {
          id: b.id, title: P('title') || b.id, kind: P('kind'), hint: P('hint'),
          requires: parseCond(S, P('requires'), b.props.requires ? b.props.requires.where : b.where),
          scene: P('scene') || b.id,
        };
        break;
      case 'scene':
        o = {
          id: b.id, chapter: P('chapter') || null, place: P('place') || null, location: P('location') || null,
          call: P('kind') === 'call', ops: compileScene(S, b),
        };
        break;
      case 'clue': {
        let ask = null;
        if (has('ask')) {
          const m = P('ask').match(/^(.*?)\s*=>\s*([\w.]+)$/);
          if (m) ask = { label: m[1].trim(), scene: m[2] };
          else problem(S, 'error', b.props.ask.where, '@ask needs "label => scene".');
        }
        o = {
          id: b.id, chapter: P('chapter'), volume: P('volume') || 'whisper', track: P('track') || 'situational',
          tags: words('tags'), supports: words('supports'), weakens: words('weakens'), opens: words('opens'),
          payoff: P('payoff') || null, decoy: has('decoy'), observation: P('observation'),
          obsIf: (b.lists.observation_if || []).map(x => condText(S, x.val, x.where)).filter(Boolean),
          ask,
        };
        if (!VOLUMES.has(o.volume)) problem(S, 'warning', b.where, `Clue "${b.id}" has volume "${o.volume}"; expected loud, murmur or whisper.`);
        if (!TRACKS.has(o.track)) problem(S, 'warning', b.where, `Clue "${b.id}" has track "${o.track}"; expected technical or situational.`);
        if (!o.observation) problem(S, 'error', b.where, `Clue "${b.id}" has no @observation.`);
        break;
      }
      case 'task':
        o = {
          id: b.id, chapter: P('chapter'), form: P('form') || 'workorder', title: P('title') || b.id,
          code: P('code'), rev: P('rev'), board: P('board'), device: P('device') || null, brief: P('brief'),
          behavior: block('behavior'), schematic: block('schematic'), rules: block('rules'), datasheet: block('datasheet'),
          capture: b.multi.capture ? parseCapture(S, b.multi.capture) : null,
          remark: P('remark'), provided: P('provided'), driver: P('driver'), parts: P('parts'),
          hints: ['hint1', 'hint2', 'hint3'].filter(has).map(k => Object.assign(parseSpeech(P(k)), { where: b.props[k].where })),
          after: P('after') || null,
          extra: (b.lists.extra || []).map(x => condText(S, x.val, x.where)).filter(Boolean),
        };
        break;
    }
    o.where = b.where;
    S[coll][b.id] = o;
    S.order[coll].push(b.id);
  }

  /* ─────────────── engine ─────────────── */

  class Engine {
    constructor(story, saved) {
      this.S = story;
      this.state = saved && saved.state ? saved.state : Engine.fresh(story);
      this.snaps = (saved && saved.snaps) || {};
      this.snapshots = !(saved && saved.noSnapshots);
    }

    static fresh(S) {
      return {
        format: 'signal-noise-state', v: 1, story: S.hash,
        started: false, ended: false, error: null,
        chapter: null, chapters: {}, stack: [], wait: null,
        flags: {}, stats: {},
        clues: {}, seenOrder: [], followOrder: [],
        hyps: {}, hypOrder: [], beliefs: null,
        tasks: {}, taskOrder: [], library: [],
        docs: {}, docOrder: [], devices: [], places: {}, placeOrder: [],
        met: {}, notes: {}, codasPlayed: [],
        log: [], seq: 0,
      };
    }

    /* — plumbing — */
    top() { const s = this.state.stack; return s[s.length - 1] || null; }
    log(entry) {
      const st = this.state;
      entry.n = ++st.seq;
      if (st.chapter && !entry.ch) entry.ch = st.chapter;
      st.log.push(entry);
      return entry;
    }
    fail(msg) {
      if (this.state.error) return;
      this.state.error = msg;
      this.state.wait = null;
      this.log({ k: 'error', text: msg });
    }
    goto(id) {
      if (!this.S.scenes[id]) { this.fail(`The story tried to go to a scene called "${id}", and there isn't one.`); return; }
      this.state.stack = [{ scene: id, pc: 0, used: {}, loc: false }];
    }
    call(id) {
      if (!this.S.scenes[id]) { this.fail(`The story tried to call a scene called "${id}", and there isn't one.`); return; }
      this.state.stack.push({ scene: id, pc: 0, used: {}, loc: false });
    }

    start() {
      const st = this.state;
      if (st.started) return;
      st.started = true;
      const player = this.S.meta.player;
      if (player && this.S.people[player]) st.met[player] = 1;
      this.goto(this.S.meta.start);
      this.advance();
    }

    /* Runs until one beat (a visible line or a chapter-end card) has been logged, or the story waits. */
    advance() {
      const st = this.state;
      if (!st.started || st.error || st.wait) return false;
      for (let guard = 0; guard < 20000; guard++) {
        if (st.wait || st.error) break;
        const fr = this.top();
        if (!fr) { this.fail('The story ran out of scenes.'); break; }
        const sc = this.S.scenes[fr.scene];
        if (!sc) { this.fail(`Scene "${fr.scene}" doesn't exist.`); break; }
        if (fr.pc >= sc.ops.length) { this.pop(); continue; }
        if (this.exec(sc.ops[fr.pc], fr, sc)) break;
      }
      this.checkNotes();
      return true;
    }

    pop() {
      const st = this.state;
      const fr = st.stack.pop();
      const codaId = this.S.sceneToCoda[fr.scene];
      if (codaId) this.log({ k: 'codaend', id: codaId });
      if (!st.stack.length) {
        if (st.ended) { st.wait = { type: 'ending' }; return; }
        this.fail(`Scene "${fr.scene}" ended without saying where to go next. Add "! next <scene>" to it.`);
        return;
      }
      const sc = this.S.scenes[fr.scene];
      if (sc && sc.location) this.top().loc = false;
    }

    exec(op, fr, sc) {
      switch (op.op) {
        case 'if':
          if (this.test(op.cond)) return this.exec(op.then, fr, sc);
          fr.pc++;
          return false;
        case 'narr':
          this.line(fr, sc, { k: 'narr', text: op.text });
          fr.pc++;
          return true;
        case 'say':
          this.line(fr, sc, { k: 'say', who: op.who, mode: op.mode, text: op.text });
          fr.pc++;
          return true;
        case 'menu': return this.menu(op, fr, sc);
        case 'cmd': return this.cmd(op, fr, sc);
      }
      fr.pc++;
      return false;
    }

    stamp(fr, sc) {
      if (fr.loc) return;
      fr.loc = true;
      if (sc.place) this.visit(sc.place);
      if (sc.location) this.log({ k: 'loc', scene: sc.id, place: sc.place, text: sc.location, cut: !!sc.call, again: !!fr.stamped });
      fr.stamped = true;
    }

    line(fr, sc, e) {
      this.stamp(fr, sc);
      e.scene = sc.id;
      if (e.k === 'say') { const pid = this.S.shortToPerson[e.who]; if (pid) this.meet(pid); }
      this.seeText(e.text);
      this.log(e);
    }

    /* — choices — */
    menuAvail(op, fr) {
      const used = (fr.used && fr.used[fr.pc]) || [];
      const out = [];
      op.options.forEach((o, i) => {
        if (o.kind === '+' && used.indexOf(i) >= 0) return;
        if (!this.test(o.cond)) return;
        out.push(i);
      });
      return out;
    }
    menu(op, fr, sc) {
      if (!this.menuAvail(op, fr).length) { fr.pc++; return false; }
      this.stamp(fr, sc);
      this.state.wait = { type: 'menu' };
      return false;
    }
    options() {
      const st = this.state;
      if (!st.wait || st.wait.type !== 'menu') return [];
      const fr = this.top();
      const op = this.S.scenes[fr.scene].ops[fr.pc];
      return this.menuAvail(op, fr).map(i => {
        const o = op.options[i];
        return { i, label: o.label, kind: o.kind, mode: o.mode };
      });
    }
    choose(i) {
      const st = this.state;
      if (!st.wait || st.wait.type !== 'menu') return false;
      const fr = this.top();
      const sc = this.S.scenes[fr.scene];
      const op = sc.ops[fr.pc];
      if (this.menuAvail(op, fr).indexOf(i) < 0) return false;
      const o = op.options[i];
      st.wait = null;
      this.log({ k: 'choice', scene: sc.id, label: o.label, kind: o.kind });
      if (o.kind === '+') (fr.used[fr.pc] = fr.used[fr.pc] || []).push(i);
      else fr.pc++;
      if (o.mode === 'call') this.call(o.target);
      else if (o.mode === 'goto') this.goto(o.target);
      this.advance();
      return true;
    }

    /* — commands — */
    cmd(op, fr, sc) {
      const st = this.state, a = op.args;
      switch (op.name) {
        case 'next': this.goto(a[0]); return false;
        case 'chapter':
          if (this.snapshots) this.snaps[a[0]] = JSON.stringify(st);
          st.chapter = a[0];
          st.chapters[a[0]] = 'running';
          this.log({ k: 'chapter', id: a[0] });
          fr.pc++;
          return false;
        case 'endchapter':
          this.stamp(fr, sc);
          this.endChapter(a[0]);
          fr.pc++;
          return true;
        case 'task': return this.issue(a[0], fr, sc);
        case 'stat':
          st.stats[a[0]] = (st.stats[a[0]] || 0) + (parseInt(a[1], 10) || 0);
          fr.pc++;
          this.checkNotes();
          return false;
        case 'flag':
          st.flags[a[0]] = true;
          fr.pc++;
          this.checkNotes();
          return false;
        case 'open': this.openHyp(a[0]); fr.pc++; return false;
        case 'demote': this.demoteHyp(a[0]); fr.pc++; return false;
        case 'doc': this.unlockDoc(a[0], true); fr.pc++; return false;
        case 'device': this.unlockDevice(a[0], true); fr.pc++; return false;
        case 'place': this.seePlace(a[0]); fr.pc++; return false;
        case 'recall': return this.block(fr, sc, 'recall', () => ({ data: this.recallData() }));
        case 'believe': return this.block(fr, sc, 'believe', () => ({ data: this.believeData() }));
        case 'codex':
          this.stamp(fr, sc);
          this.log({ k: 'devices', list: st.devices.slice() });
          fr.pc++;
          return true;
        case 'ending':
          st.ended = true;
          return this.block(fr, sc, 'ending');
      }
      this.fail(`Unknown command "! ${op.name}" at ${op.where}.`);
      return false;
    }

    block(fr, sc, type, extra) {
      if (fr.done === fr.pc) { fr.done = null; fr.shown = null; fr.pc++; return false; }
      if (fr.shown !== fr.pc) {
        this.stamp(fr, sc);
        fr.shown = fr.pc;
        this.log(Object.assign({ k: type }, extra ? extra() : {}));
      }
      this.state.wait = { type };
      return false;
    }
    resolve(type, fn) {
      const st = this.state;
      if (!st.wait || st.wait.type !== type) return false;
      if (fn) fn();
      st.wait = null;
      const fr = this.top();
      fr.done = fr.pc;
      this.advance();
      return true;
    }
    finishRecall() { return this.resolve('recall'); }
    submitBeliefs(map) { return this.resolve('believe', () => { this.state.beliefs = Object.assign({}, map || {}); }); }

    /* — chapters — */
    endChapter(ch) {
      const st = this.state, S = this.S;
      if (st.chapters[ch] === 'done') return;
      st.chapters[ch] = 'done';
      const tally = { followed: 0, noticed: 0, missed: 0 };
      for (const id of S.order.clues) {
        const C = S.clues[id];
        if (C.chapter !== ch || C.decoy) continue;
        const cs = st.clues[id];
        if (!cs || !cs.seen) continue;
        if (cs.followed) tally.followed++;
        else if (cs.noticed) tally.noticed++;
        else tally.missed++;
      }
      const docs = (S.chapterMap[ch] && S.chapterMap[ch].docs) || [];
      for (const d of docs) this.unlockDoc(d, false);
      this.log({ k: 'endchapter', id: ch, docs: docs.slice(), tally });
    }

    restoreChapter(ch) {
      const snap = this.snaps[ch];
      if (!snap) return false;
      this.state = JSON.parse(snap);
      const at = this.S.chapterMap[ch] ? this.S.chapterMap[ch].index : -1;
      for (const k of Object.keys(this.snaps)) {
        const c = this.S.chapterMap[k];
        if (!c || c.index > at) delete this.snaps[k];
      }
      this.advance();
      return true;
    }

    /* — tasks (the puzzle itself is held; these stand in for the checker) — */
    issue(id, fr, sc) {
      const st = this.state, T = this.S.tasks[id];
      if (!T) { this.fail(`Task "${id}" doesn't exist.`); return false; }
      let ts = st.tasks[id];
      if (!ts) {
        ts = st.tasks[id] = { status: 'active', fails: 0, hints: 0, extra: false };
        st.taskOrder.push(id);
        if (T.device) this.unlockDevice(T.device, false);
        this.stamp(fr, sc);
        this.log({ k: 'task', id });
      }
      if (ts.status === 'passed') {
        if (T.after) this.goto(T.after);
        else fr.pc++;
        return false;
      }
      st.wait = { type: 'task', id };
      return false;
    }
    failRun(id) {
      const ts = this.state.tasks[id], T = this.S.tasks[id];
      if (!T || !ts || ts.status !== 'active') return false;
      ts.fails++;
      while (ts.hints < T.hints.length && ts.fails >= HINT_AT[Math.min(ts.hints, HINT_AT.length - 1)]) {
        const h = T.hints[ts.hints];
        ts.hints++;
        this.log({ k: 'hint', task: id, tier: ts.hints, who: h.who, text: h.text });
      }
      return true;
    }
    extraFor(id) {
      const T = this.S.tasks[id];
      return T ? T.extra.filter(x => this.test(x.cond)) : [];
    }
    pass(id, withExtra) {
      const st = this.state, T = this.S.tasks[id], ts = st.tasks[id];
      if (!T || !ts || ts.status !== 'active') return false;
      ts.status = 'passed';
      ts.extra = !!withExtra && this.extraFor(id).length > 0;
      if (T.driver) st.library.push({ task: id, driver: T.driver });
      this.log({ k: 'passed', id, extra: ts.extra });
      if (st.wait && st.wait.type === 'task' && st.wait.id === id) st.wait = null;
      this.checkNotes();
      return true;
    }
    seeTask(id) {
      const T = this.S.tasks[id];
      if (!T || !this.state.tasks[id]) return;
      if (T.capture) for (const c of T.capture.channels) if (c.clue) this.seeClue(c.clue, c.name + ' on the ' + (T.title || id) + ' capture');
      if (T.parts) this.seeText(T.parts);
    }

    /* — clues — */
    clueState(id) {
      const st = this.state;
      return st.clues[id] || (st.clues[id] = { seen: 0, noticed: false, followed: null, letgo: false, obs: null, text: '' });
    }
    seeClue(id, label) {
      if (!this.S.clues[id]) return;
      const cs = this.clueState(id);
      if (!cs.seen) { cs.seen = this.state.seq + 1; cs.text = label || ''; this.state.seenOrder.push(id); }
    }
    seeText(text) { for (const seg of segments(text || '')) if (seg.clue) this.seeClue(seg.clue, seg.text); }
    observation(id) {
      const C = this.S.clues[id];
      for (const o of C.obsIf) if (this.test(o.cond)) return o.text;
      return C.observation;
    }
    clueStatus(id) {
      const C = this.S.clues[id];
      if (!C) return 'missing';
      const cs = this.state.clues[id];
      if (cs && cs.followed) return cs.followed;
      const ch = this.state.chapters[C.chapter];
      if (ch === 'running') return 'open';
      if (ch === 'done') return 'closed';
      return 'pending';
    }
    notice(id) {
      const C = this.S.clues[id];
      const status = this.clueStatus(id);
      if (!C || status === 'pending' || status === 'closed' || status === 'missing') return null;
      const cs = this.clueState(id);
      this.seeClue(id);
      if (!cs.noticed) { cs.noticed = true; cs.obs = this.observation(id); }
      const actions = [];
      if (status === 'open') {
        if (C.ask && !(this.state.wait && this.state.wait.type === 'ending')) actions.push({ id: 'ask', label: C.ask.label });
        actions.push({ id: 'note', label: 'Note it' });
        actions.push({ id: 'letgo', label: 'Let it go' });
      }
      return { id, obs: cs.obs, status, actions, track: C.track, letgo: cs.letgo };
    }
    act(id, action) {
      const st = this.state, C = this.S.clues[id];
      if (!C || this.clueStatus(id) !== 'open') return false;
      const cs = this.clueState(id);
      if (!cs.noticed) { cs.noticed = true; cs.obs = this.observation(id); }
      if (action === 'letgo') { cs.letgo = true; return true; }
      if (action !== 'note' && action !== 'ask') return false;
      if (action === 'ask' && !C.ask) return false;
      cs.followed = action === 'ask' ? 'asked' : 'noted';
      cs.letgo = false;
      st.followOrder.push(id);
      for (const h of C.opens) this.openHyp(h);
      this.checkNotes();
      if (action === 'ask') this.interrupt(C.ask.scene);
      return true;
    }
    interrupt(sceneId) {
      const st = this.state;
      if (st.error || !st.started) return;
      if (st.wait && st.wait.type === 'ending') return;
      st.wait = null;
      this.call(sceneId);
      this.advance();
    }

    /* — conditions — */
    test(cond) {
      if (!cond) return true;
      for (const a of cond.atoms) {
        const v = this.atom(a);
        if (a.neg ? v : !v) return false;
      }
      return true;
    }
    atom(a) {
      const st = this.state;
      switch (a.kind) {
        case 'flag': return !!st.flags[a.key];
        case 'stat': return cmp(st.stats[a.key] || 0, a.cmp, a.n);
        case 'seen': return !!(st.clues[a.key] && st.clues[a.key].seen);
        case 'noticed': return !!(st.clues[a.key] && st.clues[a.key].noticed);
        case 'followed': return !!(st.clues[a.key] && st.clues[a.key].followed);
        case 'tag': return cmp(this.tagged(a.key).length, a.cmp, a.n);
        case 'tagphases': return cmp(this.phasesOf(this.tagged(a.key)), a.cmp, a.n);
        case 'solved': return !!(st.tasks[a.key] && st.tasks[a.key].status === 'passed');
        case 'taskextra': return !!(st.tasks[a.key] && st.tasks[a.key].extra);
      }
      return false;
    }
    tagged(tag) {
      return this.state.followOrder.filter(id => {
        const C = this.S.clues[id];
        return C && !C.decoy && C.tags.indexOf(tag) >= 0;
      });
    }
    phasesOf(ids) {
      const set = new Set();
      for (const id of ids) {
        const ch = this.S.chapterMap[this.S.clues[id].chapter];
        set.add(ch ? ch.phase : '?');
      }
      return set.size;
    }

    /* — codex bookkeeping — */
    openHyp(id) {
      const st = this.state;
      if (!this.S.hyps[id] || st.hyps[id]) return;
      const first = st.hypOrder.length === 0;
      st.hyps[id] = 'live';
      st.hypOrder.push(id);
      this.log({ k: 'board', what: 'open', id, first });
    }
    demoteHyp(id) {
      const st = this.state;
      if (!this.S.hyps[id]) return;
      if (!st.hyps[id]) { st.hyps[id] = 'live'; st.hypOrder.push(id); }
      if (st.hyps[id] === 'demoted') return;
      st.hyps[id] = 'demoted';
      this.log({ k: 'board', what: 'demote', id });
    }
    unlockDoc(id, announce) {
      const st = this.state;
      if (!this.S.docs[id] || st.docs[id]) return;
      st.docs[id] = { read: false };
      st.docOrder.push(id);
      if (announce) this.log({ k: 'doc', id });
    }
    readDoc(id) {
      const st = this.state, D = this.S.docs[id];
      if (!D || !st.docs[id]) return;
      st.docs[id].read = true;
      for (const p of D.paras) this.seeText(p);
    }
    unlockDevice(id, announce) {
      const st = this.state;
      if (!this.S.devices[id] || st.devices.indexOf(id) >= 0) return;
      st.devices.push(id);
      if (announce) this.log({ k: 'device', id });
    }
    seePlace(id) {
      const st = this.state;
      if (!this.S.places[id] || st.places[id]) return;
      st.places[id] = 'seen';
      st.placeOrder.push(id);
      this.log({ k: 'place', id });
    }
    visit(id) {
      const st = this.state;
      if (!this.S.places[id]) return;
      if (!st.places[id]) st.placeOrder.push(id);
      st.places[id] = 'visited';
    }
    meet(pid) { if (!this.state.met[pid]) this.state.met[pid] = this.state.seq + 1; }

    /* Relationship notes appear once their condition holds. They never show numbers. */
    checkNotes() {
      const st = this.state, S = this.S;
      for (const pid of S.order.people) {
        if (!st.met[pid]) continue;
        S.people[pid].notes.forEach((n, i) => {
          const key = pid + ':' + i;
          if (st.notes[key] || !this.test(n.cond)) return;
          st.notes[key] = st.seq + 1;
          this.log({ k: 'note', who: pid, i, text: n.text });
        });
      }
      for (const id of S.order.places) {
        if (!st.places[id]) continue;
        S.places[id].notes.forEach((n, i) => {
          const key = 'place:' + id + ':' + i;
          if (st.notes[key] || !this.test(n.cond)) return;
          st.notes[key] = st.seq + 1;
          this.log({ k: 'note', place: id, i, text: n.text });
        });
      }
    }
    activeNotes(pid) {
      const st = this.state;
      const list = (this.S.people[pid] || this.S.places[pid] || { notes: [] }).notes;
      const prefix = this.S.people[pid] ? pid + ':' : 'place:' + pid + ':';
      return list.map((n, i) => ({ text: n.text, at: st.notes[prefix + i] })).filter(n => n.at).sort((a, b) => a.at - b.at);
    }

    /* — the case board — */
    board() {
      const st = this.state, S = this.S;
      const questions = [], byQ = {}, byH = {};
      for (const hid of st.hypOrder) {
        const H = S.hyps[hid];
        if (!byQ[H.question]) { byQ[H.question] = { question: H.question, hyps: [] }; questions.push(byQ[H.question]); }
        const e = { id: hid, text: H.text, status: st.hyps[hid], pro: [], con: [], order: st.hypOrder.indexOf(hid) };
        byQ[H.question].hyps.push(e);
        byH[hid] = e;
      }
      const placed = new Set();
      const loose = [], noise = [];
      for (const cid of st.followOrder) {
        const C = S.clues[cid];
        if (!C) continue;
        if (C.decoy) { noise.push(cid); continue; }
        for (const h of C.supports) if (byH[h]) { byH[h].pro.push(cid); placed.add(cid); }
        for (const h of C.weakens) if (byH[h]) { byH[h].con.push(cid); placed.add(cid); }
        if (!placed.has(cid)) loose.push(cid);
      }
      const score = h => h.pro.length - h.con.length;
      for (const q of questions) {
        q.hyps.sort((a, b) => ((a.status === 'demoted') - (b.status === 'demoted')) || (score(b) - score(a)) || (a.order - b.order));
        const live = q.hyps.filter(h => h.status === 'live');
        if (live.length > 1 && score(live[0]) > score(live[1])) live[0].leading = true;
      }
      return { questions, loose, noise };
    }

    recallData() {
      const st = this.state, S = this.S;
      const qs = [], byQ = {};
      for (const hid of st.hypOrder) {
        const H = S.hyps[hid];
        if (!byQ[H.question]) { byQ[H.question] = { q: H.question, hyps: [], clues: [] }; qs.push(byQ[H.question]); }
        byQ[H.question].hyps.push({ id: hid, status: st.hyps[hid] });
      }
      const loose = [], noise = [];
      for (const cid of st.seenOrder) {
        const C = S.clues[cid];
        if (!C) continue;
        const cs = st.clues[cid];
        const item = { id: cid, followed: cs.followed || null, obs: cs.obs || this.observation(cid) };
        if (C.decoy) { if (cs.followed) noise.push(item); continue; }
        const q = C.supports.concat(C.weakens).map(h => S.hyps[h] && byQ[S.hyps[h].question]).filter(Boolean)[0];
        if (q) q.clues.push(item); else loose.push(item);
      }
      return { qs, loose, noise };
    }

    believeData() {
      return this.board().questions
        .map(q => ({ q: q.question, live: q.hyps.filter(x => x.status === 'live').map(x => x.id) }))
        .filter(q => q.live.length);
    }

    /* — endings — */
    codaList() {
      return this.S.order.codas.map(id => {
        const K = this.S.codas[id];
        return { id, title: K.title, kind: K.kind, hint: K.hint, open: this.test(K.requires), played: this.state.codasPlayed.indexOf(id) >= 0 };
      });
    }
    playCoda(id) {
      const st = this.state, K = this.S.codas[id];
      if (!K || !st.wait || st.wait.type !== 'ending') return false;
      if (!this.test(K.requires) || st.codasPlayed.indexOf(id) >= 0) return false;
      st.codasPlayed.push(id);
      st.wait = null;
      this.log({ k: 'codastart', id });
      this.call(K.scene);
      this.advance();
      return true;
    }
    summary() {
      const st = this.state, S = this.S;
      let fails = 0, hints = 0;
      for (const id in st.tasks) { fails += st.tasks[id].fails; hints += st.tasks[id].hints; }
      const c = { seen: 0, noticed: 0, followed: 0, asked: 0, missed: 0 };
      for (const id of st.seenOrder) {
        const C = S.clues[id];
        if (!C || C.decoy) continue;
        const cs = st.clues[id];
        c.seen++;
        if (cs.noticed) c.noticed++;
        if (cs.followed) c.followed++;
        if (cs.followed === 'asked') c.asked++;
        if (!cs.noticed) c.missed++;
      }
      const passed = S.order.tasks.filter(id => st.tasks[id] && st.tasks[id].status === 'passed').length;
      return { tasks: S.order.tasks.length, passed, fails, hints, clues: c };
    }
    serialize() { return { state: this.state, snaps: this.snaps }; }
  }

  return {
    parseStory, parseCond, Engine, segments, cluesIn, plain, wavePoints, hash,
    HINT_AT, COMMANDS, COND_KINDS, SPEAKER_RE,
  };
});
