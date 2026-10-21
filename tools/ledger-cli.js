#!/usr/bin/env node
/* Run the clue ledger over the game's .story files.
 *   node tools/ledger-cli.js [story-dir] [runs-per-group]
 * Exits non-zero when the ledger finds errors, so it can sit in CI next to `k28 ci`. */
const fs = require('fs');
const path = require('path');
const E = require('../app/ui/src/story/engine.js');
const L = require('../app/ui/src/story/ledger.js');

const dir = process.argv[2] || path.join(__dirname, '..', 'content', 'story');
const runs = +(process.argv[3] || 150);
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.story'))
  .sort()
  .map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));

const S = E.parseStory(files);
const R = L.runLedger(S, { runs });
console.log(L.formatLedger(R));
process.exit(R.errors.length ? 1 : 0);
