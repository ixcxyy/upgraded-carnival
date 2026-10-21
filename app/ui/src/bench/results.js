// What the checker said: one seed's rules (a Run) or every seed's (a Submit). A failing
// rule with evidence can be shown on the waveform, where the expected signal is drawn
// under the real one.

import { h, put, btn, fmtT, hex, plural, basename } from './util.js';

function sizesLine(sz) {
  if (!sz) return null;
  const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  return 'Flash ' + kb(sz.flash) + ' of 256 KB · RAM ' + kb(sz.ram) + ' of 64 KB (not counting the stack)';
}

function ruleList(sr, ctx, opts) {
  const o = opts || {};
  const ul = h('ul', { class: 'rules' });
  for (const r of sr.rules) {
    const li = h('li', { class: r.pass ? 'ok' : 'bad' },
      h('span', { class: 'mark', 'aria-label': r.pass ? 'passed' : 'failed' }, r.pass ? '✓' : '✗'),
      h('div', { class: 'body' },
        h('div', { class: 'txt' }, r.text),
        r.detail ? h('div', { class: 'det' }, r.detail) : null,
        !r.pass && r.evidence ? h('div', { class: 'acts' },
          btn('Show it on the waveform', 'ghost small', () => ctx.showEvidence(sr, r, o.extra))) : null));
    ul.append(li);
  }
  return ul;
}

function faultBox(sr, loc, ctx) {
  const f = sr.fault;
  if (!f) return null;
  return h('div', { class: 'fault-box' },
    h('div', { class: 'fh' }, h('b', null, f.code), ' at ', fmtT(f.time, 4)),
    h('p', null, f.message),
    h('p', { class: 'dim' }, 'pc ' + hex(f.pc) + (f.addr !== null && f.addr !== undefined ? ' · address ' + hex(f.addr) : '')),
    loc ? h('div', { class: 'row' }, btn('Go to ' + basename(loc.file) + ':' + loc.line, 'ghost small', () => ctx.gotoLine(loc.file, loc.line))) : null);
}

function metrics(sr) {
  if (!sr.metrics || !sr.metrics.length) return null;
  return h('table', { class: 'metrics' }, h('tbody', null, sr.metrics.map(m => h('tr', null, h('th', null, m.name), h('td', null, m.value)))));
}

/** The result of one Run. */
export function renderRun(host, res, ctx) {
  const sr = res.result;
  const failing = sr.rules.filter(r => !r.pass);
  put(host, 
    h('div', { class: 'res-head ' + (sr.pass ? 'pass' : 'fail') },
      h('span', { class: 'big' }, sr.pass ? 'Seed ' + sr.seed + ' passes' : 'Seed ' + sr.seed + ' fails'),
      h('span', { class: 'sub' },
        (sr.pass ? 'every rule holds' : plural(failing.length, 'rule') + ' of ' + sr.rules.length + ' broken') +
        ' · ' + fmtT(sr.end, 3) + ' of emulated time in ' + res.wall_ms + ' ms' + (res.extra ? ' · with your own check' : ''))),
    sr.pass ? h('p', { class: 'dim' }, 'This was the visible seed only. Submitting runs the hidden seeds too: different button presses, different timing.') : null,
    faultBox(sr, res.fault_loc, ctx),
    ruleList(sr, ctx, { extra: res.extra }),
    metrics(sr),
    sr.exit_code !== null && sr.exit_code !== undefined ? h('p', { class: 'dim' }, 'The program exited with code ' + sr.exit_code + ' at ' + fmtT(sr.end, 4) + '. Firmware should never return from main.') : null,
    h('p', { class: 'dim small' }, sizesLine(res.sizes)));
}

/** The result of a Submit: every seed, base and (when asked for) the own check. */
export function renderSubmit(host, res, ctx, sel) {
  const groups = [['Required', res.base, false]];
  if (res.extra) groups.push(['Your own check', res.extra, true]);
  const all = res.base.length;
  const bad = res.base.filter(s => !s.pass);
  const pick = sel || (bad[0] ? { seed: bad[0].seed, extra: false } : res.extra && res.extra.find(s => !s.pass) ? { seed: res.extra.find(s => !s.pass).seed, extra: true } : { seed: res.base[0].seed, extra: false });
  const head = h('div', { class: 'res-head ' + (res.pass ? 'pass' : 'fail') },
    h('span', { class: 'big' }, res.pass ? 'Accepted' : 'Not accepted'),
    h('span', { class: 'sub' },
      res.pass ? 'every seed passes (' + all + ': the visible one and ' + (all - 1) + ' hidden)' : bad.length + ' of ' + all + ' seeds fail',
      res.extra_pass === true ? ' · own check passes too' : res.extra_pass === false ? ' · own check fails (it only adds; the task is judged without it)' : '',
      ' · ' + res.wall_ms + ' ms'));
  const tables = groups.map(([title, list, extra]) => h('div', { class: 'seeds' },
    groups.length > 1 ? h('h4', null, title) : null,
    h('table', { class: 'seed-t' },
      h('thead', null, h('tr', null, h('th', null, 'Seed'), h('th', null, 'Result'), h('th', null, 'First broken rule'), h('th', null, ''))),
      h('tbody', null, list.map((s, i) => {
        const first = s.rules.find(r => !r.pass);
        const selected = pick.seed === s.seed && pick.extra === extra;
        const tr = h('tr', { class: (s.pass ? 'ok' : 'bad') + (selected ? ' sel' : ''), tabindex: '0' },
          h('td', { class: 'num' }, String(s.seed), i === 0 && !extra ? h('span', { class: 'vis' }, ' visible') : null),
          h('td', null, s.pass ? '✓ pass' : '✗ fail'),
          h('td', { class: 'first' }, first ? first.text : '—'),
          h('td', { class: 'act' }, btn('Replay', 'ghost small', ev => { ev.stopPropagation(); ctx.replay(s.seed, extra); }, { title: 'Run this seed and show its pins' })));
        const choose = () => renderSubmit(host, res, ctx, { seed: s.seed, extra });
        tr.addEventListener('click', choose);
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') choose(); });
        return tr;
      })))));
  const list = pick.extra ? res.extra : res.base;
  const sr = list.find(s => s.seed === pick.seed) || list[0];
  const detail = h('div', { class: 'seed-detail' },
    h('h4', null, 'Seed ' + sr.seed + (pick.extra ? ' · own check' : '') + ': ' + (sr.pass ? 'passes' : 'fails')),
    faultBox(sr, null, ctx),
    ruleList(sr, ctx, { extra: pick.extra }),
    metrics(sr));
  put(host, head, h('div', { class: 'res-grid' }, h('div', null, tables), detail), h('p', { class: 'dim small' }, sizesLine(res.sizes)));
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
    put(host, h('p', { class: 'dim bpad' }, 'Nothing yet. Anything the firmware writes to DBGCON.PUTC or DBGCON.PUTW shows up here, with the time it happened.'));
    return;
  }
  if (!lines.length) {
    put(host, h('p', { class: 'dim bpad' }, 'The firmware wrote nothing to the debug console' + (where ? ' ' + where : '') + '.'));
    return;
  }
  put(host, h('div', { class: 'con' }, lines.map(l => {
    const row = h('div', { class: 'cl' + (l.word ? ' w' : '') }, h('span', { class: 'ct' }, fmtT(l.t, 4)), h('span', { class: 'cx' }, l.text || ' '));
    row.addEventListener('click', () => ctx.cursorAt(l.t));
    return row;
  })));
}
