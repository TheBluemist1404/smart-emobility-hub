// control.booking — RentalController (control method descriptions 2.4), UC-07 Pick up and
// UC-08 Return. It is a StatusListener: the latch sensor closes the trip (UC-08 step 5).
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock, fmtHM, MINUTE, type Timer } from "../../platform/clock/DemoClock";
import { bus } from "../../platform/events/bus";
import { iot } from "../../gateway/iot/IoTDataGateway";
import type { IoTEvent, StatusListener } from "../../gateway/iot/StatusListener";
import { VehicleReservation } from "../../domain/allocation/VehicleReservation";
import { Trip } from "../../domain/allocation/Trip";
import { Dock } from "../../domain/network/Dock";
import { Incident } from "../../domain/operations/Incident";
import { Action } from "../../domain/operations/Action";
import type { Vehicle } from "../../domain/network/Vehicle";
import type { GeoPoint, Telemetry } from "../../domain/types";
import { MobileApp } from "../../api/push";
import { UserError } from "../../api/errors";
import type { PaymentController } from "../payment/PaymentController";
import type { ReservationController } from "./ReservationController";

export type PickupState = "inspecting" | "unlocking" | "failed";
export interface PickupSession {
  studentId: string; vehicleId: string; dockId: string; reservationId: string | null; walkUp: boolean;
  state: PickupState; startedAt: number; message: string | null; incidentId: string | null; timer: Timer | null;
}

const vnd = (n: number) => `${n.toLocaleString("en-US")} VND`;

export class RentalController implements StatusListener {
  private readonly sessions = new Map<string, PickupSession>();

  constructor(private readonly payment: PaymentController, private readonly reservations: ReservationController) {}

  pickupFor(studentId: string): PickupSession | null { return this.sessions.get(studentId) ?? null; }

  // ==== UC-07 Pick up ================================================================

  /** requestPickup(vehicleId : String, location : GeoPoint) : PickupSummary — UC-07 steps 1-6, 4a, E1, E2. */
  requestPickup(studentId: string, vehicleId: string | null, location: GeoPoint) {
    const s = db.students.get(studentId);
    if (!s) throw new UserError("Unknown student", 404);
    if (s.isBlocked()) throw new UserError(`Pay the outstanding fare of ${s.unpaidTrip()?.id} first (BR-PAY-04).`, 409, "BLOCKED");
    if (s.hasOngoingTrip()) throw new UserError("You already have a trip in progress.", 409, "TRIP");
    if (this.sessions.has(studentId)) return this.summary(this.sessions.get(studentId)!);

    const vr = VehicleReservation.findConfirmed(studentId);
    const id = vr ? vr.vehicleId : vehicleId;
    if (!id) throw new UserError("Choose a vehicle at the Hub.", 422);
    const v = db.vehicles.get(id);
    if (!v) throw new UserError(`Unknown vehicle ${id}`, 404);
    if (vr && vehicleId && vehicleId !== vr.vehicleId) throw new UserError(`Your reservation ${vr.id} is for ${vr.vehicleId}. Pick that one up, or cancel the pickup to rent ${vehicleId} as a walk-up.`, 409, "OTHER");

    const check = v.checkPickup(location);
    if (!check.ok && !check.technical) throw new UserError(`${check.reason} Move to the Hub and try again (E1).`, 409, "E1");
    if (!check.ok) {
      // E2: the vehicle fails a technical condition.
      if (vr) {
        const out = this.reservations.moveOrCancelVehicleReservation(vr, check.reason!);
        throw new UserError(out === "moved" ? `${check.reason} Your reservation now holds ${vr.vehicleId} (BR-RES-02).` : `${check.reason} No same-type vehicle is free, so ${vr.id} was cancelled and refunded.`, 409, "E2");
      }
      throw new UserError(`${check.reason} Choose another vehicle (E2).`, 409, "E2");
    }
    if (!vr && !v.holdIfAvailable(studentId)) throw new UserError(`${id} is not Available for a walk-up rental (4a).`, 409, "UNAVAILABLE");
    if (vr) vr.setStatus("Pickup In Progress");

    const p: PickupSession = { studentId, vehicleId: v.id, dockId: v.dockId!, reservationId: vr?.id ?? null, walkUp: !vr, state: "inspecting", startedAt: clock().now(), message: null, incidentId: null, timer: null };
    p.timer = clock().after(config().value("INSPECTION_TIMEOUT"), `INSPECTION_TIMEOUT ${studentId}`, () => {
      // 4b: no confirmation in time.
      this.endSession(p, "inspection timed out");
      MobileApp.notify(studentId, "Pickup cancelled", `You did not confirm the unlock of ${v.id} within ${config().value("INSPECTION_TIMEOUT") / MINUTE} min. ${vr ? `Reservation ${vr.id} is still valid until ${fmtHM(vr.expiresAt!)}.` : "The vehicle was released."}`, "warn", vr?.id);
    });
    this.sessions.set(studentId, p);
    audit(studentId, "UC-07 pickup started", v.id);
    return this.summary(p);
  }

