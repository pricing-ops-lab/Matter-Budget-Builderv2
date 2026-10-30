# Matter Budget Builder

A legal matter budgeting tool that runs entirely in the browser, as a **single
self-contained HTML file**. No install, no server, no account, no network.

- **Budget by phase and task:** start from a phase and task template (the UTBMS
  Litigation Code Set is built in; firms upload their own from Excel in Settings),
  pick the team from a rate card, enter hours per timekeeper, and get fees at standard and proposed rates, the blended rate,
  realization and profit margin.
- **Default pricing options:** standard rates, 5/10/15% discounts, a fixed fee
  with contingency, the fee at the target margin and the walk-away fee at the
  profit floor, all priced against the profit policy in Settings.
- **Two audiences:** a client / RFP fee estimate with no internal figures, and an
  internal review memo, both written from the budget and editable. Exports to
  Word, PDF, email draft (.eml), clipboard, and a formula-driven Excel workbook.

Built by Sergey Mezhiritskiy.

**Live page:** https://pricing-ops-lab.github.io/Matter-Budget-Builderv2/

---

## What's here

| Path | What it is |
|---|---|
| `matter-budget-builder.html` | **The deliverable.** The self-contained app people download. Generated; do not hand-edit. |
| `index.html` | The landing page: description, download, demo link, QR code. Generated. |
| `demo.html` | Guided one-minute demo that drives the real app in a frame. Hand-written. |
| `404.html` | Sends broken links back to the home page. Hand-written. |
| `assets/track.js` | Anonymous visit and download counter for the site pages (never the app). Hand-written. |
| `assets/qr.*` | QR code for the landing page: PNG and SVG, plus a captioned slide card. Generated. |
| `assets/sample-fee-estimate.*` | The client fee estimate the demo budget exports (PDF and PNG preview). Generated. |
| `src/matter-budget-builder.src.html` | **The source you edit.** Loads its one library from a CDN; the build inlines it. |
| `src/index.template.html` | Template for the landing page. |
| `build/inline.py` | Builds `matter-budget-builder.html` from the source. |
| `build/make_site.py` | Builds `index.html` and the QR assets. |
| `build/make_demo_assets.js` | Builds the sample fee estimate from the demo budget. |
| `build/vendor/` | Pinned libraries, vendored so builds are reproducible offline. |
| `tests/` | Headless browser tests, run with network access blocked. |

## Rebuilding

```bash
python3 build/inline.py           # src -> matter-budget-builder.html
node build/make_demo_assets.js    # -> assets/sample-fee-estimate.pdf/.png
python3 build/make_site.py        # -> index.html + assets/qr.*
```

`make_site.py` needs [segno](https://pypi.org/project/segno/) (`pip install segno`).
`make_demo_assets.js` and the tests need Playwright. If the site moves, regenerate
the QR with `python3 build/make_site.py --url <new URL>`; the landing page shows a
warning whenever the QR doesn't match the address it is served from.

The demo budget is defined twice, in `demo.html` and `build/make_demo_assets.js`,
so the PDF at the end of the demo matches what the demo built. Change both together.

## Tests

```bash
node tests/static.test.js    # every element id the code looks up exists
node tests/offline.test.js   # bundled library works, nothing is fetched
node tests/budget.test.js    # known budget to the dollar, pricing options, narratives
node tests/ui.test.js        # real controls, every export, uploads, Clear All
node tests/templates.test.js # UTBMS template, template upload and mapping, save to file
```

`budget.test.js` and `ui.test.js` also check that client documents contain no
cost, margin, profit, realization or discount wording and no internal figures.

## How the offline build works

The source loads xlsx-js-style 1.2.0 (Excel import and export) from a CDN.
`inline.py` replaces that tag with the vendored copy, and fails the build if
anything external would still be fetched (`src=`, stylesheet `<link>`, `@import`).
Plain `<a href>` links are allowed because nothing loads until someone clicks.

It also patches the "save settings back into the app file" fallback, which read
the app's own source with `fetch(location.href)`. Browsers block that on `file://`
URLs, so it falls back to a file picker.

## Phase and task templates

Settings → Phase & Task Templates lists the built-in UTBMS Litigation Code Set
(L100–L500, 29 tasks) and any uploaded templates. **Upload Template** takes an Excel
or CSV file; you name it and confirm which columns hold the phase code, phase name,
task code and task name. It understands three layouts: separate phase and task
columns (blank phase cells repeat the phase above), a single UTBMS-style code list
(x00 codes are phases), and codes typed in front of names. **Save All Settings**
writes uploaded templates into the app file (`FIRM_CONFIG.templates`), so they travel
with it. In the budget, **Load Template** fills the hours matrix. Rows left at zero
hours stay out of every output, and **Remove Empty Rows** clears them from the matrix.

## Updating rate data

- **In the app:** Settings writes a new rate card back into the file.
- **By hand:** in `src/matter-budget-builder.src.html`, find
  `// ── BEGIN RATE DATA ──`, replace the array, bump `RATE_DATA_VERSION`, rebuild.

## Publishing

GitHub Pages, deploying from the `main` branch root. `.nojekyll` is present so
paths are served verbatim. On the free plan the repository must be public.

## License

Copyright (c) 2026 Sergey Mezhiritskiy. See [LICENSE](LICENSE) for the full terms.

**Free to use in your own practice.** This includes commercial use, and using it to
scope, price, quote and bill your own legal work. Firms, in-house teams and
individual practitioners need no permission, and may adapt it for internal use.

**Not free to resell.** It may not be sold, incorporated into a product or service
offered to third parties, hosted as a service, or rebranded. These limits are aimed
at software vendors, not at firms using it for their own work. Sharing a budget or
fee estimate it produces with your own clients is ordinary use.

The bundled library keeps its own license; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Privacy

The app runs wholly in the browser. It makes no network requests (the build
enforces that), and nothing a user enters leaves their device.

## Site analytics

The public pages (`index.html`, `demo.html`, `404.html`) load `assets/track.js`,
which counts visits and clicks with [GoatCounter](https://www.goatcounter.com):
no cookies and no personal data. No third-party script is loaded either: the file
builds the count request itself. It counts only on `*.github.io`, so local copies
and previews send nothing. The downloaded app never includes it.

| Count | When it is recorded |
|---|---|
| `/`, `/demo.html` | a page view (with referrer and date/time) |
| `404 /…` | a broken link someone followed |
| `qr-scan` | a visit through the QR code, which encodes `?src=qr` |
| `download-app` | a click on any Download button (title: which page) |
| `sample-pdf`, `open-demo`, `source-file`, `linkedin`, `license`, `qr-download` | clicks on those links |
| `demo-start`, `demo-step`, `demo-finished` | use of the demo player |

Dashboard: https://matter-budget-builder.goatcounter.com (site code set in
`assets/track.js`). Downloads count clicks on the button, so a file fetched straight
from GitHub isn't counted.
