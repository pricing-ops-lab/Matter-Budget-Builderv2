#!/usr/bin/env node
/**
 * Fill Hours by Staffing Mix: set a mix once, give a total in hours or fees,
 * pick phases/tasks, apply into the matrix. Driven through the real controls.
 * Network is blocked throughout.
 *
 *   node tests/fill.test.js [path/to/built.html]
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'matter-budget-builder.html'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const external = [];
  await ctx.route('**', r => { const u = r.request().url();
    if (!/^(file|blob|data):/.test(u)) { external.push(u); return r.abort(); } return r.continue(); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.accept(); });
  const results = [];
  const check = (name, ok, detail) => { results.push(!!ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); };
  const ev = e => page.evaluate(x => eval(x), e);
  const rowHours = () => ev(`budgetRows.map(r => ({ k: r.phase + ' / ' + r.task, h: { ...r.hours }, t: Object.values(r.hours||{}).reduce((a,b)=>a+(+b||0),0) }))`);

  await page.goto('file://' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  if (await page.locator('#welcome-overlay').isVisible()) await page.click('#welcome-overlay .btn-primary');

  // Team of three and the UTBMS rows
  await page.evaluate(() => { ['TK005', 'TK002', 'TK001'].forEach(id => addBudgetTimekeeper(id)); });
  await page.selectOption('#budget-template-select', 'utbms-litigation');
  await page.click('#budget-template-load');
  const team = await ev('budgetTimekeepers.map(t => ({ id: t.tkid, std: t.standardRate }))');

  await page.click('#fill-toggle');
  check('panel opens with one mix row per timekeeper', (await page.$$('#fill-panel .fill-pct')).length === 3);
  check('Apply is disabled until the mix and total are set', await page.isDisabled('#fill-apply'));

  // 1. Mix 20/30/50, 120 hours, split across the six L300 Discovery tasks
  const pct = page.locator('#fill-panel .fill-pct');
  await pct.nth(0).fill('20'); await pct.nth(1).fill('30'); await pct.nth(2).fill('40');
  check('a mix that is not 100% is refused', /adds up to 90%/.test(await page.textContent('#fill-preview')) && await page.isDisabled('#fill-apply'));
  await pct.nth(2).fill('50');
  await page.fill('#fill-total', '120');
  await page.locator('.fill-phase', { hasText: 'L300 Discovery' }).locator('.fill-phase-lbl input').check();
  check('ticking a phase selects all its tasks', /\(6 rows selected\)/.test(await page.textContent('#fill-sel-count')));
  check('preview shows hours per row and fees', /each gets <strong>20\.0 h<\/strong>/.test(await page.innerHTML('#fill-preview')) && /proposed rates/.test(await page.textContent('#fill-preview')));
  await page.click('#fill-apply');
  let rh = await rowHours();
  const disc = rh.filter(r => r.k.startsWith('L300'));
  check('hours land in the six Discovery rows: 4 / 6 / 10 each', disc.length === 6 && disc.every(r => r.h[team[0].id] === 4 && r.h[team[1].id] === 6 && r.h[team[2].id] === 10), JSON.stringify(disc[0]));
  check('total applied is 120 h and other phases are untouched',
    Math.abs(disc.reduce((a, r) => a + r.t, 0) - 120) < 1e-9 && rh.filter(r => !r.k.startsWith('L300')).every(r => r.t === 0));
  const cell = await page.inputValue('#budget-matrix-tbody tr:nth-child(14) td:nth-child(5) input');
  check('the matrix cells show the hours, editable', cell === '10', cell);
  check('the mix is kept for the next application', (await page.inputValue('#fill-panel .fill-pct >> nth=2')) === '50');

  // 1b. Totals stay exact when the split doesn't divide evenly: 100 h over 7 rows
  await page.click('#fill-panel >> text=None');
  await page.locator('.fill-phase', { hasText: 'L100' }).locator('.fill-phase-lbl input').check();
  await page.fill('#fill-total', '100');
  await page.click('#fill-apply');
  const l100 = (await rowHours()).filter(r => r.k.startsWith('L100'));
  check('100 h over 7 rows adds up to exactly 100 h, every cell on 0.1 h',
    Math.abs(l100.reduce((a, r) => a + r.t, 0) - 100) < 1e-6 && l100.every(r => Object.values(r.h).every(h => Math.abs(h * 10 - Math.round(h * 10)) < 1e-6)),
    l100.map(r => r.t.toFixed(2)).join(','));
  await page.evaluate(() => budgetRows.filter(r => r.phase.startsWith('L100')).forEach(r => r.hours = {}));
  await page.evaluate(() => renderBudgetMatrix());

  // 2. Fees: $50,000 at standard rates on one task → hours = fee / blended standard rate
  await page.click('#fill-panel >> text=None');
  await page.locator('.fill-task', { hasText: 'L240 Dispositive Motions' }).locator('input').check();
  await page.selectOption('#fill-basis', 'fees');
  await page.fill('#fill-total', '50000');
  await page.click('#fill-apply');
  rh = await rowHours();
  const dm = rh.find(r => r.k.includes('L240'));
  const blended = 0.2 * team[0].std + 0.3 * team[1].std + 0.5 * team[2].std;
  const fees = team.reduce((a, t) => a + dm.h[t.id] * t.std, 0);
  check('fee total is converted to hours at each standard rate', Math.abs(dm.t - Math.round(50000 / blended * 10) / 10) <= 0.2 && Math.abs(fees - 50000) / 50000 < 0.01,
    `hours ${dm.t}, fees ${Math.round(fees)}, blended ${blended}`);

  // 3. Replace asks before overwriting; Add tops up instead
  dialogs = 0;
  await page.selectOption('#fill-basis', 'hours'); await page.fill('#fill-total', '10');
  await page.click('#fill-apply');
  rh = await rowHours();
  check('Replace asks before overwriting hours, then overwrites', dialogs === 1 && rh.find(r => r.k.includes('L240')).t === 10);
  await page.check('input[name="fill-mode"][value="add"]');
  await page.click('#fill-apply');
  check('Add tops up the hours already there', (await rowHours()).find(r => r.k.includes('L240')).t === 20);

  // 4. Apply the full total to each row
  await page.check('input[name="fill-mode"][value="replace"]');
  await page.click('#fill-panel >> text=None');
  await page.locator('.fill-phase', { hasText: 'L500 Appeal' }).locator('.fill-phase-lbl input').check();
  await page.check('input[name="fill-spread"][value="each"]');
  await page.fill('#fill-total', '8');
  await page.click('#fill-apply');
  check('"full total to each row" gives every selected row the total', (await rowHours()).filter(r => r.k.startsWith('L500')).every(r => r.t === 8));

  // 5. Even split, rounding to 0.5
  await page.click('#fill-panel >> text=Even split');
  const mix = await ev('fillState.mix');
  check('Even split sums to 100%', Math.abs(Object.values(mix).reduce((a, b) => a + b, 0) - 100) < 1e-9, JSON.stringify(mix));
  await page.selectOption('#fill-round', '0.5');
  await page.fill('#fill-total', '10');
  await page.click('#fill-apply');
  check('rounding to 0.5 h is applied', (await rowHours()).filter(r => r.k.startsWith('L500')).every(r => Object.values(r.h).every(h => (h * 2) % 1 === 0)));

  // 5b. Option 2: a total for the matter, allocated across phases by %
  await page.click('#fill-method-phases');
  check('option 2 shows one allocation row per phase', (await page.$$('#fill-phase-table .fill-phase-pct')).length === 5);
  await page.selectOption('#fill-round', '0.1');
  await page.selectOption('#fill-basis', 'hours');
  await page.fill('#fill-total', '1000');
  const PCT = { 'L100': 10, 'L200': 20, 'L300': 40, 'L400': 25, 'L500': 4 };
  const pp = page.locator('#fill-phase-table .fill-phase-pct');
  for (let i = 0; i < 5; i++) await pp.nth(i).fill(String(Object.values(PCT)[i]));
  check('a phase allocation that is not 100% is refused', /allocation adds up to 99%/.test(await page.textContent('#fill-preview')) && await page.isDisabled('#fill-apply'));
  await pp.nth(4).fill('5'); PCT.L500 = 5;
  check('the allocation table previews hours per phase', (await page.textContent('#fill-phase-table [data-ph-hours="2"]')).trim() === '400.0');
  await page.click('#fill-apply');
  let byPh = {}; (await rowHours()).forEach(r => { const p = r.k.slice(0, 4); byPh[p] = (byPh[p] || 0) + r.t; });
  check('1,000 h land as 100 / 200 / 400 / 250 / 50 by phase', Object.entries(PCT).every(([p, v]) => Math.abs(byPh[p] - v * 10) < 1e-6), JSON.stringify(byPh));
  const l300 = (await rowHours()).filter(r => r.k.startsWith('L300')).map(r => r.t);
  check('each phase is split evenly across its tasks', Math.max(...l300) - Math.min(...l300) <= 0.1 + 1e-9, l300.join(','));
  // fees: $1,000,000 at standard rates
  await page.selectOption('#fill-basis', 'fees');
  await page.fill('#fill-total', '1000000');
  await page.click('#fill-apply');
  const team2 = await ev('budgetTimekeepers.map(t => ({ id: t.tkid, std: t.standardRate }))');
  const feeBy = {}; (await rowHours()).forEach(r => { const p = r.k.slice(0, 4); feeBy[p] = (feeBy[p] || 0) + team2.reduce((a, t) => a + (r.h[t.id] || 0) * t.std, 0); });
  const feeTot = Object.values(feeBy).reduce((a, b) => a + b, 0);
  check('a $1,000,000 matter fee converts to hours at standard rates, phases near their %',
    Math.abs(feeTot - 1e6) / 1e6 < 0.005 && Object.entries(PCT).every(([p, v]) => Math.abs(feeBy[p] / feeTot * 100 - v) < 0.5), JSON.stringify(Object.fromEntries(Object.entries(feeBy).map(([k, v]) => [k, Math.round(v)]))));
  await page.click('#fill-method-rows');
  await page.selectOption('#fill-basis', 'hours');

  // 6. With no rows yet, the panel can create one
  await page.evaluate(() => clearBudgetRows());
  check('with no rows, the panel offers a new row', await page.isVisible('#fill-new-phase'));
  check('switching hours/fees clears the total', (await page.inputValue('#fill-total')) === '');
  await page.fill('#fill-total', '10');
  await page.fill('#fill-new-phase', 'Advice'); await page.fill('#fill-new-task', 'Initial memo');
  await page.click('#fill-apply');
  rh = await rowHours();
  check('a named new row is created and filled', rh.length === 1 && rh[0].k === 'Advice / Initial memo' && rh[0].t === 10, JSON.stringify(rh));

  // 7. The filled budget builds, and a new timekeeper appears in the mix
  await page.click('#run-btn-wrap .btn-primary');
  await page.waitForSelector('#output-content .kpi-card');
  check('the filled budget builds', /Advice/.test(await page.textContent('#output-content')));
  await page.evaluate(() => addBudgetTimekeeper('TK006'));
  check('adding a timekeeper adds them to the mix', (await page.$$('#fill-panel .fill-pct')).length === 4);
  await page.click('#run-btn-wrap >> text=Clear All');
  check('Clear All closes and resets the panel', !(await page.isVisible('#fill-panel')) && (await ev('Object.keys(fillState.mix).length')) === 0);

  check('no network requests', external.length === 0, external.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const pass = results.every(Boolean);
  console.log(`\n=== fill: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})();