  summary(p: PickupSession) {
    const v = db.vehicles.get(p.vehicleId)!;
    const d = db.docks.get(p.dockId);
    return {
      ...v.getSummary(), dock: d?.label ?? null, state: p.state, message: p.message, incidentId: p.incidentId, reservationId: p.reservationId, walkUp: p.walkUp,
      unlockFee: config().value("UNLOCK_FEE"), inspectionEndsAt: p.startedAt + config().value("INSPECTION_TIMEOUT"), hubName: db.hubs.get(v.hubId)?.name,
    };
  }

  /** unlockAndStartTrip() : Trip — UC-07 steps 7-11, E2 (re-check), E3 (unlock failed or timed out). */
  unlockAndStartTrip(studentId: string) {
    const p = this.sessions.get(studentId);
    if (!p) throw new UserError("Start the pickup first.", 409);
    if (p.state === "unlocking") return this.summary(p);
    if (p.state === "failed") throw new UserError(p.message ?? "The unlock failed.", 409, "E3");
    const v = db.vehicles.get(p.vehicleId)!;
    if (!v.recheckBlocking()) {
      const vr = p.reservationId ? db.allocations.get(p.reservationId) as VehicleReservation : null;
      this.endSession(p, "blocked before unlock");
      if (vr) this.reservations.moveOrCancelVehicleReservation(vr, "it was blocked just before the unlock");
      throw new UserError(`${v.id} was blocked just before the unlock (E2). ${vr ? "Check your reservation for the replacement." : "Choose another vehicle."}`, 409, "E2");
    }
    p.timer?.cancel();
    p.state = "unlocking";
    const dock = db.docks.get(p.dockId)!;
    dock.requestUnlock();
    let answered = false;
    const timeout = clock().after(config().value("DOCK_UNLOCK_TIMEOUT"), `DOCK_UNLOCK_TIMEOUT ${dock.label}`, () => {
      if (answered) return;
      answered = true;
      this.unlockFailed(p, `Dock ${dock.label} did not confirm the release within ${config().value("DOCK_UNLOCK_TIMEOUT") / 1000} s`);
    });
    iot().requestUnlock(dock.id, v.id, (r) => {
      if (answered) { this.lateUnlock(p, r.at); return; }
      answered = true;
      timeout.cancel();
      if (r.result === "Success") this.startTrip(p, v, dock);
      else this.unlockFailed(p, `Dock ${dock.label} reported a failure${r.reason ? `: ${r.reason}` : ""}`);
    });
    bus.changed("pickup");
    return this.summary(p);
  }

  private startTrip(p: PickupSession, v: Vehicle, dock: Dock): void {
    dock.unlockPending = false;
    dock.latched = false;
    dock.vehicleId = null;
    dock.reevaluate();
    v.dockId = null;
    v.setStatus("In Use");
    v.heldBy = p.studentId;
    const vr = p.reservationId ? db.allocations.get(p.reservationId) as VehicleReservation : null;
    if (vr) { vr.setStatus("Fulfilled"); this.reservations.cancelExpiry(vr.id); }
    const t = new Trip(nextId("TR", "num"), p.studentId, v.id, v.hubId, vr?.id ?? null, v.soc, v.odometerKm, dock.label);
    db.allocations.set(t.id, t);
    this.sessions.delete(p.studentId);
    audit(p.studentId, "UC-07 trip started", t.id, "", v.id);
    bus.changed("trip");
  }

  /** UC-07 E3: open an incident that blocks dock and vehicle, then BR-RES-02 for a reservation. */
  private unlockFailed(p: PickupSession, reason: string): void {
    const dock = db.docks.get(p.dockId)!;
    const v = db.vehicles.get(p.vehicleId)!;
    dock.unlockPending = false;
    const inc = Incident.findOrOpen(dock, "Hub facility problem", `${reason}. Vehicle ${v.id} could not be released.`, "system");
    dock.noteFault(inc.id);
    v.noteFault(inc.id);
    dock.reevaluate();
    const vr = p.reservationId ? db.allocations.get(p.reservationId) as VehicleReservation : null;
    p.state = "failed";
    p.incidentId = inc.id;
    p.timer?.cancel();
    if (vr) {
      const out = this.reservations.moveOrCancelVehicleReservation(vr, "the dock did not release it");
      p.message = `${reason}. ${out === "moved" ? `Your reservation now holds ${vr.vehicleId} — start the pickup again.` : `No same-type vehicle is free; ${vr.id} was cancelled and ${vnd(vr.fee)} will be refunded.`} Incident ${inc.id} was opened.`;
    } else {
      v.releaseHold();
      p.message = `${reason}. Nothing was charged. Choose another vehicle. Incident ${inc.id} was opened.`;
    }
    v.reevaluate();
    audit("system", "UC-07 unlock failed", dock.id, "", inc.id);
    bus.changed("pickup");
  }

