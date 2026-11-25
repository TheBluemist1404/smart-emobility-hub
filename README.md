# Smart E-Mobility Hub — MVP

The minimum viable product for the HCMUT HK261 Software Engineering assignment (group 4,
CC03). One TypeScript project: a Node + Express + socket.io server and a React + Vite front
end, with all state in memory, loaded from `seed/seed.json`.

## Run it

Needs Node 20 or later (tested with Node 24; `engines.node` pins 24.x for Render).

```powershell
npm install
npm run dev
```

Then open:

| URL | What |
|---|---|
| <http://localhost:5173/stage> | Demo stage: student phone and operator console side by side |
| <http://localhost:5173/student> | Student app (S01–S12), phone width 390 px |
| <http://localhost:5173/operator> | Operator console (O01–O06), desktop width |

Set `PORT` to use another port. The fonts and icons come from Google Fonts and npm; an
internet connection is only needed for the fonts.

## Deploy on Render

`render.yaml` is a Render Blueprint for one free web service. It runs
`npm ci && npm run build`, then `npm start`, checks `/healthz`, and redeploys on every push to
`main`. Node is pinned by `engines.node` in `package.json` (24.x).

One-time steps in the Render dashboard:

1. Go to <https://dashboard.render.com> and sign in with GitHub.
2. Click **New → Blueprint**.
3. Connect GitHub if asked, and give Render access to `TheBluemist1404/smart-emobility-hub`.
4. Pick that repository. Render reads `render.yaml` and shows the service
   `smart-emobility-hub` (plan Free).
5. Click **Apply** (or **Deploy Blueprint**). The first build takes a few minutes.
6. Open the service; its URL is `https://<name>.onrender.com`. Use `/stage`, `/student` or
   `/operator` on that URL.

Free-tier behaviour:

- The service sleeps after about 15 minutes with no traffic. The next request wakes it, which
  takes about 30–60 seconds. **Open the URL a minute before the demo.**
- All state is in memory. It resets to the seed data on every restart, wake-up after sleep,
  and deploy. That is the same as **Reset demo**.
- One instance only. Everyone who opens the URL shares the same demo state.

To try the production build locally:

```powershell
npm ci
npm run build
$env:PORT = "10000"; $env:NODE_ENV = "production"; npm start
```

Then open <http://localhost:10000/stage>.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Starts everything on one port |
| `npm run build` | Builds the front-end into `dist/` (`vite build`) |
| `npm start` | Production mode: serves `dist/`, the API and the WebSocket on `PORT` (0.0.0.0), with `/healthz` |
| `npm test` | Runs the Vitest suite (test cases labelled with their TC IDs) |
| `npm run typecheck` | TypeScript check |
| `npm run seed` | Regenerates `seed/seed.json` from `seed/generate.ts` |

## Layout

The source tree follows the Sub3 development view: one directory per package, one file per
class.

```
src/
  ui/student          MobileApp (React screens S01–S12)
  ui/operator         OperatorConsole (React screens O01–O06)
  ui/demo             Demo stage and Demo tools drawer (not design classes)
  control/booking     SearchController, ReservationController, RentalController,
                      IssueController
  control/operations  MonitoringController, ChargingController, RedistributionController,
                      IncidentController, SimulationController
  control/payment     PaymentController
  domain/network      Hub, Resource, Vehicle, Dock, ChargingPoint, ParkingSpace
  domain/allocation   StudentAccount, PrivateVehicle, Allocation, VehicleReservation,
                      ParkingReservation, ChargingSession, Trip, Payment
  domain/operations   IssueReport, Incident, Action, RedistributionOrder, VehicleTransfer,
                      SimulationScenario, Recommendation
  gateway/bank        BankGateway (mock Bank System)
  gateway/iot         IoTDataGateway, StatusListener, SimulatedDataSource
  platform/config     ConfigurationRegistry (every parameter of Table 2.3-6)
  platform/clock      DemoClock (demo tool, not a design class)
  api/                HTTP routes and view models between the UI and the controllers
server/main.ts        Express + socket.io + Vite on one port
seed/                 seed.json and its generator
tests/                Vitest suites
```

