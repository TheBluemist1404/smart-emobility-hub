# Handoff

State on 2026-11-25: phases 0–6 are done, and the MVP is deployable on Render (see "Production build and Render").
Pushed to GitHub. A new session only needs this file, the README and the docs below.

## Run and test

```powershell
npm install
npm run dev     # one port, 5173: /stage, /student, /operator (?tools=0 hides Demo tools)
npm test        # 82 Vitest tests, named by TC ID (CORE-nn platform, DEMO-nn demo tools)
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


## Public-URL fixes (2026-11-25)

A tester on the Render URL could not finish a rental. The backend worked; the UI did not.

### Found and fixed

- **Return was a dead end without Demo tools.** S10 listed the vacant docks as plain tags, and
  "I've docked it — End Trip" only works after something latches the vehicle, which only the
  Demo tools drawer could do. Now each vacant dock is a button ("Tap a dock to simulate
  docking (demo)") that posts `/api/demo/latch`; the trip still closes on the dock's latch
  report through `RentalController` (UC-08 step 5). A "Dock result: Clicks in / Not engaged (E3)"
  switch shows E3. Works on `/student?tools=0` and inside `/stage`.
- **The demo latch accepted any dock.** `/api/demo/latch` now goes through
  `src/api/demoActions.ts#demoLatch`, which refuses an unknown or non-vacant dock and a vehicle
  with no open trip (409/404 with a message).
- **Shared simulators broke other visitors silently.** The bank and unlock modes are global.
  Both views now show a "Demo simulator changed" banner whenever the bank mode or next-mode,
  or the unlock mode or next-mode, is not Success (`src/ui/shared/simStatus.ts`,
  `src/ui/demo/SimWarning.tsx`), with **Back to normal** (`POST /api/demo/normal`).
  The drawer opens with a "Shared demo" note and a prominent **Reset demo**.
  Reset uses two taps instead of `confirm()`.
