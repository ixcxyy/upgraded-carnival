// Shared UI primitives for both halves of the game. The story is plain scripts sharing one
// scope and the workbench is a bundle of modules, so this is built as its own bundle (ui.js),
// loaded first, and published as window.SN. Nothing here runs before the page asks for it
// except installing the tooltip listeners.
//
//   load order (shell.html):  ui.js → api.js → bench.js → story.js

import { icon, ICON_NAMES } from './icons.js';
import { animate, cancel, flipFrom, morph, sheen, reduced, DUR, EASE } from './motion.js';
import { installTooltips, refreshTip } from './tooltip.js';
import { open, confirm, prompt, alert, modalOpen, trapTab } from './dialog.js';

/**
 * A moving "you are here" pill inside a group of controls: indicator(group).move(button).
 * It springs between items, retargets when moved again mid-flight, and hides with move(null).
 */
function indicator(group, cls) {
  const pill = document.createElement('span');
  pill.className = 'sn-ind' + (cls ? ' ' + cls : '');
  pill.setAttribute('aria-hidden', 'true');
  group.prepend(pill);
  let current = null;
  const measure = el => {
    const g = group.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - g.left + group.scrollLeft, y: r.top - g.top + group.scrollTop, w: r.width, h: r.height };
  };
  const api = {
    el: pill,
    move(el, instant) {
      if (!el || !el.isConnected || el.offsetParent === null) { current = null; pill.classList.remove('on'); return; }
      const to = measure(el);
      if (!to.w) return;
      const from = current && pill.classList.contains('on') ? { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top), w: parseFloat(pill.style.width), h: parseFloat(pill.style.height) } : null;
      Object.assign(pill.style, { left: to.x + 'px', top: to.y + 'px', width: to.w + 'px', height: to.h + 'px' });
      const was = pill.classList.contains('on');
      pill.classList.add('on');
      current = el;
      if (from && !instant && (from.x !== to.x || from.y !== to.y || from.w !== to.w)) {
        animate(pill, [
          { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)`, width: from.w + 'px', height: from.h + 'px' },
          { transform: 'none', width: to.w + 'px', height: to.h + 'px' },
        ], { dur: DUR.move, ease: EASE.spring, key: 'ind' });
      } else if (!was && !instant) {
        animate(pill, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { dur: DUR.quick, ease: EASE.spring, key: 'ind' });
      }
    },
    refresh() { if (current) api.move(current, true); },
  };
  return api;
}

/** Tactile press feedback on every .btn and icon control (CSS does the visuals; this only flags it). */
function installPress() {
  document.addEventListener('pointerdown', ev => {
    const b = ev.target.closest && ev.target.closest('.btn, .ibtn, .dock-btn');
    if (!b || b.disabled) return;
    b.classList.add('pressed');
    const up = () => { b.classList.remove('pressed'); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, true);
}

window.SN = {
  icon, ICON_NAMES,
  motion: { animate, cancel, flipFrom, morph, sheen, reduced, DUR, EASE },
  dialog: { open, confirm, prompt, alert },
  modalOpen, trapTab, indicator, refreshTip,
};

installTooltips();
installPress();
