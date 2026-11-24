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
import type { Slot, TimeWindow, VehicleType } from "../../domain/types";
import { Incident } from "../../domain/operations/Incident";
import { OperatorConsole } from "../../api/push";
import { iot } from "../../gateway/iot/IoTDataGateway";
import { bus } from "../../platform/events/bus";
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

export interface ScheduleBlock {
  sessionId: string; pointId: string; start: number; end: number; committed: boolean; status: string; vehicleId: string;
  soc: number | null; targetSoc: number; priority: number | null; emergency: boolean; originalStart: number | null; latestStart: number | null; moved: boolean; locked: boolean;
}
export interface ScheduleProposal {
  hubId: string; horizon: TimeWindow; hours: number; baseVersion: number; generatedAt: number; blocks: ScheduleBlock[]; current: ScheduleBlock[];
  unserved: Array<{ sessionId: string; vehicleId: string; priority: number | null; reason: string }>; alerts: string[]; rejected: { sessionId: string; message: string } | null;
  kpis: { serviced: number; servicedWas: number; avgWait: number; avgWaitWas: number; peakKw: number; peakKwWas: number; limitKw: number; unserved: number; unservedWas: number; load: Array<{ t: number; proposed: number; current: number }> };
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
    } else if (e.type === "pointFault") {
      if (db.points.get(e.pointId)) this.pointFault(e.pointId);
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

  // ==== UC-11 Manage smart charging schedule (operator) ==============================

  private proposals = new Map<string, ScheduleProposal>();

  /** Hub peak electrical capacity: MVP rule of 76% of the installed point power (UC-11 2a). */
  peakKw(hubId: string): number {
    return Math.round([...db.points.values()].filter((p) => p.hubId === hubId).reduce((s, p) => s + p.kw, 0) * 0.76);
  }

  private horizonFor(hours: number): TimeWindow {
    const step = config().value("SCHEDULE_TIMESLOT");
    const start = Math.floor(clock().now() / step) * step;
    return { start, end: start + hours * HOUR };
  }

  private hubPoints(hubId: string): ChargingPoint[] {
    return [...db.points.values()].filter((p) => p.hubId === hubId).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The current committed plan as blocks, for the timeline and the "was" KPIs. */
  private currentBlocks(hubId: string, horizon: TimeWindow): ScheduleBlock[] {
    return ChargingSession.getSessions(db.hubs.get(hubId)!, horizon).map((s) => this.blockOf(s, s.slot!.pointId, s.slot!.start, s.slot!.end));
  }

  private blockOf(s: ChargingSession, pointId: string, start: number, end: number): ScheduleBlock {
    const v = db.vehicles.get(s.vehicleRef);
    const orig = s.isCommittedReservation() ? (s.originalStart ?? s.slot?.start ?? start) : null;
    return {
      sessionId: s.id, pointId, start, end, committed: s.isCommittedReservation(), status: s.status,
      vehicleId: s.vehicleRef,
      soc: s.isCommittedReservation() ? s.currentSoc : v ? Math.round(v.soc) : null, targetSoc: s.targetSoc, priority: s.priority, emergency: !!s.emergencyReason,
      originalStart: orig, latestStart: orig !== null ? orig + config().value("CHARGING_SHIFT_TOLERANCE") : null,
      moved: s.slot ? s.slot.start !== start || s.slot.pointId !== pointId : false, locked: s.status === "Charging",
    };
  }

  /** openSchedule() : Schedule — UC-11 step 2: the committed timeline and the Charging Queue. */
  openSchedule(hubId: string, hours = 4) {
    const hub = db.hubs.get(hubId);
    if (!hub) throw new UserError(`Unknown Hub ${hubId}`, 404);
    const horizon = this.horizonFor(hours);
    const queue = ChargingSession.getChargingQueue().filter((s) => s.hubId === hubId);
    this.computePriority(queue);
    return {
      hubId, name: hub.name, stale: hub.isStale(), horizon, slotMs: config().value("SCHEDULE_TIMESLOT"), peakKw: this.peakKw(hubId),
      points: this.hubPoints(hubId).map((p) => ({ id: p.id, power: p.power, kw: p.kw, status: p.status, incidentId: p.blockedBy ?? [...p.faults][0] ?? null, updatedAt: p.lastUpdateTime })),
      blocks: this.currentBlocks(hubId, horizon),
      queue: ChargingSession.getChargingQueue().filter((s) => s.hubId === hubId).map((s) => this.queueRow(s)),
      version: ChargingPoint.getActiveSchedule(hubId).version,
      proposal: this.openProposal(hubId),
      policy: this.getChargingPolicy(hubId),
    };
  }

  private queueRow(s: ChargingSession) {
    const v = db.vehicles.get(s.vehicleRef);
    return { sessionId: s.id, vehicleId: s.vehicleRef, soc: v ? Math.round(v.soc) : null, priority: s.priority, waitedMs: clock().now() - s.waitingSince, emergency: s.emergencyReason, unserved: s.unserved, status: v?.status ?? null, hubFlag: this.demandOf(s.hubId) === 1 };
  }

  /** getChargingPolicy() : Policy — UC-11 step 4. */
  getChargingPolicy(hubId?: string) {
    const names = ["W_SOC", "W_DEMAND", "W_WAIT", "LOW_BATTERY_SOC", "CHARGING_SHIFT_TOLERANCE", "CHARGING_MAX_WAIT", "HIGH_PRIORITY_P"];
    return { params: names.map((n) => { const p = config().get(n); return { name: n, value: p.value, unit: p.unit, min: p.min, max: p.max, meaning: p.meaning }; }), peakKw: hubId ? this.peakKw(hubId) : null };
  }

  /** savePolicy(policy : Policy) : Violation — UC-11 step 5. */
  savePolicy(values: Record<string, number>, operatorId = "OP-014"): { parameter: string; message: string } | null {
    const v = this.validatePolicy(values);
    if (v) return v;
    for (const [k, val] of Object.entries(values)) { const before = config().value(k); config().set(k, val); if (before !== val) audit(operatorId, "UC-11 policy changed", k, String(before), String(val)); }
    return null;
  }

  /** - validatePolicy(policy : Policy) : Violation — each value in range, and the weights sum to 1. */
  private validatePolicy(values: Record<string, number>): { parameter: string; message: string } | null {
    for (const [k, val] of Object.entries(values)) if (!config().validateRange(k, val)) { const p = config().get(k); return { parameter: k, message: `${k} must be between ${p.min} and ${p.max}.` }; }
    const w = (n: string) => values[n] ?? config().value(n);
    const sum = w("W_SOC") + w("W_DEMAND") + w("W_WAIT");
    if (Math.abs(sum - 1) > 0.001) return { parameter: "W_SOC", message: `W_SOC + W_DEMAND + W_WAIT must total 1.0 (now ${sum.toFixed(2)}).` };
    return null;
  }

  /** D in BR-CHG-01: 1 when the Hub is flagged Vehicle Shortage or Insufficient Fully Charged Vehicles. */
  private demandOf(hubId: string): number {
    const f = db.hubs.get(hubId)?.getFlags() ?? [];
    return f.includes("Vehicle Shortage") || f.includes("Insufficient Fully Charged Vehicles") ? 1 : 0;
  }

  /** - computePriority(requests) : void — BR-CHG-01: P = W_SOC(1 − SoC/100) + W_DEMAND·D + W_WAIT·min(wait/CHARGING_MAX_WAIT, 1). */
  computePriority(requests: ChargingSession[]): void {
    const c = config();
    for (const s of requests) {
      if (s.isCommittedReservation()) continue;
      if (s.emergencyReason) { s.setPriority(1); continue; }
      const soc = db.vehicles.get(s.vehicleRef)?.soc ?? 100;
      const wait = Math.min((clock().now() - s.waitingSince) / c.value("CHARGING_MAX_WAIT"), 1);
      s.setPriority(c.value("W_SOC") * (1 - soc / 100) + c.value("W_DEMAND") * this.demandOf(s.hubId) + c.value("W_WAIT") * wait);
    }
  }

  /** How long a shared vehicle needs to reach its target on a point (rounded up to SCHEDULE_TIMESLOT). */
  private sharedDuration(s: ChargingSession): number {
    const v = db.vehicles.get(s.vehicleRef);
    const step = config().value("SCHEDULE_TIMESLOT");
    const pct = Math.max(5, s.targetSoc - (v?.soc ?? 50));
    const perHour = v?.type === "electric motorcycle" ? PROFILE["electric motorcycle"].pctPerHour : PROFILE["electric bicycle"].pctPerHour;
    return Math.max(step, Math.ceil(((pct / perHour) * HOUR) / step) * step);
  }

  /** generateSchedule(hub : Hub, horizon : Horizon) : ScheduleProposal — UC-11 step 7. A draft only. */
  generateSchedule(hubId: string, hours = 4): ScheduleProposal {
    const hub = db.hubs.get(hubId);
    if (!hub) throw new UserError(`Unknown Hub ${hubId}`, 404);
    if (hub.isStale()) throw new UserError(`${hubId} is Disconnected; its points cannot be scheduled (E5).`, 409, "E5");
    const horizon = this.horizonFor(hours);
    const queue = ChargingSession.getChargingQueue().filter((s) => s.hubId === hubId);
    const current = this.currentBlocks(hubId, horizon);
    const shared = [...db.allocations.values()].filter((a): a is ChargingSession => a instanceof ChargingSession && a.hubId === hubId && !a.isCommittedReservation() && a.status === "Scheduled");
    const requests = [...queue, ...shared];
    this.computePriority(requests);
    const p: ScheduleProposal = { hubId, horizon, hours, baseVersion: ChargingPoint.getActiveSchedule(hubId).version, generatedAt: clock().now(), blocks: [], unserved: [], current, alerts: [], rejected: null, kpis: null as unknown as ScheduleProposal["kpis"] };
    const usable = this.hubPoints(hubId).filter((pt) => pt.status !== "Out of Service" && pt.status !== "Disconnected");
    // 1. Fixed: what is charging now, and committed student reservations (moved only if their point is down).
    for (const b of current) {
      const s = db.allocations.get(b.sessionId) as ChargingSession;
      if (b.locked || (b.committed && usable.some((x) => x.id === b.pointId))) { p.blocks.push({ ...b, moved: false }); continue; }
      if (!b.committed) continue; // shared Scheduled sessions are re-planned below
      const spot = this.findSpot(p, usable, b.end - b.start, b.originalStart ?? b.start, b.latestStart ?? b.start, hubId);
      if (spot) { p.blocks.push(this.blockOf(s, spot.pointId, spot.start, spot.start + (b.end - b.start))); p.alerts.push(`${s.id} moved to ${spot.pointId} ${fmtHM(spot.start)} (within CHARGING_SHIFT_TOLERANCE).`); }
      else p.unserved.push({ sessionId: s.id, vehicleId: b.vehicleId, priority: null, reason: "No point free within CHARGING_SHIFT_TOLERANCE; applying cancels and refunds it (BR-CHG-02)." });
    }
    // 2. Shared requests in priority order (higher P, lower SoC, older), earliest feasible slot.
    const socOf = (s: ChargingSession) => db.vehicles.get(s.vehicleRef)?.soc ?? 100;
    const ordered = requests.filter((s) => !p.blocks.some((b) => b.sessionId === s.id))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || socOf(a) - socOf(b) || a.waitingSince - b.waitingSince);
    for (const s of ordered) {
      const dur = this.sharedDuration(s);
      const spot = this.findSpot(p, usable, dur, horizon.start, horizon.end - dur, hubId);
      if (spot) p.blocks.push(this.blockOf(s, spot.pointId, spot.start, spot.start + dur));
      else p.unserved.push({ sessionId: s.id, vehicleId: s.vehicleRef, priority: s.priority, reason: "No slot within the horizon and the peak capacity (E1)." });
    }
    this.markUnserved(p);
    p.kpis = this.kpis(p);
    if (p.unserved.length) p.alerts.push(`${p.unserved.length} request(s) cannot be served in the horizon (E1).`);
    this.proposals.set(hubId, p);
    audit("OP-014", "UC-11 schedule generated", hubId);
    return p;
  }

  /** First start in [from, to] on any usable point where the block fits and the Hub stays under its peak. */
  private findSpot(p: ScheduleProposal, points: ChargingPoint[], dur: number, from: number, to: number, hubId: string): { pointId: string; start: number } | null {
    const step = config().value("SCHEDULE_TIMESLOT");
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      for (const pt of points) if (this.fits(p, pt.id, t, t + dur) && this.underPeak(p, pt.kw, t, t + dur, hubId)) return { pointId: pt.id, start: t };
    }
    return null;
  }

  private fits(p: ScheduleProposal, pointId: string, start: number, end: number, ignore?: string): boolean {
    if (p.blocks.some((b) => b.sessionId !== ignore && b.pointId === pointId && b.start < end && b.end > start)) return false;
    const pt = db.points.get(pointId)!;
    // Held slots of students still paying are respected (UC-05 step 10).
    return !pt.bookings.some((b) => b.state === "Held" && b.ref !== ignore && b.start < end && b.end > start);
  }

  private loadAt(blocks: ScheduleBlock[], t: number): number {
    return blocks.filter((b) => b.start <= t && b.end > t).reduce((s, b) => s + (db.points.get(b.pointId)?.kw ?? 0), 0);
  }

  private underPeak(p: { blocks: ScheduleBlock[] }, kw: number, start: number, end: number, hubId: string): boolean {
    const step = config().value("SCHEDULE_TIMESLOT");
    for (let t = start; t < end; t += step) if (this.loadAt(p.blocks, t) + kw > this.peakKw(hubId)) return false;
    return true;
  }

  /** - markUnserved(requests) : void — UC-11 E1: kept visible as an explicit shortfall. */
  private markUnserved(p: ScheduleProposal): void {
    for (const u of p.unserved) { const s = db.allocations.get(u.sessionId) as ChargingSession | undefined; if (s && !s.isCommittedReservation()) s.unserved = true; }
  }

  private kpis(p: ScheduleProposal): ScheduleProposal["kpis"] {
    const step = config().value("SCHEDULE_TIMESLOT");
    const measure = (blocks: ScheduleBlock[]) => {
      const waits = blocks.filter((b) => !b.committed && !b.locked).map((b) => { const s = db.allocations.get(b.sessionId) as ChargingSession; return Math.max(0, b.start - s.waitingSince); });
      let peak = 0;
      for (let t = p.horizon.start; t < p.horizon.end; t += step) peak = Math.max(peak, this.loadAt(blocks, t));
      return { serviced: blocks.length, avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / MINUTE) : 0, peakKw: peak };
    };
    const now = measure(p.current), next = measure(p.blocks);
    const queueNow = ChargingSession.getChargingQueue().filter((s) => s.hubId === p.hubId && !p.current.some((b) => b.sessionId === s.id)).length;
    const load: Array<{ t: number; proposed: number; current: number }> = [];
    for (let t = p.horizon.start; t < p.horizon.end; t += step) load.push({ t, proposed: this.loadAt(p.blocks, t), current: this.loadAt(p.current, t) });
    return { serviced: next.serviced, servicedWas: now.serviced, avgWait: next.avgWaitMin, avgWaitWas: now.avgWaitMin, peakKw: next.peakKw, peakKwWas: now.peakKw, limitKw: this.peakKw(p.hubId), unserved: p.unserved.length, unservedWas: queueNow, load };
  }

  /** openProposal() : ScheduleProposal — UC-11 step 8, E1. */
  openProposal(hubId: string): ScheduleProposal | null {
    const p = this.proposals.get(hubId);
    if (!p) return null;
    p.kpis = this.kpis(p);
    return p;
  }

  /** setEmergency(request, reason) : void — UC-11 step 9 / 7a: P = 1.0 with a justification, then re-allocate. */
  setEmergency(hubId: string, sessionId: string, reason: string, operatorId = "OP-014"): ScheduleProposal {
    if (!reason.trim()) throw new UserError("Give a justification for the emergency priority.", 422);
    const s = db.allocations.get(sessionId) as ChargingSession | undefined;
    if (!s || s.isCommittedReservation()) throw new UserError("Only a shared vehicle in the Charging Queue can get emergency priority.", 422);
    s.emergencyReason = reason.trim();
    s.setPriority(1);
    audit(operatorId, "UC-11 emergency priority", s.vehicleRef, "", reason);
    return this.generateSchedule(hubId, this.proposals.get(hubId)?.hours ?? 4);
  }

  /** - checkConstraints(move) : Violation — UC-11 E2. */
  private checkConstraints(p: ScheduleProposal, b: ScheduleBlock, pointId: string, start: number): string | null {
    const pt = db.points.get(pointId);
    if (!pt || pt.hubId !== p.hubId) return "Choose a charging point at this Hub.";
    if (pt.status === "Out of Service" || pt.status === "Disconnected") return `${pointId} is ${pt.status}.`;
    if (b.locked) return `${b.vehicleId} is already charging; it cannot be moved.`;
    const end = start + (b.end - b.start);
    if (b.committed && b.originalStart !== null) {
      if (start < b.originalStart) return `Cannot move ${b.sessionId} earlier than its paid start ${fmtHM(b.originalStart)} (BR-CHG-02).`;
      if (start > b.latestStart!) return `Cannot move ${b.sessionId} more than ${config().value("CHARGING_SHIFT_TOLERANCE") / MINUTE} min later (BR-CHG-02).`;
    }
    if (start < p.horizon.start) return "Outside the horizon.";
    if (!this.fits(p, pointId, start, end, b.sessionId)) return `${pointId} is taken at ${fmtHM(start)}.`;
    if (!this.underPeak({ blocks: p.blocks.filter((x) => x.sessionId !== b.sessionId) }, pt.kw, start, end, p.hubId)) return `The Hub would exceed its ${this.peakKw(p.hubId)} kW peak.`;
    return null;
  }

  /** moveBlock(block, point, slot) : Violation — UC-11 step 10, E2. */
  moveBlock(hubId: string, sessionId: string, pointId: string, start: number): { violation: string | null; proposal: ScheduleProposal } {
    const p = this.proposals.get(hubId);
    if (!p) throw new UserError("Generate a schedule first.", 409);
    const b = p.blocks.find((x) => x.sessionId === sessionId);
    if (!b) throw new UserError(`${sessionId} is not on the proposal.`, 404);
    const step = config().value("SCHEDULE_TIMESLOT");
    const at = Math.round(start / step) * step;
    const v = this.checkConstraints(p, b, pointId, at);
    if (v) { p.rejected = { sessionId, message: v }; return { violation: v, proposal: this.openProposal(hubId)! }; }
    const dur = b.end - b.start;
    b.pointId = pointId; b.start = at; b.end = at + dur; b.moved = true;
    p.rejected = null;
    return { violation: null, proposal: this.openProposal(hubId)! };
  }

  /** discardProposal() : void — UC-11 step 12. The committed schedule is untouched. */
  discardProposal(hubId: string): void {
    const p = this.proposals.get(hubId);
    if (p) for (const u of p.unserved) { const s = db.allocations.get(u.sessionId) as ChargingSession | undefined; if (s) s.unserved = false; }
    this.proposals.delete(hubId);
  }

  /** applySchedule(proposal) : ScheduleResult — UC-11 step 16, E4. */
  applySchedule(hubId: string, operatorId = "OP-014") {
    const p = this.proposals.get(hubId);
    if (!p) throw new UserError("There is no proposal to apply.", 409);
    return this.commitSchedule(p, operatorId);
  }

  /** commitSchedule(proposal) : ScheduleResult — also the UC-14 entry point; same checks and audit. */
  commitSchedule(p: ScheduleProposal, operatorId = "OP-014"): { applied: number; shifted: string[]; cancelled: string[]; version: number } {
    if (ChargingPoint.getActiveSchedule(p.hubId).version !== p.baseVersion) {
      this.proposals.delete(p.hubId);
      throw new UserError("Someone changed this Hub's schedule after the proposal was generated (E4). Generate it again.", 409, "E4");
    }
    const pts = this.hubPoints(p.hubId);
    const shifted: ChargingSession[] = [], cancelled: string[] = [];
    const live = p.blocks.filter((b) => !b.locked);
    for (const b of live) {
      const s = db.allocations.get(b.sessionId) as ChargingSession;
      const prev = s.slot ? { ...s.slot } : null;
      for (const pt of pts) pt.bookings = pt.bookings.filter((x) => x.ref !== s.id);
      if (s.isCommittedReservation()) {
        s.slot = { pointId: b.pointId, start: b.start, end: b.end };
        if (prev && (prev.start !== b.start || prev.pointId !== b.pointId)) { shifted.push(s); this.armGrace(s); }
      } else s.schedule({ pointId: b.pointId, start: b.start, end: b.end });
    }
    for (const pt of pts) pt.commit(live.map((b) => ({ sessionId: b.sessionId, pointId: b.pointId, start: b.start, end: b.end })));
    for (const u of p.unserved) {
      const s = db.allocations.get(u.sessionId) as ChargingSession | undefined;
      if (s?.isCommittedReservation() && s.status === "Scheduled") { this.cancelCommitted(s, "no point free within CHARGING_SHIFT_TOLERANCE"); cancelled.push(s.id); }
    }
    this.notifyShifted(shifted);
    iot().dispatchProfiles(pts.map((x) => x.id));
    this.proposals.delete(p.hubId);
    const version = ChargingPoint.getActiveSchedule(p.hubId).version;
    this.writeAuditLog(operatorId, p.hubId, version);
    bus.changed("schedule");
    return { applied: live.length, shifted: shifted.map((s) => s.id), cancelled, version };
  }

  private cancelCommitted(s: ChargingSession, why: string): void {
    s.cancel();
    this.graceTimers.get(s.id)?.cancel();
    this.payment.refund(s.id, s.studentId, s.fee, "Charging session");
    MobileApp.notify(s.studentId, "Charging session cancelled", `${s.id} could not be kept (${why}). It was cancelled and ${vnd(s.fee)} will be refunded (BR-CHG-02, BR-PAY-02).`, "danger", s.id);
  }

  /** - notifyShifted(students) : void — a shift is never silent (BR-CHG-02). */
  private notifyShifted(sessions: ChargingSession[]): void {
    for (const s of sessions) {
      const orig = s.originalStart ?? s.slot!.start;
      MobileApp.notify(s.studentId, "Charging session moved", `Your charging session ${s.id} moved from ${fmtHM(orig)} to ${fmtHM(s.slot!.start)} at ${s.slot!.pointId} (within ${config().value("CHARGING_SHIFT_TOLERANCE") / MINUTE} min${s.neededBy ? `, before your needed-by ${fmtHM(s.neededBy)}` : ""}).`, "info", s.id);
    }
  }

  /** - writeAuditLog() : void — who committed which schedule version and when. */
  private writeAuditLog(operatorId: string, hubId: string, version: number): void {
    audit(operatorId, "UC-11 schedule applied", hubId, "", `version ${version}`);
  }

  /**
   * pointFault(point : ChargingPoint) : void — UC-11 E3. Out of Service, sessions stopped, an
   * incident opened; each paid student session is moved within BR-CHG-02 or cancelled with a
   * refund; shared vehicles go back to the queue and a 1a proposal is generated.
   */
  pointFault(pointId: string, why = "reported a hardware fault"): { incidentId: string; moved: string[]; cancelled: string[] } {
    const pt = db.points.get(pointId);
    if (!pt) throw new UserError(`Unknown charging point ${pointId}`, 404);
    const inc = Incident.findOrOpen(pt, "charging point unavailable or faulty", `${pointId} ${why} (UC-11 E3).`, "system");
    pt.noteFault(inc.id);
    return { incidentId: inc.id, ...this.reschedulePoint(pt, why) };
  }

  /** Shared by UC-11 E3 and a UC-12 block on a charging point (TC-UC12-06 a). */
  reschedulePoint(pt: ChargingPoint, why: string): { moved: string[]; cancelled: string[] } {
    const committedBefore = new Map<string, Slot>();
    for (const a of db.allocations.values()) if (a instanceof ChargingSession && a.slot?.pointId === pt.id) committedBefore.set(a.id, { ...a.slot });
    const hit = ChargingSession.stopSessions(pt);
    const moved: string[] = [], cancelled: string[] = [];
    const tol = config().value("CHARGING_SHIFT_TOLERANCE");
    for (const s of hit.filter((x) => x.isCommittedReservation())) {
      const was = committedBefore.get(s.id);
      const start = s.originalStart ?? was?.start ?? clock().now();
      const dur = was ? was.end - was.start : 60 * MINUTE;
      let spot: Slot | null = null;
      for (const other of this.hubPoints(pt.hubId).filter((x) => x.id !== pt.id)) {
        spot = other.findFreeSlot({ from: start, to: start + tol + dur, durationMs: dur });
        if (spot) { other.book(spot, s.id); other.scheduleVersion++; break; }
      }
      if (spot) { s.slot = spot; s.setStatus("Scheduled", `moved off ${pt.id}`); this.armGrace(s); this.notifyShifted([s]); moved.push(s.id); }
      else { this.cancelCommitted(s, `${pt.id} ${why} and no point is free within ${tol / MINUTE} min`); cancelled.push(s.id); }
    }
    pt.scheduleVersion++;
    const sharedHit = hit.some((x) => !x.isCommittedReservation());
    OperatorConsole.warn(`${pt.id} is Out of Service (${why}). ${hit.length} session(s) stopped: ${moved.length} moved, ${cancelled.length} cancelled${sharedHit ? "; shared vehicles back in the queue — review the 1a proposal" : ""}.`, pt.hubId, "Charging point fault (E3)");
    if (sharedHit && !db.hubs.get(pt.hubId)!.isStale()) this.generateSchedule(pt.hubId);
    pt.reevaluate();
    bus.changed("schedule");
    return { moved, cancelled };
  }
}
