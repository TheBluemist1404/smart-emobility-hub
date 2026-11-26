// Phase 5 — UC-13 what-if simulation and UC-14 apply recommendations.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, now, min, db, ctl } from "./helpers";
import { HOUR } from "../src/platform/clock/DemoClock";

beforeEach(fresh);

const period = () => ({ start: now() + min(30), end: now() + min(30) + 2 * HOUR });
function snapshotLive() {
  return JSON.stringify({ v: [...db.vehicles.values()].map((v) => [v.id, v.status, v.hubId]), d: [...db.docks.values()].map((d) => [d.id, d.status]), o: db.orders.size });
}
// H05 (46 %) has room below the 70 % ceiling, so a shortage there can be covered by transfers.
function runA(pct = 200, hub = "H05") {
  ctl.simulation.startSimulation(hub);
  ctl.simulation.defineScenario("A demand surge", [hub], period(), [{ name: "extraDemandPct", value: pct }]);
  return ctl.simulation.run();
}

describe("UC-13 what-if simulation", () => {
  it("TC-UC13-01 scenario A: measures and recommendations, live state untouched", () => {
    const before = snapshotLive();
    const s = runA();
    expect(s.measures[0].hubId).toBe("H05");
    expect(s.measures[0].shortage).toBeGreaterThan(0);
    expect(s.recommendations.some((r) => r.kind === "transfer")).toBe(true);
    expect(s.recommendations.filter((r) => r.kind === "alternative Hub").every((r) => !r.actionable)).toBe(true);
    expect(s.totals!.demandMetAfter).toBeGreaterThanOrEqual(s.totals!.demandMet);
    expect(snapshotLive()).toBe(before);
  });

  it("TC-UC13-10 a Disconnected Hub cannot be simulated", () => {
    expect(() => ctl.simulation.startSimulation("H06")).toThrow(/E1/);
  });

  it("TC-UC13-11 out-of-range input is refused with its field", () => {
    ctl.simulation.startSimulation();
    try { ctl.simulation.defineScenario("A demand surge", ["H02"], period(), [{ name: "extraDemandPct", value: 500 }]); expect.fail(); }
    catch (e) { expect((e as { code: string }).code).toBe("E2:extraDemandPct"); }
  });

  it("TC-UC13-03 scenario C proposes a charging plan without the failed points", () => {
    ctl.simulation.startSimulation("H01");
    const pts = [...db.points.values()].filter((p) => p.hubId === "H01").slice(0, 3).map((p) => p.id);
    ctl.simulation.defineScenario("C charging-point failure", ["H01"], period(), [{ name: "failedPoints", value: pts }]);
    const s = ctl.simulation.run();
    const plan = s.recommendations.find((r) => r.kind === "charging plan")!;
    expect(plan.params.points).toEqual(pts);
    expect(plan.params.window).toEqual(period());
    // Every session the normal plan had on a failed point in the window is listed with where it goes.
    const c = s.charging[0];
    expect(s.measures[0].sessionsToMove).toBe(c.moves.filter((m) => m.from && pts.includes(m.from.pointId) && m.from.start < period().end && m.from.end > period().start).length);
    for (const m of c.moves.filter((x) => x.to)) expect(pts.includes(m.to!.pointId) && m.to!.start < period().end && m.to!.end > period().start).toBe(false);
  });

  it("TC-UC13-09 discard releases the result; nothing was applied", () => {
    const n = db.orders.size;
    runA();
    ctl.simulation.discard();
    expect(ctl.simulation.state().scenario).toBeNull();
    expect(db.orders.size).toBe(n);
  });
});

describe("UC-14 apply recommendations", () => {
  it("TC-UC14-01 confirm creates an Assigned order through UC-10", () => {
    const s = runA();
    const t = s.recommendations.find((r) => r.kind === "transfer")!;
    const rv = ctl.simulation.apply([t.id]);
    expect(rv.review![0].check).toBe("Still valid");
    const res = ctl.simulation.confirm(ctl.redistribution, ctl.charging);
    const out = res.result![0];
    expect(out.outcome).toBe("Applied");
    const o = db.orders.get(out.reference!)!;
    expect(o.status).toBe("Assigned");
    expect(o.toHub).toBe("H05");
  });

  it("TC-UC14-06 cancel goes back to the result and applies nothing", () => {
    const s = runA();
    const n = db.orders.size;
    ctl.simulation.apply([s.recommendations[0].id]);
    ctl.simulation.cancel();
    expect(ctl.simulation.state().review).toBeNull();
    expect(db.orders.size).toBe(n);
  });

  it("TC-UC14-04 a recommendation the live state no longer supports is recorded Not Applied", () => {
    const s = runA();
    const t = s.recommendations.find((r) => r.kind === "transfer")!;
    // Live state drifts: every eligible vehicle at the source leaves.
    for (const v of db.vehicles.values()) if (v.hubId === t.params.fromHub) v.hubId = "H06";
    const rv = ctl.simulation.apply([t.id]);
    expect(rv.review![0].check).toBe("No longer applicable");
    const res = ctl.simulation.confirm(ctl.redistribution, ctl.charging);
    expect(res.result![0].outcome).toBe("Not Applied");
  });
});
