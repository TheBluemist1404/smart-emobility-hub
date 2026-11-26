// Teammate feedback round (2026-11-26): one test per reported problem that has logic behind it.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, now, min, db, ctl } from "./helpers";
import { HOUR } from "../src/platform/clock/DemoClock";
import { config } from "../src/platform/config/ConfigurationRegistry";
import { planOutflow, safeRoom } from "../src/domain/operations/OutflowPlan";
import type { ScheduleBlock, ScheduleProposal } from "../src/control/operations/ChargingController";

beforeEach(fresh);
const period = () => ({ start: now() + min(24), end: now() + min(24) + 2 * HOUR });
const hubSnap = (id: string) => db.hubs.get(id)!;

describe("Student search (feedback 1)", () => {
  it("a vehicle-type filter makes the card count only that type", () => {
    const all = ctl.search.search({ text: "", type: "any", minSoc: 0, nearMe: false });
    const em = ctl.search.search({ text: "", type: "electric motorcycle", minSoc: 0, nearMe: false });
    for (const h of em.hubs) {
      const real = [...db.vehicles.values()].filter((v) => v.hubId === h.hubId && v.status === "Available" && v.usage !== "In Use" && v.type === "electric motorcycle").length;
      expect(h.available).toBe(real);
      expect(h.available).toBeLessThanOrEqual(all.hubs.find((x) => x.hubId === h.hubId)!.available);
    }
    expect(em.hubs.find((h) => h.hubId === "H03")!.available).toBeLessThan(all.hubs.find((h) => h.hubId === "H03")!.available);
  });
});

describe("UC-10 orders (feedback 2 and C)", () => {
  it("an order the destination cannot take is refused, and the check names the real numbers", () => {
    const d = { fromHub: "H03", toHub: "H02", model: "e-bike", quantity: 5, deadline: now() + HOUR };
    const v = ctl.redistribution.validateOrder(d);
    expect(v.ok).toBe(false);
    const free = hubSnap("H02").netFreeDocks();
    expect(v.checks.find((c) => c.label === "Destination net free docks")!.detail).toBe(`${free} free · 5 needed`);
    expect(() => ctl.redistribution.submitOrder(d, "commit")).toThrow();
  });

  it("planOutflow fills the nearest Hub first, each only up to the safe ceiling", () => {
    const src = { hubId: "S", x: 0, y: 0 };
    // 20 docks in service: the 70 % ceiling is 14, so room = 14 - occupied.
    const dest = (hubId: string, x: number, occupied: number) => ({ hubId, x, y: 0, docksInService: 20, occupiedDocks: occupied, vacantDocks: 20 - occupied });
    const p = planOutflow(src, 9, [dest("far", 100, 4), dest("near", 10, 11), dest("mid", 50, 10)], 70);
    expect(p.legs.map((l) => [l.toHub, l.quantity])).toEqual([["near", 3], ["mid", 4], ["far", 2]]);
    expect(p.placed).toBe(9);
    expect(p.left).toBe(0);
  });

  it("an overloaded Hub gets a plan over several Hubs, nearest first, none pushed past 70 %", () => {
    const sugg = ctl.redistribution.listOrders().suggestions.filter((s) => s.plan);
    expect(sugg.length).toBeGreaterThan(1);
    const bySource = new Map<string, typeof sugg>();
    for (const s of sugg) bySource.set(s.fromHub, [...(bySource.get(s.fromHub) ?? []), s]);
    const planned = new Map<string, number>();
    for (const legs of bySource.values()) {
      const kms = legs.map((l) => l.plan!.km);
      expect([...kms].sort((a, b) => a - b)).toEqual(kms);
      for (const l of legs) planned.set(l.toHub, (planned.get(l.toHub) ?? 0) + l.quantity);
    }
    for (const [hubId, q] of planned) expect(q).toBeLessThanOrEqual(safeRoom(hubSnap(hubId).snapshot(), config().value("HUB_BUSY")));
    expect([...bySource.values()].some((legs) => legs.length > 1)).toBe(true);
  });

  it("after leg 1 is committed the plan continues with what is left", () => {
    const first = ctl.redistribution.listOrders().suggestions.find((s) => s.plan && s.plan.legs > 1)!;
    const before = first.plan!.excess;
    const ids = [...db.vehicles.values()].filter((v) => v.hubId === first.fromHub && v.isEligibleForOrder() && v.model === first.model).slice(0, first.quantity).map((v) => v.id);
    ctl.redistribution.submitOrder({ fromHub: first.fromHub, toHub: first.toHub, model: first.model, quantity: first.quantity, deadline: now() + HOUR, vehicleIds: ids }, "commit");
    const next = ctl.redistribution.listOrders().suggestions.filter((s) => s.plan?.sourceHub === first.fromHub);
    expect(next.every((s) => s.toHub !== first.toHub || s.quantity <= first.plan!.room - first.quantity)).toBe(true);
    if (next.length) expect(next[0].plan!.excess).toBe(before - first.quantity);
  });
});

