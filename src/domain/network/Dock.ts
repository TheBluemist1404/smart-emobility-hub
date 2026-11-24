// domain.network — Dock (entity method descriptions 1.4).
import { db } from "../store";
import { clock } from "../../platform/clock/DemoClock";
import { Resource } from "./Resource";
import type { DockStatus } from "../types";
import type { Hub } from "./Hub";

export class Dock extends Resource {
  readonly kind = "Dock" as const;
  private _status: DockStatus = "Vacant";
  /** The raw latch sensor bit (class-diagram.md 5.2). */
  latched = false;
  vehicleId: string | null = null;
  /** Set while the dock is kept for an incoming redistribution transfer (UC-10 step 10). */
  allocatedTo: string | null = null;
  unlockPending = false;

  constructor(id: string, hubId: string, public readonly label: string, lastUpdateTime: number) {
    super(id, hubId, lastUpdateTime);
  }

  get status(): DockStatus { return this._status; }

  /** static findVacant(hub : Hub) : Dock[*] — UC-08 step 2, E1. Excludes Allocated and Out of Service. */
  static findVacant(hub: Hub): Dock[] {
    return [...db.docks.values()].filter((d) => d.hubId === hub.id && d.status === "Vacant");
  }

  /** setStatus(status : DockStatus) : void */
  setStatus(status: DockStatus): void {
    this._status = status;
  }

  /**
   * requestUnlock() : UnlockResult — the dock side of UC-07 step 9. Marks the request as
   * outstanding; the explicit Success/Failure arrives through IoTDataGateway.requestUnlock.
   */
  requestUnlock(): { dockId: string; vehicleId: string | null; requestedAt: number } {
    this.unlockPending = true;
    return { dockId: this.id, vehicleId: this.vehicleId, requestedAt: clock().now() };
  }

  /** BR-RES-01 for a dock: Out of Service while blocked or faulted, else by allocation and latch. */
  reevaluate(): void {
    if (this.hasBlockingIncident()) this._status = "Out of Service";
    else if (this.latched) this._status = "Occupied";
    else if (this.allocatedTo) this._status = "Allocated";
    else this._status = "Vacant";
  }
}
