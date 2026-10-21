// The code editor: CodeMirror 6 with C highlighting, build diagnostics inline,
// a breakpoint gutter (click to toggle, right-click for a condition) and the debugger's
// current line.

import { EditorState, StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  gutter, GutterMarker, Decoration, highlightSpecialChars, rectangularSelection, dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { setDiagnostics, lintGutter, lintKeymap } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';

// ── breakpoints ──

class BpMarker extends GutterMarker {
  constructor(cond) {
    super();
    this.cond = cond || null;
  }
  eq(o) {
    return o.cond === this.cond;
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'cm-bp' + (this.cond ? ' cond' : '');
    if (this.cond) d.title = 'Breaks when: ' + this.cond;
    return d;
  }
}

const bpEffect = StateEffect.define({ map: (v, m) => ({ pos: m.mapPos(v.pos), on: v.on, cond: v.cond }) });
const bpReset = StateEffect.define();

const bpField = StateField.define({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(bpReset)) set = e.value;
      if (e.is(bpEffect)) {
        const line = tr.state.doc.lineAt(e.value.pos);
        set = set.update({ filter: from => from !== line.from });
        if (e.value.on) set = set.update({ add: [new BpMarker(e.value.cond).range(line.from)] });
      }
    }
    return set;
  },
});

function bpsOf(state) {
  const out = [];
  const it = state.field(bpField).iter();
  while (it.value) {
    out.push({ line: state.doc.lineAt(it.from).number, cond: it.value.cond });
    it.next();
  }
  return out;
}

function bpGutter(onToggle, onCond) {
  return [
    bpField,
    gutter({
      class: 'cm-bp-gutter',
      markers: v => v.state.field(bpField),
      initialSpacer: () => new BpMarker(),
      domEventHandlers: {
        mousedown(view, line, ev) {
          if (ev.button !== 0) return false;
          const has = hasBp(view.state, line.from);
          view.dispatch({ effects: bpEffect.of({ pos: line.from, on: !has }) });
          onToggle(view);
          return true;
        },
        contextmenu(view, line, ev) {
          ev.preventDefault();
          onCond(view, line);
          return true;
        },
      },
    }),
  ];
}

function hasBp(state, pos) {
  let found = false;
  state.field(bpField).between(pos, pos, () => { found = true; });
  return found;
}

function condOf(state, pos) {
  let c = null;
  state.field(bpField).between(pos, pos, (from, to, v) => { c = v.cond; });
  return c;
}

// ── the debugger's current line ──

const pcEffect = StateEffect.define();
const pcLine = Decoration.line({ class: 'cm-pc-line' });
const pcField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(pcEffect)) {
        if (!e.value) deco = Decoration.none;
        else {
          const n = Math.min(Math.max(1, e.value), tr.state.doc.lines);
          const b = new RangeSetBuilder();
          b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, pcLine);
          deco = b.finish();
        }
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

// ── look ──

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--code-fs, 13.5px)', backgroundColor: 'var(--code-bg)', color: 'var(--ink)' },
  '.cm-scroller': { fontFamily: 'var(--f-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--code-gutter)', color: 'var(--ink-3)', borderRight: '1px solid var(--rule)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--code-sel) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-bp-gutter': { width: '14px', cursor: 'pointer' },
  '.cm-bp-gutter .cm-gutterElement': { padding: '0 1px' },
  '.cm-pc-line': { backgroundColor: 'var(--code-pc) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--rule)', color: 'var(--ink)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--ink)' },
  '.cm-searchMatch': { backgroundColor: 'var(--code-find)' },
}, { dark: false });

const hl = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: 'var(--syn-kw)', fontWeight: '500' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-num)' },
  { tag: [t.string, t.character], color: 'var(--syn-str)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-com)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--syn-pre)' },
  { tag: [t.macroName], color: 'var(--syn-pre)' },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName))], color: 'var(--syn-fn)' },
  { tag: [t.operator], color: 'var(--ink-2)' },
  { tag: [t.propertyName], color: 'var(--syn-prop)' },
]);

// ── the editor ──

