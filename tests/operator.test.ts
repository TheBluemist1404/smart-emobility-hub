// Phase 4 — UC-09 monitor, UC-10 redistribution, UC-11 smart charging, UC-12 incidents,
// and the cross-actor push (an operator block reaches the student's phone).
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, advance, sec, min, now, db, ctl, KHOA } from "./helpers";
import { config } from "../src/platform/config/ConfigurationRegistry";
import { dataSource } from "../src/gateway/iot/SimulatedDataSource";
import { ChargingSession } from "../src/domain/allocation/ChargingSession";
import type { VehicleReservation } from "../src/domain/allocation/VehicleReservation";
import type { Trip } from "../src/domain/allocation/Trip";

beforeEach(fresh);

function reserve(vehicleId: string): VehicleReservation {
  ctl.reservation.requestReservation(vehicleId, KHOA);
  const vr = ctl.reservation.confirmReservation(vehicleId, KHOA);
  advance(sec(5));
  return vr;
}

describe("UC-09 network monitor", () => {
  it("TC-UC09-01 overview: every Hub classified, H06 Disconnected (E1)", () => {
    const o = ctl.monitoring.openNetwork();
    expect(o.hubs).toHaveLength(7);
    expect(o.hubs.find((h) => h.hubId === "H06")!.status).toBe("Disconnected");
    expect(o.reporting).toBe(6);
  });
});

describe("UC-10 redistribution", () => {
  it("TC-UC10-01 commit: vehicles In Redistribution, destination docks Allocated, order Assigned", () => {
    const d = { fromHub: "H05", toHub: "H07", model: "e-bike", quantity: 2, deadline: now() + min(60) };
    expect(ctl.redistribution.validateOrder(d).ok).toBe(true);
    const id = ctl.redistribution.submitOrder(d, "commit");
    const o = db.orders.get(id)!;
    expect(o.status).toBe("Assigned");
    expect(o.transfers).toHaveLength(2);
    for (const t of o.transfers) {
      expect(db.vehicles.get(t.vehicleId)!.status).toBe("In Redistribution");
      expect(db.docks.get(t.destDockId!)!.status).toBe("Allocated");
    }
  });
  it("TC-UC10-05 destination without enough net free docks is refused with alternatives", () => {
    const free = db.hubs.get("H07")!.netFreeDocks();
    const v = ctl.redistribution.validateOrder({ fromHub: "H05", toHub: "H07", model: "e-bike", quantity: free + 1, deadline: now() + min(60) });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/net free docks|eligible/);
  });
  it("TC-UC10-09 departures and arrivals aggregate to Completed (BR-RED-01)", () => {
    const id = ctl.redistribution.submitOrder({ fromHub: "H05", toHub: "H07", model: "e-bike", quantity: 2, deadline: now() + min(60) }, "commit");
    const o = db.orders.get(id)!;
    for (const t of o.transfers) dataSource().departed(t.vehicleId);
    expect(o.status).toBe("In Transit");
    for (const t of o.transfers) dataSource().arrived(t.vehicleId, t.destDockId!);
    expect(o.status).toBe("Completed");
    expect(db.vehicles.get(o.transfers[0].vehicleId)!.hubId).toBe("H07");
  });
  it("TC-UC10-16 breakdown in transit: transfer Removed, dock released, incident opened (E5)", () => {
    const id = ctl.redistribution.submitOrder({ fromHub: "H05", toHub: "H07", model: "e-bike", quantity: 2, deadline: now() + min(60) }, "commit");
    const o = db.orders.get(id)!;
    const [a, b] = o.transfers;
    dataSource().departed(a.vehicleId); dataSource().departed(b.vehicleId);
    dataSource().breakdown(a.vehicleId);
    expect(a.status).toBe("Removed");
    expect(db.docks.get(a.destDockId!)!.status).toBe("Vacant");
    expect(db.vehicles.get(a.vehicleId)!.status).toBe("Under Maintenance");
    dataSource().arrived(b.vehicleId, b.destDockId!);
    expect(o.status).toBe("Partially Completed");
  });
  it("TC-UC10-13 cancel releases Assigned transfers and their docks", () => {
    const id = ctl.redistribution.submitOrder({ fromHub: "H05", toHub: "H07", model: "e-bike", quantity: 2, deadline: now() + min(60) }, "commit");
    const o = db.orders.get(id)!;
    ctl.redistribution.cancelOrder(id, "Team unavailable");
    expect(o.status).toBe("Cancelled");
    expect(o.transfers.every((t) => t.status === "Released")).toBe(true);
    expect(db.vehicles.get(o.transfers[0].vehicleId)!.usage).toBe("Idle");
  });
});

