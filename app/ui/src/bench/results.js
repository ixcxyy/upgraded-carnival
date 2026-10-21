// What the checker said: one seed's rules (a Run) or every seed's (a Submit). A failing
// rule with evidence can be shown on the waveform, where the expected signal is drawn
// under the real one.

import { h, put, btn, icon, fmtT, hex, plural, basename } from './util.js';

function sizesLine(sz) {
  if (!sz) return null;
  const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  return 'Flash ' + kb(sz.flash) + ' of 256 KB · RAM ' + kb(sz.ram) + ' of 64 KB (not counting the stack)';
}

/** The rules one seed was judged by. The first broken one leads with its evidence and actions. */
function ruleList(sr, ctx, opts) {
  const o = opts || {};
  const ul = h('ul', { class: 'rules' });
  const firstBad = sr.rules.find(r => !r.pass);
  for (const r of sr.rules) {
    const lead = r === firstBad;
    const li = h('li', { class: (r.pass ? 'ok' : 'bad') + (lead ? ' lead' : '') },
      h('span', { class: 'mark', role: 'img', 'aria-label': r.pass ? 'passed' : 'failed' }, icon(r.pass ? 'check' : 'fail', { size: 15 })),
      h('div', { class: 'body' },
        h('div', { class: 'txt' }, r.text, lead ? h('span', { class: 'first-tag' }, 'first broken rule') : null),
        r.detail ? h('div', { class: 'det mono' }, r.detail) : null,
        !r.pass && (r.evidence || o.loc) ? h('div', { class: 'acts' },
          r.evidence ? btn('Show on the waveform', lead ? 'primary small' : 'ghost small', ev => ctx.showEvidence(sr, r, o.extra, ev.currentTarget), { 'data-tip': 'Replays this seed if needed, then draws the expected signal under the real one' }, 'wave') : null,
          o.replay ? btn('Replay seed ' + sr.seed, 'ghost small', () => ctx.replay(sr.seed, o.extra), null, 'run') : null) : null));
    ul.append(li);
  }
  return ul;
}

function faultBox(sr, loc, ctx) {
  const f = sr.fault;
  if (!f) return null;
  return h('div', { class: 'fault-box' },
    h('div', { class: 'fh' }, icon('alert', { size: 16 }), h('b', null, f.code), h('span', { class: 'mono' }, ' at ' + fmtT(f.time, 4))),
    h('p', null, f.message),
    h('p', { class: 'dim mono' }, 'pc ' + hex(f.pc) + (f.addr !== null && f.addr !== undefined ? ' · address ' + hex(f.addr) : '')),
    loc ? h('div', { class: 'row' }, btn('Go to ' + basename(loc.file) + ':' + loc.line, 'primary small', () => ctx.gotoLine(loc.file, loc.line), null, 'file')) : null);
}

function metrics(sr) {
  if (!sr.metrics || !sr.metrics.length) return null;
  return h('table', { class: 'metrics' }, h('caption', null, 'Measured'), h('tbody', null, sr.metrics.map(m => h('tr', null, h('th', null, m.name), h('td', { class: 'mono' }, m.value)))));
}

function verdict(pass, big, sub) {
  return h('div', { class: 'res-head ' + (pass ? 'pass' : 'fail') },
    h('span', { class: 'v-ico' }, icon(pass ? 'ok' : 'fail', { size: 22 })),
    h('div', null, h('div', { class: 'big' }, big), h('div', { class: 'sub' }, sub)));
}

/** The result of one Run. */
export function renderRun(host, res, ctx) {
  const sr = res.result;
  const failing = sr.rules.filter(r => !r.pass);
  put(host,
    verdict(sr.pass, sr.pass ? 'Seed ' + sr.seed + ' passes' : 'Seed ' + sr.seed + ' fails',
      (sr.pass ? 'every rule holds' : plural(failing.length, 'rule') + ' of ' + sr.rules.length + ' broken') +
      ' · ' + fmtT(sr.end, 3) + ' of emulated time in ' + res.wall_ms + ' ms' + (res.extra ? ' · with your own check' : '')),
    sr.pass ? h('p', { class: 'note' }, icon('info', { size: 14 }), sr.seed === 1
      ? 'This was the visible seed only. Submitting runs the hidden seeds too: different button presses, different timing.'
      : 'This was seed ' + sr.seed + ' only. Submitting checks the visible seed and every hidden seed.') : null,
    faultBox(sr, res.fault_loc, ctx),
    h('div', { class: 'res-cols' }, ruleList(sr, ctx, { extra: res.extra }), metrics(sr)),
    sr.exit_code !== null && sr.exit_code !== undefined ? h('p', { class: 'note' }, icon('warn', { size: 14 }), 'The program exited with code ' + sr.exit_code + ' at ' + fmtT(sr.end, 4) + '. Firmware should never return from main.') : null,
    h('p', { class: 'dim small' }, sizesLine(res.sizes)));
}

