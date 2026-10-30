#!/usr/bin/env node
/**
 * Static check: every element the code looks up by id must exist — either in
 * the page's markup or in markup the code itself generates. Catches the crash
 * class where markup is removed but a code path still reaches for it.
 *
 *   node tests/static.test.js [path/to/source.html]
 */
const fs = require('fs'), path = require('path');
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'src', 'matter-budget-builder.src.html'));
const text = fs.readFileSync(FILE, 'utf8');

// Ids that exist: static id="x", plus id="x" / id="${...}" emitted from JS strings.
const defined = new Set([...text.matchAll(/\bid=["'`]([A-Za-z][\w-]*)["'`]/g)].map(m => m[1]));
// Ids looked up by the code.
const lookups = new Map();
const note = (id, how) => { if (!lookups.has(id)) lookups.set(id, new Set()); lookups.get(id).add(how); };
for (const m of text.matchAll(/getElementById\(\s*['"`]([A-Za-z][\w-]*)['"`]\s*\)/g)) note(m[1], 'getElementById');
for (const m of text.matchAll(/querySelector(?:All)?\(\s*['"`]#([A-Za-z][\w-]*)/g)) note(m[1], 'querySelector');
for (const m of text.matchAll(/toggleHelp\(\s*'([\w-]+)'\s*\)/g)) note(m[1], 'toggleHelp');

const missing = [...lookups.keys()].filter(id => !defined.has(id)).sort();
console.log(`  ids defined: ${defined.size}   ids looked up: ${lookups.size}`);
missing.forEach(id => console.log(`  FAIL  #${id} is looked up (${[...lookups.get(id)].join(', ')}) but never defined`));
console.log(`\n=== static: ${missing.length ? 'FAIL' : 'PASS'} ===`);
process.exit(missing.length ? 1 : 0);
