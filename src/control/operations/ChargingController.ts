// control.operations — ChargingController (control method descriptions 3.3). The student's
// request (UC-05) and the operator's schedule (UC-11) are two views of one queue, so one
// controller owns both: the UC-05 operations, the UC-11 operations and the IoT listener.
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock, fmtHM, MINUTE, HOUR, type Timer } from "../../platform/clock/DemoClock";
import { ChargingSession } from "../../domain/allocation/ChargingSession";
import { ChargingPoint } from "../../domain/network/ChargingPoint";
import type { ChargingRequest } from "../../domain/allocation/StudentAccount";
import type { IoTEvent, StatusListener } from "../../gateway/iot/StatusListener";
import type { Slot, VehicleType } from "../../domain/types";
import { MobileApp } from "../../api/push";
import { UserError } from "../../api/errors";
import type { PaymentController } from "../payment/PaymentController";

/** How fast a private vehicle charges and what it draws (MVP tariff model; see README). */
const PROFILE: Record<VehicleType, { pctPerHour: number; kw: number }> = {
  "electric motorcycle": { pctPerHour: 40, kw: 4.2 },
  "electric bicycle": { pctPerHour: 60, kw: 0.6 },
};

export interface Proposal {
  hubId: string; hubName: string; pointId: string; power: string; slot: Slot; durationMs: number; fee: number;
  currentSoc: number; targetSoc: number; neededBy: number | null; vehicleId: string; graceMs: number; toleranceMs: number;
  alternatives: Array<{ index: number; hubId: string; hubName: string; pointId: string; slot: Slot; note: string }>;
  fromAlternative: boolean;
}

const vnd = (n: number) => `${n.toLocaleString("en-US")} VND`;

export class ChargingController implements StatusListener {
  private readonly drafts = new Map<string, { req: ChargingRequest; proposal: Proposal | null; alts: Proposal["alternatives"]; durationMs: number; fee: number }>();
  private readonly holdTimers = new Map<string, Timer>();
  private readonly graceTimers = new Map<string, Timer>();

  constructor(protected readonly payment: PaymentController) {}

  // ==== UC-05 Schedule charging session (student) ====================================

  /** startScheduling(studentId : String) : Availability[*] — UC-05 step 2, E1. */
  startScheduling(studentId: string, hubId?: string) {
    const s = db.students.get(studentId);
    if (!s) throw new UserError("Unknown student", 404);
    const hubs = [...db.hubs.values()].map((h) => {
      const pts = ChargingPoint.getStatus([h]);
      const count = (st: string) => pts.filter((p) => p.status === st).length;
      return { hubId: h.id, name: h.name, stale: h.isStale(), updatedAt: h.lastUpdateTime, available: count("Available"), inUse: count("In Use"), outOfService: count("Out of Service"), disconnected: count("Disconnected"), points: pts };
    });
    const active = [...db.allocations.values()].filter((a) => a instanceof ChargingSession && a.studentId === studentId && a.isCommittedReservation() && a.isActive()).map((a) => ({ id: a.id, vehicleId: (a as ChargingSession).vehicleRef, status: a.status }));
    return {
      hubs, selected: hubId ?? null, active,
      vehicles: s.vehicles.map((v) => ({ id: v.id, type: v.type, label: v.label })),
      horizonMs: config().value("BOOKING_HORIZON"), graceMs: config().value("CHARGING_START_GRACE"), toleranceMs: config().value("CHARGING_SHIFT_TOLERANCE"),
    };
  }

  /** submitRequest(request : ChargingRequest) : Proposal — UC-05 steps 4-7, 6a, E3, E4, E5. */
  submitRequest(studentId: string, req: ChargingRequest): Proposal {
    const s = db.students.get(studentId)!;
    if (!(req.currentSoc >= 0 && req.currentSoc <= 100 && req.targetSoc >= 0 && req.targetSoc <= 100)) throw new UserError("Battery levels must be between 0 and 100% (E3).", 422, "E3");
    const rej = s.checkRequest(req);
    if (rej) throw new UserError(`${rej.message}${rej.field === "vehicle" && rej.message.includes("already") ? " (E4)" : " (E3)"}`, 422, rej.field === "vehicle" && rej.message.includes("already") ? "E4" : "E3");
    const hub = db.hubs.get(req.hubId);
    if (!hub) throw new UserError(`Unknown Hub ${req.hubId}`, 404);
    if (hub.isStale()) throw new UserError(`Charging availability at ${hub.id} can't be shown right now (E1).`, 409, "E1");
    const v = s.vehicles.find((x) => x.id === req.privateVehicleId)!;
    const { durationMs, fee } = this.estimate(v.type, req.currentSoc, req.targetSoc);
    const end = req.neededBy !== null ? Math.min(req.to, req.neededBy) : req.to;
    const found = this.findSlot(hub.id, req.from, end, durationMs);
    let proposal: Proposal | null = null;
    let alts: Proposal["alternatives"] = [];
    if (found) proposal = this.proposal(req, found, durationMs, fee, [], false);
    else {
      alts = this.alternatives(req, durationMs);
      if (!alts.length) throw new UserError("No charging capacity: no compatible slot is free and there is no alternative (E5).", 409, "E5");
    }
    this.drafts.set(studentId, { req, proposal, alts, durationMs, fee });
    return proposal ?? this.proposal(req, null, durationMs, fee, alts, false);
  }

