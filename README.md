# Smart E-Mobility Hub — MVP

The minimum viable product for the HCMUT HK261 Software Engineering assignment (group 4,
CC03). One TypeScript project: a Node + Express + socket.io server and a React + Vite front
end, with all state in memory, loaded from `seed/seed.json`.

## Run it

Needs Node 20 or later (tested with Node 24).

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

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Starts everything on one port |
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

## Tests

`npm test` runs 63 Vitest tests. Each test name starts with its TC ID from
`sub3-design/descriptions/test-cases.md` (for example `TC-UC02-08`). Tests of the platform
parts that have no TC ID are labelled `CORE-nn`.

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

