---
name: verify
description: How to run and verify Semester HQ changes end-to-end (serve statically, drive with Playwright, run the ?selftest suite).
---

# Verifying Semester HQ

No build step — four static files (`index.html`, `app.js`, `parsers.js`, `app.css`).

## Launch

```bash
python3 -m http.server 8641 --directory /path/to/semester-hq   # any static server works
```

## Built-in test suite

Open `http://localhost:8641/index.html?selftest` in a browser and read the console:
every line is `PASS — …` or `FAIL — …`. Capture console messages with Playwright
(`page.on('console', …)`) and assert zero `FAIL`.

## Driving flows (Playwright, chromium headless)

- `npm i playwright && npx playwright install chromium` in a scratch dir; import from a script there.
- Sample data: click `[data-action="load-sample"]` on the This Week view (only shown when no data).
- Views are hash-routed; nav links are `a[data-view="week|upcoming|courses|calendar"]`.
- State lives in localStorage key `semesterhq:v1`; seed edge cases by mutating it
  via `page.evaluate` then `page.reload()` (sample data has no course `schedule` —
  inject one to test meeting-time features).
- Theme toggle is `#theme-toggle`; the body background transitions ~0.22s, so
  `waitForTimeout(600)` before dark-mode screenshots or they capture mid-transition.
- Backup download: `page.waitForEvent('download')` around `#btn-export`.

## Gotchas

- Dates are local `YYYY-MM-DD` strings everywhere; never compare against UTC-parsed dates.
- `render()` re-renders all views; per-view checks should re-query the DOM after any action.
- Cache-busted assets (`?v=N` in index.html) — bump when editing js/css or a warm browser may serve stale files.
