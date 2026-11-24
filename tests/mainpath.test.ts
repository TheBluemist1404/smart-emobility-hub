// Phase 2 — the student main path UC-01 → UC-02 → UC-03 → UC-07 → UC-08 and its main error branches.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, advance, sec, min, db, ctl, KHOA } from "./helpers";
import { bank } from "../src/gateway/bank/BankGateway";
import { dataSource } from "../src/gateway/iot/SimulatedDataSource";
import type { VehicleReservation } from "../src/domain/allocation/VehicleReservation";
import type { Trip } from "../src/domain/allocation/Trip";

beforeEach(fresh);
const AT_H01 = { hubId: "H01", insideGeofence: true };

function reserve(vehicleId = "EB-0217"): VehicleReservation {
  ctl.reservation.requestReservation(vehicleId, KHOA);
  const vr = ctl.reservation.confirmReservation(vehicleId, KHOA);
  advance(sec(5)); // the bank answers after 4 s
  return vr;
}

describe("UC-01 search", () => {
  it("lists every Hub; a silent Hub is marked stale and its vehicles cannot be reserved (E1)", () => {
    const r = ctl.search.search({ text: "", type: "any", minSoc: 0, nearMe: false });
    expect(r.hubs.length).toBe(7);
    expect(r.hubs.find((h) => h.hubId === "H06")!.stale).toBe(true);
    const h06 = ctl.search.hubDetail("H06");
    expect(h06.vehicles.every((v) => !v.reservable)).toBe(true);
  });
  it("returns an empty list, not an error, when nothing matches (4a)", () => {
    expect(ctl.search.search({ text: "zzz" }).empty).toBe(true);
  });
});

describe("UC-02 + UC-03 reserve and pay", () => {
  it("holds, charges and confirms; the vehicle becomes Reserved with a 15 min pickup window", () => {
    ctl.reservation.requestReservation("EB-0217", KHOA);
    const vr = ctl.reservation.confirmReservation("EB-0217", KHOA);
    expect(vr.status).toBe("Pending Payment");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Held");
    advance(sec(5));
    expect(vr.status).toBe("Confirmed");
    expect(vr.transactionRef).toMatch(/^TX-/);
    expect(db.vehicles.get("EB-0217")!.status).toBe("Reserved");
    expect(vr.expiresAt! - db.payments.get(vr.paymentId!)!.settledAt!).toBe(min(15));
  });
  it("rejects a second active reservation (E1)", () => {
    reserve();
    expect(() => ctl.reservation.requestReservation("EB-0221", KHOA)).toThrow(/already have an active/);
  });
  it("bank declines → Payment Failed, hold released, nothing charged (UC-03 E1)", () => {
    bank().nextMode = "Failed";
    const vr = reserve();
    expect(vr.status).toBe("Payment Failed");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Available");
  });
  it("no bank answer within PAYMENT_HOLD_VEHICLE → Payment Failed; a late Success is refunded (E2, BR-PAY-03)", () => {
    bank().nextMode = "Manual";
    ctl.reservation.requestReservation("EB-0217", KHOA);
    const vr = ctl.reservation.confirmReservation("EB-0217", KHOA);
    advance(sec(61));
    expect(vr.status).toBe("Payment Failed");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Available");
    bank().respond(bank().listOutstanding()[0].requestId, "Success");
    advance(sec(5));
    const refund = ctl.payment.latestFor(vr.id, "Refund");
    expect(refund?.result).toBe("Success");
  });
  it("a confirmed reservation not picked up expires after 15 min; the fee is kept (NIFR-03, BR-PAY-01)", () => {
    const vr = reserve();
    advance(min(15) + sec(1));
    expect(vr.status).toBe("Expired");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Available");
    expect(ctl.payment.latestFor(vr.id, "Refund")).toBeNull();
  });
});

