// Shared motion: durations, easings and a Web Animations wrapper that retargets instead of
// queueing. UI motion only — nothing here ever touches emulation time or measured values.
//
//   animate(el, keyframes, { dur, ease, key })   a new call with the same key starts from where
//                                                 the running one has got to
//   flipFrom(el, rect)                           move el from rect to where it is now
//   reduced()                                     true when motion should be minimal

export const DUR = { tap: 120, quick: 200, move: 320, scene: 420 };

/** A damped spring sampled into a CSS linear() easing; plain ease-out where linear() is missing. */
function springEase(stiffness, damping) {
  const pts = [];
  let x = 0, v = 0;
  const dt = 1 / 120;
  let t = 0;
  for (; t < 2; t += dt) {
    const a = -stiffness * (x - 1) - damping * v;
    v += a * dt;
    x += v * dt;
    pts.push(x);
    if (t > 0.3 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const n = 40;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(+pts[Math.round((i / n) * (pts.length - 1))].toFixed(4));
  out[out.length - 1] = 1;
  return { css: 'linear(0, ' + out.slice(1).join(', ') + ')', seconds: pts.length * dt };
}

const supportsLinear = (() => {
  try { return typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)'); } catch (err) { return false; }
})();
const SPRING = springEase(260, 24);
const SOFT = springEase(170, 22);

export const EASE = {
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: supportsLinear ? SPRING.css : 'cubic-bezier(0.2, 0.9, 0.25, 1.06)',
  soft: supportsLinear ? SOFT.css : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

export function reduced() {
  const root = document.documentElement;
  if (root.dataset.motion === 'reduced') return true;
  if (root.dataset.motion === 'full') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

const running = new WeakMap();

/**
 * Animate el. Resolves true when it finished, false when a newer animation with the same key
 * took over (or at once with true under reduced motion, with the end state applied).
 */
export function animate(el, keyframes, opts) {
  const o = opts || {};
  const key = o.key || 'main';
  let map = running.get(el);
  if (!map) { map = new Map(); running.set(el, map); }
  const prev = map.get(key);
  if (prev) {
    // Retarget: freeze the current visual state, then start from it.
    try { if (prev.playState === 'running') prev.commitStyles(); } catch (err) { /* not rendered */ }
    prev.cancel();
    map.delete(key);
  }
  if (!el.animate || (reduced() && !o.essential)) {
    const last = keyframes[keyframes.length - 1];
    if (o.fill === 'forwards' || o.keep) for (const k in last) if (k !== 'offset' && k !== 'easing') el.style[k] = last[k];
    return Promise.resolve(true);
  }
  const anim = el.animate(keyframes, { duration: o.dur || DUR.quick, easing: o.ease || EASE.out, delay: o.delay || 0, fill: o.fill || 'none' });
  map.set(key, anim);
  return anim.finished.then(() => {
    if (map.get(key) === anim) map.delete(key);
    if (o.keep) { try { anim.commitStyles(); anim.cancel(); } catch (err) { /* removed */ } }
    return true;
  }, () => false);
}

export function cancel(el, key) {
  const map = running.get(el);
  const a = map && map.get(key || 'main');
  if (a) { a.cancel(); map.delete(key || 'main'); }
}

/** FLIP: el is already in its final place; play the move from `first` (a DOMRect). */
export function flipFrom(el, first, opts) {
  if (!first) return Promise.resolve();
  const last = el.getBoundingClientRect();
  if (!last.width || !last.height) return Promise.resolve();
  const dx = first.left - last.left, dy = first.top - last.top;
  const sx = first.width / last.width, sy = first.height / last.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return Promise.resolve();
  return animate(el, [
    { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], Object.assign({ dur: DUR.move, ease: EASE.spring, key: 'flip' }, opts || {}));
}

/** A ghost of `fromEl` flies to `toEl`; toEl fades in as the ghost lands. Visual only. */
export function morph(fromRect, fromEl, toEl, opts) {
  if (!fromRect || !toEl || reduced()) return Promise.resolve();
  const to = toEl.getBoundingClientRect();
  if (!to.width) return Promise.resolve();
  const ghost = fromEl.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.classList.add('sn-ghost');
  Object.assign(ghost.style, {
    position: 'fixed', left: fromRect.left + 'px', top: fromRect.top + 'px', width: fromRect.width + 'px',
    height: fromRect.height + 'px', margin: '0', zIndex: '90', pointerEvents: 'none', transformOrigin: '0 0',
  });
  document.body.append(ghost);
  const s = Math.min(3, Math.max(0.3, to.height / Math.max(1, fromRect.height)));
  const dur = (opts && opts.dur) || DUR.scene;
  animate(toEl, [{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { dur, key: 'morph-in' });
  return animate(ghost, [
    { transform: 'none', opacity: 1 },
    { transform: `translate(${to.left - fromRect.left}px, ${to.top - fromRect.top}px) scale(${s})`, opacity: 0 },
  ], { dur, ease: EASE.soft, key: 'morph' }).then(() => ghost.remove());
}

/** Track the pointer over el as --mx/--my in 0..1 (for sheen highlights); returns a detach function. */
export function sheen(el) {
  const move = ev => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width).toFixed(3));
    el.style.setProperty('--my', ((ev.clientY - r.top) / r.height).toFixed(3));
  };
  el.addEventListener('pointermove', move);
  return () => el.removeEventListener('pointermove', move);
}
