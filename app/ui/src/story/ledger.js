/* SIGNAL / NOISE — clue ledger.
 * Static checks over the story model, then simulated playthroughs through the real engine:
 * zero-click runs must reach the ending, attentive runs show which epilogue fragments open. */
(function (root, factory) {
  var E = root && root.StoryEngine;
  if (!E && typeof require === 'function') E = require('./engine.js');
  var api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryLedger = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* One playthrough. attention: chance of stopping on each hotspot; askRate: chance of asking when possible. */
  function simulate(S, opts) {
    const o = Object.assign({ seed: 1, attention: 0, askRate: 1, extra: true, maxFails: 0, codas: false, snapshots: false }, opts);
    const rnd = mulberry32(o.seed);
    const e = new E.Engine(S, { noSnapshots: !o.snapshots });
    const pending = new Set(), decided = new Set();
    let scan = 0, steps = 0;
    e.start();

    function look() {
      const st = e.state;
      for (; scan < st.log.length; scan++) {
        const en = st.log[scan];
        if (en.text) for (const id of E.cluesIn(en.text)) pending.add(id);
      }
      if (o.attention > 0) {
        for (const d of st.docOrder) {
          if (!st.docs[d].read) e.readDoc(d);
          for (const p of S.docs[d].paras) for (const id of E.cluesIn(p)) pending.add(id);
        }
        for (const t of st.taskOrder) {
          e.seeTask(t);
          const T = S.tasks[t];
          if (T.capture) for (const c of T.capture.channels) if (c.clue) pending.add(c.clue);
          if (T.parts) for (const id of E.cluesIn(T.parts)) pending.add(id);
        }
      }
    }
    function attend() {
      if (!o.attention) return false;
      for (const id of Array.from(pending)) {
        if (decided.has(id)) continue;
        const status = e.clueStatus(id);
        if (status === 'pending') continue;
        decided.add(id);
        if (status !== 'open') continue;
        if (rnd() >= o.attention) continue;
        const info = e.notice(id);
        if (!info) continue;
        const canAsk = info.actions.some(a => a.id === 'ask');
        e.act(id, canAsk && rnd() < o.askRate ? 'ask' : 'note');
        return true;
      }
      return false;
    }

    while (steps++ < 60000) {
      const st = e.state;
      if (st.error) return { ok: false, error: st.error, e, steps };
      look();
      if (attend()) continue;
      const w = st.wait;
      if (!w) { e.advance(); continue; }
      if (w.type === 'menu') {
        const choices = e.options();
        e.choose(choices[Math.floor(rnd() * choices.length)].i);
        continue;
      }
      if (w.type === 'task') {
        const fails = o.maxFails ? Math.floor(rnd() * (o.maxFails + 1)) : 0;
        for (let f = 0; f < fails; f++) e.failRun(w.id);
        e.pass(w.id, o.extra);
        continue;
      }
      if (w.type === 'recall') { e.finishRecall(); continue; }
      if (w.type === 'believe') { e.submitBeliefs({}); continue; }
      if (w.type === 'ending') {
        const open = e.codaList().filter(k => k.open).map(k => k.id);
        if (o.codas) {
          for (const id of open) {
            e.playCoda(id);
            let guard = 0;
            while (!e.state.wait && !e.state.error && guard++ < 500) e.advance();
            if (e.state.error) return { ok: false, error: e.state.error, e, steps, open };
          }
        }
        return { ok: true, e, steps, open };
      }
    }
    return { ok: false, error: 'The run hit the step limit without reaching the ending.', e, steps };
  }

  function flatten(ops, fn) {
    ops.forEach((op, pc) => {
      fn(op, pc);
      if (op.op === 'if') fn(op.then, pc, op.cond);
      if (op.op === 'menu') op.options.forEach(opt => fn(opt, pc));
    });
  }

  function runLedger(S, opts) {
    const o = Object.assign({ runs: 150 }, opts);
    const t0 = Date.now();
    const R = {
      story: { files: S.files, hash: S.hash },
      errors: S.errors.slice(), warnings: S.warnings.slice(), notes: [],
      keys: [], gates: [], runs: null, ms: 0,
    };
    const err = (where, msg) => R.errors.push({ where, msg });
    const warn = (where, msg) => R.warnings.push({ where, msg });
    const note = (where, msg) => R.notes.push({ where, msg });

    const refs = {}, flagSet = {}, statInc = {}, hypOpen = {}, docUnlock = {}, devUnlock = {}, taskIssue = {}, plants = {}, callers = {};
    const addRef = (id, from) => (refs[id] = refs[id] || []).push(from);
    const addPlant = (text, loc) => { for (const id of E.cluesIn(text)) (plants[id] = plants[id] || []).push(loc); };

    if (!S.scenes[S.meta.start]) err('@@start', `The start scene "${S.meta.start}" doesn't exist.`);
    addRef(S.meta.start, '@@start');
    if (S.meta.player && !S.people[S.meta.player]) warn('@@player', `@@player "${S.meta.player}" isn't a person.`);
    for (const ch of S.chapters) {
      for (const d of ch.docs) {
        if (!S.docs[d]) err(ch.where, `Chapter ${ch.id} unlocks a document "${d}" that doesn't exist.`);
        else (docUnlock[d] = docUnlock[d] || []).push({ at: ch.index + 1, how: 'end of ' + ch.id });
      }
    }

    const checkCond = (cond, where) => {
      if (!cond) return;
      for (const a of cond.atoms) {
        if ((a.kind === 'seen' || a.kind === 'noticed' || a.kind === 'followed') && !S.clues[a.key]) err(where, `Condition refers to a clue "${a.key}" that doesn't exist.`);
        if ((a.kind === 'solved' || a.kind === 'taskextra') && !S.tasks[a.key]) err(where, `Condition refers to a task "${a.key}" that doesn't exist.`);
        if ((a.kind === 'tag' || a.kind === 'tagphases') && !S.order.clues.some(id => S.clues[id].tags.indexOf(a.key) >= 0)) err(where, `No clue carries the tag "${a.key}".`);
      }
    };
    const condAtoms = [];

    for (const sid of S.order.scenes) {
      const sc = S.scenes[sid];
      if (sc.chapter && sc.chapter !== 'epilogue' && !S.chapterMap[sc.chapter]) err(sc.where, `Scene "${sid}" is in chapter "${sc.chapter}", which isn't declared.`);
      if (sc.place && !S.places[sc.place]) err(sc.where, `Scene "${sid}" is at place "${sc.place}", which doesn't exist.`);
      if (!sc.call && !sc.location) warn(sc.where, `Scene "${sid}" has no @location, so it won't get a location stamp.`);
      flatten(sc.ops, (op, pc, cond) => {
        if (cond) { checkCond(cond, op.where); condAtoms.push({ cond, where: op.where }); }
        if (op.op === 'opt') {
          if (op.cond) { checkCond(op.cond, op.where); condAtoms.push({ cond: op.cond, where: op.where }); }
          if (op.target) {
            if (!S.scenes[op.target]) err(op.where, `Choice "${op.label}" points to a scene "${op.target}" that doesn't exist.`);
            else {
              addRef(op.target, sid);
              if (op.mode === 'call') {
                (callers[op.target] = callers[op.target] || []).push({ scene: sid });
                if (!S.scenes[op.target].call) warn(op.where, `"=>" calls "${op.target}", which isn't marked "@kind call"; it will return here when it ends.`);
              } else if (S.scenes[op.target].call) warn(op.where, `"->" jumps to "${op.target}", which is a call scene; it will have nowhere to return to.`);
            }
          }
        }
        if (op.op === 'say') {
          if (!S.shortToPerson[op.who]) err(op.where, `Speaker "${op.who}" isn't anyone's @short name.`);
          addPlant(op.text, { type: 'scene', id: sid, where: op.where });
        }
        if (op.op === 'narr') addPlant(op.text, { type: 'scene', id: sid, where: op.where });
        if (op.op === 'cmd') {
          const need = E.COMMANDS[op.name];
          if (need === undefined) { err(op.where, `Unknown command "! ${op.name}".`); return; }
          if (op.args.length < need) err(op.where, `"! ${op.name}" needs ${need} argument${need > 1 ? 's' : ''}.`);
          const a = op.args[0];
          switch (op.name) {
            case 'next':
              if (!S.scenes[a]) err(op.where, `"! next ${a}": no such scene.`); else addRef(a, sid);
              break;
            case 'chapter': case 'endchapter':
              if (!S.chapterMap[a]) err(op.where, `"! ${op.name} ${a}": no such chapter.`);
              break;
            case 'task':
              if (!S.tasks[a]) err(op.where, `"! task ${a}": no such task.`); else (taskIssue[a] = taskIssue[a] || []).push(sid);
              break;
            case 'stat':
              if (!/^[+-]?\d+$/.test(op.args[1] || '')) err(op.where, `"! stat ${a}" needs a number like +1.`);
              else if (+op.args[1] > 0) statInc[a] = (statInc[a] || 0) + (+op.args[1]);
              break;
            case 'flag': flagSet[a] = (flagSet[a] || 0) + 1; break;
            case 'open': case 'demote':
              if (!S.hyps[a]) err(op.where, `"! ${op.name} ${a}": no such hypothesis.`); else (hypOpen[a] = hypOpen[a] || []).push(sid);
              break;
            case 'doc':
              if (!S.docs[a]) err(op.where, `"! doc ${a}": no such document.`); else (docUnlock[a] = docUnlock[a] || []).push({ scene: sid, how: 'scene ' + sid });
              break;
            case 'device':
              if (!S.devices[a]) err(op.where, `"! device ${a}": no such device.`); else (devUnlock[a] = devUnlock[a] || []).push(sid);
              break;
            case 'place':
              if (!S.places[a]) err(op.where, `"! place ${a}": no such place.`);
              break;
          }
        }
      });
    }

    for (const tid of S.order.tasks) {
      const T = S.tasks[tid];
      if (!S.chapterMap[T.chapter]) err(T.where, `Task ${tid} is in chapter "${T.chapter}", which isn't declared.`);
      if (T.after) { if (!S.scenes[T.after]) err(T.where, `Task ${tid}: @after "${T.after}" doesn't exist.`); else addRef(T.after, 'task ' + tid); }
      else warn(T.where, `Task ${tid} has no @after scene; the story continues in the scene that issued it.`);
      if (T.device) { if (!S.devices[T.device]) err(T.where, `Task ${tid}: device "${T.device}" doesn't exist.`); else (devUnlock[T.device] = devUnlock[T.device] || []).push('task ' + tid); }
      if (!taskIssue[tid]) err(T.where, `Task ${tid} is never issued with "! task ${tid}".`);
      else if (taskIssue[tid].length > 1) warn(T.where, `Task ${tid} is issued from ${taskIssue[tid].length} places.`);
      if (T.hints.length < 3) warn(T.where, `Task ${tid} has ${T.hints.length} hint tier${T.hints.length === 1 ? '' : 's'}; the design calls for three.`);
      for (const h of T.hints) if (!h.who || !S.shortToPerson[h.who]) err(h.where, `Task ${tid}: a hint needs "Speaker: text" with a known speaker.`);
      for (const x of T.extra) { checkCond(x.cond, x.where); condAtoms.push({ cond: x.cond, where: x.where }); }
      if (T.capture) for (const c of T.capture.channels) if (c.clue) (plants[c.clue] = plants[c.clue] || []).push({ type: 'task', id: tid, where: T.capture.where });
      if (T.parts) addPlant(T.parts, { type: 'task', id: tid, where: T.where });
    }

    for (const did of S.order.docs) {
      const D = S.docs[did];
      for (const p of D.paras) addPlant(p, { type: 'doc', id: did, where: D.where });
      if (!docUnlock[did]) warn(D.where, `Document "${did}" is never unlocked.`);
    }
    for (const vid of S.order.devices) if (!devUnlock[vid]) warn(S.devices[vid].where, `Device "${vid}" is never unlocked.`);

    for (const cid of S.order.clues) {
      const C = S.clues[cid];
      if (!S.chapterMap[C.chapter]) err(C.where, `Clue "${cid}" is in chapter "${C.chapter}", which isn't declared.`);
      for (const h of C.supports.concat(C.weakens, C.opens)) if (!S.hyps[h]) err(C.where, `Clue "${cid}" refers to hypothesis "${h}", which doesn't exist.`);
      for (const h of C.opens) if (S.hyps[h]) (hypOpen[h] = hypOpen[h] || []).push('clue ' + cid);
      for (const x of C.obsIf) { checkCond(x.cond, x.where); condAtoms.push({ cond: x.cond, where: x.where }); }
      if (C.ask) {
        if (!S.scenes[C.ask.scene]) err(C.where, `Clue "${cid}": @ask scene "${C.ask.scene}" doesn't exist.`);
        else {
          addRef(C.ask.scene, 'clue ' + cid);
          (callers[C.ask.scene] = callers[C.ask.scene] || []).push({ chapter: C.chapter });
          if (!S.scenes[C.ask.scene].call) warn(C.where, `Clue "${cid}": ask scene "${C.ask.scene}" should be "@kind call".`);
        }
      }
      if (C.decoy && (C.supports.length || C.weakens.length)) warn(C.where, `Decoy "${cid}" supports or weakens a hypothesis; decoys should be harmless.`);
      if (!plants[cid]) err(C.where, `Clue "${cid}" is never planted: no {text|${cid}} hotspot anywhere.`);
    }
    for (const id in plants) if (!S.clues[id]) err(plants[id][0].where, `Hotspot points to a clue "${id}" that doesn't exist.`);

    for (const hid of S.order.hyps) if (!hypOpen[hid]) warn(S.hyps[hid].where, `Hypothesis "${hid}" never reaches the case board.`);

    for (const kid of S.order.codas) {
      const K = S.codas[kid];
      if (!S.scenes[K.scene]) err(K.where, `Epilogue "${kid}": scene "${K.scene}" doesn't exist.`);
      else addRef(K.scene, 'coda ' + kid);
      if (!K.requires) warn(K.where, `Epilogue "${kid}" has no @requires, so it's always open.`);
      else { checkCond(K.requires, K.where); condAtoms.push({ cond: K.requires, where: K.where }); }
    }

    for (const { cond, where } of condAtoms) {
      for (const a of cond.atoms) {
        if (a.kind === 'flag' && !flagSet[a.key]) warn(where, `Flag "${a.key}" is tested but never set.`);
        if (a.kind === 'stat' && !statInc[a.key]) warn(where, `Stat "${a.key}" is tested but never raised.`);
      }
    }

    for (const sid of S.order.scenes) if (!refs[sid]) warn(S.scenes[sid].where, `Scene "${sid}" is never reached: nothing points to it.`);

    /* Which chapter does each scene play in? Call scenes inherit from whoever calls them. */
    const sceneCh = {};
    for (const sid of S.order.scenes) if (S.scenes[sid].chapter) sceneCh[sid] = S.scenes[sid].chapter;
    for (let pass = 0; pass < 6; pass++) {
      for (const sid in callers) {
        if (sceneCh[sid]) continue;
        for (const c of callers[sid]) { const ch = c.chapter || sceneCh[c.scene]; if (ch) { sceneCh[sid] = ch; break; } }
      }
    }

    const idx = ch => (S.chapterMap[ch] ? S.chapterMap[ch].index : -1);
    const hotspotCount = {};
    for (const cid in plants) {
      const C = S.clues[cid];
      if (!C) continue;
      for (const p of plants[cid]) {
        if (p.type === 'scene') {
          hotspotCount[p.id] = (hotspotCount[p.id] || 0) + 1;
          const ch = sceneCh[p.id];
          if (ch && ch !== C.chapter) warn(p.where, `Clue "${cid}" belongs to ${C.chapter} but is planted in ${ch}; its hotspot won't open there.`);
        } else if (p.type === 'task') {
          const T = S.tasks[p.id];
          if (T.chapter !== C.chapter) warn(p.where, `Clue "${cid}" belongs to ${C.chapter} but sits in task ${p.id} (${T.chapter}).`);
        } else if (p.type === 'doc') {
          const avail = (docUnlock[p.id] || []).map(u => (u.scene ? idx(sceneCh[u.scene]) : u.at)).filter(n => n >= 0);
          const first = avail.length ? Math.min.apply(null, avail) : -1;
          if (first >= 0 && idx(C.chapter) < first) warn(p.where, `Clue "${cid}" (${C.chapter}) is in "${p.id}", which only unlocks later; the hotspot will already be closed.`);
        }
      }
    }
    for (const sid in hotspotCount) if (hotspotCount[sid] > 2) note(S.scenes[sid].where, `Scene "${sid}" has ${hotspotCount[sid]} hotspots; the design suggests 0–2.`);

    /* Rule of three for candidate conclusions. */
    const phaseOf = cid => (S.chapterMap[S.clues[cid].chapter] || {}).phase || '?';
    for (const hid of S.order.hyps) {
      const H = S.hyps[hid];
      const pro = S.order.clues.filter(c => !S.clues[c].decoy && S.clues[c].supports.indexOf(hid) >= 0);
      const con = S.order.clues.filter(c => !S.clues[c].decoy && S.clues[c].weakens.indexOf(hid) >= 0);
      const vol = { loud: 0, murmur: 0, whisper: 0 };
      for (const c of pro) vol[S.clues[c].volume] = (vol[S.clues[c].volume] || 0) + 1;
      const phases = Array.from(new Set(pro.map(phaseOf)));
      const row = { id: hid, text: H.text, question: H.question, key: H.key, trail: H.trail, pro: pro.length, con: con.length, phases, vol };
      R.keys.push(row);
      if (H.key && pro.length < 3) warn(H.where, `Rule of three: "${H.text}" has only ${pro.length} supporting clue${pro.length === 1 ? '' : 's'}.`);
      if (H.trail && con.length === 0) note(H.where, `False trail "${hid}" is broken only by the story; no clue weakens it directly.`);
    }

    /* Every phase should plant clues. */
    const perPhase = {};
    for (const ch of S.chapters) perPhase[ch.phase] = 0;
    for (const cid of S.order.clues) if (!S.clues[cid].decoy) perPhase[phaseOf(cid)] = (perPhase[phaseOf(cid)] || 0) + 1;
    for (const ph in perPhase) if (!perPhase[ph]) warn('phases', `The ${ph} phase plants no clues.`);
    R.perPhase = perPhase;

    /* Epilogue gates and their slack: how many things can be missed before a gate locks. */
    for (const kid of S.order.codas) {
      const K = S.codas[kid];
      const g = { id: kid, title: K.title, kind: K.kind, requires: K.requires ? K.requires.src : '', atoms: [], minSlack: Infinity };
      for (const a of (K.requires ? K.requires.atoms : [])) {
        const src = (a.neg ? '!' : '') + a.kind + ':' + a.key + (a.cmp ? a.cmp + a.n : '');
        let slack = null, detail = '';
        if (a.kind === 'tag' || a.kind === 'tagphases') {
          const cands = S.order.clues.filter(c => !S.clues[c].decoy && S.clues[c].tags.indexOf(a.key) >= 0);
          if (a.kind === 'tag') { slack = cands.length - a.n; detail = `${cands.length} clues carry "${a.key}"`; }
          else {
            const byPh = {};
            for (const c of cands) byPh[phaseOf(c)] = (byPh[phaseOf(c)] || 0) + 1;
            const counts = Object.values(byPh).sort((x, y) => y - x);
            slack = counts.length < a.n ? -1 : counts[a.n - 1] - 1;
            detail = Object.keys(byPh).map(p => `${p} ${byPh[p]}`).join(', ');
          }
        } else if (a.kind === 'stat') {
          const src2 = statInc[a.key] || 0;
          slack = src2 - a.n;
          detail = `${src2} raise${src2 === 1 ? '' : 's'} available`;
        } else if (a.kind === 'flag') {
          slack = (flagSet[a.key] || 0) - 1;
          detail = `set in ${flagSet[a.key] || 0} place${flagSet[a.key] === 1 ? '' : 's'}`;
        } else if (a.kind === 'followed' || a.kind === 'noticed' || a.kind === 'seen') {
          slack = 0;
          detail = 'depends on one clue';
          warn(K.where, `Epilogue "${kid}" depends on a single clue (${a.key}); one miss locks it.`);
        } else if (a.kind === 'taskextra') {
          /* Ways to unlock the extra check: for each @extra, the scarcest flag it needs; the best @extra wins. */
          const T = S.tasks[a.key];
          let best = 0;
          for (const x of (T ? T.extra : [])) {
            let ways = Infinity;
            for (const y of (x.cond ? x.cond.atoms : [])) if (y.kind === 'flag' && !y.neg) ways = Math.min(ways, flagSet[y.key] || 0);
            best = Math.max(best, ways === Infinity ? 1 : ways);
          }
          slack = best - 1;
          detail = `the extra check in ${a.key}, which can unlock ${best} way${best === 1 ? '' : 's'}, then the code for it`;
        } else detail = 'on the main path';
        g.atoms.push({ src, slack, detail });
        if (slack !== null) g.minSlack = Math.min(g.minSlack, slack);
      }
      if (g.minSlack < 0) err(K.where, `Epilogue "${kid}" can never open: ${g.atoms.filter(x => x.slack < 0).map(x => x.src).join(', ')}.`);
      R.gates.push(g);
    }

    /* Simulated playthroughs. */
    if (o.runs > 0 && !R.errors.length) {
      const allScenes = S.order.scenes.slice();
      const covered = new Set();
      const groups = [
        { key: 'zero', label: 'Zero clicks, random choices', opts: { attention: 0 } },
        { key: 'attentive', label: 'Every hotspot followed, random choices', opts: { attention: 1, askRate: 1, codas: true } },
        { key: 'mixed', label: 'Half the hotspots, failed runs and hints', opts: { attention: 0.5, askRate: 0.5, maxFails: 6, codas: true } },
      ];
      const runs = { groups: [], codaRates: {} };
      for (const kid of S.order.codas) runs.codaRates[kid] = {};
      for (const G of groups) {
        const res = { key: G.key, label: G.label, n: o.runs, ok: 0, errors: [], followed: 0, hints: 0, codas: {} };
        for (let i = 0; i < o.runs; i++) {
          const seed = (G.key.length * 7919 + i * 104729) >>> 0;
          const r = simulate(S, Object.assign({ seed }, G.opts));
          for (const en of r.e.state.log) if (en.scene) covered.add(en.scene);
          if (!r.ok) { if (res.errors.length < 5) res.errors.push({ seed, error: r.error }); continue; }
          const sm = r.e.summary();
          if (sm.passed !== sm.tasks) { if (res.errors.length < 5) res.errors.push({ seed, error: `Reached the ending with ${sm.passed}/${sm.tasks} tasks passed.` }); continue; }
          res.ok++;
          res.followed += sm.clues.followed;
          res.hints += sm.hints;
          for (const id of r.open) res.codas[id] = (res.codas[id] || 0) + 1;
        }
        res.followed = res.ok ? +(res.followed / res.ok).toFixed(1) : 0;
        res.hints = res.ok ? +(res.hints / res.ok).toFixed(1) : 0;
        for (const kid of S.order.codas) runs.codaRates[kid][G.key] = res.codas[kid] || 0;
        runs.groups.push(res);
        if (res.ok < res.n) err('runs', `${G.label}: ${res.n - res.ok} of ${res.n} runs failed. First: ${res.errors[0] ? res.errors[0].error : '?'}`);
      }
      const zero = runs.groups[0];
      if (zero.ok === zero.n) note('runs', `Main ending reached in all ${zero.n} zero-click runs.`);
      for (const kid of S.order.codas) {
        const any = Object.values(runs.codaRates[kid]).some(v => v > 0);
        if (!any) warn(S.codas[kid].where, `Epilogue "${kid}" never opened in any simulated run.`);
        if (runs.codaRates[kid].zero > 0) note(S.codas[kid].where, `Epilogue "${kid}" opened in ${runs.codaRates[kid].zero} zero-click runs; it may need a clue gate.`);
      }
      const a = simulate(S, { seed: 424242, attention: 0.6, askRate: 0.5, maxFails: 5 });
      const b = simulate(S, { seed: 424242, attention: 0.6, askRate: 0.5, maxFails: 5 });
      runs.deterministic = JSON.stringify(a.e.state.log) === JSON.stringify(b.e.state.log);
      if (!runs.deterministic) err('runs', 'The same seed produced two different logs; something in the engine is not deterministic.');
      const missing = allScenes.filter(s => !covered.has(s) && !S.sceneToCoda[s]);
      runs.coverage = { covered: allScenes.length - missing.length, total: allScenes.length, missing };
      if (missing.length) warn('runs', `Scenes never played in any run: ${missing.join(', ')}.`);
      R.runs = runs;
    }
    R.ms = Date.now() - t0;
    return R;
  }

  function formatLedger(R) {
    const out = [];
    const p = s => out.push(s);
    p(`CLUE LEDGER · story ${R.story.hash} · ${R.story.files.length} files · ${R.ms} ms`);
    p('');
    p(`Errors: ${R.errors.length}   Warnings: ${R.warnings.length}   Notes: ${R.notes.length}`);
    for (const e of R.errors) p(`  ERROR    ${e.where}  ${e.msg}`);
    for (const w of R.warnings) p(`  warning  ${w.where}  ${w.msg}`);
    for (const n of R.notes) p(`  note     ${n.where}  ${n.msg}`);
    p('');
    p('Hypotheses (supporting / weakening clues, phases):');
    for (const k of R.keys) p(`  ${k.id.padEnd(4)} ${k.key ? 'key  ' : k.trail ? 'trail' : '     '} +${String(k.pro).padEnd(3)} -${String(k.con).padEnd(3)} ${k.phases.join('/') || '—'}  ${k.text}`);
    p('');
    p('Epilogue gates (slack = how many can be missed):');
    for (const g of R.gates) {
      p(`  ${g.id} · ${g.title} · requires ${g.requires}`);
      for (const a of g.atoms) p(`      ${a.src.padEnd(26)} slack ${a.slack === null ? '—' : a.slack}  (${a.detail})`);
    }
    if (R.runs) {
      p('');
      p('Simulated playthroughs:');
      for (const g of R.runs.groups) {
        p(`  ${g.label}: ${g.ok}/${g.n} reached the ending · avg ${g.followed} clues followed · avg ${g.hints} hints`);
        for (const e of g.errors) p(`      seed ${e.seed}: ${e.error}`);
      }
      p('  Epilogue fragments opened (zero / attentive / mixed):');
      for (const id in R.runs.codaRates) {
        const r = R.runs.codaRates[id];
        p(`      ${id.padEnd(14)} ${String(r.zero || 0).padStart(4)} ${String(r.attentive || 0).padStart(4)} ${String(r.mixed || 0).padStart(4)}`);
      }
      p(`  Scene coverage: ${R.runs.coverage.covered}/${R.runs.coverage.total}` + (R.runs.coverage.missing.length ? ` (never played: ${R.runs.coverage.missing.join(', ')})` : ''));
      p(`  Deterministic: ${R.runs.deterministic ? 'yes' : 'NO'}`);
    }
    return out.join('\n');
  }

  return { runLedger, simulate, formatLedger, mulberry32 };
});
