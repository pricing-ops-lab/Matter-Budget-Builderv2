#!/usr/bin/env node
/**
 * Offline self-containment test.
 *
 * Opens the built app from file:// with EVERY network request intercepted and
 * aborted, then exercises the one bundled library (XLSX) the way the app uses
 * it. Also asserts the libraries the budget edition no longer needs (pdf.js,
 * jsPDF) are absent, so they cannot quietly creep back into the download.
 *
 *   node tests/offline.test.js [path/to/built.html]
 */
const path = require('path');
const { chromium } = loadPlaywright();
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'matter-budget-builder.html'));

function loadPlaywright() {
  try { return require('playwright'); }
  catch { return require('/opt/node22/lib/node_modules/playwright'); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const external = [];
  await ctx.route('**', r => {
    const u = r.request().url();
    if (!/^(file|blob|data):/.test(u)) { external.push(u); return r.abort(); }
    return r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => {
    const out = { libraries: { XLSX: typeof window.XLSX, pdfjsLib: typeof window.pdfjsLib, jspdf: typeof window.jspdf } };
    try {   // xlsx round trip — the budget upload and Excel export path
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Phase','Task','TKID','Hours'],['DD','Review','TK001',10]]), 'Budget');
      const back = XLSX.read(new Uint8Array(XLSX.write(wb, { type:'array', bookType:'xlsx' })), { type:'array' });
      out.xlsx = JSON.stringify(XLSX.utils.sheet_to_json(back.Sheets.Budget, { header:1 }));
    } catch (e) { out.xlsx = 'ERR ' + e.message; }
    out.workerBlock = !!document.getElementById('pdfjs-worker-src');
    return out;
  });
  await browser.close();

  const size = require('fs').statSync(FILE).size;
  const checks = [
    ['XLSX loaded',                        r.libraries.XLSX === 'object'],
    ['xlsx round trip',                    r.xlsx === '[["Phase","Task","TKID","Hours"],["DD","Review","TK001",10]]'],
    ['pdf.js not shipped',                 r.libraries.pdfjsLib === 'undefined' && !r.workerBlock],
    ['jsPDF not shipped',                  r.libraries.jspdf === 'undefined'],
    [`file stays lean (${(size/1024).toFixed(0)} KB < 1 MB)`, size < 1024 * 1024],
    ['no network requests',                external.length === 0],
    ['no page errors',                     errors.length === 0],
  ];
  checks.forEach(([n, ok]) => console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`));
  if (external.length) console.log('  attempted:', external);
  if (errors.length) console.log('  errors:', errors);
  const pass = checks.every(c => c[1]);
  console.log(`\n=== offline: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})();
