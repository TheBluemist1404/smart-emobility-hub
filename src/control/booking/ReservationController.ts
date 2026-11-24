// control.booking — ReservationController (control method descriptions 2.2), UC-02 and UC-04:
// "hold a resource, take payment, confirm or release" with the same timer and the same
// one-reservation rule. confirmReservation is overloaded exactly as in the Sub2 diagrams:
// confirmReservation(vehicleId) for UC-02 and confirmReservation() for UC-04.
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock, fmtHM, HOUR, type Timer } from "../../platform/clock/DemoClock";
import { VehicleReservation } from "../../domain/allocation/VehicleReservation";
import { ParkingReservation } from "../../domain/allocation/ParkingReservation";
import { ParkingSpace, type Alternative } from "../../domain/network/ParkingSpace";
import type { Allocation } from "../../domain/allocation/Allocation";
import type { PrivateVehicle } from "../../domain/allocation/PrivateVehicle";
import type { Hub } from "../../domain/network/Hub";
import type { VehicleType } from "../../domain/types";
import { MobileApp } from "../../api/push";
import { UserError } from "../../api/errors";
import type { PaymentController } from "../payment/PaymentController";

export interface Violation { rule: string; message: string }
interface ParkingDraft { studentId: string; hubId: string; vehicleId: string; arrival: number; departure: number; spaceId: string | null; fee: number; alternatives: Alternative[] }

const vnd = (n: number) => `${n.toLocaleString("en-US")} VND`;

export class ReservationController {
  private readonly holdTimers = new Map<string, Timer>();
  private readonly expiryTimers = new Map<string, Timer>();
  private readonly drafts = new Map<string, ParkingDraft>();

  constructor(private readonly payment: PaymentController) {}

  private student(studentId: string) {
    const s = db.students.get(studentId);
    if (!s) throw new UserError(`Unknown student ${studentId}`, 404);
    return s;
  }

  // ==== UC-02 Reserve shared vehicle =================================================

  /** requestReservation(vehicleId : String) : VehicleSummary — no hold, no charge. UC-02 step 2. */
  requestReservation(vehicleId: string, studentId: string) {
    const s = this.student(studentId);
    if (s.isBlocked()) throw new UserError("An unpaid rental fare blocks new reservations until it is paid (BR-PAY-04).", 409, "BLOCKED");
    if (s.hasOngoingTrip()) throw new UserError("You have a trip in progress.", 409, "TRIP");
    const active = VehicleReservation.findConfirmed(studentId) ?? s.getActiveAllocations().find((a) => a instanceof VehicleReservation);
    if (active) throw new UserError(`You already have an active vehicle reservation (${active.id}).`, 409, "ACTIVE");
    const v = db.vehicles.get(vehicleId);
    if (!v) throw new UserError(`Unknown vehicle ${vehicleId}`, 404);
    if (!v.isReservable()) throw new UserError(`${vehicleId} is ${v.status}, not Available.`, 409, "UNAVAILABLE");
    const hub = db.hubs.get(v.hubId)!;
    return { ...v.getSummary(), hubName: hub.name, holdMs: config().value("VEHICLE_RESERVATION_HOLD"), paymentHoldMs: config().value("PAYMENT_HOLD_VEHICLE") };
  }

  /**
   * confirmReservation(vehicleId : String) : VehicleReservation — UC-02 step 4, one indivisible
   * operation: re-check, hold, create "Pending Payment", start PAYMENT_HOLD_VEHICLE; then UC-03.
   */
  confirmReservation(vehicleId: string, studentId: string): VehicleReservation;
  /** confirmReservation() : ParkingReservation — UC-04 steps 9-10, from the draft built in this session. */
  confirmReservation(studentId: string): ParkingReservation;
  confirmReservation(a: string, b?: string): VehicleReservation | ParkingReservation {
    return b === undefined ? this.confirmParking(a) : this.confirmVehicle(a, b);
  }

