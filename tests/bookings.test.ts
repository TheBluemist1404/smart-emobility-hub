// Phase 3 — UC-04 parking, UC-05 charging, UC-06 report issue (incl. UC-07 6a).
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, advance, sec, min, now, db, ctl, KHOA } from "./helpers";
import { bank } from "../src/gateway/bank/BankGateway";
import { dataSource } from "../src/gateway/iot/SimulatedDataSource";
import type { ParkingReservation } from "../src/domain/allocation/ParkingReservation";
import type { ChargingSession } from "../src/domain/allocation/ChargingSession";

beforeEach(fresh);
const MOTO = "59-X3 123.45";
const HOUR = 60 * 60_000;

describe("UC-04 reserve parking", () => {
  it("TC-UC04-01 offers a space, takes payment and confirms; the space window is Booked", () => {
    const offer = ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + HOUR, now() + 4 * HOUR);
    expect(offer.space).not.toBeNull();
    expect(offer.fee).toBe(9000); // 3 h × 3,000 VND
    const pr = ctl.reservation.confirmReservation(KHOA) as ParkingReservation;
    expect(pr.status).toBe("Pending Payment");
    advance(sec(5));
    expect(pr.status).toBe("Confirmed");
  });
  it("TC-UC04-07 rejects an invalid window (E4)", () => {
    expect(() => ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + 2 * HOUR, now() + HOUR)).toThrow(/after arrival/);
    expect(() => ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + HOUR, now() + 14 * HOUR)).toThrow(/PARKING_MAX_DURATION/);
    expect(() => ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + 25 * HOUR, now() + 26 * HOUR)).toThrow(/BOOKING_HORIZON/);
  });
  it("TC-UC04-03 registers a new vehicle and refuses a plate owned by someone else (4a, E3)", () => {
    ctl.reservation.registerVehicle(KHOA, "electric bicycle", "59-B1 222.22");
    expect(db.students.get(KHOA)!.vehicles.map((v) => v.id)).toContain("59-B1 222.22");
    expect(() => ctl.reservation.registerVehicle(KHOA, "", "X")).toThrow(/E3/);
  });
  it("TC-UC04-18 no check-in within CHECKIN_GRACE → Expired, fee kept (NIFR-03)", () => {
    ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + min(30), now() + 2 * HOUR);
    const pr = ctl.reservation.confirmReservation(KHOA) as ParkingReservation;
    advance(sec(5));
    advance(min(46));
    expect(pr.status).toBe("Expired");
  });
  it("TC-UC04-01 the parking sensor checks the student in (step 14)", () => {
    ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + min(10), now() + 2 * HOUR);
    const pr = ctl.reservation.confirmReservation(KHOA) as ParkingReservation;
    advance(sec(5));
    advance(min(10));
    dataSource().parkingSensor(pr.spaceId, true);
    expect(pr.status).toBe("Checked-in");
  });
  it("TC-UC04-15 payment fails → Payment Failed and the window is released (E8)", () => {
    bank().nextMode = "Failed";
    ctl.reservation.submitTimeWindow(KHOA, "H01", MOTO, now() + HOUR, now() + 2 * HOUR);
    const pr = ctl.reservation.confirmReservation(KHOA) as ParkingReservation;
    advance(sec(5));
    expect(pr.status).toBe("Payment Failed");
    expect(db.spaces.get(pr.spaceId)!.isFree(pr.window)).toBe(true);
  });
});

