/* The bridge to the game's backend: Tauri's invoke in the desktop app, HTTP in the dev server. */
(function () {
  'use strict';
  const T = () => window.__TAURI__;
  const tauri = () => T() && T().core && T().core.invoke;
  const flushers = [];
  window.K28 = {
    desktop: !!tauri(),
    async call(cmd, args) {
      const inv = tauri();
      if (inv) {
        try {
          return await inv('call', { cmd, args: args || {} });
        } catch (err) {
          throw new Error(typeof err === 'string' ? err : (err && err.message) || String(err));
        }
      }
      const r = await fetch('api/' + cmd, { method: 'POST', body: JSON.stringify(args || {}) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      return j.data;
    },
    /** Register work that must finish before the window closes (unsaved files, the save file). */
    beforeQuit(fn) {
      flushers.push(fn);
    },
    async flush() {
      const results = await Promise.allSettled(flushers.map(f => Promise.resolve().then(f)));
      if (results.some(r => r.status === 'rejected' || r.value === false)) {
        throw new Error('Some changes could not be saved. The window will stay open so you can retry.');
      }
    },
    /** Close the game (desktop only). */
    async quit() {
      const w = T() && T().window && T().window.getCurrentWindow && T().window.getCurrentWindow();
      if (w) await w.close();
    },
  };
  // Never destroy a window containing unsaved work because a disk write was slow.
  const w = T() && T().window && T().window.getCurrentWindow && T().window.getCurrentWindow();
  if (w && w.onCloseRequested) {
    let closing = false;
    w.onCloseRequested(async ev => {
      ev.preventDefault();
      if (closing) return; // already saving; the first request closes the window
      closing = true;
      try {
        await window.K28.flush();
        await w.destroy();
      } catch (err) {
        closing = false;
        const msg = String(err.message || err);
        // The in-app dialog when the page has it; a plain alert otherwise.
        if (window.SN && window.SN.dialog) window.SN.dialog.alert({ title: 'Not everything is saved', icon: 'alert', body: msg, ok: 'Back to the game' });
        else window.alert(msg);
      }
    });
  }
})();
