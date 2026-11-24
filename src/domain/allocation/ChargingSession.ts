// domain.allocation — ChargingSession (entity method descriptions 2.6). One class for both
// lifecycles, separated by `kind` (class-diagram.md 4.3):
//  committed reservation : Pending Payment, Payment Failed, Scheduled, Charging, Completed, Expired, Cancelled by System
//  Charging Queue request : Waiting, Scheduled, Charging, Completed
import { db, nextId } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Allocation } from "./Allocation";
import type { AllocationOutcome, SessionKind, Slot, TimeWindow } from "../types";
import type { Hub } from "../network/Hub";
import type { ChargingPoint } from "../network/ChargingPoint";

export class ChargingSession extends Allocation {
  readonly kind = "ChargingSession" as const;
  priority: number | null = null;
  emergencyReason: string | null = null;
  slot: Slot | null = null;
  /** BR-CHG-02: delay is measured against the original confirmed start. */
  originalStart: number | null = null;
  waitingSince: number;
  unserved = false;
  /** Private sessions: the student's window and target. */
  window: TimeWindow | null = null;
  neededBy: number | null = null;
  targetSoc = 80;
  energyKwh = 0;

  constructor(
    id: string, studentId: string,
    public readonly sessionKind: SessionKind,
    /** pointId for a private session; vehicleId for a shared request (the vehicle is what waits). */
    resourceId: string, hubId: string,
    public readonly vehicleRef: string,
  ) {
    super(id, studentId, resourceId, hubId, sessionKind === "committed reservation" ? "Pending Payment" : "Waiting");
    this.waitingSince = clock().now();
  }

  get pointId(): string | null { return this.slot?.pointId ?? null; }

  protected activeStatuses(): string[] { return ["Pending Payment", "Waiting", "Scheduled", "Charging"]; }

  /** isCommittedReservation() : boolean */
  isCommittedReservation(): boolean {
    return this.sessionKind === "committed reservation";
  }

  /** Scheduled, not Confirmed, is what a paid private session becomes (Table 2.3-4). */
  confirm(transactionRef: string): void {
    this.transactionRef = transactionRef;
    this.setStatus("Scheduled");
    if (this.slot) {
      this.originalStart = this.slot.start;
      this.expiresAt = this.slot.start + config().value("CHARGING_START_GRACE");
    }
  }

  /**
   * static getChargingQueue() : ChargingSession[*] — shared requests waiting for a slot, in
   * priority order (BR-CHG-01 tie-break: higher P, lower SoC, older). BR-RES-01 puts every
   * docked vehicle in "Waiting for Charge" into the queue; the queue is kept in step here.
   */
  static getChargingQueue(): ChargingSession[] {
    for (const v of db.vehicles.values()) {
      const waiting = v.status === "Waiting for Charge" || v.status === "Interrupted";
      if (!waiting) continue;
      const has = [...db.allocations.values()].some((a) => a instanceof ChargingSession && !a.isCommittedReservation() && a.vehicleRef === v.id && a.isActive());
      if (!has) {
        const s = new ChargingSession(nextId("CQ"), "system", "Charging Queue request", v.id, v.hubId, v.id);
        s.waitingSince = v.lowSince ?? clock().now();
        db.allocations.set(s.id, s);
      }
    }
    const socOf = (s: ChargingSession) => db.vehicles.get(s.vehicleRef)?.soc ?? 100;
    return [...db.allocations.values()]
      .filter((a): a is ChargingSession => a instanceof ChargingSession && !a.isCommittedReservation() && a.status === "Waiting")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || socOf(a) - socOf(b) || a.waitingSince - b.waitingSince);
  }

  /** static getSessions(hub : Hub, horizon : Horizon) : ChargingSession[*] — committed at a Hub. UC-11 step 7. */
  static getSessions(hub: Hub, horizon: TimeWindow): ChargingSession[] {
    return [...db.allocations.values()].filter((a): a is ChargingSession =>
      a instanceof ChargingSession && a.hubId === hub.id && !!a.slot && ["Pending Payment", "Scheduled", "Charging"].includes(a.status)
      && a.slot.start < horizon.end && a.slot.end > horizon.start);
  }

  /** static stopSessions(point : ChargingPoint) : ChargingSession[*] — UC-11 E3. */
  static stopSessions(point: ChargingPoint): ChargingSession[] {
    const hit = [...db.allocations.values()].filter((a): a is ChargingSession =>
      a instanceof ChargingSession && a.pointId === point.id && ["Scheduled", "Charging"].includes(a.status));
    for (const s of hit) {
      const wasCharging = s.status === "Charging";
      point.releaseHold(s.slot, s.id);
      if (!s.isCommittedReservation()) {
        const v = db.vehicles.get(s.vehicleRef);
        if (v && wasCharging) v.energy = "Interrupted";
        s.slot = null;
        s.setStatus("Waiting", `${point.id} failed`);
      } else {
        s.slot = null;
        s.setStatus("Scheduled", `${point.id} failed — needs a new slot`);
      }
    }
    point.activeSessionId = null;
    return hit;
  }

  /** setPriority(value : double) : void — UC-11 step 9. */
  setPriority(value: number): void {
    this.priority = Math.round(value * 1000) / 1000;
  }

  /** schedule(slot : Slot) : void — assigned when the proposal is committed. UC-11 step 16. */
  schedule(slot: Slot): void {
    this.slot = slot;
    this.unserved = false;
    if (this.originalStart === null) this.originalStart = slot.start;
    this.setStatus("Scheduled");
    if (this.isCommittedReservation()) this.expiresAt = slot.start + config().value("CHARGING_START_GRACE");
    const v = db.vehicles.get(this.vehicleRef);
    if (v && v.energy === "Interrupted") { v.energy = "Low Battery"; v.reevaluate(); }
  }

  /** Charging starts (NIFR-04, reported by the IoT feed). */
  start(point: ChargingPoint): void {
    this.setStatus("Charging");
    point.activeSessionId = this.id;
    point.reevaluate();
    const v = db.vehicles.get(this.vehicleRef);
    if (v && !this.isCommittedReservation()) v.energy = "Charging";
  }

  /** complete() : void — charging finished, or the vehicle left with a redistribution order. */
  complete(): void {
    this.setStatus("Completed");
    const p = this.pointId ? db.points.get(this.pointId) : undefined;
    if (p) {
      if (p.activeSessionId === this.id) p.activeSessionId = null;
      p.bookings = p.bookings.filter((b) => b.ref !== this.id || b.end <= clock().now());
      p.reevaluate();
    }
    const v = db.vehicles.get(this.vehicleRef);
    if (v && !this.isCommittedReservation()) { v.energy = "Sufficient"; v.reevaluate(); }
  }

  /** cancel() : void — BR-CHG-02 cannot keep it; the controller refunds and notifies. UC-11 E3. */
  cancel(): void {
    const p = this.pointId ? db.points.get(this.pointId) : undefined;
    if (p) p.releaseHold(this.slot, this.id);
    this.setStatus("Cancelled by System");
  }

  /** Charging sessions are moved by UC-11 under BR-CHG-02, not by BR-RES-02. */
  moveOrCancel(): AllocationOutcome {
    return { allocationId: this.id, outcome: "awaiting", detail: "handed to UC-11 rescheduling (BR-CHG-02)" };
  }
}
