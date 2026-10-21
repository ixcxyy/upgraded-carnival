/* The bridge to the game's backend: Tauri's invoke in the desktop app, HTTP in the dev server. */
(function () {
  'use strict';
  const T = () => window.__TAURI__;
  const tauri = () => T() && T().core && T().core.invoke;
  const flushers = [];
  const settle = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
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
    flush() {
      return Promise.all(flushers.map(f => Promise.resolve().then(f).catch(() => {})));
    },
    /** Close the game (desktop only). */
    async quit() {
      const w = T() && T().window && T().window.getCurrentWindow && T().window.getCurrentWindow();
      if (w) await w.close();
    },
  };
  // Closing the window: give the game up to two seconds to save, then close for real.
  const w = T() && T().window && T().window.getCurrentWindow && T().window.getCurrentWindow();
  if (w && w.onCloseRequested) {
    let closing = false;
    w.onCloseRequested(async ev => {
      ev.preventDefault();
      if (closing) return; // already saving; the first request closes the window
      closing = true;
      try { await settle(window.K28.flush(), 2000); } catch (err) { /* close anyway */ }
      await w.destroy();
    });
  }
})();