  /** E3 step 5: a release confirmation that arrives after the timeout is added to the incident. */
  private lateUnlock(p: PickupSession, at: number): void {
    const inc = p.incidentId ? db.incidents.get(p.incidentId) : null;
    inc?.addAction(new Action(`Late unlock confirmation from dock ${db.docks.get(p.dockId)?.label} at ${fmtHM(at)} — check the vehicle on site.`, "system", at, false, "system"));
    bus.changed("incident");
  }

  /** cancelPickup() : void — UC-07 4b. */
  cancelPickup(studentId: string): void {
    const p = this.sessions.get(studentId);
    if (!p) return;
    if (p.state === "unlocking") throw new UserError("The dock is releasing the vehicle; wait for the result.", 409);
    this.endSession(p, "cancelled by the student");
  }

  /**
   * UC-07 6a: after a UC-06 report on the vehicle being picked up, the pickup ends without an
   * unlock. A walk-up hold is released; a reservation moves to a same-type vehicle (BR-RES-02).
   */
  reportedDuringPickup(studentId: string): { outcome: "released" | "moved" | "cancelled" | "awaiting"; vehicleId: string | null } | null {
    const p = this.sessions.get(studentId);
    if (!p || p.state === "unlocking") return null;
    const vr = p.reservationId ? db.allocations.get(p.reservationId) as VehicleReservation : null;
    this.endSession(p, "issue reported (6a)");
    if (!vr) return { outcome: "released", vehicleId: null };
    const outcome = this.reservations.moveOrCancelVehicleReservation(vr, "you reported a problem with it");
    return { outcome, vehicleId: vr.vehicleId };
  }

  private endSession(p: PickupSession, why: string): void {
    p.timer?.cancel();
    this.sessions.delete(p.studentId);
    if (p.state === "failed") return; // the reservation and vehicle were already handled in E3
    const vr = p.reservationId ? db.allocations.get(p.reservationId) as VehicleReservation : null;
    if (vr) vr.endPickup();
    else db.vehicles.get(p.vehicleId)?.releaseHold();
    audit(p.studentId, `UC-07 pickup ended: ${why}`, p.vehicleId);
    bus.changed("pickup");
  }

  // ==== UC-08 Return =================================================================

  /** getVacantDocks(hub : Hub) : Dock[*] — UC-08 steps 1-2; 1a nearby Hubs when this one is full. */
  getVacantDocks(hubId: string) {
    const hub = db.hubs.get(hubId);
    if (!hub) throw new UserError(`Unknown Hub ${hubId}`, 404);
    const here = Dock.findVacant(hub);
    const nearby = here.length ? [] : [...db.hubs.values()].filter((h) => h.id !== hubId && !h.isStale())
      .map((h) => ({ hubId: h.id, name: h.name, vacant: Dock.findVacant(h).length, distanceKm: Math.round(Math.hypot(h.x - hub.x, h.y - hub.y) / 10) / 10 }))
      .filter((h) => h.vacant > 0).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
    return { hubId, name: hub.name, vacant: here.map((d) => ({ dockId: d.id, label: d.label })), nearby };
  }

  /** endTrip() : TripStatus — UC-08 step 4 when the student taps "End trip": E3 if the latch never reported. */
  endTrip(studentId: string) {
    const t = db.students.get(studentId)?.hasOngoingTrip();
    if (!t) return { status: "Closed" as const, tripId: null };
    return { status: t.getStatus(), tripId: t.id, message: `${t.vehicleId} is not latched in a dock yet. Push it firmly into a vacant dock until it clicks (E3). The trip and the fare keep running until the dock confirms.` };
  }

  /** StatusListener: the latch sensor events of UC-08. */
  onIoTEvent(e: IoTEvent): void {
    if (e.type === "latched") this.onLatched(e.dockId, e.vehicleId, e.telemetry);
    else if (e.type === "latchNotEngaged") {
      const t = this.openTripFor(e.vehicleId);
      if (t) MobileApp.notify(t.studentId, "Latch not engaged", `Dock ${db.docks.get(e.dockId)?.label ?? e.dockId} did not lock ${e.vehicleId}. Push the vehicle in firmly until it clicks (E3).`, "warn", t.id);
    }
  }