## What is in it

| Use case | Screens | State |
|---|---|---|
| UC-01 Search Hubs | S01, S02 | Done, with stale-data marking (E1) |
| UC-02 Reserve vehicle, UC-03 Payment | S03, S04 | Done, with bank Failed / Timeout / late Success |
| UC-04 Parking reservation | S05 | Done, with check-in by the parking sensor |
| UC-05 Charging reservation | S06 | Done, with slot proposal and plug-in |
| UC-06 Report issue | S07, S08 | Done; photo upload failure (E1) is not simulated |
| UC-07 Pick up, UC-08 Return | S04, S09, S10 | Done, with unlock failure / timeout and latch |
| S11 Bookings, S12 Notifications | S11, S12 | Done |
| UC-09 Monitor network | O01 | Done |
| UC-10 Redistribution | O02 | Done, with transfers driven from Demo tools |
| UC-11 Smart charging | O03 | Done, with priority BR-CHG-01 and point faults |
| UC-12 Incidents | O04 | Done, with blocking and the cross-actor push |
| UC-13 What-if simulation | O05 | Done (scenarios A, B, C) |
| UC-14 Apply recommendations | O06 | Done |

The demo walk-through is in [DEMO-SCRIPT.md](DEMO-SCRIPT.md). Screenshots are in
[screenshots/](screenshots/). What we learned is in [LESSONS-LEARNED.md](LESSONS-LEARNED.md).

## Demo tools

Every page has a **Demo tools** drawer (add `?tools=0` to the URL to hide it). It controls
the demo clock (skip ahead, speed, next timer, reset), the mock bank (Success, Failed,
Timeout, manual answers), dock unlock (Success, Failure, Timeout, late release), the
student's location, Hub and resource data feeds (disconnect / reconnect), battery levels,
charging-point faults, plug-in, the dock latch at return, and redistribution transfers
(Departed, Arrived, Breakdown).

The demo state is shared: everyone on the same URL sees the same data and the same simulator
settings. The drawer says so at the top, next to **Reset demo**. While the bank or dock unlock
is not at Success, both views show a warning banner with **Back to normal**. On the student's
return screen each vacant dock can be tapped to simulate docking (or "Not engaged"), so a
rental can be finished without the drawer.

## Tests

`npm test` runs 71 Vitest tests. Each test name starts with its TC ID from
`sub3-design/descriptions/test-cases.md` (for example `TC-UC02-08`). Tests of the platform
parts that have no TC ID are labelled `CORE-nn`; the demo-tool tests are labelled `DEMO-nn`.

## Where the code differs from the design

- **MVP rules for open numbers.** The tariff, the simulation demand model (one pickup per
  hour for every four docks in service), the charging durations (shared vehicles use the
  e-bike profile) and the Hub peak power (76 % of the installed power) are simple MVP
  rules. The design does not fix them.
- **Version numbers.** Incident and the charging schedule carry a `version` for the
  "someone else changed it" checks (UC-12 E2, UC-11 E4). The class diagram has no such
  attribute.
- **Incident faults.** Incident keeps a small set of fault notes for charging points
  (`faults`), used by UC-11 E3. It is not in the class diagram.
- **Rebalancing suggestions** (UC-10 3a) are computed in RedistributionController from
  BR-HUB-01 flags, not by a separate class.
- **Simulation recommendations** (BR-SIM-01) are derived in SimulationController from the
  scenario measures: transfers from surplus Hubs, charging plans for low-battery vehicles
  or failed points, and alternative-Hub advice.
- **DemoClock and SimulatedDataSource** are demo infrastructure, not design classes.
- **UC-06 E1** (photo upload fails) is not simulated; photos are placeholders.