  /** 6a: the student picks a suggestion; it replaces the Hub and window. */
  chooseAlternative(studentId: string, index: number): Proposal {
    const d = this.drafts.get(studentId);
    const alt = d?.alts[index];
    if (!d || !alt) throw new UserError("That suggestion is no longer available.", 409);
    d.proposal = this.proposal({ ...d.req, hubId: alt.hubId }, alt.slot, d.durationMs, d.fee, [], true);
    d.alts = [];
    return d.proposal;
  }

  private estimate(type: VehicleType, from: number, to: number) {
    const p = PROFILE[type];
    const step = config().value("SCHEDULE_TIMESLOT");
    const durationMs = Math.max(step, Math.ceil((((to - from) / p.pctPerHour) * HOUR) / step) * step);
    const kwh = (durationMs / HOUR) * p.kw;
    const fee = Math.ceil((kwh * config().value("CHARGING_RATE_PER_KWH")) / 500) * 500;
    return { durationMs, fee };
  }

  /** Lowest expected demand first: the point with the fewest booked minutes in the window. */
  private findSlot(hubId: string, from: number, to: number, durationMs: number): Slot | null {
    const pts = [...db.points.values()].filter((p) => p.hubId === hubId)
      .sort((a, b) => this.load(a, from, to) - this.load(b, from, to) || b.kw - a.kw);
    for (const p of pts) {
      const s = p.findFreeSlot({ from, to, durationMs });
      if (s) return s;
    }
    return null;
  }

  private load(p: ChargingPoint, from: number, to: number): number {
    return p.bookings.filter((b) => b.state !== "Free" && b.start < to && b.end > from).reduce((m, b) => m + Math.min(b.end, to) - Math.max(b.start, from), 0);
  }

  private alternatives(req: ChargingRequest, durationMs: number): Proposal["alternatives"] {
    const now = clock().now();
    const horizonEnd = now + config().value("BOOKING_HORIZON");
    const latest = req.neededBy ?? horizonEnd;
    const out: Proposal["alternatives"] = [];
    // Same Hub, later.
    const later = this.findSlot(req.hubId, req.from, Math.min(latest, horizonEnd), durationMs);
    if (later) out.push({ index: 0, hubId: req.hubId, hubName: db.hubs.get(req.hubId)!.name, pointId: later.pointId, slot: later, note: `Same Hub, ${Math.round((later.start - req.from) / MINUTE)} min later` });
    // Nearby Hubs, same window.
    const here = db.hubs.get(req.hubId)!;
    const nearby = [...db.hubs.values()].filter((h) => h.id !== req.hubId && !h.isStale()).sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
    for (const h of nearby) {
      const s = this.findSlot(h.id, req.from, req.neededBy !== null ? Math.min(req.to, req.neededBy) : req.to, durationMs);
      if (s) out.push({ index: out.length, hubId: h.id, hubName: h.name, pointId: s.pointId, slot: s, note: `Same window · ${(Math.hypot(h.x - here.x, h.y - here.y) / 50).toFixed(1)} km away` });
      if (out.length >= 3) break;
    }
    return out.map((a, i) => ({ ...a, index: i }));
  }

  private proposal(req: ChargingRequest, slot: Slot | null, durationMs: number, fee: number, alts: Proposal["alternatives"], fromAlternative: boolean): Proposal {
    const h = db.hubs.get(req.hubId)!;
    const p = slot ? db.points.get(slot.pointId)! : null;
    return {
      hubId: h.id, hubName: h.name, pointId: p?.id ?? "", power: p?.power ?? "", slot: slot ?? { pointId: "", start: 0, end: 0 }, durationMs, fee,
      currentSoc: req.currentSoc, targetSoc: req.targetSoc, neededBy: req.neededBy, vehicleId: req.privateVehicleId,
      graceMs: config().value("CHARGING_START_GRACE"), toleranceMs: config().value("CHARGING_SHIFT_TOLERANCE"), alternatives: alts, fromAlternative,
    };
  }

  /** discardRequest — 8a: nothing was held. */
  discardRequest(studentId: string): void { this.drafts.delete(studentId); }

