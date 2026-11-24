// domain.network — ParkingSpace (entity method descriptions 1.6). Space service state
// (SpaceStatus) and window state (WindowState) are separate, which is why UC-04 tests both.
import { db } from "../store";
import { clock } from "../../platform/clock/DemoClock";
import { Resource } from "./Resource";
import { overlaps, type Booking, type SpaceStatus, type TimeWindow, type VehicleType } from "../types";
import type { Hub } from "./Hub";

export interface Availability { hubId: string; type: VehicleType; free: number; total: number; measuredAt: number; stale: boolean }
export interface Alternative { hubId: string; window: TimeWindow; freeSpaces: number; note: string }

export class ParkingSpace extends Resource {
  readonly kind = "ParkingSpace" as const;
  private _status: SpaceStatus = "In Service";
  windows: Booking[] = [];

  constructor(id: string, hubId: string, public readonly label: string, public readonly type: VehicleType, lastUpdateTime: number) {
    super(id, hubId, lastUpdateTime);
  }

  get status(): SpaceStatus { return this._status; }

  /** static getAvailability(hubs : Hub[*]) : Availability[*] — UC-04 step 3, E1. Free = no window right now. */
  static getAvailability(hubs: Hub[], at = clock().now()): Availability[] {
    const out: Availability[] = [];
    for (const h of hubs) {
      for (const type of ["electric bicycle", "electric motorcycle"] as VehicleType[]) {
        const sp = [...db.spaces.values()].filter((s) => s.hubId === h.id && s.type === type);
        if (!sp.length) continue;
        const now = { start: at, end: at + 60_000 };
        out.push({
          hubId: h.id, type, total: sp.length,
          free: sp.filter((s) => s.status === "In Service" && s.isFree(now)).length,
          measuredAt: h.lastUpdateTime, stale: h.isStale(),
        });
      }
    }
    return out;
  }

  isFree(w: TimeWindow): boolean {
    return !this.windows.some((b) => b.state !== "Free" && overlaps(b, w));
  }

  /** findFreeInServiceSpace(type : VehicleType, window : TimeWindow) : boolean — UC-04 steps 3, 6, 9, E6. */
  findFreeInServiceSpace(type: VehicleType, window: TimeWindow): boolean {
    return this.status === "In Service" && !this.hasBlockingIncident() && this.type === type && this.isFree(window);
  }

  /** suggestAlternatives(window : TimeWindow) : Alternative[*] — UC-04 E1: other Hubs, then adjacent windows. */
  suggestAlternatives(window: TimeWindow): Alternative[] {
    const out: Alternative[] = [];
    const spaces = [...db.spaces.values()];
    for (const h of db.hubs.values()) {
      if (h.id === this.hubId || h.isStale()) continue;
      const n = spaces.filter((s) => s.hubId === h.id && s.findFreeInServiceSpace(this.type, window)).length;
      if (n) out.push({ hubId: h.id, window, freeSpaces: n, note: `${n} free for the same window` });
    }
    const dur = window.end - window.start;
    for (const shift of [60, 120].map((m) => m * 60_000)) {
      const w = { start: window.start + shift, end: window.start + shift + dur };
      const n = spaces.filter((s) => s.hubId === this.hubId && s.findFreeInServiceSpace(this.type, w)).length;
      if (n) out.push({ hubId: this.hubId, window: w, freeSpaces: n, note: `${shift / 3_600_000} h later at the same Hub` });
    }
    return out.sort((a, b) => b.freeSpaces - a.freeSpaces).slice(0, 4);
  }

  /** holdIfFree(window : TimeWindow) : boolean — atomic hold before payment. UC-04 step 10. */
  holdIfFree(window: TimeWindow, ref: string): boolean {
    if (!this.findFreeInServiceSpace(this.type, window)) return false;
    this.windows.push({ ...window, state: "Held", ref });
    return true;
  }

  /** releaseHold(window : TimeWindow) : void — the window is "Free" again (BR-RES-01). */
  releaseHold(_window: TimeWindow | null, ref: string): void {
    this.windows = this.windows.filter((b) => b.ref !== ref);
  }

  /** book(window : TimeWindow) : void — Held becomes Booked after payment. UC-04 step 13. */
  book(window: TimeWindow, ref: string): void {
    const b = this.windows.find((x) => x.ref === ref);
    if (b) b.state = "Booked";
    else this.windows.push({ ...window, state: "Booked", ref });
  }

  /** setStatus(status : SpaceStatus) : void — UC-12 step 7. */
  setStatus(status: SpaceStatus): void {
    this._status = status;
  }

  reevaluate(): void {
    this.blockedBy = this.blocks.size ? [...this.blocks][0] : null;
    this._status = this.hasBlockingIncident() ? "Out of Service" : "In Service";
  }
}
