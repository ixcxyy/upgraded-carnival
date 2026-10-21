// The logic analyser: every pin the run touched, interrupt activity, the debug console and
// probe halts on one time axis. Wheel zooms, drag pans, click places cursor A, right-click
// (or shift-click) cursor B; both snap to the nearest edge. A failing rule's evidence is drawn
// as an "expected" lane under the pin it is about, with every mismatch shaded.

import { h, btn, fmtT, fmtF, VECTORS } from './util.js';

const LABEL_W = 148;
const AXIS_H = 26;
const ROW_H = { pin: 30, expect: 22, isr: 20, console: 22, marks: 20 };
const MIN_SPAN = 20; // cycles (200 ns) across the plot at most zoom

function upper(arr, v, lo = 0, hi = arr.length) {
  // First index with arr[i] > v.
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (arr[m] <= v) lo = m + 1; else hi = m;
  }
  return lo;
}
function lower(arr, v, lo = 0, hi = arr.length) {
  // First index with arr[i] >= v.
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (arr[m] < v) lo = m + 1; else hi = m;
  }
  return lo;
}

function niceStep(minCycles) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(minCycles, 1))));
  for (const m of [1, 2, 5, 10]) if (m * p >= minCycles) return m * p;
  return 10 * p;
}

/** Tick labels: the unit follows the largest visible time, the decimals follow the step. */
function tickFmt(tMax, step) {
  const U = tMax >= 1e8 ? [1e8, ' s'] : tMax >= 1e5 ? [1e5, ' ms'] : tMax >= 100 ? [100, ' µs'] : [0.1, ' ns'];
  const d = Math.min(9, Math.max(0, Math.ceil(Math.log10(U[0] / step) - 1e-9)));
  return t => (t / U[0]).toFixed(d) + U[1];
}

function levelName(l) {
  return l === 1 ? 'HIGH' : l === 0 ? 'LOW' : 'floating';
}