  /** confirmProposal() : ChargingSession — UC-05 steps 9-13, E6, E7, E8. */
  confirmProposal(studentId: string): ChargingSession {
    const s = db.students.get(studentId)!;
    const d = this.drafts.get(studentId);
    if (!d?.proposal) throw new UserError("Start again: no proposal to confirm.", 409);
    const v = s.vehicles.find((x) => x.id === d.req.privateVehicleId)!;
    if (s.hasActiveSession(v)) throw new UserError(`A parallel request already booked charging for ${v.label} (E7).`, 409, "E7");
    const id = nextId("CS");
    let slot = d.proposal.slot;
    let point = db.points.get(slot.pointId)!;
    if (!point.holdIfFree(slot, id)) {
      // E6: back to step 6 for another slot.
      const again = this.findSlot(d.proposal.hubId, d.req.from, d.req.neededBy !== null ? Math.min(d.req.to, d.req.neededBy) : d.req.to, d.durationMs);
      if (!again || !db.points.get(again.pointId)!.holdIfFree(again, id)) throw new UserError("The slot is no longer free and no other fits (E6).", 409, "E6");
      slot = again; point = db.points.get(again.pointId)!;
    }
    const cs = new ChargingSession(id, studentId, "committed reservation", point.id, point.hubId, v.id);
    cs.slot = slot; cs.window = { start: d.req.from, end: d.req.to }; cs.neededBy = d.req.neededBy; cs.targetSoc = d.req.targetSoc; cs.fee = d.proposal.fee;
    cs.expiresAt = clock().now() + config().value("PAYMENT_HOLD_BOOKING");
    cs.currentSoc = d.req.currentSoc;
    db.allocations.set(cs.id, cs);
    this.drafts.delete(studentId);
    this.holdTimers.set(cs.id, clock().after(config().value("PAYMENT_HOLD_BOOKING"), `PAYMENT_HOLD_BOOKING ${cs.id}`, () => {
      if (cs.status !== "Pending Payment") return;
      cs.setStatus("Payment Failed", "payment hold ran out");
      point.releaseHold(slot, cs.id);
      MobileApp.notify(studentId, "Payment not completed", `No payment result arrived in time for ${cs.id}. Nothing was charged and the slot was released.`, "warn", cs.id);
    }));
    const p = this.payment.processPayment("Charge", cs.id, studentId, cs.fee, {
      purpose: "Charging session · UC-05",
      onResult: (o) => {
        if (cs.status !== "Pending Payment") return;
        this.holdTimers.get(cs.id)?.cancel();
        if (o.result === "Success") {
          cs.paymentId = o.payment.id;
          cs.confirm(o.transactionRef!);
          point.book(slot, cs.id);
          this.armGrace(cs);
          audit(studentId, "UC-05 scheduled", cs.id, "Pending Payment", "Scheduled");
        } else {
          cs.setStatus("Payment Failed", o.timedOut ? "no answer from the bank" : o.failureCode ?? "declined");
          point.releaseHold(slot, cs.id);
        }
      },
      onLate: (o) => {
        if (o.result !== "Success" || cs.status === "Scheduled") return;
        this.payment.refund(cs.id, studentId, cs.fee, "Charging session");
        MobileApp.notify(studentId, "Late payment refunded", `Your bank confirmed the ${vnd(cs.fee)} charge for ${cs.id} after the slot was released. It is refunded automatically (BR-PAY-03).`, "info", cs.id);
      },
    });
    cs.paymentId = p.id;
    return cs;
  }

  /** NIFR-03: a paid session that has not started within CHARGING_START_GRACE expires; the fee is forfeited (BR-PAY-01). */
  armGrace(cs: ChargingSession): void {
    this.graceTimers.get(cs.id)?.cancel();
    if (!cs.slot || !cs.isCommittedReservation()) return;
    cs.expiresAt = cs.slot.start + config().value("CHARGING_START_GRACE");
    this.graceTimers.set(cs.id, clock().at(cs.expiresAt, `charging start grace ${cs.id}`, () => {
      if (cs.status !== "Scheduled") return;
      const p = db.points.get(cs.slot!.pointId);
      p?.releaseHold(cs.slot, cs.id);
      cs.setStatus("Expired", "charging did not start within CHARGING_START_GRACE");
      MobileApp.notify(cs.studentId, "Charging session expired", `Charging for ${cs.id} did not start by ${fmtHM(cs.expiresAt!)}. The slot was released and the ${vnd(cs.fee)} fee is not refunded (BR-PAY-01).`, "warn", cs.id);
    }));
  }

  /** StatusListener: NIFR-04 charging started / ended, reported by the charging point. */
  onIoTEvent(e: IoTEvent): void {
    if (e.type === "chargingStarted") {
      const s = db.allocations.get(e.sessionId) as ChargingSession | undefined;
      const p = db.points.get(e.pointId);
      if (!s || !p || s.status !== "Scheduled") return;
      s.start(p);
      this.graceTimers.get(s.id)?.cancel();
      if (s.isCommittedReservation()) MobileApp.notify(s.studentId, "Charging started", `${s.vehicleRef} is charging on ${p.id} until ${fmtHM(s.slot!.end)}.`, "ok", s.id);
    } else if (e.type === "chargingEnded") {
      const s = db.allocations.get(e.sessionId) as ChargingSession | undefined;
      if (!s || s.status !== "Charging") return;
      s.complete();
      if (s.isCommittedReservation()) MobileApp.notify(s.studentId, "Charging complete", `${s.id} finished on ${e.pointId}. You can unplug ${s.vehicleRef}.`, "ok", s.id);
    }
  }

  /** Re-arm the start-grace timers of seeded sessions at boot. */
  armSeeded(): void {
    for (const a of db.allocations.values()) if (a instanceof ChargingSession && a.isCommittedReservation() && a.status === "Scheduled") this.armGrace(a);
  }
}
