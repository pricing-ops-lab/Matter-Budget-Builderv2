#!/usr/bin/env node
/**
 * Generate the sample fee estimate shown at the end of the demo and linked from
 * the landing page.
 *
 * It drives the real app with the demo budget (the same team, phases and hours
 * demo.html walks through), then prints the app's own client export, the
 * document behind the Client / RFP "PDF" button, to PDF. What it writes is
 * what a user gets from that button. A PNG of page 1 is rendered with pdf.js
 * for the demo, because an <img> draws everywhere and an embedded PDF does not.
 *
 *     node build/make_demo_assets.js
 *
 * Needs Playwright. A one-off asset build: the committed files are what the
 * site serves, so visitors need nothing.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'matter-budget-builder.html');
const OUT_PDF = path.join(ROOT, 'assets', 'sample-fee-estimate.pdf');
const OUT_PNG = path.join(ROOT, 'assets', 'sample-fee-estimate.png');

// Keep in step with DEMO in demo.html.
const DEMO = {
  firm: 'Meridian & Cole LLP',
  matter: 'Acme Corp — Acquisition of Beta Ltd',
  team: ['TK005', 'TK002', 'TK006', 'TK004', 'TK001'],
  proposedFactor: 0.92,          // agreed client rates: 8% off standard, to the nearest $25
  rows: [
    { phase: 'Due Diligence', task: 'Document review',     hours: { TK005: 3, TK002: 8,  TK006: 14, TK004: 30, TK001: 40 } },
    { phase: 'Due Diligence', task: 'Diligence report',    hours: { TK005: 4, TK002: 10, TK006: 8,  TK004: 12, TK001: 10 } },
    { phase: 'Negotiation',   task: 'SPA drafting',        hours: { TK005: 10, TK002: 22, TK006: 12, TK004: 24, TK001: 16 } },
    { phase: 'Negotiation',   task: 'Disclosure letter',   hours: { TK005: 2, TK002: 6,  TK006: 10, TK004: 12, TK001: 14 } },
    { phase: 'Closing',       task: 'Closing mechanics',   hours: { TK005: 2, TK002: 6,  TK006: 4,  TK004: 10, TK001: 12 } },
  ],
};

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  const r = await page.evaluate(async (DEMO) => {
    ['welcome-overlay', 'welcome-modal'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    FIRM_CONFIG.name = DEMO.firm;
    document.getElementById('matter-name').value = DEMO.matter;
    DEMO.team.forEach(id => addBudgetTimekeeper(id));
    budgetTimekeepers.forEach(t => updateBudgetTK(t.tkid, 'proposedRate', Math.round(t.standardRate * DEMO.proposedFactor / 25) * 25));
    clearBudgetRows();
    DEMO.rows.forEach(row => addBudgetRow(row));
    renderBudget();
    runAnalysis();
    await new Promise(res => setTimeout(res, 500));
    const t = lastResult.totals;
    return { html: buildExportDoc('client').html, fees: curr(t.proposedFees), hours: t.hours, cost: curr(t.cost),
             margin: Math.round(t.margin), options: lastResult.budgetScenarios.length };
  }, DEMO);

  if (errors.length) { console.error('ERROR: the app reported errors:\n  ' + errors.join('\n  ')); process.exit(1); }
  if (r.html.includes(r.cost)) { console.error('ERROR: the client document contains the cost figure'); process.exit(1); }

  const doc = await browser.newPage();
  await doc.setContent(r.html, { waitUntil: 'load' });
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  // The document carries its own 28px body margin, so the page margin stays modest.
  await doc.pdf({ path: OUT_PDF, format: 'Letter', printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });

  const shot = await browser.newPage();
  await shot.setContent('<body style="margin:0"><canvas id="cv"></canvas></body>');
  await shot.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'build/vendor/pdf.min.js'), 'utf8') });
  const workerSrc = fs.readFileSync(path.join(ROOT, 'build/vendor/pdf.worker.min.js'), 'utf8');
  const pdfB64 = fs.readFileSync(OUT_PDF).toString('base64');
  const info = await shot.evaluate(async ({ workerSrc, pdfB64 }) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
    const pdf = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0)) }).promise;
    const pg = await pdf.getPage(1);
    const vp = pg.getViewport({ scale: 2 });
    const cv = document.getElementById('cv'); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return { pages: pdf.numPages, png: cv.toDataURL('image/png') };
  }, { workerSrc, pdfB64 });
  fs.writeFileSync(OUT_PNG, Buffer.from(info.png.split(',')[1], 'base64'));
  await browser.close();

  console.log(`  proposed fees  ${r.fees}`);
  console.log(`  hours          ${r.hours}`);
  console.log(`  margin         ${r.margin}% (internal only, not in the PDF)`);
  console.log(`  pdf pages      ${info.pages}`);
  console.log(`\n  wrote          assets/sample-fee-estimate.pdf (${(fs.statSync(OUT_PDF).size / 1024).toFixed(1)} KB)`);
  console.log(`  wrote          assets/sample-fee-estimate.png (${(fs.statSync(OUT_PNG).size / 1024).toFixed(1)} KB)`);
}
main().catch(e => { console.error(e); process.exit(1); });
