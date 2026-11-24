// domain.allocation — Allocation (entity method descriptions 2.3). Everything a student
// holds on a resource. UC-12 works on this type, not on the four subclasses.
import { db } from "../store";
import { clock } from "../../platform/clock/DemoClock";
import type { AllocationOutcome } from "../types";

export type AllocationKind = "VehicleReservation" | "ParkingReservation" | "ChargingSession" | "Trip";

export abstract class Allocation {
  abstract readonly kind: AllocationKind;
  /** The allowed values differ per subclass; each subclass's state chart fixes its set. */
  status: string;
  /** Optimistic concurrency, UC-11 and UC-12. */
  version = 1;
  transactionRef: string | null = null;
  paymentId: string | null = null;
  fee = 0;
  expiresAt: number | null = null;
  readonly createdAt: number;
  readonly history: Array<{ time: number; status: string; note?: string }> = [];

  constructor(public readonly id: string, public readonly studentId: string, public resourceId: string, public hubId: string, initial: string) {
    this.status = initial;
    this.createdAt = clock().now();
    this.history.push({ time: this.createdAt, status: initial });
  }

  /** The statuses in which this allocation still holds its resource. */
  protected abstract activeStatuses(): string[];

  isActive(): boolean {
    return this.activeStatuses().includes(this.status);
  }

  /** static findActive(resourceId : String) : Allocation[*] — UC-12 step 6. */
  static findActive(resourceId: string): Allocation[] {
    return [...db.allocations.values()].filter((a) => a.resourceId === resourceId && a.isActive());
  }

  /** setStatus(status : String) : void */
  setStatus(status: string, note?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.version++;
    this.history.push({ time: clock().now(), status, note });
  }

  /** confirm(transactionRef : String) : void — Pending Payment to Confirmed. */
  confirm(transactionRef: string): void {
    this.transactionRef = transactionRef;
    this.setStatus("Confirmed");
  }

  /** moveOrCancel() : AllocationOutcome — UC-12 step 6. */
  abstract moveOrCancel(): AllocationOutcome;

  /** isExpired() : boolean */
  isExpired(): boolean {
    return this.expiresAt !== null && clock().now() > this.expiresAt;
  }
}
