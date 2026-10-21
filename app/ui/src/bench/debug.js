// The debugger's side panel: where the core stopped and why, the call stack, variables,
// watch expressions (with data watchpoints), registers, peripherals, memory and breakpoints.
// Every view is read without side effects; edits go through the backend's assign/poke.

import { h, put, btn, hex, fmtT, parseNum, ABI, VECTORS, basename, plural } from './util.js';

const REASON = {
  start: 'Stopped at reset',
  step: 'Stepped',
  breakpoint: 'Breakpoint',
  watchpoint: 'Watchpoint',
  pause: 'Paused',
  fault: 'Fault',
  end: 'End of the run',
  exited: 'Program exited',
  ebreak: 'EBREAK',
  irq: 'Interrupt taken',
  error: 'Could not do that',
  time: 'Time travel',
  continue: 'Stopped',
};

const CPU = { running: 'running', sleeping: 'asleep in WFI', exited: 'exited', faulted: 'faulted' };

const DEFAULT_OPEN = { stack: true, locals: true, watch: true, globals: false, regs: false, periph: false, mem: false, bps: true };

export class DebugPanel {
  constructor(host, ctx) {
    this.ctx = ctx;
    this.el = h('div', { class: 'dbg' });
    host.append(this.el);
    this.state = null;
    this.frame = 0;
    this.stack = [];
    this.locals = [];
    this.globals = null;
    this.periph = null;
    this.watchVals = [];
    this.armed = [];
    this.memAddr = 0x20000000;
    this.mem = null;
    this.prevMem = null;
    this.running = false;
    this.runNow = 0;
    this.expanded = new Set();
    this.periphOpen = new Set();
    this.regOpen = new Set();
    this.renderIdle();
  }

  isOpen(key) {
    const o = this.ctx.layout().dbgOpen || {};
    return key in o ? !!o[key] : !!DEFAULT_OPEN[key];
  }

  setOpen(key, v) {
    const L = this.ctx.layout();
    L.dbgOpen = Object.assign({}, L.dbgOpen || {}, { [key]: v });
    this.ctx.persist();
  }

  call(cmd, args) {
    return this.ctx.call(cmd, args || {});
  }

  // ── lifecycle ──

  renderIdle() {
    put(this.el, h('div', { class: 'dbg-idle' },
      h('p', null, 'The debugger runs your firmware on the emulated chip one step at a time. Click in the gutter left of a line number to set a breakpoint, then press ',
        h('span', { class: 'kbd' }, 'F5'), ' or Debug.'),
      h('ul', null,
        h('li', null, h('span', { class: 'kbd' }, 'F10'), ' step over, ', h('span', { class: 'kbd' }, 'F11'), ' step into, ', h('span', { class: 'kbd' }, 'Shift+F11'), ' step out'),
        h('li', null, 'Step back runs time backwards: every stop can be undone.'),
        h('li', null, 'Right-click a breakpoint for a condition, like ', h('code', null, 'count == 3'), '.'),
        h('li', null, 'Watch any C expression, register (', h('code', null, '$a0'), ') or peripheral register (', h('code', null, 'GPIOA.DAT'), ').')),
      this.bpSection()));
  }

  stop() {
    this.state = null;
    this.running = false;
    this.stack = [];
    this.locals = [];
    this.globals = null;
    this.periph = null;
    this.mem = null;
    this.prevMem = null;
    this.watchVals = [];
    this.renderIdle();
  }

  setRunning(now) {
    this.running = true;
    this.runNow = now || 0;
    const head = this.el.querySelector('.dbg-status');
    if (head) {
      head.classList.add('running');
      put(head, h('div', { class: 'reason' }, 'Running…'), h('div', { class: 'meta' }, 't = ' + fmtT(this.runNow, 4) + (this.state ? ' of ' + fmtT(this.state.end, 3) : '')));
    }
    this.el.classList.add('is-running');
  }

