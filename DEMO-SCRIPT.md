# Demo script (about 10 minutes)

Two people can run this, or one person on one screen. Everything runs on one machine.

## Before you start

```powershell
npm install
npm run dev
```

Open <http://localhost:5173/stage>. The left side is the student phone (Nguyen Minh Khoa ·
2412345). The right side is the operator console (Tran Lan · OP-014). Both sides share one
server, so a change on one side shows on the other within a second.

The **Demo tools** button (bottom right of each side) opens a drawer with:

- **Clock:** skip ahead (+30 s, +1 min, +5 min, +15 min, +1 h), "Next timer", speed ×1/×10/×60,
  pause, and **Reset demo** (back to Mon 02/11/2026 14:36 and the seed data).
- **Bank:** answer Success, Failed or Timeout, for every request or only the next one.
- **Dock unlock:** Success, Failure or Timeout, and a late release.
- **Location:** inside or outside the Hub area.
- **Hubs:** cut or restore a Hub's data feed (H06 starts cut).
- **Vehicles and points:** set a battery level, disconnect a vehicle or point, report a
  charging-point fault, plug in a charging session.
- **Trip:** latch the vehicle into a chosen dock, or "Not engaged".
- **Transfers:** Departed, Arrived or Breakdown for each redistribution transfer.

Press **Reset demo** before each run.

## 1. Student: find and reserve a vehicle (UC-01, UC-02, UC-03) — 2 min

1. On the phone, the Hubs tab lists the campus Hubs. Point out H06: it is marked
   Disconnected, and its vehicles cannot be reserved (UC-01 E1).
2. Tap **H01 KTX Khu A**. The vehicle list shows battery level, status and tariff.
3. Tap **Reserve** on **EB-0217**. The summary shows the 5,000 VND reservation fee and the
   15-minute pickup window. Tap **Confirm & Pay**.
4. The bank answers after about 2 s. The ticket shows **VR-…**, "Confirmed", and the pickup
   deadline 14:51.

Optional failure: in Demo tools set **Bank → Next: Failed**, reserve another vehicle, and
show "Payment Failed" with the hold released (UC-02 E2).

## 2. Cross-actor push: operator blocks the reserved vehicle (UC-12 → UC-02 E4) — 1.5 min

1. On the console, open **Incidents → New incident**. Resource **EB-0217**, category
   "Vehicle failure", a short description. **Create incident**.
2. In the incident panel, tap **Start handling**, then **Block resource** with a note.
3. The panel lists the affected reservation: "moved to EB-0221".
4. Look at the phone: a **"Vehicle replaced"** banner appears at once, and the ticket now
   shows EB-0221 with the same pickup deadline. No reload was needed: the server pushed it.
5. Open the bell (Notifications, S12) to show the stored message with a "View VR-…" link.

## 3. Student: pick up, ride and return (UC-07, UC-08) — 2.5 min

1. On the ticket, tap **I'm at the Hub — scan to pick up**, then **Scan EB-0221**.
2. The inspection screen counts down (INSPECTION_TIMEOUT). Tap **Unlock & Start Trip**.
   The dock opens after about 1 s and the Trip tab starts the timer.
3. Optional failure: before step 2, set **Dock unlock → Failure**. The app shows E3, an
   incident is opened on the dock, and the reservation moves to another e-bike.
4. Skip the clock **+15 min**: the fare so far grows.
5. In Demo tools → **Trip**, choose a vacant dock at any Hub and press **Latch**.
6. Tap **I've docked it — End Trip**. The fare is charged; the receipt shows the time and
   distance parts.
7. Optional: set **Bank → Next: Failed** before step 6. The fare becomes "Unpaid" and the
   student is blocked from new reservations until **Pay now** succeeds (UC-08 E2).

## 4. Student: parking, charging and reporting (UC-04, UC-05, UC-06) — 1.5 min

1. Back on **Hubs → H01 → Parking**, tap **Reserve parking** (S05): choose the private vehicle, a time window,
   then **Confirm & Pay** → PR-… Confirmed.
2. **H01 → Charging → Schedule charging** (S06): choose the vehicle, current and target battery, needed-by time. The
   system proposes a point and slot with the price → confirm → CS-… Scheduled.
3. **Report** tab (S07): category, resource, description → **Send report**. The result
   shows IR-… linked to an incident; the console's Incidents count goes up.

## 5. Operator: monitor, redistribute, charge (UC-09, UC-10, UC-11) — 1.5 min

1. **Network monitor** (O01): KPIs, the E1 banner for H06, the 5b low-battery banners for
   H02 and H04. Click **H02** (Overloaded) to open its panel.
2. **Create Redistribution Order** from the panel, or use a suggestion on
   **Redistribution orders** (O02). Confirm → RO-… "Assigned"; the vehicles show
   "In Redistribution" and the destination docks "Allocated".
3. In Demo tools → **Transfers**, press **Departed** then **Arrived** on each vehicle. The
   order goes In Transit → Completed.
4. **Smart charging** (O03), Hub H01: **Generate Schedule**, show the priority queue and
   the load chart under the peak line, then **Apply**.
5. Optional: Demo tools → **Report fault** on a point with a paid session. The session is
   moved within 15 min or cancelled with a refund, and the student is told.

## 6. Operator: what-if simulation and apply (UC-13, UC-14) — 1.5 min

1. From the H02 panel, press **Run What-if Simulation**. The violet frame says
   "SIMULATION — results do not change live data".
2. Scenario **A · Demand surge**, Hubs H02, H03, H05, +60 %. **Run simulation**.
3. Show the before → after KPIs, the per-Hub table and the recommendations. The
   alternative-Hub advice cannot be ticked.
4. **Apply N selected…** → the review (O06) rechecks each one against the live state.
   **Confirm and apply** → each one is "Applied" with its RO-… or schedule version, or
   "Not Applied" with the reason.
5. Open **Redistribution orders**: the new orders are there with source "simulation".

## Close

Press **Reset demo**. Run `npm test` to show the 63 tests, labelled with their TC IDs, pass.
