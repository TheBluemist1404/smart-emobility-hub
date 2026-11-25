# Handoff

State on 2026-11-25: phases 0–6 are done, and the MVP is deployable on Render (see "Production build and Render").
Pushed to GitHub. A new session only needs this file, the README and the docs below.

## Run and test

```powershell
npm install
npm run dev     # one port, 5173: /stage, /student, /operator (?tools=0 hides Demo tools)
npm test        # 63 Vitest tests, named by TC ID (CORE-nn for platform tests)
npm run typecheck
```

`tsx watch` restarts the server, and with it the in-memory demo state, on every server-file edit.
UI-only edits do not restart it.

## Production build and Render (2026-11-25)

The repo is public at `TheBluemist1404/smart-emobility-hub` (branch `main`).

- `npm run build` runs `vite build` into `dist/` (gitignored).
- `npm start` runs `tsx server/main.ts --prod`. Production mode is on with `--prod` or
  `NODE_ENV=production`. It serves `dist/` with an SPA fallback (any non-`/api/` GET gets
  `index.html`), the API and socket.io on `PORT`, bound to `0.0.0.0`. Without `dist/index.html`
  it exits with an error. In dev, Vite is imported only on the dev path.
- `/healthz` returns `{"ok":true}` in both modes.
- The client's socket connects with `io()`, so it uses the page's own host and `wss` on https.
- `tsx`, `vite` and `@vitejs/plugin-react` are in `dependencies`, so `npm ci` with
  `NODE_ENV=production` (which skips devDependencies) still builds and runs.
- `engines.node` is `24.x` (tested with Node 24.14.1).
- `render.yaml` is the Blueprint: one free web service, `npm ci && npm run build`,
  `npm start`, health check `/healthz`, auto-deploy on push to `main`, `NODE_ENV=production`.
  Dashboard steps are in the README section "Deploy on Render".
- Free tier: sleeps after about 15 min idle, cold start about 30–60 s, and the in-memory
  state resets on every restart or deploy. Everyone on the URL shares one demo state.

Verified locally on 2026-11-25 with `PORT=10000 NODE_ENV=production npm start`: `/stage`,
`/student` and `/operator` load on a hard refresh with no console errors; demo steps 1–2
(reserve EB-0217, operator blocks it) push "Vehicle replaced" to the student tab over the
WebSocket without a reload. `npm test` (63) and `npm run typecheck` pass.

## Package layout

See the README "Layout" section. The short version:
- `src/control/booking`: Search, Reservation, Rental and Issue controllers.
- `src/control/operations`: Monitoring, Charging, Redistribution, Incident and Simulation controllers.
- `src/control/payment`: PaymentController.
- `src/domain/*`: entities, one class per file.
- `src/gateway/{bank,iot}`: mock Bank System and the IoT simulator.
- `src/platform`: config, DemoClock and the event bus.
- `src/api`: routes (student, operator, demo), the `ctl` controller singletons, socket push helpers.
- `src/ui/{student,operator,demo,shared}`: React screens.

## What each phase delivered

| Phase | Commit | What |
|---|---|---|
| 0 | 99eddc6 | Skeleton, seed, design system, both views |
| 1 | 6418b87 | Entities, state machines, config, gateways, demo clock |
| 2 | 071608e | Student main path: UC-01 → 02 → 03 → 07 → 08 |
| 3 | 363d8d0 | UC-04, UC-05, UC-06, S11, S12 |
| 4 | 3f43eaa | Operator UC-09 to UC-12, plus the cross-actor push |
| 5 | 5d3b310 | UC-13 simulation (O05) and UC-14 apply (O06) |
| 6 | ac67a33 | TC-labelled tests, DEMO-SCRIPT, screenshots, LESSONS-LEARNED, README |

## Known shortcuts and gotchas

- In `src/ui/shared/live.ts`, `api(url)` with no body sends a GET. POST actions must pass `{}`.
- UC-06 E1 (photo upload fails) is not simulated.
- The time inputs on O05 show in the browser's locale format (12 h on some machines).
- In scenario C the recommendations are charging plans only. Shortage figures are still shown.
- To retake every screenshot, run `npm run dev`, then `node tools/screenshots.mjs http://localhost:5173`.
  It resets the demo, walks DEMO-SCRIPT.md and writes the 28 files in `screenshots/` (about 3 minutes).
  It needs Chrome or Edge installed (or `CHROME=<path>`). See "Review round" below.