  /** A new stop: fetch everything the open sections show, then render. */
  async update(state) {
    this.running = false;
    this.el.classList.remove('is-running');
    this.state = state;
    this.frame = 0;
    try {
      this.stack = await this.call('dbg_stack');
    } catch (err) {
      this.stack = [];
    }
    await this.refreshData();
    this.render();
  }

  async refreshData() {
    const jobs = [];
    jobs.push(this.call('dbg_locals', { frame: this.frame }).then(v => { this.locals = v; }, () => { this.locals = []; }));
    jobs.push(this.evalWatches());
    if (this.isOpen('globals')) jobs.push(this.call('dbg_globals').then(v => { this.globals = v; }, () => { this.globals = []; }));
    if (this.isOpen('periph')) jobs.push(this.call('dbg_periph').then(v => { this.periph = v; }, () => { this.periph = null; }));
    if (this.isOpen('mem')) jobs.push(this.loadMem(false));
    await Promise.all(jobs);
  }

  async evalWatches() {
    const list = this.ctx.watches();
    this.watchVals = await Promise.all(list.map(w => this.call('dbg_eval', { expr: w.expr, frame: this.frame }).catch(err => ({ error: String(err.message || err) }))));
  }

  /** Arm the data watchpoints (watches marked "break on write"). */
  async armWatches() {
    const list = this.ctx.watches().filter(w => w.brk).map(w => ({ expr: w.expr, write: true, read: false }));
    try {
      this.armed = await this.call('dbg_watch', { list, frame: this.frame });
    } catch (err) {
      this.armed = [];
    }
  }

  async loadMem(keepPrev) {
    try {
      const bytes = await this.call('dbg_mem', { addr: this.memAddr >>> 0, len: 256 });
      if (!keepPrev) this.prevMem = this.mem && this.mem.addr === this.memAddr ? this.mem.bytes : null;
      this.mem = { addr: this.memAddr, bytes };
    } catch (err) {
      this.mem = { addr: this.memAddr, bytes: [], error: String(err.message || err) };
    }
  }

  async selectFrame(i) {
    this.frame = i;
    const f = this.stack[i];
    if (f && f.file && f.line) this.ctx.gotoFrame(f.file, f.line, i);
    await this.refreshData();
    this.render();
  }

  /** After an edit (variable, register, memory): the machine changed, re-read everything. */
  async afterEdit() {
    try {
      const st = await this.call('dbg_state');
      this.state = st;
      this.stack = await this.call('dbg_stack');
    } catch (err) { /* keep what we have */ }
    await this.refreshData();
    this.render();
    this.ctx.edited();
  }

  // ── rendering ──

  render() {
    if (!this.state) { this.renderIdle(); return; }
    const scroll = this.el.scrollTop;
    put(this.el,
      this.statusBox(),
      this.section('stack', 'Call stack', () => this.stackView(), this.stack.length ? String(this.stack.length) : null),
      this.section('locals', this.frame ? 'Locals · frame ' + this.frame : 'Locals', () => this.tree(this.locals, 'l' + this.frame, true, 'No locals here.')),
      this.section('watch', 'Watch', () => this.watchView(), this.ctx.watches().length ? String(this.ctx.watches().length) : null),
      this.section('globals', 'Globals', () => this.globals ? this.tree(this.globals, 'g', true, 'No globals in RAM.') : h('p', { class: 'dim' }, 'Loading…'), null, () => this.lazy('globals')),
      this.section('regs', 'Registers', () => this.regsView()),
      this.section('periph', 'Peripherals', () => this.periph ? this.periphView() : h('p', { class: 'dim' }, 'Loading…'), null, () => this.lazy('periph')),
      this.section('mem', 'Memory', () => this.memView(), null, () => this.lazy('mem')),
      this.bpSection());
    this.el.scrollTop = scroll;
  }

  async lazy(key) {
    if (key === 'globals') this.globals = await this.call('dbg_globals').catch(() => []);
    if (key === 'periph') this.periph = await this.call('dbg_periph').catch(() => null);
    if (key === 'mem') await this.loadMem(true);
    this.render();
  }