  private confirmVehicle(vehicleId: string, studentId: string): VehicleReservation {
    const s = this.student(studentId);
    const v = db.vehicles.get(vehicleId);
    if (!v) throw new UserError(`Unknown vehicle ${vehicleId}`, 404);
    // E1: re-check inside the indivisible step.
    if (s.isBlocked()) throw new UserError("An unpaid rental fare blocks new reservations (BR-PAY-04).", 409, "BLOCKED");
    if (s.getActiveAllocations().some((x) => x instanceof VehicleReservation)) throw new UserError("A parallel request already created an active reservation (E1).", 409, "ACTIVE");
    if (!v.holdIfAvailable(studentId)) throw new UserError(`${vehicleId} is no longer Available (E1). Choose another vehicle.`, 409, "UNAVAILABLE");
    const vr = new VehicleReservation(nextId("VR"), studentId, vehicleId, v.hubId);
    vr.fee = config().value("RESERVATION_FEE");
    db.allocations.set(vr.id, vr);
    vr.expiresAt = clock().now() + config().value("PAYMENT_HOLD_VEHICLE");
    this.startTimer("PAYMENT_HOLD_VEHICLE", vr);
    audit(studentId, "UC-02 hold", vehicleId, "Available", "Held");

    const p = this.payment.processPayment("Charge", vr.id, studentId, vr.fee, {
      purpose: "Vehicle reservation · UC-02",
      onResult: (o) => {
        if (vr.status !== "Pending Payment") return; // the hold already ran out
        this.holdTimers.get(vr.id)?.cancel();
        if (o.result === "Success") {
          vr.paymentId = o.payment.id;
          vr.confirm(o.transactionRef!);
          v.reserve();
          this.scheduleExpiry(vr);
          audit(studentId, "UC-02 confirmed", vr.id, "Pending Payment", "Confirmed");
          // E4: a block recorded while the reservation was "Pending Payment" moves it now (BR-RES-02).
          if (v.hasBlockingIncident()) this.moveOrCancelVehicleReservation(vr, "it was blocked while you were paying");
        } else {
          vr.setStatus("Payment Failed", o.timedOut ? "no answer from the bank" : o.failureCode ?? "declined");
          v.releaseHold();
          audit(studentId, "UC-02 payment failed", vr.id, "Pending Payment", "Payment Failed");
        }
      },
      onLate: (o) => this.lateCharge(vr, o.result),
    });
    vr.paymentId = p.id;
    return vr;
  }

  /** BR-PAY-03: a late Success for a hold already released is refunded by NIFR-05. */
  private lateCharge(a: Allocation, result: string): void {
    if (result !== "Success") return;
    if (["Confirmed", "Scheduled"].includes(a.status)) return;
    this.payment.refund(a.id, a.studentId, a.fee, a.kind === "VehicleReservation" ? "Vehicle reservation" : "Parking reservation");
    MobileApp.notify(a.studentId, "Late payment refunded", `Your bank confirmed the ${vnd(a.fee)} charge for ${a.id} after the hold was released. It is refunded automatically (BR-PAY-03).`, "info", a.id);
  }

  /** BR-RES-02 for a vehicle reservation, then BR-PAY-02 if it had to be cancelled. Used by UC-02 E4, UC-07 and UC-12. */
  moveOrCancelVehicleReservation(vr: VehicleReservation, why: string): "moved" | "cancelled" | "awaiting" {
    const old = vr.vehicleId;
    const out = vr.moveOrCancel();
    if (out.outcome === "moved") {
      this.scheduleExpiry(vr);
      MobileApp.notify(vr.studentId, "Vehicle replaced", `Your reserved vehicle ${old} became unavailable (${why}). You now have ${vr.vehicleId} at the same Hub; pick up before ${fmtHM(vr.expiresAt!)}.`, "ok", vr.id);
    } else if (out.outcome === "cancelled") {
      this.expiryTimers.get(vr.id)?.cancel();
      this.payment.refund(vr.id, vr.studentId, vr.fee, "Vehicle reservation");
      MobileApp.notify(vr.studentId, "Reservation cancelled", `Your reserved vehicle ${old} became unavailable (${why}) and no same-type vehicle is free at ${vr.hubId}. Reservation ${vr.id} was cancelled and ${vnd(vr.fee)} will be refunded.`, "danger", vr.id);
    }
    return out.outcome;
  }

  /** discardRequest() : void — UC-02 2a / UC-04 8a: nothing was held. */
  discardRequest(studentId: string): void {
    this.drafts.delete(studentId);
  }

  /** - startTimer(parameter : Parameter) : void — the duration comes from ConfigurationRegistry by name. */
  private startTimer(parameter: "PAYMENT_HOLD_VEHICLE" | "PAYMENT_HOLD_BOOKING", a: Allocation): void {
    const t = clock().after(config().value(parameter), `${parameter} ${a.id}`, () => this.onHoldExpired(a));
    this.holdTimers.set(a.id, t);
  }

