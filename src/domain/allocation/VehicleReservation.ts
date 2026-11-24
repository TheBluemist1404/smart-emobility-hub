// domain.allocation — VehicleReservation (entity method descriptions 2.4). Status values:
// Pending Payment, Confirmed, Pickup In Progress, Fulfilled, Payment Failed, Expired,
// Cancelled by System (Table 2.3-2).
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Allocation } from "./Allocation";
import { Vehicle } from "../network/Vehicle";
import type { AllocationOutcome, VehicleReservationStatus } from "../types";

export class VehicleReservation extends Allocation {
  readonly kind = "VehicleReservation" as const;
  declare status: VehicleReservationStatus;
  /** Set after a BR-RES-02 move, for the student's message. */
  movedFrom: string | null = null;

  constructor(id: string, studentId: string, vehicleId: string, hubId: string) {
    super(id, studentId, vehicleId, hubId, "Pending Payment");
  }

  get vehicleId(): string { return this.resourceId; }

  protected activeStatuses(): string[] { return ["Pending Payment", "Confirmed", "Pickup In Progress"]; }

  /** static findConfirmed(studentId, vehicleId) : VehicleReservation — null means walk-up. UC-07 step 3, 4a. */
  static findConfirmed(studentId: string, vehicleId?: string): VehicleReservation | null {
    return ([...db.allocations.values()].find((a) => a instanceof VehicleReservation && a.studentId === studentId
      && (a.status === "Confirmed" || a.status === "Pickup In Progress") && (!vehicleId || a.vehicleId === vehicleId)) as VehicleReservation) ?? null;
  }

  /** confirm — the pickup expiry (VEHICLE_RESERVATION_HOLD) starts now. UC-02 step 6. */
  confirm(transactionRef: string): void {
    super.confirm(transactionRef);
    this.expiresAt = clock().now() + config().value("VEHICLE_RESERVATION_HOLD");
  }

  /** endPickup() : void — back to Confirmed while the expiry is ahead, else Expired. UC-07 4b, E2, E3. */
  endPickup(): void {
    if (this.status !== "Pickup In Progress") return;
    this.setStatus(this.isExpired() ? "Expired" : "Confirmed", "pickup ended");
  }

  /** moveTo(replacementId : String) : void — same booking and fee, new pickup expiry. BR-RES-02. */
  moveTo(replacementId: string): void {
    this.movedFrom = this.resourceId;
    this.resourceId = replacementId;
    this.expiresAt = clock().now() + config().value("VEHICLE_RESERVATION_HOLD");
    this.version++;
    this.setStatus("Confirmed", `moved from ${this.movedFrom}`);
    this.history.push({ time: clock().now(), status: "Confirmed", note: `moved from ${this.movedFrom} to ${replacementId}` });
  }

  /**
   * moveOrCancel() — BR-RES-02: secure an Available vehicle of the same type at the same Hub
   * (set "Reserved") before releasing the original; otherwise "Cancelled by System".
   * The refund (BR-PAY-02) is requested by the calling controller.
   */
  moveOrCancel(): AllocationOutcome {
    const old = db.vehicles.get(this.vehicleId)!;
    const hub = db.hubs.get(this.hubId)!;
    if (this.status === "Pending Payment") return { allocationId: this.id, outcome: "awaiting", detail: "payment still pending" };
    const repl = Vehicle.findReplacement(hub, old.type, old.id);
    if (repl) {
      repl.holdIfAvailable(this.studentId);
      repl.reserve();
      this.moveTo(repl.id);
      old.releaseHold();
      return { allocationId: this.id, outcome: "moved", detail: `moved to ${repl.id}` };
    }
    this.setStatus("Cancelled by System", "no same-type replacement");
    old.releaseHold();
    return { allocationId: this.id, outcome: "cancelled", detail: "no same-type vehicle free at the Hub" };
  }
}
