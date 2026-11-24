// domain.allocation — PrivateVehicle (entity method descriptions 2.2). A data class.
import type { VehicleType } from "../types";

export class PrivateVehicle {
  constructor(
    public readonly id: string,
    public readonly type: VehicleType,
    public readonly batteryKwh: number,
    public readonly label: string,
  ) {}
}
