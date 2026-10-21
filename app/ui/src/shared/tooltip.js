// The glass tooltip: one capsule for the whole app. Any element with data-tip gets it on
// hover (after a short pause) and on keyboard focus (at once). data-kbd adds the shortcut.
// The capsule springs to its new width and position when it moves between controls, and
// never takes pointer events, so hit targets stay exactly where they are.

import { animate, DUR, EASE, reduced } from './motion.js';

let tip = null, label = null, kbd = null;
let target = null, showTimer = 0, hideTimer = 0, warmUntil = 0, visible = false;

function ensure() {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'sn-tip';
  tip.setAttribute('aria-hidden', 'true');
  label = document.createElement('span');
  label.className = 'sn-tip-l';
  kbd = document.createElement('span');
  kbd.className = 'sn-tip-k';
  tip.append(label, kbd);
  document.body.append(tip);
}

function tipTarget(el) {
  return el && el.closest ? el.closest('[data-tip]') : null;
}

function place(el, animateMove) {
  const r = el.getBoundingClientRect();
  const prevW = visible ? tip.offsetWidth : 0;
  const prevRect = visible ? tip.getBoundingClientRect() : null;
  label.textContent = el.getAttribute('data-tip');
  const k = el.getAttribute('data-kbd');
  kbd.textContent = k || '';
  kbd.hidden = !k;
  tip.style.width = '';
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  const below = el.getAttribute('data-tip-at') === 'below' || r.top < hgt + 14;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  const top = below ? r.bottom + 8 : r.top - hgt - 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.dataset.side = below ? 'below' : 'above';
  if (animateMove && prevRect && !reduced()) {
    // Spring from the old capsule to the new one: width and position together.
    animate(tip, [
      { width: prevW + 'px', transform: `translate(${prevRect.left - left}px, ${prevRect.top - top}px)` },
      { width: w + 'px', transform: 'none' },
    ], { dur: DUR.move, ease: EASE.spring, key: 'move' });
  }
}

function show(el, now) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!el.isConnected || !el.getAttribute('data-tip')) return;
  ensure();
  const go = () => {
    const moving = visible && target !== el;
    target = el;
    place(el, moving);
    if (!visible) {
      visible = true;
      tip.classList.add('on');
      animate(tip, [
        { opacity: 0, transform: `translateY(${tip.dataset.side === 'below' ? -4 : 4}px) scale(0.96)` },
        { opacity: 1, transform: 'none' },
      ], { dur: DUR.quick, ease: EASE.spring, key: 'move' });
    }
  };
  if (now || visible || Date.now() < warmUntil) go();
  else showTimer = setTimeout(go, 380);
}

function hide(immediate) {
  clearTimeout(showTimer);
  if (!visible) { target = null; return; }
  const out = () => {
    if (!visible) return;
    visible = false;
    target = null;
    warmUntil = Date.now() + 300;
    animate(tip, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.98)' }], { dur: DUR.tap, ease: EASE.in, key: 'move' })
      .then(() => { if (!visible) tip.classList.remove('on'); });
  };
  clearTimeout(hideTimer);
  if (immediate) out(); else hideTimer = setTimeout(out, 60);
}

/** Re-read the target's text (a state change while the tip is showing). */
export function refreshTip(el) {
  if (visible && target === el) place(el, true);
}

export function installTooltips() {
  document.addEventListener('pointerover', ev => {
    if (ev.pointerType === 'touch') return;
    const el = tipTarget(ev.target);
    if (el) show(el, false);
  });
  document.addEventListener('pointerout', ev => {
    const el = tipTarget(ev.target);
    if (el && !(ev.relatedTarget && el.contains(ev.relatedTarget))) hide(false);
  });
  document.addEventListener('pointermove', ev => {
    if (!visible || !target) return;
    // A little parallax in the capsule's sheen, from where the pointer sits on the control.
    const r = target.getBoundingClientRect();
    if (r.width) tip.style.setProperty('--px', (((ev.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
  }, { passive: true });
  document.addEventListener('focusin', ev => {
    const el = tipTarget(ev.target);
    if (el && el.matches(':focus-visible')) show(el, true);
    else if (visible) hide(true);
  });
  document.addEventListener('focusout', ev => { if (tipTarget(ev.target) === target) hide(false); });
  document.addEventListener('pointerdown', () => hide(true), true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hide(true); }, true);
  window.addEventListener('scroll', () => hide(true), true);
  window.addEventListener('blur', () => hide(true));
}