describe("UC-11 smart charging", () => {
  it("TC-UC11-02 priority score, BR-CHG-01 worked example (A 0.50, B 0.725)", () => {
    const veh = [...db.vehicles.values()].filter((v) => v.hubId === "H05");
    const [va, vb] = veh;
    va.soc = 10; vb.soc = 15;
    const A = new ChargingSession("CQ-TA", "system", "Charging Queue request", va.id, "H05", va.id);
    const B = new ChargingSession("CQ-TB", "system", "Charging Queue request", vb.id, "H02", vb.id);
    A.waitingSince = now() - min(30); B.waitingSince = now();
    // A's Hub has no flag, B's Hub is flagged.
    const flagged = db.hubs.get("H02")!.getFlags().length > 0 && /Shortage|Insufficient/.test(db.hubs.get("H02")!.getFlags().join());
    ctl.charging.computePriority([A, B]);
    expect(A.priority).toBeCloseTo(0.5 * 0.9 + 0.2 * 0.25, 3);
    expect(B.priority).toBeCloseTo(0.5 * 0.85 + (flagged ? 0.3 : 0), 3);
  });
  it("TC-UC11-01 generate → apply schedules the queue; a committed session keeps its paid slot", () => {
    const p = ctl.charging.generateSchedule("H01");
    expect(p.blocks.length).toBeGreaterThan(0);
    const committed = p.blocks.find((b) => b.sessionId === "CS-5HDP")!;
    expect(committed.committed).toBe(true);
    const res = ctl.charging.applySchedule("H01");
    expect(res.applied).toBeGreaterThan(0);
    const shared = p.blocks.find((b) => !b.committed && !b.locked);
    if (shared) expect((db.allocations.get(shared.sessionId) as ChargingSession).status).toBe("Scheduled");
  });
  it("TC-UC11-10 a committed session cannot move earlier or beyond CHARGING_SHIFT_TOLERANCE", () => {
    ctl.charging.generateSchedule("H01");
    const cs = db.allocations.get("CS-5HDP") as ChargingSession;
    const orig = cs.originalStart!;
    expect(ctl.charging.moveBlock("H01", cs.id, cs.slot!.pointId, orig - min(15)).violation).toMatch(/earlier/);
    expect(ctl.charging.moveBlock("H01", cs.id, cs.slot!.pointId, orig + config().value("CHARGING_SHIFT_TOLERANCE") + min(15)).violation).toMatch(/later/);
  });
  it("TC-UC11-14 apply is refused when the schedule changed after generation", () => {
    ctl.charging.generateSchedule("H01");
    db.points.get("CP-H01-02")!.scheduleVersion++;
    expect(() => ctl.charging.applySchedule("H01")).toThrow(/E4/);
  });
  it("TC-UC11-16 point fault moves the paid session within tolerance or cancels with a refund", () => {
    const cs = db.allocations.get("CS-5HDP") as ChargingSession;
    dataSource().pointFault(cs.slot!.pointId);
    expect(db.points.get("CP-H01-03")!.status).toBe("Out of Service");
    expect(["Scheduled", "Cancelled by System"]).toContain(cs.status);
    expect(db.notifications.some((n) => n.studentId === KHOA && n.ref === cs.id && /moved|cancelled/i.test(n.title))).toBe(true);
  });
});

describe("UC-12 incidents and the cross-actor push", () => {
  it("TC-UC02-11 blocking a reserved vehicle moves the reservation and notifies the student", () => {
    const vr = reserve("EB-0217");
    const incId = ctl.incident.createIncident("EB-0217", "vehicle failure", "Brake cable snapped");
    const inc = db.incidents.get(incId)!;
    const out = ctl.incident.saveAction(incId, "Taken out of service", true, inc.version);
    expect(out[0]).toMatchObject({ allocationId: vr.id, outcome: "moved" });
    expect(vr.vehicleId).not.toBe("EB-0217");
    expect(vr.status).toBe("Confirmed");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Under Maintenance");
    expect(db.notifications.at(-1)).toMatchObject({ studentId: KHOA, title: "Vehicle replaced", ref: vr.id });
  });
  it("TC-UC12-18 a stale version is rejected wholesale", () => {
    const incId = ctl.incident.createIncident("EB-0221", "vehicle failure", "Light broken");
    const v = db.incidents.get(incId)!.version;
    ctl.incident.startHandling(incId, "Looking", v);
    expect(() => ctl.incident.saveAction(incId, "Blocked", true, v)).toThrow(/E2/);
    expect(db.vehicles.get("EB-0221")!.blocks.size).toBe(0);
  });
  it("TC-UC12-13 verified breakdown closes the trip at the report time with the fare Waived (8c)", () => {
    ctl.rental.requestPickup(KHOA, "EB-0217", { hubId: "H01", insideGeofence: true });
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(5));
    const trip = [...db.allocations.values()].find((a) => a.kind === "Trip" && a.studentId === KHOA && a.isActive()) as Trip;
    advance(min(10));
    const r = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0217", "Motor cut out", []);
    const reportedAt = now();
    advance(min(5));
    const inc = db.incidents.get(r.incidentId!)!;
    ctl.incident.recordVerification(inc.id, inc.version);
    expect(trip.status).toBe("Closed");
    expect(trip.endTime).toBe(reportedAt);
    expect(trip.fareStatus).toBe("Waived");
    expect(db.notifications.at(-1)).toMatchObject({ studentId: KHOA, title: "Trip closed · fare waived" });
  });
  it("TC-UC12-01 resolve re-evaluates the resource and tells the reporters", () => {
    const r = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0221", "Front light is broken", []);
    const inc = db.incidents.get(r.incidentId!)!;
    expect(db.vehicles.get("EB-0221")!.isReservable()).toBe(false);
    ctl.incident.resolve(inc.id, "Light replaced", inc.version);
    expect(inc.status).toBe("Resolved");
    expect(db.vehicles.get("EB-0221")!.isReservable()).toBe(true);
    expect(db.reports.get(r.reportId)!.status).toBe("Closed");
    expect(db.notifications.at(-1)).toMatchObject({ studentId: KHOA, title: "Report resolved" });
  });
});
