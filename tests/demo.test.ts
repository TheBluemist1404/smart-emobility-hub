// Demo-tool fixes after the public-URL test (2026-11-25): docking from the student's return
// screen, the shared-simulator warning and "Back to normal", and the operator-closed trip.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, advance, sec, min, db, ctl, KHOA } from "./helpers";
import { bank } from "../src/gateway/bank/BankGateway";
import { dataSource } from "../src/gateway/iot/SimulatedDataSource";
import { backToNormal, demoLatch } from "../src/api/demoActions";
import { tripView } from "../src/api/studentRoutes";
import { simulatorWarnings } from "../src/ui/shared/simStatus";
import { summaryToShow } from "../src/ui/student/tripSummary";
import { UserError } from "../src/api/errors";
import type { Trip } from "../src/domain/allocation/Trip";

beforeEach(fresh);

function startTrip(vehicleId = "EB-0217"): Trip {
  ctl.rental.requestPickup(KHOA, vehicleId, { hubId: "H01", insideGeofence: true });
  ctl.rental.unlockAndStartTrip(KHOA);
  advance(sec(5));
  return [...db.allocations.values()].find((a) => a.kind === "Trip" && a.studentId === KHOA && a.isActive()) as Trip;
}
const vacantAt = (hubId: string) => [...db.docks.values()].find((d) => d.hubId === hubId && d.status === "Vacant")!;

describe("DEMO-01 dock from the student's return screen", () => {
  it("DEMO-01a tapping a vacant dock latches it; the trip closes on the latch report and the fare is paid", () => {
    const t = startTrip();
    advance(min(12));
    const dock = vacantAt("H02");
    demoLatch(dock.id, "EB-0217", true);
    expect(t.status).toBe("Closed");
    expect(t.endDock).toBe(dock.label);
    expect(t.fareStatus).toBe("Unpaid");
    advance(sec(5));
    expect(t.fareStatus).toBe("Paid");
    expect(dock.status).toBe("Occupied");
  });
  it("DEMO-01b 'Not engaged' keeps the trip open and tells the student (E3)", () => {
    const t = startTrip();
    const dock = vacantAt("H01");
    demoLatch(dock.id, "EB-0217", false);
    expect(t.status).toBe("Open");
    expect(dock.status).toBe("Vacant");
    expect(db.notifications.at(-1)).toMatchObject({ studentId: KHOA, title: "Latch not engaged" });
    expect(ctl.rental.endTrip(KHOA).status).toBe("Open");
  });
  it("DEMO-01c an occupied dock, an unknown dock or a vehicle with no open trip is refused", () => {
    startTrip();
    const occupied = [...db.docks.values()].find((d) => d.hubId === "H01" && d.status === "Occupied")!;
    expect(() => demoLatch(occupied.id, "EB-0217", true)).toThrow(UserError);
    expect(() => demoLatch("NOPE", "EB-0217", true)).toThrow(/Unknown dock/);
    expect(() => demoLatch(vacantAt("H01").id, "EB-0221", true)).toThrow(/not on an open trip/);
  });
  it("DEMO-01d a failed fare after docking leaves it Unpaid, blocks the student, and Pay now clears it", () => {
    const t = startTrip();
    bank().nextMode = "Failed";
    demoLatch(vacantAt("H01").id, "EB-0217", true);
    advance(sec(5));
    expect(t.fareStatus).toBe("Unpaid");
    expect(db.students.get(KHOA)!.unpaidTrip()?.id).toBe(t.id);
    ctl.rental.payFare(KHOA);
    advance(sec(5));
    expect(t.fareStatus).toBe("Paid");
    expect(db.students.get(KHOA)!.unpaidTrip()).toBeFalsy();
  });
});

describe("DEMO-02 shared simulators", () => {
  it("DEMO-02a warns for every simulator that is not at Success, and for nothing when all are normal", () => {
    expect(simulatorWarnings({ bank: { mode: "Success", nextMode: null }, unlock: { mode: "Success", nextMode: null } })).toEqual([]);
    const w = simulatorWarnings({ bank: { mode: "Failed", nextMode: "Timeout" }, unlock: { mode: "Failure", nextMode: null } });
    expect(w).toHaveLength(3);
    expect(simulatorWarnings({ bank: { mode: "Manual", nextMode: null }, unlock: { mode: "Success", nextMode: "Timeout" } })).toHaveLength(2);
  });
  it("DEMO-02b Back to normal sets the bank and the dock unlock to Success, now and next", () => {
    bank().mode = "Failed"; bank().nextMode = "Timeout";
    dataSource().unlockMode = "Timeout"; dataSource().nextUnlockMode = "Failure";
    backToNormal();
    expect([bank().mode, bank().nextMode, dataSource().unlockMode, dataSource().nextUnlockMode]).toEqual(["Success", null, "Success", null]);
  });
});

describe("DEMO-03 a trip closed by an operator is shown to the student", () => {
  it("DEMO-03a the closed trip names the incident, and the Trip tab keeps showing it until dismissed", () => {
    const t = startTrip();
    advance(min(10));
    const r = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0217", "Motor cut out", []);
    advance(min(45)); // longer than the 30 min a normal receipt stays
    const inc = db.incidents.get(r.incidentId!)!;
    ctl.incident.recordVerification(inc.id, inc.version);
    const v = tripView(t);
    expect(v.closedByIncident).toBe(inc.id);
    expect(v.fareStatus).toBe("Waived");
    const now = Date.now();
    expect(summaryToShow({ ...v, endTime: now - min(60) }, now, new Set())?.id).toBe(t.id);
    expect(summaryToShow({ ...v, endTime: now - min(60) }, now, new Set([t.id]))).toBeNull();
  });
  it("DEMO-03b a paid receipt hides after 30 min or when a new pickup waits; an unpaid fare never hides", () => {
    const now = Date.now();
    const paid = { id: "TR-1", endTime: now - min(31), fareStatus: "Paid", closedByIncident: null };
    expect(summaryToShow(paid, now, new Set())).toBeNull();
    expect(summaryToShow({ ...paid, endTime: now - min(5) }, now, new Set())).not.toBeNull();
    expect(summaryToShow({ ...paid, fareStatus: "Unpaid" }, now, new Set(["TR-1"]))).not.toBeNull();
    // A new reservation waiting for pickup: the Trip tab opens the scan screen, not the old receipt.
    expect(summaryToShow({ ...paid, endTime: now - min(5) }, now, new Set(), true)).toBeNull();
    expect(summaryToShow({ ...paid, fareStatus: "Unpaid" }, now, new Set(), true)).not.toBeNull();
  });
});