describe("UC-07 pick up", () => {
  it("unlocks, starts the trip, marks the reservation Fulfilled", () => {
    const vr = reserve();
    ctl.rental.requestPickup(KHOA, null, AT_H01);
    expect(vr.status).toBe("Pickup In Progress");
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(4));
    expect(vr.status).toBe("Fulfilled");
    const v = db.vehicles.get("EB-0217")!;
    expect(v.status).toBe("In Use");
    expect(db.students.get(KHOA)!.hasOngoingTrip()?.vehicleId).toBe("EB-0217");
  });
  it("outside the Hub area → rejected, nothing changes (E1)", () => {
    const vr = reserve();
    expect(() => ctl.rental.requestPickup(KHOA, null, { hubId: "H01", insideGeofence: false })).toThrow(/E1/);
    expect(vr.status).toBe("Confirmed");
  });
  it("unlock failure → incident on the dock, reservation moved to a same-type vehicle (E3, BR-RES-02)", () => {
    const vr = reserve();
    dataSource().nextUnlockMode = "Failure";
    ctl.rental.requestPickup(KHOA, null, AT_H01);
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(4));
    expect(vr.status).toBe("Confirmed");
    expect(vr.vehicleId).toBe("EB-0221");
    expect(db.vehicles.get("EB-0217")!.status).toBe("Under Maintenance");
    const p = ctl.rental.pickupFor(KHOA)!;
    expect(p.state).toBe("failed");
    expect(db.incidents.get(p.incidentId!)!.source).toBe("system");
  });
  it("no unlock answer within DOCK_UNLOCK_TIMEOUT → E3 too", () => {
    reserve();
    dataSource().nextUnlockMode = "Timeout";
    ctl.rental.requestPickup(KHOA, null, AT_H01);
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(16));
    expect(ctl.rental.pickupFor(KHOA)!.state).toBe("failed");
  });
  it("inspection not confirmed within INSPECTION_TIMEOUT → back to Confirmed (4b)", () => {
    const vr = reserve();
    ctl.rental.requestPickup(KHOA, null, AT_H01);
    advance(min(3) + sec(1));
    expect(vr.status).toBe("Confirmed");
    expect(ctl.rental.pickupFor(KHOA)).toBeNull();
  });
  it("walk-up rental without reservation (4a)", () => {
    ctl.rental.requestPickup(KHOA, "EM-0038", AT_H01);
    expect(db.vehicles.get("EM-0038")!.status).toBe("Held");
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(4));
    expect(db.vehicles.get("EM-0038")!.status).toBe("In Use");
  });
});

describe("UC-08 return and pay", () => {
  function ride(minutes: number): Trip {
    reserve();
    ctl.rental.requestPickup(KHOA, null, AT_H01);
    ctl.rental.unlockAndStartTrip(KHOA);
    advance(sec(4));
    const t = db.students.get(KHOA)!.hasOngoingTrip()!;
    advance(min(minutes) - sec(30));
    return t;
  }
  it("the latch closes the trip and the fare is charged: 36 min e-bike = 5,600 VND", () => {
    const t = ride(36);
    const dock = [...db.docks.values()].find((d) => d.hubId === "H05" && d.status === "Vacant")!;
    dataSource().latch(dock.id, "EB-0217");
    expect(t.status).toBe("Closed");
    expect(t.fare).toBe(5600);
    expect(t.fareStatus).toBe("Unpaid");
    advance(sec(5));
    expect(t.fareStatus).toBe("Paid");
    const v = db.vehicles.get("EB-0217")!;
    expect(v.hubId).toBe("H05");
    expect(dock.status).toBe("Occupied");
  });
  it("fare declined → Unpaid and the student is blocked until paid (E2, BR-PAY-04)", () => {
    const t = ride(10);
    bank().nextMode = "Failed";
    const dock = [...db.docks.values()].find((d) => d.hubId === "H01" && d.status === "Vacant")!;
    dataSource().latch(dock.id, "EB-0217");
    advance(sec(5));
    expect(t.fareStatus).toBe("Unpaid");
    expect(() => ctl.reservation.requestReservation("EB-0221", KHOA)).toThrow(/BR-PAY-04/);
    ctl.rental.payFare(KHOA);
    advance(sec(5));
    expect(t.fareStatus).toBe("Paid");
    expect(db.students.get(KHOA)!.isBlocked()).toBe(false);
  });
  it("End Trip before the latch reports → the trip stays open (E3)", () => {
    const t = ride(5);
    expect(ctl.rental.endTrip(KHOA).status).toBe("Open");
    expect(t.status).toBe("Open");
  });
  it("a full Hub lists nearby Hubs with vacant docks (1a)", () => {
    for (const d of db.docks.values()) if (d.hubId === "H02" && d.status === "Vacant") { d.latched = true; d.reevaluate(); }
    const r = ctl.rental.getVacantDocks("H02");
    expect(r.vacant).toHaveLength(0);
    expect(r.nearby.length).toBeGreaterThan(0);
  });
});
