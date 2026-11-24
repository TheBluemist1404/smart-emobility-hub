# Lessons learned

What building the MVP taught us about the Sub2 and Sub3 design.

## What the design got right

- **One controller per use case, one class per entity** mapped straight to files. Most
  methods in the control and entity method descriptions became one TypeScript method each,
  with the same name. The code could be read next to the sequence diagrams.
- **StatusListener + IoTDataGateway** kept the physical world out of the controllers. The
  simulator (`SimulatedDataSource`) plays the docks, sensors and chargers, and every
  failure in the demo tools is just another IoT event. No controller has a "demo mode".
- **BR-RES-02 "move or cancel"** written once in ReservationController served UC-02 E4,
  UC-04 and UC-07 E3/6a, and UC-12 step 7. The cross-actor push (operator block → student
  "Vehicle replaced") fell out of it with no extra code.
- **Table 2.3-6 parameters** in one ConfigurationRegistry made the timers (pickup window,
  payment holds, inspection, unlock, check-in grace) easy to test at their boundaries.
- **Detached baseline for UC-13** (`Hub.captureSnapshot`) made "the simulation never
  changes live data" true by construction, and easy to test.

## Where the design was not enough

- **Time.** The design talks about timeouts but not about a clock. Every timer needed one
  `DemoClock` so tests can skip ahead and the demo can fast-forward. A real system needs
  the same idea (a scheduler that survives restarts); the design should name it.
- **Concurrency.** UC-12 E2 and UC-11 E4 say "someone else changed it". We needed an
  explicit version number on Incident and on the charging schedule. The class diagram
  should show it.
- **Late bank answers.** BR-PAY-03 covers a late Success for a released hold, but the
  design did not say which object owns the refund. We put it in PaymentController with the
  request ID as the key, so a repeated event refunds once (NIFR-05).
- **Numbers the design left open.** The tariff, the simulation demand model, the charging
  durations and the Hub peak power are not fixed in the documents. The MVP uses simple
  rules (listed in the README) so the screens show real numbers. These need a decision
  before a real build.
- **UI routing.** The mockups show screens, not navigation state. We had to decide where
  each push and link goes (for example, a notification "View VR-…" opens the ticket).

## Process

- Building in phases, each verified in the browser and committed, kept the main path
  working while the operator side grew.
- Tests labelled with TC IDs from `test-cases.md` showed quickly which design cases the
  code covers. Browser checks found bugs the tests missed: a parking and a charging booking
  that got the same short code, and a false "someone else changed this" warning after the
  operator's own save.
- Checking each screen against the mockup by its text (not only by screenshot) caught
  missing fields early.
- A shared helper that sent GET when no body was given caused two "button does nothing"
  bugs. Small helper APIs need the same care as domain code.
