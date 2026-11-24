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
  control/booking     SearchController, ReservationController, RentalController
  control/charging    ChargingController
  control/support     IssueController, IncidentController
  control/operations  MonitoringController, RedistributionController, SimulationController
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
