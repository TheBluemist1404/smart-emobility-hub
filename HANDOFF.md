# Handoff

State on 2026-11-24: phases 0–6 are all done and committed locally (last commit is Phase 6).
Nothing is pushed. A new session only needs this file, the README and the docs below.

## Run and test

```powershell
npm install
npm run dev     # one port, 5173: /stage, /student, /operator (?tools=0 hides Demo tools)
npm test        # 63 Vitest tests, named by TC ID (CORE-nn for platform tests)
npm run typecheck
```

`tsx watch` restarts the server, and with it the in-memory demo state, on every server-file edit.
UI-only edits do not restart it.

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
- The screenshots were taken with a throwaway headless-Chrome script that is not in the repo.
  To retake them, drive `/student?tools=0` at 430 px and `/operator?tools=0` at 1440 px.

## Design vs code

See the README section "Where the code differs from the design":
- MVP rules fill the numbers the design leaves open (tariff, demand model, charging profile, 76 % peak kW).
- `version` on Incident and on the charging schedule.
- Incident `faults`.
- Suggestions and recommendations are computed in their controllers.
- DemoClock and SimulatedDataSource are demo-only.