  /**
   * - onHoldExpired(allocation : Allocation) : void — UC-02 E2 / UC-04 E8: no result within the
   * payment hold. The UC text sets "Payment Failed" (Tables 2.3-2, 2.3-3), so that is what is stored.
   */
  private onHoldExpired(a: Allocation): void {
    if (a.status !== "Pending Payment") return;
    a.setStatus("Payment Failed", "payment hold ran out");
    if (a instanceof VehicleReservation) db.vehicles.get(a.vehicleId)?.releaseHold();
    if (a instanceof ParkingReservation) { const sp = db.spaces.get(a.spaceId); sp?.releaseHold(a.window, a.id); sp?.reevaluate(); }
    MobileApp.notify(a.studentId, "Payment not completed", `No payment result arrived in time for ${a.id}. Nothing was charged and the hold was released.`, "warn", a.id);
  }

  /** NIFR-03: the reservation expires at its pickup / check-in deadline (fee not refunded, BR-PAY-01). */
  scheduleExpiry(a: Allocation): void {
    this.expiryTimers.get(a.id)?.cancel();
    if (!a.expiresAt) return;
    const label = a instanceof VehicleReservation ? `pickup expiry ${a.id}` : `check-in grace ${a.id}`;
    const t = clock().at(a.expiresAt, label, () => {
      if (a instanceof VehicleReservation && a.status === "Confirmed") {
        a.setStatus("Expired", "not picked up in time (NIFR-03)");
        db.vehicles.get(a.vehicleId)?.releaseHold();
        MobileApp.notify(a.studentId, "Reservation expired", `${a.id} for ${a.vehicleId} expired at ${fmtHM(a.expiresAt!)}. The fee is not refunded (BR-PAY-01).`, "warn", a.id);
      } else if (a instanceof ParkingReservation && a.status === "Confirmed") {
        a.setStatus("Expired", "no check-in within CHECKIN_GRACE (NIFR-03)");
        const sp = db.spaces.get(a.spaceId);
        sp?.releaseHold(a.window, a.id);
        MobileApp.notify(a.studentId, "Parking reservation expired", `No check-in at ${sp?.label ?? a.spaceId} within ${config().value("CHECKIN_GRACE") / 60000} min. The fee is not refunded (BR-PAY-01).`, "warn", a.id);
      }
    });
    this.expiryTimers.set(a.id, t);
  }

  cancelExpiry(id: string): void { this.expiryTimers.get(id)?.cancel(); }

  // ==== UC-04 Reserve parking space ==================================================

  /** startReservation(studentId : String) : Availability[*] — UC-04 steps 2-3, E1. */
  startReservation(studentId: string) {
    const s = this.student(studentId);
    const active = s.getActiveAllocations().find((a) => a instanceof ParkingReservation);
    const hubs = [...db.hubs.values()];
    return {
      active: active ? { id: active.id, status: active.status } : null,
      availability: ParkingSpace.getAvailability(hubs),
      hubs: hubs.map((h) => ({ hubId: h.id, name: h.name, stale: h.isStale(), updatedAt: h.lastUpdateTime })),
      vehicles: s.vehicles.map((v) => ({ id: v.id, type: v.type, label: v.label })),
      maxDurationMs: config().value("PARKING_MAX_DURATION"), horizonMs: config().value("BOOKING_HORIZON"), graceMs: config().value("CHECKIN_GRACE"),
    };
  }

  /** registerVehicle(type : VehicleType, id : String) : void — UC-04 4a, E3. */
  registerVehicle(studentId: string, type: VehicleType | "", id: string): PrivateVehicle {
    const s = this.student(studentId);
    if (!type || !["electric bicycle", "electric motorcycle"].includes(type)) throw new UserError("Choose the vehicle type (E3).", 422, "E3");
    const plate = id.trim().toUpperCase();
    if (plate.length < 4) throw new UserError("Enter the licence plate or frame number (E3).", 422, "E3");
    const other = [...db.students.values()].find((x) => x.id !== studentId && x.vehicles.some((v) => v.id.toUpperCase() === plate));
    if (other) throw new UserError(`${plate} is already registered to another student (E3).`, 422, "E3");
    return s.addVehicle(type as VehicleType, plate);
  }

