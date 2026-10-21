// Measures, rather than asserts, how the expensive parts of the redesign behave in a real browser
// against the real dev server: the title's decorative loop, waveform zoom/pan after a real run,
// the clue-popover grow, and what reduced motion turns off. Same setup as capture.cjs:
//
//   NODE_PATH=$(npm root -g) node tools/qa/perf.cjs /tmp/sn-perf [http://127.0.0.1:8028/]
//
// Numbers depend on the machine and on headless rendering; they are a record, not a promise.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.resolve(process.argv[2] || 'qa-perf');
const URL = process.argv[3] || 'http://127.0.0.1:8028/';
fs.mkdirSync(OUT, { recursive: true });

let cdp = null;
async function cpu() {
  const m = (await cdp.send('Performance.getMetrics')).metrics;
  const g = k => (m.find(x => x.name === k) || {}).value || 0;
  return { task: g('TaskDuration'), script: g('ScriptDuration'), layout: g('LayoutDuration'), style: g('RecalcStyleDuration') };
}

/** Frame intervals (ms) over `ms`, while `during` runs, plus main-thread CPU time spent (CDP). */
async function frames(page, ms, during) {
  const c0 = await cpu(), w0 = Date.now();
  await page.evaluate(() => {
    window.__fr = [];
    let last = performance.now();
    const tick = now => { window.__fr.push(now - last); last = now; if (window.__frOn) requestAnimationFrame(tick); };
    window.__frOn = true;
    requestAnimationFrame(tick);
  });
  if (during) await during(); else await page.waitForTimeout(ms);
  const fr = await page.evaluate(() => { window.__frOn = false; return window.__fr.slice(1); });
  const c1 = await cpu(), wall = Date.now() - w0;
  const ms_ = k => +((c1[k] - c0[k]) * 1000).toFixed(1);
  fr.cpu = { wall_ms: wall, main_thread_ms: ms_('task'), script_ms: ms_('script'), layout_ms: ms_('layout'), style_ms: ms_('style') };
  return fr;
}
function stats(list) {
  const s = list.slice().sort((a, b) => a - b);
  const q = p => s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null;
  return { frames: s.length, p50_ms: q(0.5), p95_ms: q(0.95), max_ms: s.length ? +s[s.length - 1].toFixed(1) : null, over_25ms: s.filter(x => x > 25).length, cpu: list.cpu };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const result = { url: URL, when: new Date().toISOString(), note: 'headless Chromium, software rendering; machine-dependent', runs: {} };

  for (const motion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: motion });
    const page = await ctx.newPage();
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL);
    await page.waitForSelector('#title-inner h1');
    const profile = 'Perf ' + motion + ' ' + Date.now().toString(36);
    await page.evaluate(n => window.K28.call('profile_create', { name: n }), profile);
    await page.evaluate(n => localStorage.setItem('signal-noise.active-profile', n), profile);
    await page.reload();
    await page.waitForSelector('#trace-cv');
    const r = {};
    r.title_idle = stats(await frames(page, 3000));
    // Does the decorative strip keep drawing? Compare two snapshots a second apart.
    const snap = () => page.evaluate(() => document.getElementById('trace-cv').toDataURL());
    const a = await snap(); await page.waitForTimeout(1000); const b = await snap();
    r.title_strip_animating = a !== b;
    r.title_running_css_animations = await page.evaluate(() => document.getAnimations().filter(x => x.playState === 'running').length);

    await page.locator('#title .btn.primary').click();
    await page.waitForTimeout(400);
    // Clue popover: frames while it grows.
    const hs = page.locator('.stream .hs.st-open[role="button"]');
    for (let i = 0; i < 40 && !(await hs.count()); i++) await page.keyboard.press('Space');
    if (await hs.count()) {
      r.popover_grow = stats(await frames(page, 0, async () => { await hs.first().click(); await page.waitForTimeout(600); }));
      r.popover_animations_after_open = await page.evaluate(() => document.getAnimations().filter(x => x.playState === 'running').length);
      await page.keyboard.press('Escape');
    }
    // The bench, with a real run of the reference solution for task 1.1.
    const ref = fs.readFileSync(path.join(__dirname, '../../content/solutions/ref/1.1/main.c'), 'utf8');
    await page.evaluate(([p, t]) => window.K28.call('ws_write', { profile: p, path: 'tasks/1.1/main.c', text: t }), [profile, ref]);
    await page.evaluate(() => window.Bench.open('1.1'));
    await page.waitForSelector('.bench:not([hidden]) .cm-content');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !document.querySelector('.bb-status.busy'), null, { timeout: 120000 });
    await page.locator('.btabs .ptab').first().click();
    await page.waitForTimeout(400);
    const box = await page.locator('.wave-rows').boundingBox();
    if (box) {
      const x = box.x + box.width * 0.6, y = box.y + 15;
      await page.mouse.move(x, y);
      r.wave_wheel_zoom_60 = stats(await frames(page, 0, async () => { for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, i < 30 ? -120 : 120); await page.waitForTimeout(16); } }));
      r.wave_drag_pan = stats(await frames(page, 0, async () => { await page.mouse.down(); for (let i = 0; i < 40; i++) { await page.mouse.move(x - i * 8, y); await page.waitForTimeout(16); } await page.mouse.up(); }));
    }
    r.bench_idle = stats(await frames(page, 2000));
    r.bench_running_animations_idle = await page.evaluate(() => document.getAnimations().filter(x => x.playState === 'running').length);
    r.page_errors = errors;
    result.runs[motion] = r;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
})().catch(e => { console.error(e); process.exit(2); });