describe("UC-13 scenarios A and B (feedback 3, 4)", () => {
  function run(type: string, hubs: string[], inputs: Array<{ name: string; value: unknown }>) {
    ctl.simulation.startSimulation(hubs[0]);
    ctl.simulation.defineScenario(type as never, hubs, period(), inputs as never);
    return ctl.simulation.run();
  }

  it("A never moves vehicles into a Hub above 70 %, nor takes them from a Hub that is short", () => {
    const s = run("A demand surge", ["H02"], [{ name: "extraDemandPct", value: 150 }]);
    const transfers = s.recommendations.filter((r) => r.kind === "transfer");
    expect(transfers.every((r) => r.params.toHub !== "H02")).toBe(true);
    for (const r of transfers) expect(hubSnap(String(r.params.fromHub)).snapshot().flags).not.toContain("Vehicle Shortage");
    expect(s.recommendations.some((r) => /No transfer into H02/.test(r.title))).toBe(true);
  });

  it("B with an overflowing H02 recommends moving vehicles out of it and redirecting returns", () => {
    const s = run("B return wave", ["H02", "H03"], [{ name: "extraReturns", value: 40 }]);
    expect(s.measures.find((m) => m.hubId === "H02")!.overflow).toBeGreaterThan(0);
    expect(s.recommendations.some((r) => r.kind === "transfer" && r.params.fromHub === "H02")).toBe(true);
    expect(s.recommendations.some((r) => /returning students from H02/.test(r.title) || /returning students from H0[23]/.test(r.title))).toBe(true);
  });

  it("opening the simulator from another Hub discards an old result for a different Hub", () => {
    run("A demand surge", ["H05"], [{ name: "extraDemandPct", value: 100 }]);
    ctl.simulation.startSimulation("H03");
    expect(ctl.simulation.state().scenario).toBeNull();
  });
});

