// Operator QA round (2026-11-25): fixes found by clicking through O01–O06.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, now, min, db, ctl } from "./helpers";
import { HOUR } from "../src/platform/clock/DemoClock";
import { config } from "../src/platform/config/ConfigurationRegistry";
import { searchOperator } from "../src/api/operatorSearch";
import { Vehicle } from "../src/domain/network/Vehicle";
import { ChargingController } from "../src/control/operations/ChargingController";
import type { ChargingSession } from "../src/domain/allocation/ChargingSession";

beforeEach(fresh);

describe("UC-09 network monitor", () => {
  it("TC-UC09-06 vehicle-type filter keeps Hubs with that type ready and counts them", () => {
    const all = ctl.monitoring.filter({});
    const em = ctl.monitoring.filter({ vehicleType: "e-motorbike" });
    for (const h of em) {
      const ready = [...db.vehicles.values()].filter((v) => v.hubId === h.hubId && v.model === "e-motorbike" && v.status === "Available").length;
      expect(h.readyOfType).toBe(ready);
      expect(ready).toBeGreaterThan(0);
      expect(h.stale).toBe(false);
    }
    // The seed has Hubs with no Available e-motorbike (e.g. H02), so the list really changes.
    expect(em.length).toBeLessThan(all.length);
    expect(em.some((h) => h.hubId === "H02")).toBe(false);
  });

  it("CORE-06 charging-point KPIs count reporting Hubs only (free X of Y)", () => {
    const o = ctl.monitoring.openNetwork();
    const live = o.hubs.filter((h) => !h.stale);
    expect(o.kpis.pointsTotal).toBe(live.reduce((s, h) => s + h.chargers, 0));
    expect(o.kpis.pointsFree).toBeLessThanOrEqual(o.kpis.pointsTotal);
  });
});

describe("Console header search", () => {
  it("CORE-07 finds Hubs, vehicles, orders and incidents and says where to open them", () => {
    expect(searchOperator("H02")[0]).toMatchObject({ kind: "Hub", go: { nav: "monitor", hubId: "H02" } });
    expect(searchOperator("eb-0217")[0]).toMatchObject({ kind: "Vehicle", go: { nav: "monitor", hubId: "H01" } });
    expect(searchOperator("RO-0312")[0]).toMatchObject({ kind: "Order", go: { nav: "orders", orderId: "RO-0312" } });
    expect(searchOperator("INC-0190")[0]).toMatchObject({ kind: "Incident", go: { nav: "incidents", incidentId: "INC-0190" } });
    expect(searchOperator("CP-H01-04").map((h) => h.kind)).toEqual(expect.arrayContaining(["Charging point", "Incident"]));
    expect(searchOperator("metro")[0]).toMatchObject({ kind: "Hub", id: "H03" });
    expect(searchOperator("x")).toEqual([]);
    expect(searchOperator("zzzz")).toEqual([]);
    // Docks carry their Hub's code but rank below the Hub, its orders and its incidents.
    const h03 = searchOperator("H03");
    const firstDock = h03.findIndex((h) => h.kind === "Dock");
    expect(h03.slice(0, firstDock === -1 ? undefined : firstDock).some((h) => h.kind === "Order")).toBe(true);
  });
});

describe("UC-10 redistribution", () => {
  it("TC-UC10-03 same source and destination is refused with its own message", () => {
    const v = ctl.redistribution.validateOrder({ fromHub: "H02", toHub: "H02", model: "e-bike", quantity: 5, deadline: now() + HOUR });
    expect(v.ok).toBe(false);
    expect(v.message).toBe("The source and destination must be different Hubs.");
    expect(v.alternatives).toEqual([]);
  });

  it("TC-UC10-14 a cancelled order is no longer shown as overdue", () => {
    const o = db.orders.get("RO-0314")!;
    expect(ctl.redistribution.listOrders().orders.find((x) => x.id === o.id)!.overdue).toBe(true);
    ctl.redistribution.cancelOrder(o.id, "Team unavailable", "OP-014");
    expect(ctl.redistribution.listOrders().orders.find((x) => x.id === o.id)!.overdue).toBe(false);
  });

  it("TC-UC10-08 the O01 pre-filled order never asks for more vehicles than are eligible", () => {
    const seed = ctl.redistribution.orderSeedFor("H02")!;
    expect(seed.fromHub).toBe("H02");
    expect(seed.quantity).toBeLessThanOrEqual(Vehicle.countEligible(db.hubs.get("H02")!, "e-bike"));
    expect(ctl.redistribution.validateOrder({ ...seed, deadline: now() + HOUR }).ok).toBe(true);
  });
});