  /** submitTimeWindow(hub, vehicle, arrival, departure) : Offer — UC-04 steps 5-7, 6a, E4, E5. */
  submitTimeWindow(studentId: string, hubId: string, vehicleId: string, arrival: number, departure: number) {
    const s = this.student(studentId);
    const active = s.getActiveAllocations().find((a) => a instanceof ParkingReservation);
    if (active) throw new UserError(`Only one active parking reservation is allowed at a time (${active.id}, ${active.status}).`, 409, "E1");
    const v = s.vehicles.find((x) => x.id === vehicleId);
    if (!v) throw new UserError("Choose a registered vehicle.", 422, "E3");
    const viol = this.validateTimeWindow(arrival, departure);
    if (viol) throw new UserError(viol.message, 422, "E4");
    const hub = db.hubs.get(hubId);
    if (!hub) throw new UserError(`Unknown Hub ${hubId}`, 404);
    if (hub.isStale()) throw new UserError(`${hub.id} has sent no data recently; availability can't be confirmed (E2).`, 409, "E2");
    const window = { start: arrival, end: departure };
    const space = this.findSpace(hub, v.type, window);
    const fee = this.parkingFee(window.end - window.start);
    const draft: ParkingDraft = { studentId, hubId, vehicleId, arrival, departure, spaceId: space?.id ?? null, fee, alternatives: [] };
    if (!space) {
      const any = [...db.spaces.values()].find((x) => x.hubId === hubId && x.type === v.type);
      draft.alternatives = any ? any.suggestAlternatives(window) : [];
      if (!draft.alternatives.length) throw new UserError("No matching space is free and there is no alternative (E5).", 409, "E5");
    }
    this.drafts.set(studentId, draft);
    return this.offer(draft);
  }

  /** 6a: the student picks one of the suggested alternatives. */
  chooseAlternative(studentId: string, index: number) {
    const d = this.drafts.get(studentId);
    if (!d) throw new UserError("Start again: no parking request in progress.", 409);
    const alt = d.alternatives[index];
    if (!alt) throw new UserError("Unknown alternative.", 422);
    const v = this.student(studentId).vehicles.find((x) => x.id === d.vehicleId)!;
    const sp = this.findSpace(db.hubs.get(alt.hubId)!, v.type, alt.window);
    if (!sp) throw new UserError("That alternative is no longer free.", 409, "E6");
    Object.assign(d, { hubId: alt.hubId, arrival: alt.window.start, departure: alt.window.end, spaceId: sp.id, fee: this.parkingFee(alt.window.end - alt.window.start), alternatives: [] });
    return this.offer(d);
  }

  private offer(d: ParkingDraft) {
    const sp = d.spaceId ? db.spaces.get(d.spaceId)! : null;
    const h = db.hubs.get(d.hubId)!;
    return {
      hubId: h.id, hubName: h.name, space: sp ? { id: sp.id, label: sp.label, type: sp.type } : null, arrival: d.arrival, departure: d.departure,
      fee: d.fee, vehicleId: d.vehicleId, graceMs: config().value("CHECKIN_GRACE"),
      alternatives: d.alternatives.map((a, i) => ({ index: i, hubId: a.hubId, hubName: db.hubs.get(a.hubId)?.name, start: a.window.start, end: a.window.end, note: a.note, freeSpaces: a.freeSpaces })),
    };
  }

  private findSpace(hub: Hub, type: VehicleType, w: { start: number; end: number }): ParkingSpace | null {
    return [...db.spaces.values()].find((s) => s.hubId === hub.id && s.findFreeInServiceSpace(type, w)) ?? null;
  }

  private parkingFee(ms: number): number {
    return Math.ceil(ms / HOUR) * config().value("PARKING_RATE_PER_HOUR");
  }

  private confirmParking(studentId: string): ParkingReservation {
    const s = this.student(studentId);
    const d = this.drafts.get(studentId);
    if (!d || !d.spaceId) throw new UserError("Start again: no parking offer to confirm.", 409);
    if (s.getActiveAllocations().some((a) => a instanceof ParkingReservation)) throw new UserError("A parallel request already created an active parking reservation (E7).", 409, "E7");
    const window = { start: d.arrival, end: d.departure };
    let sp = db.spaces.get(d.spaceId)!;
    const id = nextId("PR");
    if (!sp.holdIfFree(window, id)) {
      // E6: the space is no longer free — back to step 6 for another one.
      const v = s.vehicles.find((x) => x.id === d.vehicleId)!;
      const other = this.findSpace(db.hubs.get(d.hubId)!, v.type, window);
      if (!other || !other.holdIfFree(window, id)) throw new UserError("The space is no longer free and no other matches (E6).", 409, "E6");
      sp = other;
    }
    const pr = new ParkingReservation(id, studentId, sp.id, d.hubId, window, d.vehicleId);
    pr.fee = d.fee;
    pr.expiresAt = clock().now() + config().value("PAYMENT_HOLD_BOOKING");
    db.allocations.set(pr.id, pr);
    this.drafts.delete(studentId);
    this.startTimer("PAYMENT_HOLD_BOOKING", pr);
    const p = this.payment.processPayment("Charge", pr.id, studentId, pr.fee, {
      purpose: "Parking reservation · UC-04",
      onResult: (o) => {
        if (pr.status !== "Pending Payment") return;
        this.holdTimers.get(pr.id)?.cancel();
        if (o.result === "Success") {
          pr.paymentId = o.payment.id;
          pr.confirm(o.transactionRef!);
          sp.book(window, pr.id);
          this.scheduleExpiry(pr);
          if (sp.hasBlockingIncident()) this.moveOrCancelParking(pr, "the space was blocked while you were paying");
        } else {
          pr.setStatus("Payment Failed", o.timedOut ? "no answer from the bank" : o.failureCode ?? "declined");
          sp.releaseHold(window, pr.id);
          sp.reevaluate();
        }
      },
      onLate: (o) => this.lateCharge(pr, o.result),
    });
    pr.paymentId = p.id;
    return pr;
  }