function css(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export class Wave {
  constructor(host, hooks) {
    this.hooks = hooks || {};
    this.rows = [];
    this.trace = null;
    this.evidence = null;
    this.v0 = 0;
    this.span = 1e5;
    this.end = 0;
    this.duration = 0;
    this.now = null;
    this.curA = null;
    this.curB = null;
    this.hover = null;
    this.sel = 0;
    this.raf = 0;
    this.empty = 'Run the firmware to see its pins here.';

    this.readout = h('span', { class: 'wave-read' });
    this.hoverOut = h('span', { class: 'wave-hover' });
    this.gotoBtn = btn('Go to cursor', 'ghost small', () => this.curA !== null && this.hooks.onGoto && this.hooks.onGoto(Math.round(this.curA)),
      { title: 'Travel the debug session to the time at cursor A (forwards or backwards)', hidden: true });
    this.bar = h('div', { class: 'wave-bar' },
      h('div', { class: 'grp' },
        btn('Fit', 'ghost small', () => this.fit(), { title: 'Show the whole run (double-click the trace)' }),
        btn('−', 'ghost small icon', () => this.zoom(1.6), { title: 'Zoom out (wheel down)' }),
        btn('+', 'ghost small icon', () => this.zoom(1 / 1.6), { title: 'Zoom in (wheel up)' }),
        btn('◂ Edge', 'ghost small', () => this.edge(-1), { title: 'Move cursor A to the previous edge on the selected row (←)' }),
        btn('Edge ▸', 'ghost small', () => this.edge(1), { title: 'Move cursor A to the next edge on the selected row (→)' }),
        this.gotoBtn),
      this.readout,
      this.hoverOut);
    this.axis = h('canvas', { class: 'wave-axis' });
    this.canvas = h('canvas', { class: 'wave-rows', tabindex: '0', 'aria-label': 'Waveform. Arrow keys move between edges, plus and minus zoom.' });
    this.scroll = h('div', { class: 'wave-scroll' }, this.canvas);
    this.msg = h('div', { class: 'wave-empty' }, this.empty);
    this.el = h('div', { class: 'wave' }, this.bar, h('div', { class: 'wave-view' }, this.axis, this.scroll, this.msg));
    host.append(this.el);

    this.bindMouse(this.canvas, false);
    this.bindMouse(this.axis, true);
    this.canvas.addEventListener('keydown', ev => this.onKey(ev));
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(this.el);
    this.updateReadout();
  }

  // ── data ──

  /** trace: the JSON from a run or a debug session. order: board pin numbers in board order. */
  setTrace(trace, opts) {
    const o = opts || {};
    const keepView = !!o.keepView && this.trace;
    this.trace = trace;
    this.rows = [];
    if (!trace) {
      this.msg.textContent = o.empty || this.empty;
      this.msg.hidden = false;
      this.schedule();
      return;
    }
    this.msg.hidden = true;
    this.end = trace.end || 0;
    this.duration = trace.duration || this.end;
    const order = o.order || [];
    const pins = trace.pins.slice().sort((a, b) => {
      const ia = order.indexOf(a.pin), ib = order.indexOf(b.pin);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      return a.pin - b.pin;
    });
    for (const p of pins) {
      const n = p.ch.length >> 1;
      const t = new Float64Array(n), l = new Uint8Array(n);
      for (let i = 0; i < n; i++) { t[i] = p.ch[2 * i]; l[i] = p.ch[2 * i + 1]; }
      this.rows.push({ kind: 'pin', pin: p.pin, name: p.name, label: p.label || '', dir: p.dir || '', board: p.board, t, l });
    }
    // Interrupts: one lane per vector that ran.
    const byVec = new Map();
    for (const [v, a, b] of trace.isrs || []) {
      if (!byVec.has(v)) byVec.set(v, []);
      byVec.get(v).push([a, b === null ? Infinity : b]);
    }
    for (const v of Array.from(byVec.keys()).sort((a, b) => a - b)) {
      const spans = byVec.get(v);
      this.rows.push({ kind: 'isr', vector: v, spans, starts: Float64Array.from(spans.map(s => s[0])) });
    }
    if (trace.console && trace.console.length) {
      this.rows.push({ kind: 'console', ev: trace.console, t: Float64Array.from(trace.console.map(e => e[0])) });
    }
    if (trace.marks && trace.marks.length) {
      this.rows.push({ kind: 'marks', ev: trace.marks, t: Float64Array.from(trace.marks.map(e => e[0])) });
    }
    this.contention = (trace.contention || []).filter(c => c[2]);
    this.halts = trace.halts || [];
    this.insertExpect();
    this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
    if (!keepView) this.fit(); else this.schedule();
  }

  setEvidence(ev) {
    this.evidence = ev || null;
    this.insertExpect();
    if (ev) {
      const pad = Math.max((ev.t1 - ev.t0) * 0.08, 50);
      this.zoomTo(Math.max(0, ev.t0 - pad), ev.t1 + pad);
      this.curA = ev.at;
      this.curB = null;
      this.updateReadout();
    }
    this.schedule();
  }

  insertExpect() {
    this.rows = this.rows.filter(r => r.kind !== 'expect');
    if (!this.evidence || !this.evidence.tracks) return;
    for (const tr of this.evidence.tracks) {
      const i = this.rows.findIndex(r => r.kind === 'pin' && r.pin === tr.pin);
      const row = { kind: 'expect', pin: tr.pin, segs: tr.segs };
      if (i >= 0) this.rows.splice(i + 1, 0, row);
      else this.rows.unshift(row);
    }
  }

  setNow(t) {
    this.now = t === null || t === undefined ? null : t;
    this.gotoBtn.hidden = this.now === null;
    this.schedule();
  }

  // ── view ──

  width() {
    return Math.max(50, this.scroll.clientWidth || this.el.clientWidth);
  }

  plotW() {
    return Math.max(10, this.width() - LABEL_W - 12);
  }

  xOf(t) {
    return LABEL_W + (t - this.v0) * (this.plotW() / this.span);
  }

  tOf(x) {
    return this.v0 + (x - LABEL_W) * (this.span / this.plotW());
  }

  fit() {
    const end = Math.max(this.end, this.now || 0, 100);
    this.v0 = 0;
    this.span = end * 1.02;
    this.schedule();
  }

  zoomTo(t0, t1) {
    this.v0 = t0;
    this.span = Math.max(MIN_SPAN, t1 - t0);
    this.clamp();
    this.schedule();
  }

  zoom(f, atX) {
    const x = atX === undefined ? LABEL_W + this.plotW() / 2 : atX;
    const t = this.tOf(x);
    this.span = Math.min(Math.max(this.span * f, MIN_SPAN), Math.max(this.end, this.duration, 1000) * 4);
    this.v0 = t - (x - LABEL_W) * (this.span / this.plotW());
    this.clamp();
    this.schedule();
  }

  clamp() {
    const maxT = Math.max(this.end, this.duration, this.now || 0, 100);
    if (this.v0 < -this.span * 0.05) this.v0 = -this.span * 0.05;
    if (this.v0 > maxT - this.span * 0.05) this.v0 = maxT - this.span * 0.05;
  }

  /** Put cursor A at t and make sure it is on screen. */
  cursorTo(t) {
    this.curA = t;
    if (t < this.v0 || t > this.v0 + this.span) this.v0 = t - this.span / 2;
    this.clamp();
    this.updateReadout();
    this.schedule();
  }

  edge(dir) {
    const r = this.rows[this.sel];
    if (!r) return;
    const arr = r.kind === 'pin' ? r.t : r.kind === 'isr' ? r.starts : r.t;
    if (!arr || !arr.length) return;
    const from = this.curA === null ? (dir > 0 ? this.v0 : this.v0 + this.span) : this.curA;
    let t = null;
    if (dir > 0) {
      const i = upper(arr, from);
      if (i < arr.length) t = arr[i];
    } else {
      const i = lower(arr, from) - 1;
      if (i >= 0) t = arr[i];
    }
    if (t === null) return;
    if (r.kind === 'pin' && t === 0 && dir < 0) return;
    this.cursorTo(t);
  }

  // ── input ──

  bindMouse(el, isAxis) {
    let drag = null;
    el.addEventListener('mousedown', ev => {
      if (ev.button === 2) return;
      if (!isAxis) this.canvas.focus({ preventScroll: true });
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      if (!isAxis && x < LABEL_W) {
        const r = this.rowAt(y);
        if (r >= 0) { this.sel = r; this.schedule(); }
        return;
      }
      drag = { x0: ev.clientX, v0: this.v0, moved: false, y };
      const move = e => {
        const dx = e.clientX - drag.x0;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved) {
          this.v0 = drag.v0 - dx * (this.span / this.plotW());
          this.clamp();
          this.schedule();
        }
      };
      const up = e => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (!drag.moved) {
          const r2 = el.getBoundingClientRect();
          const t = this.snap(e.clientX - r2.left, isAxis ? -1 : this.rowAt(drag.y));
          if (e.shiftKey) this.curB = t; else this.curA = t;
          if (!isAxis) {
            const r = this.rowAt(drag.y);
            if (r >= 0) this.sel = r;
          }
          this.updateReadout();
          this.schedule();
          if (!e.shiftKey && this.hooks.onCursor) this.hooks.onCursor(t);
        }
        drag = null;
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      if (x < LABEL_W) return;
      this.curB = this.snap(x, isAxis ? -1 : this.rowAt(y));
      this.updateReadout();
      this.schedule();
    });
    el.addEventListener('wheel', ev => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) {
        const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        this.v0 += d * (this.span / this.plotW());
        this.clamp();
        this.schedule();
        ev.preventDefault();
        return;
      }
      if (ev.altKey) return; // let the rows scroll
      ev.preventDefault();
      const f = Math.pow(1.0018, ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY);
      this.zoom(f, Math.max(x, LABEL_W));
    }, { passive: false });
    el.addEventListener('mousemove', ev => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      this.hover = x >= LABEL_W ? { t: this.tOf(x), row: isAxis ? -1 : this.rowAt(y) } : null;
      this.updateHover();
      this.schedule();
    });
    el.addEventListener('mouseleave', () => {
      this.hover = null;
      this.updateHover();
      this.schedule();
    });
    el.addEventListener('dblclick', ev => {
      const rect = el.getBoundingClientRect();
      if (ev.clientX - rect.left >= LABEL_W) this.fit();
    });
  }

  onKey(ev) {
    if (ev.key === 'ArrowRight') { this.edge(1); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { this.edge(-1); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { this.sel = Math.max(0, this.sel - 1); this.schedule(); ev.preventDefault(); }
    else if (ev.key === 'ArrowDown') { this.sel = Math.min(this.rows.length - 1, this.sel + 1); this.schedule(); ev.preventDefault(); }
    else if (ev.key === '+' || ev.key === '=') { this.zoom(1 / 1.6, this.curA !== null ? this.xOf(this.curA) : undefined); ev.preventDefault(); }
    else if (ev.key === '-' || ev.key === '_') { this.zoom(1.6, this.curA !== null ? this.xOf(this.curA) : undefined); ev.preventDefault(); }
    else if (ev.key === '0' || ev.key === 'f') { this.fit(); ev.preventDefault(); }
  }

  rowAt(y) {
    let top = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const hh = ROW_H[this.rows[i].kind];
      if (y >= top && y < top + hh) return i;
      top += hh;
    }
    return -1;
  }

  /** The time under x, snapped to the nearest edge (within 6 px) on the given row, or on any pin row. */
  snap(x, rowIdx) {
    const t = this.tOf(x);
    const tol = 6 * (this.span / this.plotW());
    let best = null;
    const consider = arr => {
      if (!arr || !arr.length) return;
      const i = lower(arr, t);
      for (const j of [i - 1, i]) {
        if (j >= 0 && j < arr.length && arr[j] > 0) {
          const d = Math.abs(arr[j] - t);
          if (d <= tol && (best === null || d < Math.abs(best - t))) best = arr[j];
        }
      }
    };
    const rows = rowIdx >= 0 ? [this.rows[rowIdx]] : this.rows.filter(r => r.kind === 'pin');
    for (const r of rows) {
      if (!r) continue;
      if (r.kind === 'pin' || r.kind === 'console' || r.kind === 'marks') consider(r.t);
      if (r.kind === 'isr') {
        consider(r.starts);
        consider(Float64Array.from(r.spans.map(s => s[1]).filter(isFinite)));
      }
      if (r.kind === 'expect') consider(Float64Array.from(r.segs.map(s => s[0])));
    }
    return Math.max(0, Math.round(best === null ? t : best));
  }

  levelAt(row, t) {
    const i = upper(row.t, t) - 1;
    return i >= 0 ? row.l[i] : row.l[0];
  }

  /** The constant-level stretch of a pin row around t: [start, end, level]. */
  segmentAt(row, t) {
    const i = Math.max(0, upper(row.t, t) - 1);
    const start = row.t[i];
    const end = i + 1 < row.t.length ? row.t[i + 1] : null;
    return [start, end, row.l[i]];
  }

  updateReadout() {
    const parts = [];
    if (this.curA !== null) parts.push(h('span', { class: 'ca' }, 'A ' + fmtT(this.curA, 4)));
    if (this.curB !== null) parts.push(h('span', { class: 'cb' }, 'B ' + fmtT(this.curB, 4)));
    if (this.curA !== null && this.curB !== null) {
      const d = Math.abs(this.curB - this.curA);
      parts.push(h('span', { class: 'cd' }, 'Δ ' + fmtT(d, 4) + (d > 0 ? ' · ' + fmtF(d) : '')));
    }
    if (!parts.length) parts.push(h('span', { class: 'hint' }, 'Click: cursor A · right-click: cursor B · wheel: zoom · drag: pan'));
    this.readout.replaceChildren(...parts);
  }

  updateHover() {
    const hv = this.hover;
    if (!hv || !this.trace) { this.hoverOut.textContent = ''; return; }
    const r = this.rows[hv.row];
    let s = fmtT(Math.max(0, hv.t), 4);
    if (r && r.kind === 'pin' && hv.t >= 0 && hv.t <= this.end) {
      const [a, b, l] = this.segmentAt(r, hv.t);
      s += ' · ' + (r.label || r.name) + ' ' + levelName(l) + (b !== null ? ' for ' + fmtT(b - a, 4) : ' since ' + fmtT(a, 4));
    } else if (r && r.kind === 'isr') {
      const sp = r.spans.find(x => x[0] <= hv.t && hv.t < x[1]);
      if (sp) s += ' · in the ' + (VECTORS[r.vector] || 'vector ' + r.vector) + ' handler' + (isFinite(sp[1]) ? ' for ' + fmtT(sp[1] - sp[0], 4) : '');
    }
    this.hoverOut.textContent = s;
  }

  // ── drawing ──

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = this.width();
    const rowsH = this.rows.reduce((s, r) => s + ROW_H[r.kind], 0);
    const H = Math.max(rowsH, 10);
    for (const [c, hh] of [[this.axis, AXIS_H], [this.canvas, H]]) {
      const w = Math.round(W * dpr), hp = Math.round(hh * dpr);
      if (c.width !== w || c.height !== hp) { c.width = w; c.height = hp; }
      c.style.width = W + 'px';
      c.style.height = hh + 'px';
    }
    const C = {
      ink: css(this.el, '--ink', '#222'),
      ink2: css(this.el, '--ink-2', '#555'),
      ink3: css(this.el, '--ink-3', '#888'),
      rule: css(this.el, '--rule', '#ccc'),
      sig: css(this.el, '--trace', '#1D5AA6'),
      grid: css(this.el, '--trace-grid', 'rgba(0,0,0,0.06)'),
      exp: css(this.el, '--accent', '#245C63'),
      red: css(this.el, '--red', '#A8321F'),
      bg: css(this.el, '--code-bg', '#fff'),
      sel: css(this.el, '--code-active', 'rgba(0,0,0,0.04)'),
      z: css(this.el, '--wave-z', '#B7862B'),
      fill: css(this.el, '--wave-fill', 'rgba(29, 90, 166, 0.10)'),
      curB: css(this.el, '--wave-b', '#8A4FB0'),
      mono: css(this.el, '--f-mono', 'monospace'),
    };
    this.drawAxis(dpr, W, C);
    this.drawRows(dpr, W, H, C);
  }

  ticks() {
    const pxPer = this.plotW() / this.span;
    const step = niceStep(90 / pxPer);
    const first = Math.ceil(this.v0 / step) * step;
    const out = [];
    for (let t = first; t <= this.v0 + this.span; t += step) out.push(t);
    return { step, list: out };
  }

  drawAxis(dpr, W, C) {
    const g = this.axis.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, AXIS_H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, AXIS_H);
    g.strokeStyle = C.rule;
    g.beginPath();
    g.moveTo(0, AXIS_H - 0.5);
    g.lineTo(W, AXIS_H - 0.5);
    g.stroke();
    if (!this.trace) return;
    g.font = '11px ' + C.mono;
    g.fillStyle = C.ink3;
    g.textBaseline = 'middle';
    const { step, list } = this.ticks();
    const fmt = tickFmt(this.v0 + this.span, step);
    for (const t of list) {
      const x = this.xOf(t);
      if (x < LABEL_W - 1) continue;
      g.fillRect(Math.round(x), AXIS_H - 6, 1, 6);
      g.fillText(fmt(t), x + 3, AXIS_H / 2 - 1);
    }
    g.fillStyle = C.ink3;
    g.fillText('time', 10, AXIS_H / 2 - 1);
    for (const [s, e] of this.halts) this.band(g, s, e, AXIS_H, 'rgba(183,134,43,0.18)', W);
    this.drawMarkers(g, AXIS_H, W, C, true);
  }

  band(g, s, e, H, color, W) {
    const x0 = Math.max(LABEL_W, this.xOf(s)), x1 = Math.min(W, this.xOf(e));
    if (x1 <= x0) return;
    g.fillStyle = color;
    g.fillRect(x0, 0, Math.max(1, x1 - x0), H);
  }

  drawMarkers(g, H, W, C, axis) {
    const placed = [];
    const line = (t, color, label, dash) => {
      if (t === null || t === undefined) return;
      const x = Math.round(this.xOf(t)) + 0.5;
      if (x < LABEL_W || x > W) return;
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash(dash || []);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.setLineDash([]);
      if (axis && label) {
        const tw = g.measureText(label).width + 8;
        // Stack labels that would overlap (a cursor sitting on the evidence mark, say).
        let row = 0;
        while (placed.some(p => p.row === row && x < p.x1 + 2 && x + tw > p.x0 - 2) && row < 1) row++;
        placed.push({ x0: x, x1: x + tw, row });
        const y = 1 + row * 12;
        g.fillStyle = color;
        g.fillRect(x, y, tw, 12);
        g.fillStyle = C.bg;
        g.fillText(label, x + 4, y + 6.5);
      }
    };
    if (this.evidence) line(this.evidence.at, C.red, 'here', [3, 3]);
    if (this.now !== null) line(this.now, C.exp, 'now');
    line(this.curA, C.ink, 'A');
    line(this.curB, C.curB, 'B');
    if (this.hover && !axis) line(this.hover.t, C.ink3, null, [2, 3]);
  }

  drawRows(dpr, W, H, C) {
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    if (!this.trace) return;
    // Grid.
    g.fillStyle = C.grid;
    for (const t of this.ticks().list) {
      const x = Math.round(this.xOf(t));
      if (x >= LABEL_W) g.fillRect(x, 0, 1, H);
    }
    // After the end of the recording.
    const xe = this.xOf(this.end);
    if (xe < W) {
      g.fillStyle = C.grid;
      for (let x = Math.max(LABEL_W, Math.floor(xe)); x < W; x += 6) g.fillRect(x, 0, 1, H);
    }
    for (const [s, e] of this.halts) this.band(g, s, e, H, 'rgba(183,134,43,0.12)', W);
    this.missCache = new Map();
    if (this.evidence) for (const tr of this.evidence.tracks || []) this.missCache.set(tr.pin, this.mismatches(tr.pin));
    let top = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const hh = ROW_H[r.kind];
      if (i === this.sel) {
        g.fillStyle = C.sel;
        g.fillRect(0, top, W, hh);
      }
      g.save();
      g.beginPath();
      g.rect(LABEL_W, top, W - LABEL_W, hh);
      g.clip();
      if (r.kind === 'pin') this.drawPin(g, r, top, hh, W, C);
      else if (r.kind === 'expect') this.drawExpect(g, r, top, hh, W, C);
      else if (r.kind === 'isr') this.drawIsr(g, r, top, hh, W, C);
      else if (r.kind === 'console') this.drawEvents(g, r, top, hh, W, C, true);
      else if (r.kind === 'marks') this.drawEvents(g, r, top, hh, W, C, false);
      g.restore();
      this.drawLabel(g, r, top, hh, C, i === this.sel);
      g.fillStyle = C.rule;
      g.fillRect(0, top + hh - 1, W, 1);
      top += hh;
    }
    g.fillStyle = C.rule;
    g.fillRect(LABEL_W - 1, 0, 1, H);
    this.drawMarkers(g, H, W, C, false);
  }

  drawLabel(g, r, top, hh, C, selected) {
    g.fillStyle = C.bg;
    g.fillRect(0, top, LABEL_W - 1, hh - 1);
    if (selected) {
      g.fillStyle = C.sel;
      g.fillRect(0, top, LABEL_W - 1, hh - 1);
      g.fillStyle = C.exp;
      g.fillRect(0, top, 3, hh - 1);
    }
    g.textBaseline = 'middle';
    const mid = top + hh / 2;
    if (r.kind === 'pin') {
      g.font = '600 12px ' + C.mono;
      g.fillStyle = r.board ? C.ink : C.ink2;
      const main = r.label || r.name;
      g.fillText(main, 10, mid);
      const w = g.measureText(main).width;
      g.font = '11px ' + C.mono;
      g.fillStyle = C.ink3;
      const sub = (r.label ? r.name : '') + (r.dir === 'in' ? ' ←' : r.dir === 'out' ? ' →' : '') + (r.board ? '' : 'n.c.');
      g.fillText(sub, 16 + w, mid);
    } else {
      g.font = '11px ' + C.mono;
      g.fillStyle = r.kind === 'expect' ? C.exp : C.ink3;
      const txt = r.kind === 'expect' ? '  expected'
        : r.kind === 'isr' ? 'ISR ' + (VECTORS[r.vector] || r.vector)
          : r.kind === 'console' ? 'DBGCON' : 'MARK';
      g.fillText(txt, 10, mid);
    }
  }

  drawPin(g, r, top, hh, W, C) {
    const n = r.t.length;
    if (!n) return;
    this.shadeMiss(g, r.pin, top, hh, W);
    const yH = top + 6, yL = top + hh - 7, yZ = top + hh / 2;
    const yOf = l => (l === 1 ? yH : l === 0 ? yL : yZ);
    const pxPer = this.plotW() / this.span;
    const vEnd = Math.min(this.v0 + this.span * 1.01 + 1 / pxPer, this.end);
    const xEnd = this.xOf(vEnd);
    const segs = []; // [x0, x1, level]
    const busy = []; // [x0, x1]
    let i = upper(r.t, this.v0);
    let cur = i > 0 ? r.l[i - 1] : r.l[0];
    let x = Math.max(LABEL_W, this.xOf(Math.max(this.v0, r.t[0])));
    const edges = []; // [x, from, to]
    while (i < n && r.t[i] <= vEnd) {
      const xi = this.xOf(r.t[i]);
      if (i + 1 < n && r.t[i + 1] <= vEnd && (this.xOf(r.t[i + 1]) - xi) < 1) {
        // Several edges inside one pixel: draw a solid block until the edges spread out again.
        const px = Math.floor(xi);
        let j = i, bx0 = px, bx1 = px + 1;
        for (;;) {
          // First edge at or after the block's right boundary.
          j = lower(r.t, this.tOf(bx1), j + 1);
          if (j >= n || r.t[j] > vEnd) break;
          const xj = this.xOf(r.t[j]);
          if (xj >= bx1 + 1) break; // a quiet stretch follows: the block ends here
          bx1 = Math.floor(xj) + 1;
        }
        segs.push([x, bx0, cur]);
        busy.push([bx0, bx1]);
        cur = r.l[j - 1];
        x = bx1;
        i = j;
        continue;
      }
      segs.push([x, xi, cur]);
      edges.push([xi, cur, r.l[i]]);
      cur = r.l[i];
      x = xi;
      i++;
    }
    segs.push([x, Math.min(xEnd, W + 2), cur]);
    // High fill.
    g.fillStyle = C.fill;
    for (const [a, b, l] of segs) if (l === 1 && b > a) g.fillRect(a, yH, b - a, yL - yH);
    // Lines.
    g.lineWidth = 1.5;
    g.strokeStyle = C.sig;
    g.beginPath();
    for (const [a, b, l] of segs) {
      if (b <= a || l === 2) continue;
      g.moveTo(a, yOf(l));
      g.lineTo(b, yOf(l));
    }
    for (const [xe, from, to] of edges) {
      if (from === 2 || to === 2) continue;
      g.moveTo(xe, yOf(from));
      g.lineTo(xe, yOf(to));
    }
    g.stroke();
    // Floating stretches: a dashed amber line through the middle.
    g.strokeStyle = C.z;
    g.setLineDash([4, 3]);
    g.beginPath();
    for (const [a, b, l] of segs) {
      if (b <= a || l !== 2) continue;
      g.moveTo(a, yZ);
      g.lineTo(b, yZ);
    }
    for (const [xe, from, to] of edges) {
      if (from !== 2 && to !== 2) continue;
      g.moveTo(xe, yOf(from));
      g.lineTo(xe, yOf(to));
    }
    g.stroke();
    g.setLineDash([]);
    // Dense stretches.
    g.fillStyle = C.sig;
    for (const [a, b] of busy) g.fillRect(a, yH, Math.max(1, b - a), yL - yH);
    // Contention on this pin.
    if (this.contention) {
      g.fillStyle = C.red;
      for (const [t, pin] of this.contention) {
        if (pin !== r.pin) continue;
        const xc = this.xOf(t);
        if (xc < LABEL_W - 5 || xc > W + 5) continue;
        g.beginPath();
        g.moveTo(xc - 5, top + 1);
        g.lineTo(xc + 5, top + 1);
        g.lineTo(xc, top + 9);
        g.closePath();
        g.fill();
      }
    }
    // Level labels when zoomed in enough to read them.
    g.font = '10px ' + C.mono;
    g.fillStyle = C.ink3;
    g.textBaseline = 'middle';
    for (const [a, b, l] of segs) {
      if (b - a > 150) {
        const lab = fmtT(this.tOf(b) - this.tOf(a), 3);
        const x0 = Math.max(a, LABEL_W) + 6;
        if (Math.min(b, W) - x0 > g.measureText(lab).width + 10) g.fillText(lab, x0, l === 1 ? yH + 8 : l === 0 ? yL - 8 : yZ - 7);
      }
    }
  }

  /** Where the pin's actual level differs from a required one, inside the view: [[t0, t1]]. */
  mismatches(pinNo) {
    const out = [];
    if (!this.evidence) return out;
    const pin = this.rows.find(x => x.kind === 'pin' && x.pin === pinNo);
    const exp = this.evidence.tracks.find(x => x.pin === pinNo);
    if (!pin || !exp || !pin.t.length) return out;
    const v1 = this.v0 + this.span * 1.02;
    for (const [s, e, l] of exp.segs) {
      if (l === 3 || e < this.v0 || s > v1) continue;
      const tStart = Math.max(s, this.v0), tEnd = Math.min(e, v1, this.end);
      let i = Math.max(0, upper(pin.t, tStart) - 1);
      let t = tStart;
      while (t < tEnd && i < pin.t.length) {
        const next = i + 1 < pin.t.length ? Math.min(pin.t[i + 1], tEnd) : tEnd;
        if (pin.l[i] !== l && next > t) {
          const last = out[out.length - 1];
          if (last && last[1] >= t) last[1] = next; else out.push([t, next]);
        }
        t = next;
        i++;
      }
    }
    return out;
  }

  shadeMiss(g, pinNo, top, hh, W) {
    const miss = this.missCache && this.missCache.get(pinNo);
    if (!miss || !miss.length) return;
    g.fillStyle = 'rgba(200, 60, 40, 0.22)';
    for (const [a, b] of miss) {
      const xa = Math.max(LABEL_W, this.xOf(a)), xb = Math.min(W, this.xOf(b));
      g.fillRect(xa, top, Math.max(2, xb - xa), hh - 1);
    }
  }

  drawExpect(g, r, top, hh, W, C) {
    const yH = top + 5, yL = top + hh - 6;
    this.shadeMiss(g, r.pin, top, hh, W);
    const v1 = this.v0 + this.span * 1.02;
    for (const [s, e, l] of r.segs) {
      if (e < this.v0 || s > v1) continue;
      const a = Math.max(LABEL_W - 2, this.xOf(s)), b = Math.min(W + 2, this.xOf(e));
      if (l === 3) {
        // "Either is fine here": hatching.
        g.save();
        g.beginPath();
        g.rect(a, yH, Math.max(1, b - a), yL - yH);
        g.clip();
        g.strokeStyle = C.exp;
        g.globalAlpha = 0.35;
        g.beginPath();
        for (let x = Math.floor(a) - (yL - yH); x < b; x += 6) {
          g.moveTo(x, yL);
          g.lineTo(x + (yL - yH), yH);
        }
        g.stroke();
        g.restore();
        continue;
      }
      g.strokeStyle = C.exp;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a, l === 1 ? yH : yL);
      g.lineTo(b, l === 1 ? yH : yL);
      g.stroke();
    }
    // Vertical joins between expected segments.
    g.strokeStyle = C.exp;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k < r.segs.length; k++) {
      const [s, , l] = r.segs[k];
      const pl = r.segs[k - 1][2];
      if (l === 3 || pl === 3 || l === pl) continue;
      const x = this.xOf(s);
      if (x < LABEL_W || x > W) continue;
      g.moveTo(x, yH);
      g.lineTo(x, yL);
    }
    g.stroke();
  }

  drawIsr(g, r, top, hh, W, C) {
    const v1 = this.v0 + this.span * 1.02;
    const i0 = Math.max(0, upper(r.starts, this.v0) - 1);
    g.fillStyle = C.exp;
    g.globalAlpha = 0.75;
    let lastX = -1;
    for (let i = Math.max(0, i0 - 1); i < r.spans.length; i++) {
      const [a, b] = r.spans[i];
      if (a > v1) break;
      const end = isFinite(b) ? b : this.end;
      if (end < this.v0) continue;
      const xa = Math.max(LABEL_W, this.xOf(a)), xb = Math.min(W, this.xOf(end));
      const w = Math.max(1, xb - xa);
      if (Math.floor(xa) === lastX && w <= 1) continue;
      lastX = Math.floor(xa);
      g.fillRect(xa, top + 4, w, hh - 8);
    }
    g.globalAlpha = 1;
  }

  drawEvents(g, r, top, hh, W, C, isConsole) {
    const v1 = this.v0 + this.span * 1.02;
    let i = lower(r.t, this.v0);
    g.font = '10px ' + C.mono;
    g.textBaseline = 'middle';
    let lastLabelEnd = -1e9;
    let lastX = -1;
    for (; i < r.t.length && r.t[i] <= v1; i++) {
      const x = this.xOf(r.t[i]);
      const px = Math.floor(x);
      if (px !== lastX) {
        g.fillStyle = isConsole ? C.ink2 : C.curB;
        g.fillRect(px, top + 4, 1, hh - 8);
        lastX = px;
      }
      const e = r.ev[i];
      let lab;
      if (isConsole) {
        if (e[1] === 0) {
          const c = e[2];
          lab = c === 10 ? '⏎' : c === 13 ? '␍' : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\x' + c.toString(16).padStart(2, '0');
        } else lab = '0x' + (e[2] >>> 0).toString(16).toUpperCase();
      } else lab = String(e[1]);
      if (x + 3 > lastLabelEnd) {
        const w = g.measureText(lab).width;
        g.fillStyle = C.ink;
        g.fillText(lab, x + 3, top + hh / 2);
        lastLabelEnd = x + 3 + w + 3;
      }
    }
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
