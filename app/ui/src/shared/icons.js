// One icon family for the whole game: Lucide (ISC licence, see node_modules/lucide/LICENSE),
// drawn on a 24-unit grid with one stroke weight. Two glyphs Lucide has no word for — the
// logic-analyser square wave and the brand mark — are drawn here on the same grid and stroke.
//
//   icon('run')                   an <svg> for a semantic name (below), 16 px
//   icon('run', { size: 20 })

import {
  Hammer, Play, Bug, Send, Pause, Square, RotateCcw, RedoDot, ArrowDownToDot, ArrowUpFromDot,
  StepBack, Folder, FolderOpen, ListChecks, SquareTerminal, Microchip, Waypoints, BookOpenText,
  Archive, SlidersHorizontal, CircleUser, FileCode, FilePlus, Pencil, Trash2, ZoomIn, ZoomOut,
  Scan, Search, Crosshair, Binary, PanelLeft, PanelRight, PanelBottom, Maximize2, Minimize2,
  ArrowLeft, X, Check, CircleAlert, LoaderCircle, ChevronRight, ChevronDown, ChevronLeft, ChevronUp,
  ClipboardList, Power, FileText, MapPin, Users, Eye, Library, ArrowLeftToLine, ArrowRightToLine,
  History, Info, CircleCheck, CircleX, TriangleAlert, Keyboard, FastForward, NotebookPen, Plus,
  Lock, CornerDownLeft, Cpu, Flag, Sparkles, Undo2, Save, Dot, MessageSquare, Hand, Layers,
} from 'lucide';

const SQUARE_WAVE = [['path', { d: 'M2 17h4V7h5v10h5V7h4v10h2' }]];
const MARK = [
  ['path', { d: 'M2 15h3.5V9H9v6h2.5' }],
  ['path', { d: 'm13 20 4-16' }],
  ['path', { d: 'M18.5 12h3.5' }],
];

const NODES = {
  build: Hammer, run: Play, debug: Bug, submit: Send, pause: Pause, stop: Square, restart: RotateCcw,
  'step-over': RedoDot, 'step-into': ArrowDownToDot, 'step-out': ArrowUpFromDot, 'step-back': StepBack,
  'step-instr': CornerDownLeft, continue: Play,
  files: Folder, 'folder-open': FolderOpen, results: ListChecks, console: SquareTerminal, wave: SQUARE_WAVE,
  board: Microchip, chip: Cpu, case: Waypoints, datasheet: BookOpenText, codex: Archive, settings: SlidersHorizontal,
  profile: CircleUser, file: FileCode, 'file-new': FilePlus, rename: Pencil, delete: Trash2,
  'zoom-in': ZoomIn, 'zoom-out': ZoomOut, fit: Scan, search: Search, cursor: Crosshair, disasm: Binary,
  'panel-left': PanelLeft, 'panel-right': PanelRight, 'panel-bottom': PanelBottom, focus: Maximize2, unfocus: Minimize2,
  back: ArrowLeft, close: X, check: Check, alert: CircleAlert, spinner: LoaderCircle,
  'chev-right': ChevronRight, 'chev-down': ChevronDown, 'chev-left': ChevronLeft, 'chev-up': ChevronUp,
  work: ClipboardList, quit: Power, doc: FileText, place: MapPin, people: Users, clue: Eye, library: Library,
  'edge-prev': ArrowLeftToLine, 'edge-next': ArrowRightToLine, travel: History, info: Info,
  ok: CircleCheck, fail: CircleX, warn: TriangleAlert, keys: Keyboard, skip: FastForward, note: NotebookPen,
  plus: Plus, lock: Lock, flag: Flag, hint: Sparkles, undo: Undo2, save: Save, dot: Dot, message: MessageSquare,
  letgo: Hand, output: Layers, mark: MARK,
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, opts) {
  const o = opts || {};
  const node = NODES[name] || NODES.dot;
  const size = o.size || 16;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(o.stroke || 1.75));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'i i-' + name + (o.class ? ' ' + o.class : ''));
  for (const [tag, attrs] of node) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    svg.append(el);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(NODES);