/** The result of a Submit: every seed, base and (when asked for) the own check. */
export function renderSubmit(host, res, ctx, sel) {
  const groups = [['Required', res.base, false]];
  if (res.extra) groups.push(['Your own check (optional: it only adds)', res.extra, true]);
  const all = res.base.length;
  const bad = res.base.filter(s => !s.pass);
  const pick = sel || (bad[0] ? { seed: bad[0].seed, extra: false } : res.extra && res.extra.find(s => !s.pass) ? { seed: res.extra.find(s => !s.pass).seed, extra: true } : { seed: res.base[0].seed, extra: false });
  const head = verdict(res.pass, res.pass ? 'Accepted' : 'Not accepted',
    [res.pass ? 'every seed passes (' + all + ': the visible one and ' + (all - 1) + ' hidden)' : bad.length + ' of ' + all + ' seeds fail',
      res.extra_pass === true ? ' · own check passes too' : res.extra_pass === false ? ' · own check fails (it only adds; the task is judged without it)' : '',
      ' · ' + res.wall_ms + ' ms'].join(''));
  const chooser = (s, extra) => () => renderSubmit(host, res, ctx, { seed: s.seed, extra });
  // Overview: one chip per seed, in the order the checker ran them.
  const strips = groups.map(([title, list, extra]) => h('div', { class: 'seed-strip' },
    h('span', { class: 'ss-t' }, title),
    h('div', { class: 'ss-chips', role: 'group', 'aria-label': title + ' seeds' }, list.map((s, i) => {
      const selected = pick.seed === s.seed && pick.extra === extra;
      const b = h('button', { type: 'button', class: 'seed-chip ' + (s.pass ? 'ok' : 'bad') + (selected ? ' sel' : ''), 'aria-pressed': String(selected),
        'data-tip': 'Seed ' + s.seed + (i === 0 && !extra ? ' (visible)' : ' (hidden)') + ': ' + (s.pass ? 'passes' : 'fails') },
        icon(s.pass ? 'check' : 'close', { size: 12 }), String(s.seed), i === 0 && !extra ? h('span', { class: 'vis' }, 'visible') : null);
      b.addEventListener('click', chooser(s, extra));
      return b;
    }))));
  const tables = groups.map(([title, list, extra]) => h('div', { class: 'seeds' },
    groups.length > 1 ? h('h4', null, title) : null,
    h('table', { class: 'seed-t' },
      h('thead', null, h('tr', null, h('th', null, 'Seed'), h('th', null, 'Result'), h('th', null, 'First broken rule'), h('th', null, h('span', { class: 'sr' }, 'Actions')))),
      h('tbody', null, list.map((s, i) => {
        const first = s.rules.find(r => !r.pass);
        const selected = pick.seed === s.seed && pick.extra === extra;
        const tr = h('tr', { class: (s.pass ? 'ok' : 'bad') + (selected ? ' sel' : ''), tabindex: '0', 'aria-selected': String(selected) },
          h('td', { class: 'num' }, String(s.seed), i === 0 && !extra ? h('span', { class: 'vis' }, ' visible') : null),
          h('td', { class: 'res' }, icon(s.pass ? 'check' : 'fail', { size: 13 }), s.pass ? 'pass' : 'fail'),
          h('td', { class: 'first' }, first ? first.text : '—'),
          h('td', { class: 'act' }, btn('Replay', 'ghost small', ev => { ev.stopPropagation(); ctx.replay(s.seed, extra); }, { 'data-tip': 'Run this seed and show its pins' }, 'run')));
        tr.addEventListener('click', chooser(s, extra));
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') chooser(s, extra)(); });
        return tr;
      })))));
  const list = pick.extra ? res.extra : res.base;
  const sr = list.find(s => s.seed === pick.seed) || list[0];
  const detail = h('div', { class: 'seed-detail' },
    h('h4', null, icon(sr.pass ? 'ok' : 'fail', { size: 15 }), 'Seed ' + sr.seed + (pick.extra ? ' · own check' : '') + ': ' + (sr.pass ? 'passes' : 'fails')),
    faultBox(sr, null, ctx),
    ruleList(sr, ctx, { extra: pick.extra, replay: true }),
    metrics(sr));
  put(host, head, strips, h('div', { class: 'res-grid' }, h('div', null, tables), detail), h('p', { class: 'dim small' }, sizesLine(res.sizes)));
}

/** The DBGCON output as lines with the time each one started. */
export function consoleLines(trace) {
  const out = [];
  if (!trace || !trace.console) return out;
  let cur = null;
  for (const [t, kind, v] of trace.console) {
    if (kind === 1) {
      if (cur) { out.push(cur); cur = null; }
      out.push({ t, text: '[word] ' + hex(v) + ' = ' + (v >>> 0) + ((v | 0) < 0 ? ' (' + (v | 0) + ')' : ''), word: true });
      continue;
    }
    if (!cur) cur = { t, text: '' };
    if (v === 10) { out.push(cur); cur = null; continue; }
    if (v === 13) continue;
    cur.text += v >= 32 && v < 127 ? String.fromCharCode(v) : '\\x' + v.toString(16).padStart(2, '0');
  }
  if (cur) out.push(cur);
  return out;
}

export function renderConsole(host, trace, ctx, where) {
  const lines = consoleLines(trace);
  if (!trace) {
    put(host, h('div', { class: 'pempty' }, icon('console', { size: 22 }), h('b', null, 'No console output yet'), h('span', null, 'Anything the firmware writes to DBGCON.PUTC or DBGCON.PUTW shows up here, with the time it happened.')));
    return;
  }
  if (!lines.length) {
    put(host, h('p', { class: 'dim bpad' }, 'The firmware wrote nothing to the debug console' + (where ? ' ' + where : '') + '.'));
    return;
  }
  put(host, h('div', { class: 'con' }, lines.map(l => {
    const row = h('div', { class: 'conl' + (l.word ? ' w' : ''), tabindex: '0', 'data-tip': 'Put cursor A at ' + fmtT(l.t, 4) }, h('span', { class: 'ct' }, fmtT(l.t, 4)), h('span', { class: 'cx' }, l.text || ' '));
    row.addEventListener('click', () => ctx.cursorAt(l.t));
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter') ctx.cursorAt(l.t); });
    return row;
  })));
}
