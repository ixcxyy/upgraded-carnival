// The board the task runs on: which pin is wired to what, which way it points, and — while
// the debugger holds the core — the level on every pin right now.

import { h, put } from './util.js';

const LV = ['LOW', 'HIGH', 'floating'];

export class BoardView {
  constructor(host) {
    this.el = h('div', { class: 'boardv' });
    host.append(this.el);
    this.info = null;
    this.levels = null;
    this.sizes = null;
  }

  set(info) {
    this.info = info;
    this.levels = null;
    this.sizes = null;
    this.render();
  }

  setLevels(levels) {
    this.levels = levels || null;
    this.render();
  }

  setSizes(sizes) {
    this.sizes = sizes || null;
    this.render();
  }

  render() {
    const I = this.info;
    if (!I) { put(this.el); return; }
    const rows = I.pins.map(p => {
      const lv = this.levels ? this.levels[p.pin] : null;
      return h('tr', null,
        h('td', { class: 'pn' }, p.name),
        h('td', { class: 'dir' }, p.dir === 'in' ? '← in' : '→ out'),
        h('td', { class: 'lb' }, h('b', null, p.label), p.note ? h('div', { class: 'note' }, p.note) : null),
        h('td', { class: 'lv' }, lv === null || lv === undefined ? h('span', { class: 'dim' }, '—')
          : h('span', { class: 'led l' + lv, title: LV[lv] }, h('i'), LV[lv])));
    });
    const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
    put(this.el,
      h('div', { class: 'mcu' },
        h('div', { class: 'mcu-h' }, 'K28'),
        h('div', { class: 'mcu-s' }, 'RV32IMC · 100 MHz · 256 KB flash · 64 KB RAM')),
      h('table', { class: 'pins-t' },
        h('thead', null, h('tr', null, h('th', null, 'Pin'), h('th', null, 'Way'), h('th', null, 'Wired to'), h('th', null, this.levels ? 'Now' : 'Level'))),
        h('tbody', null, rows)),
      h('p', { class: 'dim small' },
        this.levels ? 'Levels as the debugger sees them at this instant.' : 'Start the debugger to see live levels. "in" pins are driven by the board: never make them outputs.'),
      h('div', { class: 'facts' },
        h('div', null, h('span', null, 'Startup code'), h('b', null, I.startup ? 'sdk/startup.S is linked in' : 'none — your firmware provides the boot header and reset path')),
        h('div', null, h('span', null, 'Your library'), h('b', null, I.library ? 'lib/*.c is linked in' : 'not linked in (exam rules)')),
        h('div', null, h('span', null, 'Hidden seeds'), h('b', null, String(I.hidden_seeds))),
        this.sizes ? h('div', null, h('span', null, 'Last build'), h('b', null, 'flash ' + kb(this.sizes.flash) + ' · RAM ' + kb(this.sizes.ram) + ' (text ' + kb(this.sizes.text) + ', rodata ' + kb(this.sizes.rodata) + ', data ' + kb(this.sizes.data) + ', bss ' + kb(this.sizes.bss) + ')')) : null));
  }
}
