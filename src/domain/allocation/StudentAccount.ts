// domain.allocation — StudentAccount (entity method descriptions 2.1).
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { PrivateVehicle } from "./PrivateVehicle";
import { VehicleReservation } from "./VehicleReservation";
import { ParkingReservation } from "./ParkingReservation";
import { ChargingSession } from "./ChargingSession";
import { Trip } from "./Trip";
import type { Allocation } from "./Allocation";
import type { VehicleType } from "../types";

export interface ChargingRequest {
  hubId: string; privateVehicleId: string; from: number; to: number; neededBy: number | null; currentSoc: number; targetSoc: number;
}
export interface Rejection { field: string; message: string }

export class StudentAccount {
  readonly vehicles: PrivateVehicle[] = [];

  constructor(public readonly id: string, public readonly name: string, public readonly email: string) {}

  /** hasActiveReservation() : boolean — the one-reservation rule of UC-02 / UC-04 (per kind). */
  hasActiveReservation(kind: "vehicle" | "parking" = "vehicle"): boolean {
    return this.getActiveAllocations().some((a) =>
      kind === "vehicle" ? a instanceof VehicleReservation : a instanceof ParkingReservation && a.status !== "Checked-in");
  }

  hasOngoingTrip(): Trip | null {
    return (this.getActiveAllocations().find((a) => a instanceof Trip) as Trip) ?? null;
  }

  /** hasActiveSession(vehicle : PrivateVehicle) : boolean — UC-05 step 9. */
  hasActiveSession(vehicle: PrivateVehicle): boolean {
    return [...db.allocations.values()].some((a) => a instanceof ChargingSession && a.isCommittedReservation()
      && a.vehicleRef === vehicle.id && ["Pending Payment", "Scheduled", "Charging"].includes(a.status));
  }

  /** getActiveAllocations() : Allocation[*] */
  getActiveAllocations(): Allocation[] {
    return [...db.allocations.values()].filter((a) => a.studentId === this.id && a.isActive());
  }

  /** addVehicle(type : VehicleType, id : String) : void — UC-04 step 5. */
  addVehicle(type: VehicleType, id: string): PrivateVehicle {
    const existing = this.vehicles.find((v) => v.id === id);
    if (existing) return existing;
    const v = new PrivateVehicle(id, type, type === "electric bicycle" ? 0.6 : 2.4, `${type === "electric bicycle" ? "E-bike" : "E-motorbike"} ${id}`);
    this.vehicles.push(v);
    return v;
  }

  /** checkRequest(request : ChargingRequest) : Rejection — null when valid. UC-05 step 4. */
  checkRequest(r: ChargingRequest): Rejection | null {
    const v = this.vehicles.find((x) => x.id === r.privateVehicleId);
    if (!v) return { field: "vehicle", message: "Register the vehicle on your account first." };
    if (this.isBlocked()) return { field: "account", message: "An unpaid rental fare blocks new bookings (BR-PAY-04)." };
    if (this.hasActiveSession(v)) return { field: "vehicle", message: `${v.label} already has a charging session booked.` };
    const now = clock().now();
    if (r.from < now) return { field: "window", message: "The preferred window must start in the future." };
    if (r.to <= r.from) return { field: "window", message: "The window must end after it starts." };
    if (r.to > now + config().value("BOOKING_HORIZON")) return { field: "window", message: `You can book at most ${config().value("BOOKING_HORIZON") / 3_600_000} h ahead (BOOKING_HORIZON).` };
    if (r.targetSoc <= r.currentSoc) return { field: "target", message: "The target level must be above the current level." };
    if (r.neededBy !== null && r.neededBy < r.from) return { field: "neededBy", message: "The needed-by time must be after the window starts." };
    return null;
  }

  /** isBlocked() : boolean — an Unpaid fare blocks new reservations and rentals (BR-PAY-04). */
  isBlocked(): boolean {
    return [...db.allocations.values()].some((a) => a instanceof Trip && a.studentId === this.id && a.fareStatus === "Unpaid");
  }

  unpaidTrip(): Trip | null {
    return ([...db.allocations.values()].find((a) => a instanceof Trip && a.studentId === this.id && a.fareStatus === "Unpaid") as Trip) ?? null;
  }
}
