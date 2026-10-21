// In-app dialogs in place of window.prompt/confirm/alert: modal, focus-trapped, Escape to
// cancel, focus returned to where it was. An async onSubmit can fail; the dialog then stays
// open with the error shown, so the player can correct and retry.
//
//   await confirm({ title, body, ok: 'Delete', danger: true })        → true | false
//   await prompt({ title, label, value, validate, onSubmit })          → string | null
//   await alert({ title, body })

import { animate, DUR, EASE } from './motion.js';
import { icon } from './icons.js';

const stack = [];

/** Overlays that should stop the game's global shortcuts while they are up. */
export function modalOpen() {
  return stack.length > 0 || !!document.querySelector('[data-modal="open"]');
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

function focusables(root) {
  return Array.from(root.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'))
    .filter(x => !x.disabled && x.offsetParent !== null);
}

/** Keep Tab inside root. Returns the keydown handler to attach. */
export function trapTab(root) {
  return ev => {
    if (ev.key !== 'Tab') return;
    const f = focusables(root);
    if (!f.length) { ev.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
}

export function open(spec) {
  return new Promise(resolve => {
    const restore = document.activeElement;
    const id = 'sn-dlg-' + Math.random().toString(36).slice(2, 8);
    const back = el('div', 'sn-modal');
    const box = el('div', 'sn-dialog' + (spec.danger ? ' danger' : ''));
    box.setAttribute('role', spec.role || 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', id + '-t');
    const title = el('h2', 'sn-dialog-t', spec.icon ? icon(spec.icon, { size: 18 }) : null, el('span', null, spec.title || ''));
    title.id = id + '-t';
    box.append(title);
    if (spec.body) {
      const b = typeof spec.body === 'string' ? el('p', 'sn-dialog-b', spec.body) : spec.body;
      b.id = id + '-d';
      box.setAttribute('aria-describedby', b.id);
      box.append(b);
    }
    let input = null;
    const err = el('p', 'sn-dialog-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    if (spec.input) {
      const lab = el('label', 'sn-field', el('span', 'sn-field-l', spec.input.label || ''));
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-input' + (spec.input.mono ? ' mono' : '');
      input.value = spec.input.value || '';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (spec.input.placeholder) input.placeholder = spec.input.placeholder;
      if (spec.input.maxlength) input.maxLength = spec.input.maxlength;
      lab.append(input);
      if (spec.input.hint) lab.append(el('span', 'sn-field-h', spec.input.hint));
      box.append(lab);
      input.addEventListener('input', () => { err.hidden = true; });
    }
    box.append(err);
    const row = el('div', 'sn-dialog-acts');
    const cancelBtn = spec.cancel === false ? null : el('button', 'btn ghost', spec.cancel || 'Cancel');
    const okBtn = el('button', 'btn ' + (spec.danger ? 'danger' : 'primary'), spec.ok || 'OK');
    for (const b of [cancelBtn, okBtn]) if (b) { b.type = 'button'; row.append(b); }
    box.append(row);
    back.append(box);
    document.body.append(back);
    stack.push(back);

    let done = false, busy = false;
    const finish = v => {
      if (done) return;
      done = true;
      const i = stack.indexOf(back);
      if (i >= 0) stack.splice(i, 1);
      animate(box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(0.98)' }], { dur: DUR.tap, ease: EASE.in, key: 'in' });
      animate(back, [{ opacity: 1 }, { opacity: 0 }], { dur: DUR.quick, key: 'in' }).then(() => back.remove());
      if (restore && restore.focus && restore.isConnected) restore.focus({ preventScroll: true });
      resolve(v);
    };
    const submit = async () => {
      if (busy) return;
      let value = input ? input.value : true;
      if (input && spec.input.trim !== false) value = value.trim();
      if (input && spec.input.validate) {
        const problem = spec.input.validate(value);
        if (problem) { err.textContent = problem; err.hidden = false; input.focus(); return; }
      }
      if (spec.onSubmit) {
        busy = true;
        okBtn.disabled = true;
        okBtn.classList.add('busy');
        try {
          await spec.onSubmit(value);
        } catch (e) {
          err.textContent = String((e && e.message) || e);
          err.hidden = false;
          busy = false;
          okBtn.disabled = false;
          okBtn.classList.remove('busy');
          (input || okBtn).focus();
          return;
        }
      }
      finish(value);
    };
    okBtn.addEventListener('click', submit);
    if (cancelBtn) cancelBtn.addEventListener('click', () => finish(input ? null : false));
    back.addEventListener('mousedown', ev => { if (ev.target === back && spec.cancel !== false && !busy) finish(input ? null : false); });
    const trap = trapTab(box);
    box.addEventListener('keydown', ev => {
      trap(ev);
      if (ev.key === 'Escape' && spec.cancel !== false && !busy) { ev.preventDefault(); ev.stopPropagation(); finish(input ? null : false); }
      else if (ev.key === 'Enter' && (ev.target === input || (!input && ev.target === okBtn))) { ev.preventDefault(); submit(); }
      ev.stopPropagation(); // the game's shortcuts stay behind the dialog
    });
    animate(back, [{ opacity: 0 }, { opacity: 1 }], { dur: DUR.quick, key: 'in' });
    animate(box, [{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { dur: DUR.move, ease: EASE.spring, key: 'in' });
    setTimeout(() => {
      if (input) { input.focus(); input.select(); } else (spec.danger && cancelBtn ? cancelBtn : okBtn).focus();
    }, 0);
  });
}

export const confirm = spec => open(Object.assign({ ok: 'OK' }, spec));
export const prompt = spec => open(Object.assign({ ok: 'OK' }, spec, { input: Object.assign({}, spec.input || {}, { label: spec.label || (spec.input && spec.input.label), value: spec.value !== undefined ? spec.value : spec.input && spec.input.value, validate: spec.validate || (spec.input && spec.input.validate) }) }));
export const alert = spec => open(Object.assign({ ok: 'OK', cancel: false, role: 'alertdialog' }, spec));
