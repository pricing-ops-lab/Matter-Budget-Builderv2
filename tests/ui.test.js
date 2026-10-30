#!/usr/bin/env node
/**
 * Interface test: drives the budget through the real controls a person uses,
 * then exercises every export and upload. Network is blocked throughout.
 *
 *   node tests/ui.test.js [path/to/built.html]
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'matter-budget-builder.html'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const external = [];
  await ctx.route('**', r => { const u = r.request().url();
    if (!/^(file|blob|data):/.test(u)) { external.push(u); return r.abort(); } return r.continue(); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const results = [];
  const check = (name, ok, detail) => { results.push([name, !!ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); };

  await page.goto('file://' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const welcome = page.locator('#welcome-overlay');
  if (await welcome.isVisible()) await page.click('#welcome-overlay .btn-primary');

  // 1. Add two timekeepers through the search box, the way a person does
  for (const q of ['Herbert Hoover', 'Charles de Gaulle']) {
    await page.fill('#budget-tk-search', q);
    await page.waitForSelector('#budget-tk-dd.open .tk-option[data-budget-add-tkid]');
    await page.dispatchEvent('#budget-tk-dd .tk-option[data-budget-add-tkid]', 'mousedown');
  }
  const team = await page.evaluate(() => eval('budgetTimekeepers.map(t=>t.name)'));
  check('timekeepers added through the search box', team.join() === 'Herbert Hoover,Charles de Gaulle', JSON.stringify(team));

  // 2. Add two rows with the button, type phase, task and hours into the matrix
  await page.click('text=+ Add Phase / Task');
  await page.click('text=+ Add Phase / Task');
  const rows = page.locator('#budget-matrix-tbody tr');
  const fill = async (i, phase, task, hrs) => {
    const r = rows.nth(i);
    await r.locator('input.w-phase').fill(phase);
    await r.locator('input.w-task').fill(task);
    const h = r.locator('input[type=number]');
    for (let k = 0; k < hrs.length; k++) await h.nth(k).fill(String(hrs[k]));
  };
  await fill(0, 'Pleadings', 'Complaint', [6, 30]);
  await fill(1, 'Discovery', 'Document review', [4, 80]);
  const hrs = await page.evaluate(() => eval('budgetRows.reduce((a,r)=>a+Object.values(r.hours).reduce((x,y)=>x+y,0),0)'));
  check('matrix rows and hours entered through the inputs', hrs === 120, 'hours=' + hrs);

  // 3. Build Budget
  await page.click('#run-btn-wrap .btn-primary');
  await page.waitForSelector('#output-content .kpi-card');
  const fees = await page.textContent('#output-content .kpi-card .kpi-value');
  check('Build Budget renders the output', /^\$[\d,]+$/.test(fees.trim()), fees);

  // 4. Exports — capture each download and look inside it
  const grab = async (label) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click(`#output-section .output-actions >> text=${label}`)]);
    const fs = require('fs'); const p = await dl.path();
    return { name: dl.suggestedFilename(), buf: fs.readFileSync(p) };
  };
  try {
    const x = await grab('Export Excel');
    const sheets = await page.evaluate(b64 => { const wb = XLSX.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
      return { names: wb.SheetNames, text: wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n') }; }, x.buf.toString('base64'));
    check('Excel export opens and contains the phases', /\.xlsx$/.test(x.name) && /Pleadings/.test(sheets.text) && /Discovery/.test(sheets.text), x.name + ' ' + sheets.names);
  } catch (e) { check('Excel export opens and contains the phases', false, e.message); }
  try {
    const w = await grab('Export Word');
    const t = w.buf.toString('utf8');
    check('Word export contains the budget', /\.doc$/.test(w.name) && /Pleadings/.test(t) && /Discovery/.test(t), w.name);
  } catch (e) { check('Word export contains the budget', false, e.message); }
  try {
    const m = await grab('Email Draft');
    const t = m.buf.toString('utf8');
    check('Email draft has a subject and the budget', /\.eml$/.test(m.name) && /^Subject: .+/m.test(t) && /Pleadings/.test(t), m.name);
  } catch (e) { check('Email draft has a subject and the budget', false, e.message); }

  // 5. Budget file upload (built in-page with the bundled XLSX, then fed to the real file input)
  const xlsxB64 = await page.evaluate(() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Phase', 'Task', 'TKID', 'Hours'],
      ['Trial', 'Trial prep', 'TK005', 20], ['Trial', 'Trial prep', 'TK001', 40], ['Trial', 'Trial', 'TK005', 30]]), 'Budget');
    const a = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); let s = ''; new Uint8Array(a).forEach(b => s += String.fromCharCode(b)); return btoa(s);
  });
  await page.setInputFiles('#budget-file-input', { name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxB64, 'base64') });
  await page.waitForTimeout(800);
  const up = await page.evaluate(() => ({ rows: eval('budgetRows.length'), phases: eval('[...new Set(budgetRows.map(r=>r.phase))]'),
    hours: eval('budgetRows.reduce((a,r)=>a+Object.values(r.hours).reduce((x,y)=>x+y,0),0)') }));
  check('budget file upload populates the matrix', up.phases.includes('Trial') && up.hours >= 90, JSON.stringify(up));

  // 6. Settings save logic (the splice that writes settings back into the file)
  const src = require('fs').readFileSync(FILE, 'utf8');
  const spliced = await page.evaluate(text => {
    const cfg = Object.assign({}, FIRM_CONFIG, { name: 'Test & Co LLP', cfoTarget: '25' });
    return spliceFirmConfig(text, cfg);
  }, src);
  check('settings save writes new values into the file text', spliced && spliced.includes('"name":"Test & Co LLP"') && spliced.includes('"cfoTarget":"25"'));

  // 7. Clear All
  await page.click('#run-btn-wrap >> text=Clear All');
  const cleared = await page.evaluate(() => ({ rows: eval('budgetRows.length'), team: eval('budgetTimekeepers.length'),
    output: getComputedStyle(document.getElementById('output-section')).display }));
  check('Clear All empties the budget', cleared.rows === 0 && cleared.team === 0 && cleared.output === 'none', JSON.stringify(cleared));

  check('no network requests', external.length === 0, external.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const pass = results.every(r => r[1]);
  console.log(`\n=== ui: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})();