export class Editor {
  constructor(parent, hooks) {
    this.hooks = hooks;
    this.states = new Map();
    this.meta = new Map();
    this.path = null;
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: [theme, EditorState.readOnly.of(true)] }) });
    this.view.dom.classList.add('cm-empty');
  }

  extensions(path, readonly) {
    const self = this;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      bpGutter(
        view => self.hooks.onBreakpoints && self.hooks.onBreakpoints(self.path, bpsOf(view.state)),
        (view, line) => self.editCondition(view, line),
      ),
      lintGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      cpp(),
      syntaxHighlighting(hl),
      pcField,
      theme,
      EditorState.readOnly.of(!!readonly),
      EditorView.editable.of(!readonly),
      keymap.of([
        { key: 'Mod-s', run: () => { self.hooks.onSave && self.hooks.onSave(self.path); return true; } },
        { key: 'F5', run: () => { self.hooks.onKey && self.hooks.onKey('F5'); return true; } },
        { key: 'F9', run: v => { self.toggleAtCursor(v); return true; } },
        { key: 'F10', run: () => { self.hooks.onKey && self.hooks.onKey('F10'); return true; } },
        { key: 'F11', run: () => { self.hooks.onKey && self.hooks.onKey('F11'); return true; } },
        { key: 'Shift-F11', run: () => { self.hooks.onKey && self.hooks.onKey('Shift-F11'); return true; } },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of(u => {
        if (u.docChanged && self.path === path) {
          self.meta.get(path).dirty = true;
          self.hooks.onChange && self.hooks.onChange(path, u.state.doc.toString());
        }
        if (u.docChanged && u.state.field(bpField) !== u.startState.field(bpField)) {
          self.hooks.onBreakpoints && self.hooks.onBreakpoints(path, bpsOf(u.state));
        }
      }),
    ];
  }

  editCondition(view, line) {
    const cur = condOf(view.state, line.from);
    const lineNo = view.state.doc.lineAt(line.from).number;
    const v = window.prompt('Break on line ' + lineNo + ' only when this is true (a C expression; empty for always):', cur || '');
    if (v === null) return;
    view.dispatch({ effects: bpEffect.of({ pos: line.from, on: true, cond: v.trim() || null }) });
    this.hooks.onBreakpoints && this.hooks.onBreakpoints(this.path, bpsOf(view.state));
  }

  toggleAtCursor(view) {
    const pos = view.state.doc.lineAt(view.state.selection.main.head).from;
    view.dispatch({ effects: bpEffect.of({ pos, on: !hasBp(view.state, pos) }) });
    this.hooks.onBreakpoints && this.hooks.onBreakpoints(this.path, bpsOf(view.state));
  }

  has(path) {
    return this.states.has(path);
  }

  open(path, text, readonly, bps) {
    if (!this.states.has(path)) {
      let st = EditorState.create({ doc: text, extensions: this.extensions(path, readonly) });
      if (bps && bps.length) st = st.update({ effects: bpReset.of(this.buildBps(st, bps)) }).state;
      this.states.set(path, st);
      this.meta.set(path, { readonly: !!readonly, dirty: false });
    }
    this.show(path);
  }

  buildBps(st, bps) {
    const ranges = [];
    const seen = new Set();
    for (const b of bps) {
      if (b.line < 1 || b.line > st.doc.lines || seen.has(b.line)) continue;
      seen.add(b.line);
      ranges.push(new BpMarker(b.cond).range(st.doc.line(b.line).from));
    }
    ranges.sort((a, b) => a.from - b.from);
    return RangeSet.of(ranges);
  }

  show(path) {
    if (path === this.path) return;
    if (this.path && this.states.has(this.path)) this.states.set(this.path, this.view.state);
    const st = this.states.get(path);
    if (!st) return;
    this.path = path;
    this.view.setState(st);
    this.view.dom.classList.remove('cm-empty');
  }

  current() {
    return this.path;
  }

  state(path) {
    return path === this.path ? this.view.state : this.states.get(path);
  }

  text(path) {
    const st = this.state(path);
    return st ? st.doc.toString() : null;
  }

  isDirty(path) {
    return !!(this.meta.get(path) && this.meta.get(path).dirty);
  }

  markSaved(path) {
    const m = this.meta.get(path);
    if (m) m.dirty = false;
  }

  close(path) {
    if (this.path === path) {
      this.path = null;
      this.view.setState(EditorState.create({ doc: '', extensions: [theme, EditorState.readOnly.of(true)] }));
      this.view.dom.classList.add('cm-empty');
    }
    this.states.delete(path);
    this.meta.delete(path);
  }

  replace(path, text) {
    const st = this.state(path);
    if (!st || st.doc.toString() === text) return;
    const tr = st.update({ changes: { from: 0, to: st.doc.length, insert: text } });
    if (path === this.path) this.view.dispatch(tr);
    else this.states.set(path, tr.state);
  }

  update(path, spec) {
    const st = this.state(path);
    if (!st) return;
    if (path === this.path) this.view.dispatch(spec);
    else this.states.set(path, st.update(spec).state);
  }

  breakpoints(path) {
    const st = this.state(path);
    return st ? bpsOf(st) : [];
  }

  setBreakpoints(path, bps) {
    const st = this.state(path);
    if (!st) return;
    this.update(path, { effects: bpReset.of(this.buildBps(st, bps)) });
  }

  setDiagnostics(path, diags) {
    const st = this.state(path);
    if (!st) return;
    const doc = st.doc;
    const list = diags.map(d => {
      const ln = doc.line(Math.min(Math.max(1, d.line || 1), doc.lines));
      const from = Math.min(ln.from + Math.max(0, (d.col || 1) - 1), ln.to);
      // Underline to the end of the word at the column.
      let to = from;
      const txt = doc.sliceString(from, ln.to);
      const m = /^[A-Za-z_0-9.]+/.exec(txt);
      to = m ? from + m[0].length : Math.min(from + 1, ln.to);
      if (to <= from) to = Math.min(ln.to, from + 1);
      return { from, to: Math.max(to, from), severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info', message: d.message };
    });
    this.update(path, setDiagnostics(st, list));
  }

  setPc(path, line) {
    for (const p of this.states.keys()) {
      if (p !== path) this.update(p, { effects: pcEffect.of(null) });
    }
    if (path && this.states.has(path)) {
      this.update(path, { effects: pcEffect.of(line) });
    }
  }

  gotoLine(path, line, select) {
    if (!this.states.has(path)) return;
    this.show(path);
    const doc = this.view.state.doc;
    const ln = doc.line(Math.min(Math.max(1, line), doc.lines));
    this.view.dispatch({
      selection: select ? { anchor: ln.from, head: ln.to } : { anchor: ln.from },
      effects: EditorView.scrollIntoView(ln.from, { y: 'center' }),
    });
  }

  focus() {
    this.view.focus();
  }
}