## Design vs code

See the README section "Where the code differs from the design":
- MVP rules fill the numbers the design leaves open (tariff, demand model, charging profile, 76 % peak kW).
- `version` on Incident and on the charging schedule.
- Incident `faults`.
- Suggestions and recommendations are computed in their controllers.
- DemoClock and SimulatedDataSource are demo-only.

## Review round (2026-11-24)

A visual pass over `/student` at 390 px, `/operator` at 1440 and 1280 px, `/stage` at 800–1920 px
and the Demo tools panel, compared with `ui-design/screens` and `ds.css`.

### Tools added (`tools/`, no npm dependencies)

- `cdp.mjs`: a small Chrome DevTools Protocol driver (headless Chrome, Node's built-in WebSocket,
  en-GB locale, Asia/Ho_Chi_Minh time zone). `__ov()` reports sideways scroll, boxes that clip
  their content, and `--:--` placeholders.
- `screenshots.mjs`: retakes `screenshots/` (see above).
- `review-operator.mjs <base> <width> <outDir>` and `review-student.mjs <base> <width> <outDir>`:
  walk O01–O06 or S01–S12, save shots and print the `__ov()` report for each screen.
  The trip and ticket cards show up as "clips" on purpose (decorative cut-outs); ignore those.

### Found and fixed

Stage (`/stage`):
- The operator console overflowed its half and scrolled sideways. Now the phone scales to the
  height and the console is laid out at max(column, 960 px) and scaled down to fit ("scaled N%"
  in the stage bar). No sideways scroll at 800, 1000, 1366 or 1920 px.
- Two Demo tools buttons, one on the student tab bar. The iframes now load with `tools=0` and
  the stage bar holds the only button.
- The phone's shadow was cut off at the iframe edge; the student page now centres the phone.

Operator console:
- KPI and alert cards clipped, header meta broken into pieces, filters row overflowing:
  the page head wraps, meta items and KPI lines no longer break mid-phrase, alert cards use
  `auto-fit` columns.
- Below 1360 px the layout tightens; below 1240 px the sidebar becomes an icon rail and map/table,
  timeline/queue and the other two-column grids stack.
- Map labels overlapped: the map uses a schematic layout (`MAP_POS` in `CampusMap.tsx`), shared with
  the student map. The legend no longer covers a pin.
- "Hubs on alert" sub-text wrapped badly; it now breaks only between items.
- Hub table: last column was clipped and flags were crammed. Status and flags are now one column
  with wrapping chips.
- Smart charging: the "now" marker was a hard-coded "14:36" in CSS; gridlines assumed 16 slots;
  the policy grid overflowed; short blocks spilled their text. All now follow the data.
- Navigation did not scroll back to the top.
- Demo tools covered the Apply buttons; it now sits in the sidebar.
- Text: "session(s)" plurals, lowercase categories, "P-B01" breaking at the hyphen.

Student app:
- `/student` had the phone frame twice and was wider than a 390 px screen. Below 420 px the
  frame is dropped and the app fills the screen.
- Datetime fields overflowed at 390 px (S05, S06): they now stack.
- S09 scan: white text on a light background. The whole screen is dark now.
- Choice cards showed a tick even when not selected.
- The pickup countdown ring read like a clock time; it now says "left".
- Map view: the hub list overlapped the map without a backing; it is now a bottom sheet.
- Fare: a large gap before "VND".
- S11: long booking lines pushed the status chips off the card.

### Left as it is

- O05 time inputs follow the browser's locale (12 h on an en-US machine). Native inputs; a
  custom picker is not worth it for the demo.
- On the charging timeline the red "now" label covers the first time label when now is close to
  the start of the horizon.
- O01 at 1280 px: the third alert banner sits alone on its row.
- The stage at about 1000 px works but is small (console about 70 %, phone about 0.7). Use
  1366 px or wider for the live demo.
- The `__ov()` check reports the stage's left column as clipping; that is the scaled phone
  iframe, not a bug.