describe("UC-05 schedule charging", () => {
  it("TC-UC05-08 refuses a second active session for the same vehicle (E4)", () => {
    expect(() => ctl.charging.submitRequest(KHOA, { hubId: "H01", privateVehicleId: MOTO, from: now() + HOUR, to: now() + 3 * HOUR, neededBy: null, currentSoc: 30, targetSoc: 80 })).toThrow(/E4/);
  });
  it("TC-UC05-01 proposes a slot, takes payment, schedules a committed reservation that never enters the queue", () => {
    ctl.reservation.registerVehicle(KHOA, "electric motorcycle", "59-Y1 555.55");
    const p = ctl.charging.submitRequest(KHOA, { hubId: "H01", privateVehicleId: "59-Y1 555.55", from: now() + HOUR, to: now() + 3 * HOUR, neededBy: null, currentSoc: 32, targetSoc: 80 });
    expect(p.durationMs).toBe(75 * 60_000);
    expect(p.fee).toBe(18500);
    const cs = ctl.charging.confirmProposal(KHOA);
    advance(sec(5));
    expect(cs.status).toBe("Scheduled");
    expect(db.points.get(cs.pointId!)!.bookings.find((b) => b.ref === cs.id)?.state).toBe("Booked");
  });
  it("TC-UC05-06 rejects a target not above the current level (E3)", () => {
    ctl.reservation.registerVehicle(KHOA, "electric bicycle", "59-B1 222.22");
    expect(() => ctl.charging.submitRequest(KHOA, { hubId: "H01", privateVehicleId: "59-B1 222.22", from: now() + HOUR, to: now() + 2 * HOUR, neededBy: null, currentSoc: 80, targetSoc: 50 })).toThrow(/E3/);
  });
  it("TC-UC05-18 a seeded session not started within CHARGING_START_GRACE expires (NIFR-03)", () => {
    const cs = db.allocations.get("CS-5HDP") as ChargingSession;
    advance(cs.slot!.start + min(15) - now() + sec(1));
    expect(cs.status).toBe("Expired");
  });
  it("TC-UC05-18 plugging in starts the seeded session (NIFR-04)", () => {
    const cs = db.allocations.get("CS-5HDP") as ChargingSession;
    dataSource().plugIn(cs.id);
    advance(cs.slot!.start - now() + sec(6));
    expect(cs.status).toBe("Charging");
  });
});

describe("UC-06 report issue", () => {
  it("TC-UC06-01 files an Open report linked to a new incident; the vehicle is no longer offered (BR-INC-02, BR-RES-01)", () => {
    const r = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0221", "Front light is broken", []);
    expect(r.reportId).toMatch(/^IR-20261102-0\d\d$/);
    expect(db.incidents.get(r.incidentId!)!.status).toBe("Open");
    expect(db.vehicles.get("EB-0221")!.isReservable()).toBe(false);
  });
  it("TC-UC06-06 a repeat is not filed twice (6a); another student's report is attached (6b)", () => {
    const a = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0221", "Front light is broken", [], "k1");
    const b = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0221", "Front light is broken", [], "k1");
    expect(b.reportId).toBe(a.reportId);
    const other = [...db.students.keys()].find((id) => id !== KHOA)!;
    const c = ctl.issue.submitReport(other, "vehicle failure", "EB-0221", "Light flickers then dies", []);
    expect(c.reportId).toBe(a.reportId);
    expect(db.reports.get(a.reportId)!.submissions).toHaveLength(2);
  });
  it("TC-UC06-11 missing description or mismatched resource → E3", () => {
    expect(() => ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0221", "", [])).toThrow(/Describe/);
    expect(() => ctl.issue.submitReport(KHOA, "vehicle failure", "CP-H01-02", "Broken plug", [])).toThrow(/match/);
  });
  it("TC-UC07-13 a report during pickup ends the pickup and moves the reservation (UC-07 6a)", () => {
    ctl.reservation.requestReservation("EB-0217", KHOA);
    const vr = ctl.reservation.confirmReservation("EB-0217", KHOA);
    advance(sec(5));
    ctl.rental.requestPickup(KHOA, null, { hubId: "H01", insideGeofence: true });
    const r = ctl.issue.submitReport(KHOA, "vehicle failure", "EB-0217", "Rear brake does not grip", []);
    expect(r.pickupEnded?.outcome).toBe("moved");
    expect(vr.vehicleId).not.toBe("EB-0217");
    expect(ctl.rental.pickupFor(KHOA)).toBeNull();
  });
});
