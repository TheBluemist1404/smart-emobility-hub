// domain.network — ChargingPoint (entity method descriptions 1.5).
// Hardware state (PointStatus) is kept apart from the Held/Booked state of its slots
// (WindowState), as Table 2.3-5 requires.
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Resource } from "./Resource";
import { overlaps, type Booking, type PointStatus, type Slot, type TimeWindow } from "../types";
import type { Hub } from "./Hub";

export interface ChargingRequestWindow { from: number; to: number; durationMs: number }
export interface Schedule { version: number; blocks: Array<Booking & { pointId: string }> }
export interface ScheduleAssignment { sessionId: string; pointId: string; start: number; end: number }
export interface ScheduleProposalLike { baseVersion: number; assignments: ScheduleAssignment[] }

export class ChargingPoint extends Resource {
  readonly kind = "ChargingPoint" as const;
  private _status: PointStatus = "Available";
  bookings: Booking[] = [];
  scheduleVersion = 1;
  /** Session currently drawing power (NIFR-04 says "charging started"). */
  activeSessionId: string | null = null;

  constructor(id: string, hubId: string, public readonly power: "AC 7 kW" | "DC 22 kW", lastUpdateTime: number) {
    super(id, hubId, lastUpdateTime);
  }

  get kw(): number { return this.power === "AC 7 kW" ? 7 : 22; }
  get status(): PointStatus { return this._status; }

  /** static getStatus(hubs : Hub[*]) : PointStatus[*] — UC-05 step 2. */
  static getStatus(hubs: Hub[]): Array<{ pointId: string; hubId: string; status: PointStatus; power: string; busyUntil: number | null; updatedAt: number; stale: boolean }> {
    const ids = new Set(hubs.map((h) => h.id));
    return [...db.points.values()].filter((p) => ids.has(p.hubId)).map((p) => ({
      pointId: p.id, hubId: p.hubId, status: p.status, power: p.power, busyUntil: p.busyUntil(), updatedAt: p.lastUpdateTime, stale: p.isStale(),
    }));
  }

  /** static getActiveSchedule() : Schedule — UC-11 step 2. */
  static getActiveSchedule(hubId?: string): Schedule {
    const pts = [...db.points.values()].filter((p) => !hubId || p.hubId === hubId);
    return {
      version: pts.reduce((s, p) => s + p.scheduleVersion, 0),
      blocks: pts.flatMap((p) => p.bookings.map((b) => ({ ...b, pointId: p.id }))),
    };
  }

  busyUntil(): number | null {
    const now = clock().now();
    const cur = this.bookings.find((b) => b.start <= now && b.end > now && b.state !== "Free");
    return cur ? cur.end : null;
  }

  isFree(w: TimeWindow): boolean {
    return !this.bookings.some((b) => b.state !== "Free" && overlaps(b, w));
  }

  /** getPointsAndSlots(horizon : Horizon) : Slot[*] — the free timeslots over a horizon. UC-11 step 7. */
  getPointsAndSlots(horizon: TimeWindow): Slot[] {
    const step = config().value("SCHEDULE_TIMESLOT");
    const out: Slot[] = [];
    if (this.status === "Out of Service" || this.status === "Disconnected") return out;
    for (let t = Math.ceil(horizon.start / step) * step; t + step <= horizon.end; t += step) {
      const s = { pointId: this.id, start: t, end: t + step };
      if (this.isFree(s)) out.push(s);
    }
    return out;
  }

  /** findFreeSlot(request : ChargingRequest) : Slot — null is UC-05 E1. */
  findFreeSlot(req: ChargingRequestWindow): Slot | null {
    if (this.status === "Out of Service" || this.status === "Disconnected" || this.hasBlockingIncident()) return null;
    const step = config().value("SCHEDULE_TIMESLOT");
    const dur = Math.ceil(req.durationMs / step) * step;
    for (let t = Math.ceil(req.from / step) * step; t + dur <= req.to; t += step) {
      const s = { pointId: this.id, start: t, end: t + dur };
      if (this.isFree(s)) return s;
    }
    return null;
  }

  /** holdIfFree(slot : Slot) : boolean — atomic hold before payment. UC-05 step 10. */
  holdIfFree(slot: Slot, ref: string): boolean {
    if (!this.isFree(slot) || this.status === "Out of Service" || this.status === "Disconnected") return false;
    this.bookings.push({ start: slot.start, end: slot.end, state: "Held", ref });
    return true;
  }

  /** releaseHold(slot : Slot) : void — UC-05 E2/E8. */
  releaseHold(slot: Slot | null, ref: string): void {
    this.bookings = this.bookings.filter((b) => !(b.ref === ref && (!slot || b.start === slot.start)));
    this.reevaluate();
  }

  /** book(slot : Slot) : void — Held becomes Booked after payment. UC-05 step 13. */
  book(slot: Slot, ref: string): void {
    const b = this.bookings.find((x) => x.ref === ref && x.start === slot.start);
    if (b) b.state = "Booked";
    else this.bookings.push({ start: slot.start, end: slot.end, state: "Booked", ref });
  }

  /** verifyVersion(baseVersion : int) : boolean — UC-11 step 16, E4. */
  verifyVersion(baseVersion: number): boolean {
    return this.scheduleVersion === baseVersion;
  }

  /** commit(proposal : ScheduleProposal) : void — writes this point's part and bumps the version. */
  commit(assignments: ScheduleAssignment[]): void {
    for (const a of assignments.filter((x) => x.pointId === this.id)) {
      this.bookings = this.bookings.filter((b) => b.ref !== a.sessionId);
      this.bookings.push({ start: a.start, end: a.end, state: "Booked", ref: a.sessionId });
    }
    this.scheduleVersion++;
  }

  /** setStatus(status : PointStatus) : void — UC-11 E3 / E5. */
  setStatus(status: PointStatus): void {
    this._status = status;
  }

  /** BR-RES-01 for a charging point. */
  reevaluate(): void {
    this.blockedBy = this.blocks.size ? [...this.blocks][0] : null;
    if (this.hasBlockingIncident()) this._status = "Out of Service";
    else if (this.isStale()) this._status = "Disconnected";
    else this._status = this.activeSessionId ? "In Use" : "Available";
  }
}
