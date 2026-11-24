// domain.network — Resource (entity method descriptions 1.2). The abstract superclass of
// everything an incident can hit: Vehicle, Dock, ChargingPoint, ParkingSpace.
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import type { ResourceStatus } from "../types";

export type ResourceKind = "Vehicle" | "Dock" | "ChargingPoint" | "ParkingSpace";

export abstract class Resource {
  abstract readonly kind: ResourceKind;
  /** The incident that blocked this resource (UC-12 step 6). By ID, never by object (dev view 5.2). */
  blockedBy: string | null = null;
  /**
   * Other unresolved incidents BR-RES-01 must respect: a system-detected hardware fault
   * (UC-07 E3, UC-11 E3) or a vehicle-failure report not yet confirmed (UC-06).
   * MVP detail: the design keeps only blockedBy; this set is how the entity "knows" the
   * incidents without importing domain.operations.
   */
  readonly faults = new Set<string>();
  readonly blocks = new Set<string>();

  constructor(public readonly id: string, public hubId: string, public lastUpdateTime: number) {}

  abstract get status(): string;

  /** getLatestStatus() : ResourceStatus — UC-12 step 4, E1. */
  getLatestStatus(): ResourceStatus {
    return { status: this.status, confirmedAt: this.lastUpdateTime, stale: this.isStale() };
  }

  /** block(incidentId : String) : void — UC-12 step 6. Only an operator decision calls this. */
  block(incidentId: string): void {
    this.blocks.add(incidentId);
    this.blockedBy = incidentId;
    this.reevaluate();
  }

  /** MVP helper used by Incident.resolve/dismiss before reevaluate(). */
  clearIncident(incidentId: string): void {
    this.blocks.delete(incidentId);
    this.faults.delete(incidentId);
    this.blockedBy = this.blocks.size ? [...this.blocks][0] : null;
  }

  /** MVP helper: an unresolved fault incident that BR-RES-01 must respect. */
  noteFault(incidentId: string): void {
    this.faults.add(incidentId);
    this.reevaluate();
  }

  hasBlockingIncident(): boolean {
    return this.blocks.size > 0 || this.faults.size > 0;
  }

  /** reevaluate() : void — BR-RES-01, implemented per subclass. */
  abstract reevaluate(): void;

  /** isStale() : boolean — lastUpdateTime older than DATA_STALE_AFTER. */
  isStale(): boolean {
    return clock().now() - this.lastUpdateTime > config().value("DATA_STALE_AFTER");
  }
}