- **A trip closed by an operator vanished.** After UC-12 8c (e.g. TR-0943 closed by INC-0194
  with the fare waived) the Trip tab fell back to the scan screen once 30 demo-minutes had
  passed since the report time, and the student stayed on whatever tab they were on. Now the
  phone jumps to the Trip tab when the open trip closes, and an operator-closed trip shows
  "Trip closed by an operator" (incident ID, close time, fare 0 VND Waived, "you don't need to
  return it") until the student taps Done (`src/ui/student/tripSummary.ts`).
- **An old receipt hid the scan screen.** With a new confirmed reservation, "I'm at the Hub —
  scan to pick up" opened the previous trip's receipt (still inside its 30 min). A waiting
  pickup now wins over a paid receipt; an Unpaid fare still wins over everything.
- **The "Trip tab opens S10 return" state leaked to the next trip.** `returning` is now keyed to
  the trip ID.
- Smaller: the reservation-payment screen said "No fee was charged" next to "Your bank
  confirmed late"; the waived receipt showed "H01 → null".

Tests: `tests/demo.test.ts` (DEMO-01 to DEMO-03, 8 tests). Total 71.

## Operator QA (2026-11-25)

Every O01–O06 screen and action was clicked through in the real UI (preview "mvp", 1440 px,
1280 px and inside `/stage`), with the student side in a second tab for the cross-actor paths.

### Found and fixed

O01 Network monitor (UC-09):
- **The header search did nothing** (a static box). It now searches Hubs, vehicles, orders,
  incidents, charging points, docks and parking spaces (`GET /api/operator/search?q=`,
  `src/api/operatorSearch.ts`) and opens the right screen: Hub → its monitor panel, order → O02
  with the order selected, incident → O04 with it open, charging point → O03 for its Hub.
  Arrow keys + Enter work; "/" focuses it. It now also shows below 1240 px and in `/stage`.
- **The bell did nothing.** It opens the alert list (`src/ui/operator/TopBar.tsx`): newest first,
  Acknowledge per alert or all, and clicking an alert opens its Hub (TC-UC09-05).
- **The vehicle-type filter never changed the list** (every Hub parks both types). It now keeps
  the Hubs with at least one "Available" vehicle of that type, and the Hub table has a "Ready"
  column that counts that type.
- "Charging points free X of Y": Y counted the Disconnected H06, X did not. Both now count
  reporting Hubs only.
- "Create Redistribution Order" from an overloaded Hub pre-filled 5 vehicles while only 4 were
  eligible. It now uses the same rule as the O02 suggestions (`orderSeedFor`).

O02 Redistribution (UC-10):
- Same source and destination showed the E1 "only N eligible" message and alternative Hubs. It
  now says "The source and destination must be different Hubs."
- A cancelled (or completed) order kept its red "Overdue" chip. Overdue now applies to open
  orders only.
- A validation error in the new-order form never cleared after the inputs were fixed.
- The transfers card now shows the deadline and minutes left for an open order.

O03 Smart charging (UC-11):
- The student's "Charging session moved" notice said "moved from 15:15 to 15:15" after a point
  fault: it quoted the original booking, not the slot it left. It now says "moved from 15:30 at
  CP-H01-03 to 15:15 at CP-H01-01 (no later than 15 min after your booked 15:15 …)".
- Policy: a blank field was saved as 0, and time limits were stated in ms ("between 0 and
  3600000"). Blank is refused; limits read "between 0 min and 60 min".

O05 What-if (UC-13) and O06 Apply (UC-14):
- A blank % or returns field ran as 0. It is now refused with the field error (E2).
- **Scenario B was wrong.** Overflow ignored the pickups (TC-UC13-02: overflow = returns −
  (free docks + pickups)), returned vehicles were not counted as supply, and the Hubs in the
  wave got "transfer more vehicles in" recommendations while overflowing. Now returns add supply,
  overflow follows TC-UC13-02, overflowing Hubs only move vehicles out (to Hubs outside the wave,
  several if needed), and each keeps HUB_SHORTAGE_RATIO of its docks in vehicles. The "after"
  figures also subtract vehicles a Hub gives away.
- When the live state shrank a transfer between review and confirm (6a), the result said
  "Applied · 1 vehicle" under a "Transfer 6 e-bikes" title. It now says "Adjusted to 1 of 6
  vehicles (live state changed)".

Tests: `tests/operator-qa.test.ts` (11 tests, labelled TC-UC09-06, TC-UC10-03/08/14,
TC-UC11-07/16, TC-UC13-02/11, TC-UC14-04, CORE-06/07). Total 82.

### Checked and working (no change)

KPIs add up against `/api/operator/network`; category, status and sort filters; H06 E1 banner
and restoring its feed (banner clears, KPIs grow to 7 Hubs); 5b banners and "Open charging
schedule"; map pins and the Hub panel; Acknowledge; "Updated … s ago" ticks every
MONITOR_REFRESH and student-side changes (a report, a reservation) appear at once over the
socket. O02: order create/confirm, Draft resume, quantity and capacity checks with "Use Hx",
Departed → Arrived → Completed / Partially Completed, Breakdown (incident opened, vehicle Under
Maintenance), counts moving on O01 and in the student Hub view, cancel with reason, overdue
warning after the clock passes the deadline. O03: Generate, drag within / beyond
CHARGING_SHIFT_TOLERANCE, onto an Out of Service point, onto a taken slot, Apply (student notified),
Discard, policy weights must total 1, point fault moves the paid session. O04: new incident
(validation), student report → incident, Start handling → Block → "Vehicle replaced" on the
phone, Resolve, Save progress, Dismiss as duplicate, E2 version conflict with Reload, 8c
"Confirm breakdown during trip". O05/O06: scenarios A, B, C with valid and invalid inputs,
partial apply, advisory items cannot be ticked, live change between review and confirm.
Demo-simulator banner and Back to normal; two-tap Reset demo; no sideways scroll at 1440/1280
or in `/stage`; no dead buttons on any screen; no JS exceptions in the console.

### Left as it is

- The charging schedule "version" is the sum of the Hub's point versions, so it jumps by the
  number of points per apply (4 → 8 at H01). Correct for the E4 check, odd to read.
- A student report adds two action lines to its incident ("Opened from student report" and
  "Report IR-… from student …").
- A vehicle that broke down in transit is still counted at its source Hub in O01 (not docked).
- Browser consoles log the API's 4xx validation answers as failed requests; they are expected.
