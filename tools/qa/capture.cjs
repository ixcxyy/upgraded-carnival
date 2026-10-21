// Browser QA for the redesigned UI against the REAL dev server (real compiler, emulator and
// checkers). It plays into the story, works task 1.1 on the bench and saves screenshots plus a
// JSON report of what it checked. Playwright is not a product dependency: point NODE_PATH at an
// installation, e.g.
//
//   cargo build --release && node app/ui/build.mjs
//   ./target/release/k28-devserver --port 8028 --ui app/dist --data /tmp/sn-qa --res app/src-tauri/resources &
//   NODE_PATH=$(npm root -g) node tools/qa/capture.cjs /tmp/sn-shots [http://127.0.0.1:8028/]
//
// CHROMIUM=/path/to/chrome selects a browser; VIDEO=1 records a motion video of the flow.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || 'qa-shots');
const URL = process.argv[3] || 'http://127.0.0.1:8028/';
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

const report = { started: new Date().toISOString(), url: URL, checks: [], errors: [], shots: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    recordVideo: process.env.VIDEO ? { dir: path.join(OUT, 'video'), size: { width: 1440, height: 900 } } : undefined,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => report.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text()); });
  const shot = async (name, opts) => { const f = path.join(OUT, name + '.png'); await page.screenshot(Object.assign({ path: f }, opts || {})); report.shots.push(name); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.bb-status.busy'), null, { timeout: 180000 });
  const call = (cmd, args) => page.evaluate(([c, a]) => window.K28.call(c, a), [cmd, args]);

  // A fresh profile for this run.
  await page.goto(URL);
  await page.waitForSelector('#title-inner h1');
  const profile = 'QA ' + Date.now().toString(36);
  await call('profile_create', { name: profile });
  await page.evaluate(n => localStorage.setItem('signal-noise.active-profile', n), profile);
  await page.reload();
  await page.waitForSelector('#title-inner h1');
  await page.waitForTimeout(250);
  await shot('01-title-reveal-250ms');
  await page.waitForTimeout(700);
  await shot('02-title');
  check('title: one primary action', await page.locator('#title .btn.primary').count() === 1);
  check('title: decorative strip labelled decorative', (await page.locator('#title .trace .nm').innerText()).includes('decorative'));

  // Story: play to the first task, noting loud and murmured details on the way.
  await page.locator('#title .btn.primary').click();
  let noted = 0, popShot = false;
  for (let i = 0; i < 400; i++) {
    if (await page.locator('.dock .choice').count()) { await page.keyboard.press('1'); continue; }
    if (!(await page.locator('#btn-continue').count())) break;
    // Any open detail will do for QA (the player has to find the quiet ones; the harness doesn't).
    const hs = page.locator('.stream .hs.st-open[role="button"]:not(.st-noted):not(.st-asked)');
    if (noted < 3 && await hs.count()) {
      await hs.last().scrollIntoViewIfNeeded();
      await hs.last().click();
      await page.waitForSelector('.pop');
      await page.waitForTimeout(450);
      if (!popShot) { await shot('04-clue-popover'); popShot = true; }
      const focusedInPop = await page.evaluate(() => !!document.activeElement.closest('.pop'));
      if (noted === 0) check('popover: focus moves into it', focusedInPop);
      if (noted === 0) {
        // Escape closes; Space then continues the story instead of reopening the detail.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        const before = await page.locator('.stream .line').count();
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        check('popover: Escape, then Space continues reading', !(await page.locator('.pop').count()) && (await page.locator('.stream .line').count()) > before);
        await hs.last().click();
        await page.waitForSelector('.pop');
        await page.waitForTimeout(400);
      }
      const note = page.locator('.pop button', { hasText: 'Note it' });
      if (await note.count()) { await note.click(); noted++; } else { await page.keyboard.press('Escape'); noted++; }
      await page.waitForTimeout(250);
      continue;
    }
    await page.keyboard.press('Space');
  }
  await page.waitForTimeout(500);
  await shot('03-story-task-in-hand');
  check('story: reached a task', await page.locator('.dock-task').count() === 1);
  check('story: dialogue stays text', (await page.locator('.stream .line.say .txt').count()) > 5);

  // Notebook rail.
  for (const [tab, name] of [['board', '05-case-board'], ['codex', '06-codex'], ['work', '07-work-order']]) {
    await page.click('.rail-btn[data-tab="' + tab + '"]');
    await page.waitForTimeout(380);
    await shot(name);
  }
  check('work order: pin map from level data', await page.locator('.ticket .pinmap .chip-side').count() >= 2);
  check('rail: active destination has a visible label', await page.locator('.rail-btn[aria-selected="true"] .rl').isVisible());

  // Whisper gating: an undiscovered whisper gets no visual treatment of its own.
  const whisper = await page.evaluate(() => {
    const el = document.querySelector('.stream .hs.v-whisper.st-open:not(.letgo)');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { deco: cs.textDecorationLine, bg: cs.backgroundColor, anim: cs.animationName };
  });
  check('clues: an open whisper is not underlined, tinted or animated', !whisper || (whisper.deco === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(whisper.bg) && whisper.anim === 'none'), whisper ? JSON.stringify(whisper) : 'no open whisper in view');

  // Rail: folding the panel and bringing it back.
  await page.click('.rail-btn[aria-selected="true"]');
  await page.waitForTimeout(400);
  check('rail: clicking the open destination folds the panel', await page.locator('.app.panel-closed').count() === 1);
  await shot('07b-panel-folded');
  await page.click('.rail-btn[data-tab="work"]');
  await page.waitForTimeout(400);
  check('rail: picking a destination unfolds it', await page.locator('.app.panel-closed').count() === 0);

  // Menu sheet and a dialog.
  await page.click('#menu-btn');
  await page.waitForTimeout(450);
  await shot('08-menu');
  await page.locator('.sheet button', { hasText: 'New profile' }).click();
  await page.waitForSelector('.sn-dialog');
  await page.waitForTimeout(350);
  await page.keyboard.type(profile); // already taken: the dialog must say so and stay open
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('dialog: duplicate profile name refused inline', await page.locator('.sn-dialog-err').isVisible());
  await shot('09-dialog-validation');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('dialog: Escape closes and returns focus into the sheet', await page.evaluate(() => !document.querySelector('.sn-dialog') && !!document.activeElement.closest('.sheet')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Workbench with a firmware that fails the latency rule.
  await call('ws_write', { profile, path: 'tasks/1.1/main.c', text: read('content/solutions/anti/1.1/slow-poll.c') });
  await page.locator('.dock-task .btn.primary').click();
  await page.waitForSelector('.bench:not([hidden]) .cm-content');
  await page.waitForTimeout(160);
  await shot('10-bench-enter-160ms');
  await page.waitForTimeout(600);
  await shot('11-bench-open');
  check('bench: analysis area folded before first use', await page.locator('.bench.no-bottom').count() === 1);
  check('bench: editor has focus', await page.evaluate(() => !!document.activeElement.closest('.cm-editor')));
  await page.hover('.dock-btn.b-run');
  await page.waitForTimeout(700);
  await shot('11b-dock-tooltip', { clip: { x: 300, y: 40, width: 760, height: 140 } });
  const tip = await page.evaluate(() => { const t = document.querySelector('.sn-tip.on'); if (!t) return null; const r = t.getBoundingClientRect(); return { text: t.textContent, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
  check('dock: hovering Run shows its name and shortcut inside the window', tip && /Run/.test(tip.text) && /Ctrl\+Enter/.test(tip.text) && tip.inside, tip && tip.text);
  const names = await page.$$eval('.bb button, .bb select', els => els.filter(e => e.offsetParent).map(e => e.getAttribute('aria-label') || e.textContent.trim()).filter(x => !x));
  check('header: every visible control has an accessible name', names.length === 0, names.length + ' unnamed');

  // Build error → diagnostic.
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nint broken(void) { return nope; }\n');
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+b');
  await idle();
  await page.waitForTimeout(400);
  await shot('12-build-error');
  check('build error: Build tab selected with diagnostics', await page.locator('.bp-output:not([hidden]) .diags li.error').count() > 0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);

  await page.keyboard.press('Control+Enter');
  await idle();
  await page.waitForTimeout(500);
  await shot('13-run-result');
  await page.click('.btabs .ptab:nth-child(2)'); // waveform is first after the indicator span
  await page.waitForTimeout(400);
  await shot('14-waveform');

  await page.keyboard.press('Control+Shift+Enter');
  await idle();
  await page.waitForTimeout(500);
  await shot('15-submit-failed');
  const chips = await page.locator('.seed-chip').count();
  check('submit: one chip per seed from the backend', chips >= 2, chips + ' chips');
  const ev = page.locator('.rules li.lead .btn', { hasText: 'Show on the waveform' }).first();
  if (await ev.count()) {
    await ev.click();
    await idle();
    await page.waitForTimeout(250);
    await shot('16-evidence-bloom');
    await page.waitForTimeout(900);
    await shot('17-evidence');
    check('evidence: expected lane drawn', await page.evaluate(() => !!document.querySelector('.bp-wave:not([hidden])')));
  }

  // Debugger: step forward twice, then back.
  await page.keyboard.press('F5');
  await page.waitForSelector('.bench.debugging', { timeout: 120000 });
  await page.waitForTimeout(800);
  await shot('18-debug');
  const t0 = await page.locator('.dtime').innerText();
  await page.keyboard.press('F10'); await page.waitForTimeout(600);
  await page.keyboard.press('F10'); await page.waitForTimeout(600);
  const t1 = await page.locator('.dtime').innerText();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(200);
  await shot('19-reverse-step-ack');
  await page.waitForTimeout(700);
  const t2 = await page.locator('.dtime').innerText();
  check('debug: stepping advances time', t0 !== t1, t0 + ' → ' + t1);
  check('debug: reverse step returns to an earlier backend time', t2 !== t1, t1 + ' → ' + t2);
  await shot('20-after-reverse');
  await page.keyboard.press('Shift+F5');
  await page.waitForTimeout(400);

  // Datasheet search.
  await page.click('.stabs .ptab[aria-label="Datasheet"]');
  await page.waitForTimeout(300);
  await page.fill('.ds-q', 'PCLKCR');
  await page.waitForTimeout(500);
  await shot('21-datasheet');
  check('datasheet: search finds PCLKCR', /of/.test(await page.locator('.ds-count').innerText()));

  // A file dialog, keyboard only.
  await page.locator('.fg-h .ibtn').first().click();
  await page.waitForSelector('.sn-dialog');
  await page.waitForTimeout(350);
  await shot('22-new-file-dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Focus mode, then the sizes the native window allows.
  await page.keyboard.press('Control+Shift+E');
  await page.waitForTimeout(450);
  await shot('23-focus-editor');
  await page.keyboard.press('Control+Shift+E');
  await page.waitForTimeout(400);
  for (const [w, hgt] of [[1000, 620], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(450);
    await shot('24-bench-' + w + 'x' + hgt);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('bench ' + w + 'x' + hgt + ': no horizontal overflow', !over);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.bh-back').click();
  await page.waitForTimeout(500);
  await shot('25-back-to-story');

  // Light theme and narrow browser.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.Bench && window.Bench.setAppearance(); });
  await page.waitForTimeout(300);
  await shot('26-story-light');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.Bench && window.Bench.setAppearance(); });
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.waitForTimeout(400);
  await shot('27-story-1000x620');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(400);
  await shot('28-story-720');
  await page.click('.mtabs .tab[data-view="board"]');
  await page.waitForTimeout(300);
  await shot('29-case-720');
  check('narrow: no horizontal overflow', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await ctx.close();
  await browser.close();
  const failed = report.checks.filter(c => !c.ok).length;
  console.log('checks: ' + (report.checks.length - failed) + '/' + report.checks.length + ' · page errors: ' + report.errors.length);
  process.exit(failed || report.errors.length ? 1 : 0);
})().catch(e => { console.error(e); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(Object.assign(report, { crash: String(e.stack || e) }), null, 1)); process.exit(2); });
