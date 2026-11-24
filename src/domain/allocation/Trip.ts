// domain.allocation — Trip (entity method descriptions 2.7). TripStatus Open/Closed,
// FareStatus Unpaid/Paid/Waived (Table 2.3-5).
import { clock } from "../../platform/clock/DemoClock";
import { Allocation } from "./Allocation";
import type { AllocationOutcome, FareStatus, Telemetry, TripStatus } from "../types";

export class Trip extends Allocation {
  readonly kind = "Trip" as const;
  declare status: TripStatus;
  readonly startTime: number;
  endTime: number | null = null;
  endHubId: string | null = null;
  endDock: string | null = null;
  fare = 0;
  fareStatus: FareStatus | null = null;
  fareBreakdown: Array<{ label: string; amount: number }> = [];
  distanceKm = 0;
  endSoc: number | null = null;
  /** UC-12 8c: the operator-accepted breakdown time. */
  closedByIncident: string | null = null;

  constructor(id: string, studentId: string, vehicleId: string, hubId: string, public readonly reservationId: string | null,
    public readonly startSoc: number, public readonly startOdometerKm: number, public readonly startDock: string) {
    super(id, studentId, vehicleId, hubId, "Open");
    this.startTime = clock().now();
  }

  get vehicleId(): string { return this.resourceId; }

  protected activeStatuses(): string[] { return ["Open"]; }

  /** getStatus() : TripStatus — UC-08 step 5. */
  getStatus(): TripStatus {
    return this.status;
  }

  /** close(telemetry : Telemetry) : void — UC-08 step 6. */
  close(t: Telemetry): void {
    this.endTime = t.at;
    this.endSoc = t.soc;
    this.distanceKm = Math.max(0, Math.round((t.odometerKm - this.startOdometerKm) * 10) / 10);
    this.setStatus("Closed");
  }

  /** setFare(status : FareStatus) : void — Unpaid blocks new bookings (BR-PAY-04). */
  setFare(status: FareStatus): void {
    this.fareStatus = status;
    this.version++;
    this.history.push({ time: clock().now(), status: this.status, note: `fare ${status}` });
  }

  /** closeTrip(reportTime : DateTime) : void — UC-12 8c: closed at the verified breakdown time. */
  closeTrip(reportTime: number): void {
    this.endTime = reportTime;
    this.setStatus("Closed", "closed at the verified breakdown time");
  }

  /** An active trip is never ended by an incident alone (BR-INC-01). */
  moveOrCancel(): AllocationOutcome {
    return { allocationId: this.id, outcome: "awaiting", detail: "trip stays active until return or a verified breakdown (8c)" };
  }
}