  /** BR-RES-02 for parking, then BR-PAY-02 when cancelled. Used by UC-12 step 7. */
  moveOrCancelParking(pr: ParkingReservation, why: string): "moved" | "cancelled" | "awaiting" {
    const oldLabel = db.spaces.get(pr.spaceId)?.label ?? pr.spaceId;
    const out = pr.moveOrCancel();
    if (out.outcome === "moved") {
      MobileApp.notify(pr.studentId, "Parking space changed", `Space ${oldLabel} became unavailable (${why}). Reservation ${pr.id} moved to ${db.spaces.get(pr.spaceId)?.label} at the same Hub, same window.`, "ok", pr.id);
    } else if (out.outcome === "cancelled") {
      this.expiryTimers.get(pr.id)?.cancel();
      this.payment.refund(pr.id, pr.studentId, pr.fee, "Parking reservation");
      MobileApp.notify(pr.studentId, "Parking reservation cancelled", `Parking space ${oldLabel} is blocked and no replacement is free. Reservation ${pr.id} was cancelled and ${vnd(pr.fee)} will be refunded.`, "danger", pr.id);
    }
    return out.outcome;
  }

  /** UC-04 step 14 / NIFR-04: the parking sensor reports the arrival or the departure. */
  parkingSensor(spaceId: string, occupied: boolean, at: number): void {
    const pr = [...db.allocations.values()].find((a) => a instanceof ParkingReservation && a.spaceId === spaceId && ["Confirmed", "Checked-in"].includes(a.status)) as ParkingReservation | undefined;
    if (!pr) return;
    if (occupied && pr.status === "Confirmed") {
      if (pr.checkIn(at)) { this.expiryTimers.get(pr.id)?.cancel(); MobileApp.notify(pr.studentId, "Checked in", `Welcome — ${pr.id} is Checked-in at ${db.spaces.get(spaceId)?.label}.`, "ok", pr.id); }
    } else if (!occupied && pr.status === "Checked-in") {
      pr.setStatus("Completed");
      db.spaces.get(spaceId)?.releaseHold(pr.window, pr.id);
    }
  }

  /** - validateTimeWindow(arrival, departure) : Violation — UC-04 E4. */
  private validateTimeWindow(arrival: number, departure: number): Violation | null {
    const now = clock().now();
    if (!(departure > arrival)) return { rule: "order", message: "Departure must be after arrival." };
    if (arrival < now - 60_000) return { rule: "past", message: "The arrival time is in the past." };
    if (departure - arrival > config().value("PARKING_MAX_DURATION")) return { rule: "PARKING_MAX_DURATION", message: `A reservation can last at most ${config().value("PARKING_MAX_DURATION") / HOUR} h (PARKING_MAX_DURATION).` };
    if (arrival > now + config().value("BOOKING_HORIZON")) return { rule: "BOOKING_HORIZON", message: `You can book at most ${config().value("BOOKING_HORIZON") / HOUR} h ahead (BOOKING_HORIZON).` };
    return null;
  }

  draftFor(studentId: string) { const d = this.drafts.get(studentId); return d ? this.offer(d) : null; }

  /** Re-arm NIFR-03 timers for seeded reservations at boot. */
  armSeeded(): void {
    for (const a of db.allocations.values()) {
      if ((a instanceof VehicleReservation || a instanceof ParkingReservation) && a.status === "Confirmed") this.scheduleExpiry(a);
    }
  }
}
