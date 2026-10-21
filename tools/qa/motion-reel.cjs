// Records a short video of the redesign's signature motion in the real app (real dev server):
// title reveal, clue popover, task-to-bench continuity, dock indicator and tooltips, evidence
// on the waveform, a reverse step, and the way back. A first, unrecorded pass prepares a
// profile that has a task in hand.
//
//   NODE_PATH=$(npm root -g) node tools/qa/motion-reel.cjs /tmp/sn-reel [http://127.0.0.1:8028/]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || 'qa-reel');
const URL = process.argv[3] || 'http://127.0.0.1:8028/';
fs.mkdirSync(OUT, { recursive: true });
const SIZE = { width: 1280, height: 800 };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const profile = 'Reel ' + Date.now().toString(36);

  // Preparation, not recorded.
  {
    const ctx = await browser.newContext({ viewport: SIZE });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForSelector('#title-inner h1');
    await page.evaluate(n => window.K28.call('profile_create', { name: n }), profile);
    await page.evaluate(n => localStorage.setItem('signal-noise.active-profile', n), profile);
    await page.reload();
    await page.locator('#title .btn.primary').click();
    for (let i = 0; i < 400; i++) {
      if (await page.locator('.dock .choice').count()) { await page.keyboard.press('1'); continue; }
      if (!(await page.locator('#btn-continue').count())) break;
      await page.keyboard.press('Space');
    }
    await page.evaluate(([p, t]) => window.K28.call('ws_write', { profile: p, path: 'tasks/1.1/main.c', text: t }),
      [profile, fs.readFileSync(path.join(ROOT, 'content/solutions/anti/1.1/slow-poll.c'), 'utf8')]);
    await page.waitForTimeout(800); // the story save settles
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  await ctx.addInitScript(n => { try { localStorage.setItem('signal-noise.active-profile', n); } catch (e) {} }, profile);
  const page = await ctx.newPage();
  const idle = () => page.waitForFunction(() => !document.querySelector('.bb-status.busy'), null, { timeout: 180000 });
  await page.goto(URL);
  await page.waitForSelector('#title-inner h1');
  // 1. Title: noise resolves into the pulse; the wordmark's sheen follows the pointer.
  for (let i = 0; i <= 20; i++) { await page.mouse.move(250 + i * 40, 330); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  await page.locator('#title .btn.primary').click();
  await page.waitForTimeout(900);
  // 2. Tooltips spring between rail destinations; the rail indicator moves.
  for (const t of ['board', 'codex', 'work']) { await page.hover('.rail-btn[data-tab="' + t + '"]'); await page.waitForTimeout(500); await page.click('.rail-btn[data-tab="' + t + '"]'); await page.waitForTimeout(600); }
  // 3. Task card to workbench.
  await page.locator('.dock-task .btn.primary').click();
  await page.waitForSelector('.bench:not([hidden]) .cm-content');
  await page.waitForTimeout(1200);
  for (const b of ['b-build', 'b-run', 'b-debug', 'b-submit']) { await page.hover('.dock-btn.' + b); await page.waitForTimeout(450); }
  // 4. Submit (fails), then the evidence moves onto the waveform.
  await page.keyboard.press('Control+Shift+Enter');
  await idle();
  await page.waitForTimeout(1400);
  const ev = page.locator('.rules li.lead .btn', { hasText: 'Show on the waveform' }).first();
  if (await ev.count()) { await ev.click(); await idle(); await page.waitForTimeout(1800); }
  // 5. Debugger: the dock swaps its instruments; step, step, step back.
  await page.keyboard.press('F5');
  await page.waitForSelector('.bench.debugging', { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('F10'); await page.waitForTimeout(900);
  await page.keyboard.press('F10'); await page.waitForTimeout(900);
  await page.keyboard.press('Shift+F10'); await page.waitForTimeout(1400);
  await page.keyboard.press('Shift+F5'); await page.waitForTimeout(900);
  // 6. Focus mode and back to the story.
  await page.keyboard.press('Control+Shift+E'); await page.waitForTimeout(900);
  await page.keyboard.press('Control+Shift+E'); await page.waitForTimeout(900);
  await page.locator('.bh-back').click();
  await page.waitForTimeout(1200);
  const video = page.video();
  await ctx.close();
  const file = await video.path();
  fs.renameSync(file, path.join(OUT, 'motion-reel.webm'));
  await browser.close();
  console.log('wrote ' + path.join(OUT, 'motion-reel.webm'));
})().catch(e => { console.error(e); process.exit(2); });
