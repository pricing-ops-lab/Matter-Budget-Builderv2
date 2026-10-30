#!/usr/bin/env node
/**
 * Budget-only behaviour test.
 *
 * Checks the build opens straight into budget mode with the other analyses
 * hidden, keeps the profit policy in Settings, produces a known budget to the
 * dollar, survives Clear All, and that the self-save guard still recognises the
 * file. Network is blocked throughout.
 *
 *   node tests/budget.test.js [path/to/built.html]
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'matter-budget-builder.html'));
(async () => {
  const b = await chromium.launch(); let pass = true; const fail = m => { pass = false; console.log('  FAIL', m); };
  const ctx = await b.newContext({ viewport:{ width:1360, height:1000 } });
  const ext=[]; await ctx.route('**', r => { const u=r.request().url();
    if (!/^(file|blob|data):/.test(u)) { ext.push(u); return r.abort(); } return r.continue(); });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + FILE, { waitUntil:'load' }); await p.waitForTimeout(1200);

  // 1. On first load, before anything is touched
  const load = await p.evaluate(() => {
    const vis = id => { const e=document.getElementById(id); return !!e && getComputedStyle(e).display!=='none' && e.getBoundingClientRect().height>0; };
    return {
      title: document.title,
      toolLabel: document.querySelector('.tool-label').textContent.trim(),
      welcome: document.getElementById('welcome-header').textContent.trim(),
      welcomeSteps: document.querySelectorAll('#welcome-body .welcome-step').length,
      analysisType: document.getElementById('analysis-type').value,
      options: [...document.getElementById('analysis-type').options].map(o=>o.value),
      budgetVisible: vis('budget-section'), runVisible: vis('run-btn-wrap'),
      runLabel: document.querySelector('#run-btn-wrap .btn-primary').textContent.trim(),
      parserVisible: vis('parser-section'),
      otherModesVisible: ['tk-selector-section','range-section','writeoff-section','fixed-mix-wrap','ri-scenario-wrap','scenario-config-wrap'].filter(vis),
      steps: [...document.querySelectorAll('.card-header .step-num')].filter(e=>e.offsetParent).map(e=>e.parentElement.textContent.replace(/\?.*$/,'').replace(/\s+/g,' ').trim()),
    };
  });
  console.log('first load:', JSON.stringify(load, null, 1));
  if (load.analysisType!=='budget' || load.options.join()!=='budget') fail('not budget-only');
  if (!load.budgetVisible || !load.runVisible) fail('budget setup not shown on load');
  if (load.parserVisible) fail('request parser still visible');
  if (load.otherModesVisible.length) fail('other modes visible: '+load.otherModesVisible);
  if (load.runLabel!=='Build Budget') fail('run label');
  if (load.welcomeSteps!==3) fail('welcome steps');
  if (!/Matter Budget Builder/.test(load.title+load.toolLabel+load.welcome)) fail('branding');

  // 2. Settings: profit policy kept, the two foreign fields hidden
  const st = await p.evaluate(() => {
    openSettings();
    const vis = id => { const e=document.getElementById(id); return !!e && e.offsetParent!==null; };
    const h5 = [...document.querySelectorAll('#settings-modal h5')].map(h=>h.textContent.split('(')[0].trim());
    const r = { headings:h5, target:vis('cfg-cfo-target'), floor:vis('cfg-cfo-floor'),
      targetVal:document.getElementById('cfg-cfo-target').value, floorVal:document.getElementById('cfg-cfo-floor').value,
      woDisclaimer:vis('cfg-wo-disclaimer'), rangeNote:vis('cfg-range-note') };
    document.getElementById('settings-overlay').style.display='none';
    return r;
  });
  console.log('settings:', JSON.stringify(st));
  if (!st.headings.includes('Profit Policy') || st.headings.includes('Write-off Policy')) fail('profit policy heading');
  if (!st.target || !st.floor || st.targetVal!=='20' || st.floorVal!=='10') fail('target/floor not kept at 20/10');
  if (st.woDisclaimer || st.rangeNote) fail('foreign settings still visible');

  // 3. Build the same budget as the baseline, WITHOUT touching the selector
  const TEAM=['TK005','TK002','TK006','TK001'];
  const ROWS=[
    {phase:'Due Diligence',task:'Document review',  hours:{TK005:4, TK002:10,TK006:20,TK001:60}},
    {phase:'Due Diligence',task:'Issues memo',      hours:{TK005:3, TK002:8, TK006:6, TK001:12}},
    {phase:'Negotiation',  task:'SPA drafting',     hours:{TK005:10,TK002:24,TK006:12,TK001:30}},
    {phase:'Negotiation',  task:'Disclosure letter',hours:{TK005:2, TK002:6, TK006:10,TK001:18}},
    {phase:'Closing',      task:'Closing mechanics',hours:{TK005:2, TK002:6, TK006:4, TK001:16}},
    {phase:'Closing',      task:'Post-closing',     hours:{TK005:1, TK002:3, TK006:2, TK001:8}}];
  const out = await p.evaluate(async ({TEAM,ROWS}) => {
    ['welcome-overlay','welcome-modal'].forEach(id=>{const e=document.getElementById(id); if(e) e.style.display='none';});
    TEAM.forEach(id=>addBudgetTimekeeper(id)); clearBudgetRows(); ROWS.forEach(r=>addBudgetRow(r));
    document.querySelector('#run-btn-wrap .btn-primary').click();
    await new Promise(r=>setTimeout(r,900));
    const kp = {}; document.querySelectorAll('#output-content .kpi-card').forEach(c=>{
      kp[(c.querySelector('.kpi-label')||{}).textContent.trim()] = { v:(c.querySelector('.kpi-value')||{}).textContent.trim(), cls:c.className.replace('kpi-card','').trim()||'green' }; });
    return { kpis:kp, sections:[...document.querySelectorAll('#output-content .section-label')].map(e=>e.textContent.trim()),
             outputStep:(document.querySelector('#output-section .step-num')||{}).textContent };
  }, {TEAM,ROWS});
  console.log('budget output:', JSON.stringify(out, null, 1));
  const k = out.kpis;
  if ((k['Proposed Budget Fees']||{}).v!=='$469,100') fail('fees differ from baseline');
  if ((k['Total Hours']||{}).v!=='277.0') fail('hours differ');
  if ((k['Profit Margin']||{}).v!=='38%') fail('margin differs');
  if ((k['Profit Margin']||{}).cls!=='green') fail('38% margin should be green against a 20% target');
  if (out.sections.length!==5) fail('expected the same 5 output sections');

  // 4. Clear All must leave the tool in budget mode
  const cleared = await p.evaluate(() => { clearAll(); return { type:document.getElementById('analysis-type').value,
    budgetVisible:getComputedStyle(document.getElementById('budget-section')).display!=='none' }; });
  console.log('after Clear All:', JSON.stringify(cleared));
  if (cleared.type!=='budget' || !cleared.budgetVisible) fail('Clear All left budget mode');

  // 5. Self-save guard still recognises this file as the app
  const src = require('fs').readFileSync(FILE,'utf8');
  const guardStr = (src.match(/!pickedText\.includes\('([^']+)'\)\)/)||[])[1];
  console.log('save guard looks for:', JSON.stringify(guardStr), '— present in file:', src.includes(guardStr));
  if (!guardStr || !src.includes(guardStr)) fail('save guard would reject the app file');

  console.log('\nexternal requests:', ext.length?ext:'(none)'); console.log('page errors:', errs.length?errs:'(none)');
  if (ext.length || errs.length) pass = false;
  console.log('\n=== budget: '+(pass?'PASS':'FAIL')+' ===');
  await b.close(); process.exit(pass?0:1);
})();
