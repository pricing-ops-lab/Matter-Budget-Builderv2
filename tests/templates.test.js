#!/usr/bin/env node
/**
 * Phase & task templates: the built-in UTBMS Litigation set, uploading a firm
 * template in Settings (naming it, confirming its columns), loading a template
 * into a budget, saving templates into the app file, and keeping unused
 * template rows out of the outputs. Network is blocked throughout.
 *
 *   node tests/templates.test.js [path/to/built.html]
 */
const path = require('path'), fs = require('fs'), os = require('os');
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
  page.on('dialog', d => d.accept());
  const results = [];
  const check = (name, ok, detail) => { results.push(!!ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); };
  const ev = expr => page.evaluate(e => eval(e), expr);

  await page.goto('file://' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  if (await page.locator('#welcome-overlay').isVisible()) await page.click('#welcome-overlay .btn-primary');

  // 1. Built-in UTBMS Litigation Code Set
  const lit = await ev(`(() => { const t = findTemplate('utbms-litigation'); const s = templateStats(t);
    return { s, first: t.rows[0], last: t.rows[t.rows.length-1], codes: t.rows.map(r => r.taskCode).join(' ') }; })()`);
  check('UTBMS Litigation is built in: 5 phases, 29 tasks', lit.s.phases === 5 && lit.s.tasks === 29, JSON.stringify(lit.s));
  check('UTBMS codes run L110 … L530 with exact titles',
    lit.first.taskCode === 'L110' && lit.first.task === 'Fact Investigation/Development' && lit.first.phase === 'Case Assessment, Development and Administration'
    && lit.last.taskCode === 'L530' && lit.last.task === 'Oral Argument' && /L260 .*L390 .*L470/.test(lit.codes), JSON.stringify([lit.first, lit.last]));

  // Build test spreadsheets in the page with the bundled XLSX library
  const xlsx = rows => page.evaluate(rows => { const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S');
    const a = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); let s = ''; new Uint8Array(a).forEach(b => s += String.fromCharCode(b)); return btoa(s); }, rows);
  const upload = async (name, rows) => {
    await page.setInputFiles('#tpl-file-input', { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await xlsx(rows), 'base64') });
    await page.waitForSelector('#tpl-import-name');
  };
  const summary = async () => (await page.textContent('#tpl-import-summary').catch(() => '')).trim();

  await page.evaluate(() => openSettings());

  // 2a. Separate columns, phase cells left blank under the first task (merged-cell style), extra columns ignored
  await upload('M&A Deal Phases.xlsx', [
    ['Phase Code', 'Phase', 'Task Code', 'Task', 'Notes'],
    ['P200', 'Due Diligence', 'T1', 'Document review', 'x'],
    ['', '', 'T2', 'Diligence report', ''],
    ['P500', 'Negotiation', 'T3', 'SPA drafting', ''],
    ['', '', 'T4', 'Disclosure letter', ''],
    ['P600', 'Closing', '', '', ''],
  ]);
  const map1 = await ev('tplImport.map');
  check('upload guesses the columns from the headings', map1.phaseCode === 0 && map1.phase === 1 && map1.taskCode === 2 && map1.task === 3, JSON.stringify(map1));
  check('blank phase cells repeat the phase above; a phase with no tasks is kept', /3 phases, 4 tasks/.test(await summary()), await summary());
  check('name defaults from the file name', (await page.inputValue('#tpl-import-name')) === 'M&A Deal Phases');
  await page.fill('#tpl-import-name', 'Firm M&A Template');
  await page.click('#tpl-import-add');
  const after1 = await ev(`uploadedTemplates().map(t => t.name + ':' + t.rows.length)`);
  check('Add Template stores it under the given name', after1.join() === 'Firm M&A Template:5', after1.join());
  check('template list and unsaved-changes prompt show', /Firm M&A Template/.test(await page.textContent('#tpl-list')) && /not yet saved/.test(await page.textContent('#tpl-save-row')));

  // 2b. One UTBMS-style code list with no headings for tasks: x00 codes are phases
  await upload('codes.xlsx', [['Code', 'Description'], ['C100', 'Fact Gathering'], ['C110', 'Interviews'], ['C120', 'Records'], ['C200', 'Researching Law'], ['C210', 'Research memo']]);
  check('single code list reads x00 codes as phases', /2 phases, 3 tasks/.test(await summary()) && /code list/.test(await summary()), await summary());
  await page.click('#tpl-import-add');

  // 2c. No headings, codes typed in front of the names, columns confirmed by hand
  await upload('plain.xlsx', [['A100 Intake', 'A110 Conflict check'], ['', 'A120 Engagement letter'], ['A200 Advice', 'A210 Opinion']]);
  check('no headings: the checkbox turns off', !(await page.isChecked('#tpl-import-header')));
  await page.selectOption('#tpl-map-phase', '0'); await page.selectOption('#tpl-map-task', '1');
  await page.waitForTimeout(100);
  const rows3 = await ev('buildTemplateRows().rows');
  check('codes typed in front of names are split out', rows3.length === 3 && rows3[0].phaseCode === 'A100' && rows3[0].phase === 'Intake' && rows3[1].taskCode === 'A120' && rows3[1].phase === 'Intake', JSON.stringify(rows3));
  await page.fill('#tpl-import-name', 'Advisory </script><b>x</b>');
  await page.click('#tpl-import-add');
  check('three templates uploaded', (await ev('uploadedTemplates().length')) === 3);
  await page.evaluate(() => closeSettings());

  // 3. Budget: choose a template, add timekeepers, enter hours, build
  const opts = await page.$$eval('#budget-template-select option', o => o.map(x => x.textContent));
  check('budget template picker lists built-in and uploaded templates', opts.length === 5 && /UTBMS Litigation/.test(opts[1]) && /Firm M&A Template/.test(opts.join('|')), opts.join(' | '));
  await page.selectOption('#budget-template-select', 'utbms-litigation');
  await page.click('#budget-template-load');
  const lrows = await ev('budgetRows.map(r => r.phase + " / " + r.task)');
  check('loading UTBMS fills the matrix with 29 coded rows', lrows.length === 29 && lrows[0] === 'L100 Case Assessment, Development and Administration / L110 Fact Investigation/Development', lrows[0]);
  await page.evaluate(() => { addBudgetTimekeeper('TK002'); addBudgetTimekeeper('TK001'); });
  const fillHours = async (rowIdx, vals) => { const r = page.locator('#budget-matrix-tbody tr').nth(rowIdx); const h = r.locator('input[type=number]');
    for (let k = 0; k < vals.length; k++) await h.nth(k).fill(String(vals[k])); };
  await fillHours(0, [5, 20]);      // L110
  await fillHours(15, [10, 30]);    // L330 Depositions (L110–L190 are rows 0–6, L210–L260 7–12, L310 13)
  await page.click('#run-btn-wrap .btn-primary');
  await page.waitForSelector('#output-content .kpi-card');
  const phases = await page.$$eval('#output-content table.result-table', ts => {
    const t = ts.find(t => /Fees at Standard Rates/.test(t.textContent) && /Proposed Fee/.test(t.textContent));
    return [...t.querySelectorAll('tbody tr td:first-child')].map(td => td.textContent.trim()); });
  check('only phases with hours reach the analysis', phases.join(' | ') === 'L100 Case Assessment, Development and Administration | L300 Discovery', phases.join(' | '));

  // Excel keeps unused template rows out too
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#x-int-excel')]);
  const xb = fs.readFileSync(await dl.path()).toString('base64');
  const csv = await page.evaluate(b64 => { const wb = XLSX.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
    return XLSX.utils.sheet_to_csv(wb.Sheets.Inputs); }, xb);
  check('Excel export leaves out rows with no hours', /L330 Depositions/.test(csv) && !/L520 Appellate Briefs/.test(csv) && !/L210 Pleadings/.test(csv));

  // 4. Switching template keeps hours on shared rows and asks before dropping the rest
  const sw = await page.evaluate(() => {
    const t = { id:'t-mix', name:'Mix', rows:[ { phaseCode:'L300', phase:'Discovery', taskCode:'L330', task:'Depositions' }, { phaseCode:'', phase:'Other', taskCode:'', task:'' } ] };
    FIRM_CONFIG.templates.push(t); renderBudgetTemplateSelect();
    document.getElementById('budget-template-select').value = 't-mix'; applyBudgetTemplate();
    const r = budgetRows.map(x => ({ p:x.phase, t:x.task, h:Object.values(x.hours).reduce((a,b)=>a+(+b||0),0) }));
    FIRM_CONFIG.templates.pop(); renderBudgetTemplateSelect(); return r; });
  check('switching template keeps hours where phase and task match', sw.length === 2 && sw[0].t === 'L330 Depositions' && sw[0].h === 40 && sw[1].h === 0, JSON.stringify(sw));
  await page.click('text=Remove Empty Rows');
  check('Remove Empty Rows drops rows at zero hours', (await ev('budgetRows.length')) === 1);

  // 5. Save into the app file, then open the saved file: templates survive, the page is intact
  const src = fs.readFileSync(FILE, 'utf8');
  const saved = await page.evaluate(text => { openSettings(); const out = spliceFirmConfig(text, collectFirmConfig()); closeSettings(); return out; }, src);
  check('saved file contains the uploaded templates', saved && saved.includes('"name":"Firm M&A Template"') && saved.includes('A120'));
  check("a '</script>' typed into a template name cannot break the saved file", !/Advisory <\/script>/.test(saved) && saved.includes('Advisory \\u003c/script>'));
  const tmp = path.join(os.tmpdir(), 'mbb-templates-saved.html'); fs.writeFileSync(tmp, saved);
  const p2 = await ctx.newPage(); const errs2 = []; p2.on('pageerror', e => errs2.push(String(e)));
  await p2.goto('file://' + tmp, { waitUntil: 'load' }); await p2.waitForTimeout(800);
  const reopened = await p2.evaluate(() => ({ names: allTemplates().map(t => t.name), opts: document.querySelectorAll('#budget-template-select option').length }));
  check('reopened file lists all templates in the budget picker', reopened.names.length === 4 && reopened.names.includes('Advisory </script><b>x</b>') && reopened.opts === 5, JSON.stringify(reopened));
  check('reopened file loads with no errors', errs2.length === 0, errs2.join(' | '));
  await p2.close();

  // 6. Delete an uploaded template; the built-in one cannot be deleted
  await page.evaluate(() => openSettings());
  const delBtns = await page.$$eval('#tpl-list tr', trs => trs.map(tr => !!tr.querySelector('button[onclick^="deleteTemplate"]')));
  check('built-in template has no Delete button', delBtns[1] === false && delBtns.slice(2).every(Boolean), JSON.stringify(delBtns));
  await page.locator('#tpl-list tr', { hasText: 'codes' }).locator('text=Delete').click();
  check('Delete removes an uploaded template', (await ev('uploadedTemplates().map(t=>t.name)')).join() === 'Firm M&A Template,Advisory </script><b>x</b>');
  const [tdl] = await Promise.all([page.waitForEvent('download'), page.locator('#tpl-list tr', { hasText: 'UTBMS' }).locator('text=Download').click()]);
  const tcsv = await page.evaluate(b64 => { const wb = XLSX.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
    return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); }, fs.readFileSync(await tdl.path()).toString('base64'));
  check('Download gives the template back as an uploadable Excel file', /^Phase Code,Phase,Task Code,Task/.test(tcsv) && tcsv.trim().split('\n').length === 30, tcsv.split('\n')[0]);

  check('no network requests', external.length === 0, external.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const pass = results.every(Boolean);
  console.log(`\n=== templates: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})();