describe("UC-11 smart charging", () => {
  it("TC-UC11-07 policy: blank values are refused and time limits are stated in minutes", () => {
    expect(ctl.charging.savePolicy({ CHARGING_SHIFT_TOLERANCE: null as unknown as number })?.message).toBe("Enter a number for CHARGING_SHIFT_TOLERANCE.");
    expect(ctl.charging.savePolicy({ CHARGING_SHIFT_TOLERANCE: -5 * 60_000 })?.message).toBe("CHARGING_SHIFT_TOLERANCE must be between 0 min and 60 min.");
    expect(config().value("CHARGING_SHIFT_TOLERANCE")).toBe(15 * 60_000);
  });

  it("TC-UC11-16 the moved-session notice says where the session was before", () => {
    const s = db.allocations.get("CS-5HDP") as ChargingSession;
    const prev = { pointId: "CP-H01-03", start: s.slot!.start + min(15), end: s.slot!.end + min(15) };
    const text = ChargingController.shiftMessage(s, prev);
    expect(text).toContain(`moved from ${new Date(prev.start + 7 * HOUR).toISOString().slice(11, 16)} at CP-H01-03 to`);
    expect(text).toContain(`at ${s.slot!.pointId}`);
  });
});

describe("UC-13 what-if simulation", () => {
  const period = () => ({ start: now() + min(30), end: now() + min(30) + 2 * HOUR });

  it("TC-UC13-02 scenario B: overflow = returns − (free docks + pickups); vehicles move out, the Hub keeps 10%", () => {
    ctl.simulation.startSimulation("H03");
    ctl.simulation.defineScenario("B return wave", ["H03"], period(), [{ name: "extraReturns", value: 100 }]);
    const s = ctl.simulation.run();
    const h = db.hubs.get("H03")!.snapshot();
    const m = s.measures[0];
    expect(m.overflow).toBe(100 - (h.vacantDocks + m.demand));
    expect(m.shortage).toBe(0);
    const moves = s.recommendations.filter((r) => r.kind === "transfer");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((r) => r.params.fromHub === "H03" && r.params.toHub !== "H03")).toBe(true);
    const moved = moves.reduce((n, r) => n + (r.params.quantity ?? 0), 0);
    expect(h.available - moved).toBeGreaterThanOrEqual(Math.ceil(0.1 * h.docksInService));
    expect(s.after[0].overflow).toBe(Math.max(0, m.overflow - moved));
  });

  it("TC-UC13-11 a blank input is refused, not run as 0", () => {
    ctl.simulation.startSimulation();
    try { ctl.simulation.defineScenario("A demand surge", ["H02"], period(), [{ name: "extraDemandPct", value: null as unknown as number }]); expect.fail(); }
    catch (e) { expect((e as { code: string }).code).toBe("E2:extraDemandPct"); }
  });
});

describe("UC-14 apply recommendations", () => {
  it("TC-UC14-04 a transfer cut down by a live change says it was adjusted", () => {
    ctl.simulation.startSimulation("H05");
    ctl.simulation.defineScenario("A demand surge", ["H05"], { start: now() + min(30), end: now() + min(150) }, [{ name: "extraDemandPct", value: 200 }]);
    const s = ctl.simulation.run();
    const t = s.recommendations.find((r) => r.kind === "transfer" && (r.params.quantity ?? 0) >= 2)!;
    ctl.simulation.apply([t.id]);
    // Someone else takes all but one eligible e-bike at the donor Hub before the confirm.
    const from = t.params.fromHub!;
    const n = Vehicle.countEligible(db.hubs.get(from)!, "e-bike") - 1;
    const free = [...db.hubs.values()].find((h) => h.id !== from && h.id !== "H05" && !h.isStale() && h.netFreeDocks() >= n)!;
    ctl.redistribution.submitOrder({ fromHub: from, toHub: free.id, model: "e-bike", quantity: n, deadline: now() + HOUR }, "commit");
    const res = ctl.simulation.confirm(ctl.redistribution, ctl.charging).result!.find((x) => x.id === t.id)!;
    expect(res.outcome).toBe("Applied");
    expect(res.note).toMatch(new RegExp(`^Adjusted to 1 of ${t.params.quantity} vehicles`));
    expect(db.orders.get(res.reference!)!.quantity).toBe(1);
  });
});