  section(key, title, body, badge, onOpen) {
    const open = this.isOpen(key);
    const head = h('button', { type: 'button', class: 'sec-h', 'aria-expanded': String(open) },
      h('span', { class: 'tw' }, open ? '▾' : '▸'), h('span', null, title), badge ? h('span', { class: 'badge' }, badge) : null);
    const sec = h('section', { class: 'dbg-sec' + (open ? ' open' : '') }, head);
    if (open) sec.append(h('div', { class: 'sec-b' }, body()));
    head.addEventListener('click', () => {
      this.setOpen(key, !open);
      if (!open && onOpen && this.state) onOpen(); else this.render();
    });
    return sec;
  }

  statusBox() {
    const s = this.state;
    const reason = REASON[s.stop.reason] || s.stop.reason;
    const box = h('div', { class: 'dbg-status' + (s.fault ? ' fault' : '') },
      h('div', { class: 'reason' }, reason, s.stop.detail ? h('span', { class: 'detail' }, ' — ' + s.stop.detail) : null),
      h('div', { class: 'meta' },
        't = ' + fmtT(s.now, 4) + ' of ' + fmtT(s.end, 3),
        ' · ' + s.instret.toLocaleString('en-US') + ' instructions',
        ' · core ' + (CPU[s.cpu] || s.cpu),
        s.halted_by_probe ? ' · halted by the probe' : null),
      h('div', { class: 'meta' },
        s.func ? 'in ' + s.func + '()' : 'at ' + hex(s.pc),
        s.file ? ' · ' + basename(s.file) + ':' + s.line : '',
        ' · pc ' + hex(s.pc),
        s.pie_active && s.pie_active.length ? ' · serving ' + s.pie_active.map(v => VECTORS[v] || v).join(' ← ') : null));
    if (s.fault) box.append(h('div', { class: 'fault-msg' }, h('b', null, s.fault_code || 'FAULT'), ' ', s.fault));
    if (s.exit_code !== null && s.exit_code !== undefined) box.append(h('div', { class: 'meta' }, 'Exit code ' + s.exit_code));
    return box;
  }