  private openTripFor(vehicleId: string): Trip | null {
    return ([...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === vehicleId && a.status === "Open") as Trip) ?? null;
  }

  /** UC-08 steps 5-9: the dock confirms the latch, the trip closes, the fare is charged (UC-03). */
  private onLatched(dockId: string, vehicleId: string, tel: Telemetry): void {
    const dock = db.docks.get(dockId);
    const v = db.vehicles.get(vehicleId);
    if (!dock || !v) return;
    const t = this.openTripFor(vehicleId);
    const closedByIncident = !t && [...db.allocations.values()].some((a) => a instanceof Trip && a.vehicleId === vehicleId && a.fareStatus === "Waived" && !a.endDock);
    if (!t && !closedByIncident && v.usage === "In Use") return;
    if (!t && v.usage !== "In Use" && !closedByIncident) return; // transfers are handled by RedistributionController
    // The dock and vehicle side.
    dock.latched = true;
    dock.vehicleId = v.id;
    dock.allocatedTo = null;
    dock.reevaluate();
    v.dockId = dock.id;
    v.hubId = dock.hubId;
    v.soc = tel.soc;
    v.odometerKm = tel.odometerKm;
    v.lastUpdateTime = tel.at;
    v.setStatus("Idle");
    v.reevaluate();
    if (!t) {
      // UC-12 8c: the trip was already closed at the breakdown time with the fare waived.
      const done = [...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === vehicleId && a.fareStatus === "Waived" && !a.endDock) as Trip;
      done.endDock = dock.label; done.endHubId = dock.hubId;
      return;
    }
    t.close(tel);
    t.endHubId = dock.hubId;
    t.endDock = dock.label;
    t.fare = this.calculateFare(t);
    t.setFare("Unpaid");
    audit(t.studentId, "UC-08 trip closed", t.id, "Open", "Closed");
    this.chargeFare(t);
  }

  /** - calculateFare(trip : Trip) : Money — ceil(minutes) × rate/60 + UNLOCK_FEE (TARIFF). */
  private calculateFare(t: Trip): number {
    const v = db.vehicles.get(t.vehicleId)!;
    const minutes = Math.max(1, Math.ceil((t.endTime! - t.startTime) / MINUTE));
    const ride = Math.round((minutes * v.ratePerHour) / 60);
    const unlock = config().value("UNLOCK_FEE");
    t.fareBreakdown = [
      { label: `Ride time ${minutes} min × ${vnd(v.ratePerHour)}/h`, amount: ride },
      { label: "Unlock fee", amount: unlock },
    ];
    return ride + unlock;
  }

  private chargeFare(t: Trip): void {
    this.payment.processPayment("Charge", t.id, t.studentId, t.fare, {
      purpose: "Rental fare · UC-08",
      onResult: (o) => {
        if (o.result === "Success") {
          t.paymentId = o.payment.id; t.transactionRef = o.transactionRef; t.setFare("Paid");
          MobileApp.notify(t.studentId, "Trip ended", `${t.vehicleId} returned at dock ${t.endDock}. Fare ${vnd(t.fare)} paid.`, "ok", t.id);
        } else {
          t.paymentId = o.payment.id;
          MobileApp.notify(t.studentId, "Fare not paid", `The ${vnd(t.fare)} fare for ${t.id} could not be charged (${o.timedOut ? "no answer from the bank" : o.failureCode}). New reservations and rentals are blocked until it is paid (BR-PAY-04).`, "danger", t.id);
        }
      },
      onLate: (o) => {
        if (o.result === "Success" && t.fareStatus === "Unpaid") { t.transactionRef = o.transactionRef; t.setFare("Paid"); MobileApp.notify(t.studentId, "Fare paid", `Your bank confirmed the ${vnd(t.fare)} fare for ${t.id}. Your account is unblocked.`, "ok", t.id); }
      },
    });
  }

  /** payFare(tripId) — UC-08 E4 / BR-PAY-04: the student retries the outstanding fare. */
  payFare(studentId: string): void {
    const t = db.students.get(studentId)?.unpaidTrip();
    if (!t) throw new UserError("No outstanding fare.", 409);
    const open = [...db.payments.values()].find((p) => p.orderRef === t.id && p.type === "Charge" && p.open);
    if (open) throw new UserError("A payment for this fare is still waiting for the bank.", 409);
    this.chargeFare(t);
  }
}