describe("UC-13/14 charging scenarios C and D (feedback D, 8)", () => {
  const blocksIn = (hubId: string, pts: string[], w: { start: number; end: number }) =>
    ctl.charging.openSchedule(hubId, 4).blocks.filter((b: ScheduleBlock) => pts.includes(b.pointId) && !b.locked && b.start < w.end && b.end > w.start);

  it("C: after Apply, Smart charging shows exactly the plan the simulation showed", () => {
    const pts = ["CP-H02-01", "CP-H02-06"];
    ctl.simulation.startSimulation("H02");
    ctl.simulation.defineScenario("C charging-point failure", ["H02"], period(), [{ name: "failedPoints", value: pts }]);
    const s = ctl.simulation.run();
    const c = s.charging[0];
    const rec = s.recommendations.find((r) => r.kind === "charging plan")!;
    ctl.simulation.apply([rec.id]);
    const res = ctl.simulation.confirm(ctl.redistribution, ctl.charging);
    expect(res.result![0].outcome).toBe("Applied");
    const live = ctl.charging.openSchedule("H02", 4);
    expect(live.keepFree.some((k) => k.points.join() === pts.join())).toBe(true);
    expect(blocksIn("H02", pts, period())).toHaveLength(0);
    // Every session the simulation moved is where the simulation said it would be.
    for (const m of c.moves.filter((x) => x.to)) {
      const b = live.blocks.find((x: ScheduleBlock) => x.sessionId === m.sessionId)!;
      expect([b.pointId, b.start]).toEqual([m.to!.pointId, m.to!.start]);
    }
    // A later schedule still honours the window.
    ctl.charging.commitSchedule(ctl.charging.generateSchedule("H02", 4));
    expect(blocksIn("H02", pts, period())).toHaveLength(0);
  });

  it("D: the surge scenario keeps points free, serves at least as many surge requests, and applies", () => {
    ctl.simulation.startSimulation("H02");
    try { ctl.simulation.defineScenario("D charging demand surge", ["H02"], period(), [{ name: "extraChargingRequests", value: 0 }]); expect.fail(); }
    catch (e) { expect((e as { code: string }).code).toBe("E2:extraChargingRequests"); }
    ctl.simulation.defineScenario("D charging demand surge", ["H02"], period(), [{ name: "extraChargingRequests", value: 8 }]);
    const s = ctl.simulation.run();
    const c = s.charging[0];
    expect(c.surge!.servedAfter).toBeGreaterThanOrEqual(c.surge!.servedBefore);
    expect(c.points.length).toBeGreaterThan(0);
    // Sessions already charging on a kept point finish; they are not listed as stopping.
    expect(c.moves.some((m) => m.outcome === "stops early")).toBe(false);
    const rec = s.recommendations.find((r) => r.kind === "charging plan")!;
    ctl.simulation.apply([rec.id]);
    expect(ctl.simulation.confirm(ctl.redistribution, ctl.charging).result![0].outcome).toBe("Applied");
    expect(blocksIn("H02", c.points, period())).toHaveLength(0);
  });
});

describe("UC-11 power limit (feedback E)", () => {
  type Ctl = { checkConstraints(p: ScheduleProposal, b: ScheduleBlock, pointId: string, start: number): string | null };
  it("the load per slot is the sum of the rated kW of the sessions in it", () => {
    const p = ctl.charging.generateSchedule("H02", 4);
    for (const slot of p.kpis.load) {
      expect(slot.proposed).toBe(slot.parts.reduce((a, x) => a + x.kw, 0));
      for (const part of slot.parts) expect(part.kw).toBe(db.points.get(part.pointId)!.kw);
    }
    expect(ctl.charging.installedKw("H02")).toBe(72);
  });

  it("a rejected move names the slot, what is already planned, the moved point and the limit", () => {
    const p = ctl.charging.generateSchedule("H02", 4);
    const limit = Math.round(0.76 * ctl.charging.installedKw("H02"));
    const step = config().value("SCHEDULE_TIMESLOT");
    let found: string | null = null;
    for (const b of p.blocks.filter((x) => !x.locked && x.pointId !== "CP-H02-06")) {
      for (let t = p.horizon.start; t < p.horizon.end && !found; t += step) {
        const v = (ctl.charging as unknown as Ctl).checkConstraints(p, b, "CP-H02-06", t);
        if (v && /would draw/.test(v)) found = v;
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const m = found!.match(/would draw (\d+) kW: (\d+) kW already planned .* \+ (\d+) kW for CP-H02-06\. The limit is (\d+) kW/)!;
    const [total, already, kw, lim] = m.slice(1).map(Number);
    expect(total).toBe(already + kw);
    expect(kw).toBe(22);
    expect(lim).toBe(limit);
    expect(total).toBeGreaterThan(lim);
  });
});
