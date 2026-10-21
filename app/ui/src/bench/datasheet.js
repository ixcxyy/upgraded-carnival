// The K28 datasheet, inside the workbench: a table of contents and a search that marks every
// hit and steps through them.

import { h, btn, ibtn, icon, put } from './util.js';

function slug(s) {
  return 'ds-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class Datasheet {
  constructor(host, html) {
    this.html = html;
    this.hits = [];
    this.at = -1;
    this.q = h('input', { type: 'search', class: 'ds-q', placeholder: 'Search the datasheet (PCLKCR, VBASE, W1C…)', spellcheck: 'false', 'aria-label': 'Search the datasheet' });
    this.count = h('span', { class: 'ds-count' });
    this.toc = h('nav', { class: 'ds-toc', 'aria-label': 'Datasheet contents' });
    this.doc = h('div', { class: 'ds-doc' });
    this.el = h('div', { class: 'ds' },
      h('div', { class: 'ds-bar' }, h('label', { class: 'ds-search' }, icon('search', { size: 15 }), this.q), this.count,
        ibtn('chev-up', 'Previous hit', () => this.step(-1), { cls: 'sm', kbd: 'Shift+Enter', at: 'below' }),
        ibtn('chev-down', 'Next hit', () => this.step(1), { cls: 'sm', kbd: 'Enter', at: 'below' }),
        this.tocBtn = ibtn('output', 'Contents', () => { this.toc.hidden = !this.toc.hidden; this.tocBtn.setAttribute('aria-pressed', String(!this.toc.hidden)); }, { cls: 'sm', at: 'below' })),
      h('div', { class: 'ds-body' }, this.toc, this.doc));
    host.append(this.el);
    this.loaded = false;
    let t = 0;
    this.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(this.q.value), 160); });
    this.q.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); this.step(ev.shiftKey ? -1 : 1); }
      if (ev.key === 'Escape') { this.q.value = ''; this.search(''); }
    });
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.doc.innerHTML = this.html || '<p>The datasheet is missing from this build.</p>';
    // A narrow panel reads better without the contents column; the button brings it back.
    this.toc.hidden = this.el.clientWidth > 0 && this.el.clientWidth < 620;
    const items = [];
    for (const el of this.doc.querySelectorAll('h1, h2, h3')) {
      if (!el.id) el.id = slug(el.textContent);
      if (el.tagName !== 'H1') items.push(el);
    }
    put(this.toc, items.map(el => {
      const a = h('a', { href: '#' + el.id, class: el.tagName.toLowerCase() }, el.textContent);
      a.addEventListener('click', ev => { ev.preventDefault(); this.goto(el.id); });
      return a;
    }));
    // Links inside the datasheet (#regs-GPIOA and the like) stay inside the panel.
    this.doc.addEventListener('click', ev => {
      const a = ev.target.closest && ev.target.closest('a[href^="#"]');
      if (!a) return;
      ev.preventDefault();
      this.goto(a.getAttribute('href').slice(1));
    });
  }

  goto(id) {
    this.load();
    const el = this.doc.querySelector('#' + CSS.escape(id));
    if (el) el.scrollIntoView({ block: 'start' });
  }

  /** Find a register or topic by name and jump there. */
  find(text) {
    this.load();
    this.q.value = text;
    this.search(text);
  }

  clear() {
    for (const m of this.doc.querySelectorAll('mark.ds-hit')) {
      const p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    this.hits = [];
    this.at = -1;
  }

  search(q) {
    this.load();
    this.clear();
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) { this.count.textContent = ''; return; }
    const walker = document.createTreeWalker(this.doc, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const text = n.nodeValue;
      const low = text.toLowerCase();
      let i = low.indexOf(needle);
      if (i < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (i >= 0) {
        frag.append(text.slice(last, i));
        const m = h('mark', { class: 'ds-hit' }, text.slice(i, i + needle.length));
        frag.append(m);
        this.hits.push(m);
        last = i + needle.length;
        i = low.indexOf(needle, last);
      }
      frag.append(text.slice(last));
      n.parentNode.replaceChild(frag, n);
    }
    this.count.textContent = this.hits.length ? '' : 'no hits';
    this.at = -1;
    if (this.hits.length) this.step(1);
  }

  step(d) {
    if (!this.hits.length) return;
    if (this.at >= 0) this.hits[this.at].classList.remove('cur');
    this.at = (this.at + d + this.hits.length) % this.hits.length;
    const m = this.hits[this.at];
    m.classList.add('cur');
    m.scrollIntoView({ block: 'center' });
    this.count.textContent = (this.at + 1) + ' of ' + this.hits.length;
  }
}
