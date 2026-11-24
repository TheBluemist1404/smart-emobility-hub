// domain.operations — VehicleTransfer (entity method descriptions 3.5). TransferStatus:
// Assigned, In Transit, Arrived, Removed, Released.
import type { TransferStatus } from "../types";
import type { Hub } from "../network/Hub";

export class VehicleTransfer {
  status: TransferStatus = "Assigned";
  redirectedTo: string | null = null;

  constructor(public readonly orderId: string, public readonly vehicleId: string, public destHubId: string, public destDockId: string | null) {}

  /** setStatus(status : TransferStatus) : void */
  setStatus(status: TransferStatus): void {
    this.status = status;
  }

  /** redirect(hub : Hub) : void — an in-transit vehicle goes to another receiving Hub. UC-10 2c. */
  redirect(hub: Hub, dockId: string | null): void {
    this.redirectedTo = hub.id;
    this.destHubId = hub.id;
    this.destDockId = dockId;
  }
}
