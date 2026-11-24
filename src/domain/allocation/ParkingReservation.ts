// domain.allocation — ParkingReservation (entity method descriptions 2.5). Status values:
// Pending Payment, Confirmed, Checked-in, Completed, Payment Failed, Expired, Cancelled by System.
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { Allocation } from "./Allocation";
import type { AllocationOutcome, ParkingReservationStatus, TimeWindow } from "../types";

export class ParkingReservation extends Allocation {
  readonly kind = "ParkingReservation" as const;
  declare status: ParkingReservationStatus;
  checkedInAt: number | null = null;
  movedFrom: string | null = null;

  constructor(id: string, studentId: string, spaceId: string, hubId: string, public readonly window: TimeWindow, public readonly privateVehicleId: string) {
    super(id, studentId, spaceId, hubId, "Pending Payment");
  }

  get spaceId(): string { return this.resourceId; }

  protected activeStatuses(): string[] { return ["Pending Payment", "Confirmed", "Checked-in"]; }

  /** Expired once CHECKIN_GRACE after the planned arrival has passed without a check-in (NIFR-03). */
  confirm(transactionRef: string): void {
    super.confirm(transactionRef);
    this.expiresAt = this.window.start + config().value("CHECKIN_GRACE");
  }

  /** checkIn(at : DateTime) : boolean — inside CHECKIN_GRACE? UC-04 step 14. */
  checkIn(at: number): boolean {
    if (this.status !== "Confirmed") return false;
    if (at > this.window.start + config().value("CHECKIN_GRACE")) return false;
    this.checkedInAt = at;
    this.setStatus("Checked-in");
    return true;
  }

  /**
   * moveOrCancel() — BR-RES-02 for parking: same window, Free start to end, on another
   * space of the same type at the same Hub; never moves a Checked-in vehicle.
   */
  moveOrCancel(): AllocationOutcome {
    if (this.status === "Checked-in") return { allocationId: this.id, outcome: "awaiting", detail: "vehicle is checked in; staff handle it on site" };
    if (this.status === "Pending Payment") return { allocationId: this.id, outcome: "awaiting", detail: "payment still pending" };
    const old = db.spaces.get(this.spaceId)!;
    const repl = [...db.spaces.values()].find((s) => s.id !== old.id && s.hubId === this.hubId && s.findFreeInServiceSpace(old.type, this.window));
    if (repl) {
      repl.book(this.window, this.id);
      old.releaseHold(this.window, this.id);
      this.movedFrom = old.label;
      this.resourceId = repl.id;
      this.version++;
      this.history.push({ time: this.window.start, status: this.status, note: `moved from ${old.label} to ${repl.label}` });
      return { allocationId: this.id, outcome: "moved", detail: `moved to space ${repl.label}` };
    }
    old.releaseHold(this.window, this.id);
    this.setStatus("Cancelled by System", "no free space of the same type");
    return { allocationId: this.id, outcome: "cancelled", detail: "no other space free for the window" };
  }
}
