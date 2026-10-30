#!/usr/bin/env node
/**
 * Offline self-containment test.
 *
 * Opens the built app from file:// with EVERY network request intercepted and
 * aborted, then exercises each bundled library the way the app uses it. Passes
 * only if nothing tried to reach the network and every library works.
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
    const out = {};
    const J = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    out.libraries = {
      XLSX: typeof window.XLSX, jsPDF: typeof J,
      autoTable: J ? typeof new J().autoTable : 'n/a', pdfjsLib: typeof window.pdfjsLib,
    };
    try {   // xlsx round trip — the budget upload path
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Phase','Task','TKID','Hours'],['DD','Review','TK001',10]]), 'Budget');
      const back = XLSX.read(new Uint8Array(XLSX.write(wb, { type:'array', bookType:'xlsx' })), { type:'array' });
      out.xlsx = JSON.stringify(XLSX.utils.sheet_to_json(back.Sheets.Budget, { header:1 }));
    } catch (e) { out.xlsx = 'ERR ' + e.message; }
    try {   // jsPDF + AutoTable
      const d = new J(); d.autoTable({ head:[['Phase','Fees']], body:[['DD','$10,000']] });
      out.jspdfBytes = d.output('arraybuffer').byteLength;
    } catch (e) { out.jspdfBytes = 'ERR ' + e.message; }
    try {   // pdf.js through the embedded worker, wired exactly as the app wires it
      const el = document.getElementById('pdfjs-worker-src');
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([el.textContent], { type:'application/javascript' }));
      const d = new J(); d.text('Total Fees $123,456', 14, 20);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(d.output('arraybuffer')) }).promise;
      const tc = await (await doc.getPage(1)).getTextContent();
      out.pdfjs = tc.items.map(i => i.str).join(' ');
    } catch (e) { out.pdfjs = 'ERR ' + e.message; }
    return out;
  });
  await browser.close();

  const checks = [
    ['XLSX loaded',            r.libraries.XLSX === 'object'],
    ['jsPDF loaded',           r.libraries.jsPDF === 'function'],
    ['AutoTable attached',     r.libraries.autoTable === 'function'],
    ['pdf.js loaded',          r.libraries.pdfjsLib === 'object'],
    ['xlsx round trip',        r.xlsx === '[["Phase","Task","TKID","Hours"],["DD","Review","TK001",10]]'],
    ['jsPDF produces a PDF',   typeof r.jspdfBytes === 'number' && r.jspdfBytes > 1000],
    ['pdf.js worker parses',   /Total Fees \$123,456/.test(r.pdfjs || '')],
    ['no network requests',    external.length === 0],
    ['no page errors',         errors.length === 0],
  ];
  checks.forEach(([n, ok]) => console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`));
  if (external.length) console.log('  attempted:', external);
  if (errors.length) console.log('  errors:', errors);
  const pass = checks.every(c => c[1]);
  console.log(`\n=== offline: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})();
