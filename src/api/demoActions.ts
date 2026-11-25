// Demo-tool actions with checks, kept apart from the Express routes so they can be tested.
import { bank } from "../gateway/bank/BankGateway";
import { dataSource } from "../gateway/iot/SimulatedDataSource";
import { db } from "../domain/store";
import { Trip } from "../domain/allocation/Trip";
import { UserError } from "./errors";

/** "Back to normal": the bank and the dock unlock answer Success again (now and next). */
export function backToNormal(): void {
  bank().mode = "Success";
  bank().nextMode = null;
  dataSource().unlockMode = "Success";
  dataSource().nextUnlockMode = null;
}

/**
 * The simulated dock reports a latch (or "not engaged") for a vehicle on an open trip.
 * A real dock can only take a vehicle when it is vacant, so anything else is refused.
 * The trip itself still closes through RentalController's latch listener (UC-08 step 5).
 */
export function demoLatch(dockId: string, vehicleId: string, engaged: boolean): void {
  const dock = db.docks.get(dockId);
  if (!dock) throw new UserError(`Unknown dock ${dockId}.`, 404);
  if (!db.vehicles.get(vehicleId)) throw new UserError(`Unknown vehicle ${vehicleId}.`, 404);
  const trip = [...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === vehicleId && a.status === "Open");
  if (!trip) throw new UserError(`${vehicleId} is not on an open trip.`, 409);
  if (dock.status !== "Vacant") throw new UserError(`Dock ${dock.label} at ${dock.hubId} is ${dock.status}. Choose a vacant dock.`, 409);
  if (engaged) dataSource().latch(dockId, vehicleId); else dataSource().latchNotEngaged(dockId, vehicleId);
}