  stackView() {
    if (!this.stack.length) return h('p', { class: 'dim' }, 'No frames.');
    return h('ol', { class: 'stack' }, this.stack.map((f, i) => {
      const where = f.file ? basename(f.file) + ':' + f.line : hex(f.pc);
      const li = h('li', { class: i === this.frame ? 'sel' : '', tabindex: '0' },
        h('span', { class: 'fn' }, (f.func || '??') + '()'),
        h('span', { class: 'at' }, where));
      if (f.interrupt) li.append(h('div', { class: 'irq' }, '↑ interrupted by ' + (VECTORS[f.interrupt] || 'vector ' + f.interrupt)));
      li.addEventListener('click', () => this.selectFrame(i));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.selectFrame(i); });
      return li;
    }));
  }

  /** A tree of formatted values. prefix keys the expand state; exprs builds assignable paths. */
  tree(list, prefix, editable, empty, exprOf) {
    if (!list || !list.length) return h('p', { class: 'dim' }, empty || 'Nothing.');
    const ul = h('ul', { class: 'vt' });
    const add = (v, key, depth, expr) => {
      const kids = v.children && v.children.length;
      const open = this.expanded.has(key);
      const valEl = h('span', { class: 'v' + (v.value && v.value.startsWith('<') ? ' dim' : '') }, v.value);
      const row = h('li', { style: { paddingLeft: (depth * 14 + 4) + 'px' } },
        h('span', { class: 'tw' }, kids ? (open ? '▾' : '▸') : ''),
        h('span', { class: 'n' }, v.name),
        valEl,
        h('span', { class: 't' }, v.ty));
      if (kids) row.addEventListener('click', () => { if (open) this.expanded.delete(key); else this.expanded.add(key); this.render(); });
      else if (editable && v.addr !== null && v.addr !== undefined && !this.running) {
        row.title = 'Double-click to change';
        row.addEventListener('dblclick', () => this.editValue(expr, v));
      }
      if (v.addr !== null && v.addr !== undefined) {
        row.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          this.memAddr = v.addr >>> 0;
          this.setOpen('mem', true);
          this.lazy('mem');
        });
      }
      ul.append(row);
      if (kids && open) {
        for (const c of v.children) {
          const ce = c.name.startsWith('[') ? expr + c.name : expr + '.' + c.name;
          add(c, key + '/' + c.name, depth + 1, ce);
        }
      }
    };
    for (const v of list) add(v, prefix + '/' + v.name, 0, exprOf ? exprOf(v) : v.name);
    return ul;
  }

  async editValue(expr, v) {
    const cur = String(v.value || '').split(' ')[0];
    const nv = window.prompt('New value for ' + expr + ' (' + v.ty + '):', cur);
    if (nv === null || !nv.trim()) return;
    try {
      await this.call('dbg_assign', { target: expr, value: nv.trim(), frame: this.frame });
    } catch (err) {
      this.ctx.toast(String(err.message || err));
      return;
    }
    this.afterEdit();
  }

  watchView() {
    const list = this.ctx.watches();
    const input = h('input', { type: 'text', class: 'watch-in', placeholder: 'Add a watch: count, buf[2], GPIOA.DAT, $sp…', spellcheck: 'false' });
    const addIt = async () => {
      const v = input.value.trim();
      if (!v) return;
      this.ctx.setWatches(list.concat([{ expr: v, brk: false }]));
      input.value = '';
      await this.evalWatches();
      this.render();
      const again = this.el.querySelector('.watch-in');
      if (again) again.focus();
    };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') addIt(); });
    const rows = list.map((w, i) => {
      const val = this.watchVals[i];
      const armed = w.brk ? this.armed.find(a => a.expr === w.expr.trim()) : null;
      const brk = h('button', {
        type: 'button', class: 'wbrk' + (w.brk ? ' on' : '') + (armed && armed.error ? ' bad' : ''),
        title: w.brk ? (armed && armed.error ? 'Cannot watch: ' + armed.error : 'Breaks when this is written' + (armed ? ' (' + plural(armed.len, 'byte') + ' at ' + hex(armed.addr) + ')' : '')) : 'Break when this is written',
        'aria-pressed': String(!!w.brk),
      }, '●');
      brk.addEventListener('click', async ev => {
        ev.stopPropagation();
        const next = list.slice();
        next[i] = Object.assign({}, w, { brk: !w.brk });
        this.ctx.setWatches(next);
        await this.armWatches();
        this.render();
      });
      const rm = h('button', { type: 'button', class: 'wrm', title: 'Remove' }, '×');
      rm.addEventListener('click', async ev => {
        ev.stopPropagation();
        const next = list.slice();
        next.splice(i, 1);
        this.ctx.setWatches(next);
        if (w.brk) await this.armWatches();
        await this.evalWatches();
        this.render();
      });
      let body;
      if (!val) body = h('span', { class: 'v dim' }, '…');
      else if (val.error) body = h('span', { class: 'v err' }, val.error);
      else body = this.tree([Object.assign({}, val, { name: '' })], 'w' + i, true, '', () => '(' + w.expr + ')');
      return h('div', { class: 'watch' }, h('div', { class: 'wh' }, brk, h('code', { class: 'we' }, w.expr), rm), body);
    });
    return h('div', null, rows, h('div', { class: 'row' }, input, btn('Add', 'ghost small', addIt)));
  }

  regsView() {
    const s = this.state;
    const grid = h('div', { class: 'regs' });
    const cell = (label, idx, v, changed, title) => {
      const c = h('div', { class: 'reg' + (changed ? ' changed' : ''), title: title || '' },
        h('span', { class: 'rn' }, label), h('span', { class: 'rv' }, hex(v)));
      if (idx !== null && !this.running) {
        c.addEventListener('dblclick', async () => {
          const nv = window.prompt('New value for ' + label + ':', hex(v));
          if (nv === null) return;
          const n = parseNum(nv);
          if (!isFinite(n)) { this.ctx.toast('That is not a number.'); return; }
          try { await this.call('dbg_setreg', { idx, value: n >>> 0 }); } catch (err) { this.ctx.toast(String(err.message || err)); return; }
          this.afterEdit();
        });
      }
      return c;
    };
    grid.append(cell('pc', 32, s.pc, false, 'Program counter'));
    for (let i = 1; i < 32; i++) grid.append(cell(ABI[i] + ' x' + i, i, s.regs[i], (s.changed >>> i) & 1, s.regs[i] + ' (' + (s.regs[i] | 0) + ')'));
    const csr = h('div', { class: 'regs csr' },
      cell('mstatus', null, s.mstatus, false, 'MIE (bit 3) = ' + ((s.mstatus >>> 3) & 1) + ', MPIE (bit 7) = ' + ((s.mstatus >>> 7) & 1)),
      cell('mie', null, s.mie, false, 'MEIE (bit 11) = ' + ((s.mie >>> 11) & 1)),
      cell('mepc', null, s.mepc, false),
      cell('mcause', null, s.mcause, false));
    const flags = h('p', { class: 'dim small' },
      'Interrupts ' + (((s.mstatus >>> 3) & 1) ? 'enabled' : 'disabled') + ' in mstatus.MIE · external interrupts ' + (((s.mie >>> 11) & 1) ? 'enabled' : 'disabled') + ' in mie.MEIE. Changed registers are marked; double-click to edit.');
    return h('div', null, grid, csr, flags);
  }

  periphView() {
    const out = h('div', { class: 'periph' });
    for (const b of this.periph) {
      const open = this.periphOpen.has(b.name);
      const head = h('button', { type: 'button', class: 'pb-h' + (b.clocked ? '' : ' off') },
        h('span', { class: 'tw' }, open ? '▾' : '▸'), h('span', { class: 'bn' }, b.name), b.clocked ? null : h('span', { class: 'off-note' }, 'clock off'));
      head.addEventListener('click', () => { if (open) this.periphOpen.delete(b.name); else this.periphOpen.add(b.name); this.render(); });
      out.append(head);
      if (!open) continue;
      const tbl = h('table', { class: 'preg' });
      for (const r of b.regs) {
        const key = b.name + '.' + r.name;
        const ro = this.regOpen.has(key);
        const tr = h('tr', { class: 'pr' + (ro ? ' open' : ''), title: r.desc },
          h('td', { class: 'nm' }, h('span', { class: 'tw' }, r.fields && r.fields.length ? (ro ? '▾' : '▸') : ''), r.name),
          h('td', { class: 'ad' }, hex(r.addr).slice(-4)),
          h('td', { class: 'val' }, r.value === null ? (r.access === 'WO' ? 'write-only' : '—') : hex(r.value)),
          h('td', { class: 'ac' }, r.access));
        tr.addEventListener('click', () => { if (ro) this.regOpen.delete(key); else this.regOpen.add(key); this.render(); });
        if (!this.running && r.value !== null) {
          tr.addEventListener('dblclick', ev => {
            ev.preventDefault();
            this.editValue(b.name + '.' + r.name, { value: hex(r.value), ty: 'register' });
          });
        }
        tbl.append(tr);
        if (ro && r.fields) {
          for (const f of r.fields) {
            tbl.append(h('tr', { class: 'pf' },
              h('td', { class: 'nm' }, f.name),
              h('td', { class: 'ad' }, f.bits),
              h('td', { class: 'val' }, String(f.value)),
              h('td', { class: 'mean' }, f.meaning)));
          }
        }
      }
      out.append(tbl);
    }
    out.append(h('p', { class: 'dim small' }, 'Click a register for its fields; double-click to write it. Reading here has no side effects.'));
    return out;
  }

  memView() {
    const input = h('input', { type: 'text', class: 'mem-in', value: hex(this.memAddr), spellcheck: 'false', 'aria-label': 'Address or expression' });
    const go = async () => {
      const v = input.value.trim();
      let n = parseNum(v);
      if (!isFinite(n)) {
        try {
          const r = await this.call('dbg_eval', { expr: v, frame: this.frame });
          if (r.error) { this.ctx.toast(r.error); return; }
          const m = /0x[0-9a-f]+/i.exec(r.value);
          n = m ? parseInt(m[0], 16) : parseNum(String(r.value).split(' ')[0]);
          if (r.addr !== null && r.addr !== undefined && !/\*/.test(r.ty)) n = r.addr;
        } catch (err) { this.ctx.toast(String(err.message || err)); return; }
      }
      if (!isFinite(n)) { this.ctx.toast('Give an address, like 0x20000000, or an expression like &count.'); return; }
      this.memAddr = (n >>> 0) & ~0xF;
      this.prevMem = null;
      await this.loadMem(true);
      this.render();
    };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
    const page = async d => {
      this.memAddr = (this.memAddr + d * 256) >>> 0;
      this.prevMem = null;
      await this.loadMem(true);
      this.render();
    };
    const bar = h('div', { class: 'row mem-bar' },
      input, btn('Go', 'ghost small', go), btn('◂', 'ghost small icon', () => page(-1), { title: 'Previous 256 bytes' }), btn('▸', 'ghost small icon', () => page(1), { title: 'Next 256 bytes' }),
      btn('RAM', 'ghost small', () => { input.value = '0x20000000'; go(); }), btn('sp', 'ghost small', () => { input.value = hex(this.state.regs[2]); go(); }));
    const m = this.mem;
    if (!m) return h('div', null, bar, h('p', { class: 'dim' }, 'Loading…'));
    if (m.error) return h('div', null, bar, h('p', { class: 'err' }, m.error));
    const pre = h('div', { class: 'hexdump' });
    for (let r = 0; r < m.bytes.length; r += 16) {
      const addr = (m.addr + r) >>> 0;
      const hexs = [], asc = [];
      for (let k = 0; k < 16 && r + k < m.bytes.length; k++) {
        const b = m.bytes[r + k];
        const was = this.prevMem ? this.prevMem[r + k] : b;
        const ch = b === null ? '??' : b.toString(16).padStart(2, '0');
        hexs.push(h('span', { class: (b !== was ? 'chg' : '') + (k === 8 ? ' gap' : '') }, ch));
        asc.push(b === null ? '·' : b >= 32 && b < 127 ? String.fromCharCode(b) : '.');
      }
      pre.append(h('div', { class: 'hl' }, h('span', { class: 'ha' }, hex(addr)), h('span', { class: 'hb' }, hexs), h('span', { class: 'hc' }, asc.join(''))));
    }
    return h('div', null, bar, pre, h('p', { class: 'dim small' }, 'Bytes that changed since the last stop are marked. ?? = nothing mapped there. Right-click a variable to show it here.'));
  }

  bpSection() {
    const list = this.ctx.bpList();
    const body = () => {
      if (!list.length) return h('p', { class: 'dim' }, 'No breakpoints. Click in the gutter left of a line number, or press F9 on a line.');
      return h('div', null,
        h('ul', { class: 'bps' }, list.map(b => {
          const li = h('li', null,
            h('span', { class: 'dot' + (b.cond ? ' cond' : '') }),
            h('span', { class: 'bloc' }, basename(b.path) + ':' + b.line),
            b.cond ? h('code', { class: 'cond' }, b.cond) : null,
            h('button', { type: 'button', class: 'wrm', title: 'Remove' }, '×'));
          li.addEventListener('click', ev => {
            if (ev.target.classList.contains('wrm')) this.ctx.removeBp(b.path, b.line);
            else this.ctx.gotoLine(b.path, b.line);
          });
          return li;
        })),
        h('div', { class: 'row' }, btn('Remove all', 'ghost small', () => this.ctx.clearBps())));
    };
    return this.section('bps', 'Breakpoints', body, list.length ? String(list.length) : null);
  }
}
