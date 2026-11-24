// domain.network — Vehicle (entity method descriptions 1.3). Three parallel regions
// (usage, technical, energy) from the Sub2 shared-vehicle state chart; one derived status
// (Table 2.3-1) computed by deriveStatus() in BR-RES-01 order.
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Resource } from "./Resource";
import type { EnergyState, GeoPoint, TechnicalState, UsageState, VehicleStatus, VehicleType } from "../types";
import type { Hub } from "./Hub";

export interface PickupCheck { ok: boolean; reason?: string; technical?: boolean }

export interface VehicleSummary {
  vehicleId: string; type: VehicleType; model: string; soc: number; hubId: string;
  dock: string | null; ratePerHour: number; fee: number; status: VehicleStatus;
}

export class Vehicle extends Resource {
  readonly kind = "Vehicle" as const;
  usage: UsageState = "Idle";
  technical: TechnicalState = "Operational";
  energy: EnergyState = "Sufficient";
  heldBy: string | null = null;
  orderId: string | null = null;
  dockId: string | null = null;
  /** When the vehicle entered "Waiting for Charge" — the wait term of BR-CHG-01. */
  lowSince: number | null = null;
  odometerKm = 0;

  constructor(
    id: string, hubId: string,
    public readonly type: VehicleType,
    public soc: number,
    lastUpdateTime: number,
  ) {
    super(id, hubId, lastUpdateTime);
  }

  /** "e-bike" / "e-motorbike" — the model used by redistribution orders. */
  get model(): string { return this.type === "electric bicycle" ? "e-bike" : "e-motorbike"; }
  get ratePerHour(): number {
    return config().value(this.type === "electric bicycle" ? "RATE_EBIKE_PER_HOUR" : "RATE_EMOTO_PER_HOUR");
  }

  get status(): VehicleStatus { return this.deriveStatus(); }

  // ---- static queries -------------------------------------------------------------

  /** static getVehicles(hubs : Hub[*]) : Vehicle[*] — UC-01 step 6. */
  static getVehicles(hubs: Hub[]): Vehicle[] {
    const ids = new Set(hubs.map((h) => h.id));
    return [...db.vehicles.values()].filter((v) => ids.has(v.hubId) && v.usage !== "In Use");
  }

  /** static findReplacement(hub : Hub, type : VehicleType) : Vehicle — UC-07 E3, BR-RES-02. */
  static findReplacement(hub: Hub, type: VehicleType, excludeId?: string): Vehicle | null {
    const c = [...db.vehicles.values()]
      .filter((v) => v.hubId === hub.id && v.type === type && v.id !== excludeId && v.isReservable())
      .sort((a, b) => b.soc - a.soc);
    return c[0] ?? null;
  }

  /** static countEligible(hub : Hub, model : String) : int — UC-10 step 6, E1. */
  static countEligible(hub: Hub, model: string): number {
    return Vehicle.eligibleAt(hub, model).length;
  }

  /** static recommendCandidates(hub : Hub, model : String) : Vehicle[*] — UC-10 step 7. */
  static recommendCandidates(hub: Hub, model: string): Vehicle[] {
    return Vehicle.eligibleAt(hub, model).sort((a, b) => b.soc - a.soc);
  }

  private static eligibleAt(hub: Hub, model: string): Vehicle[] {
    return [...db.vehicles.values()].filter((v) => v.hubId === hub.id && (model === "any" || v.model === model) && v.isEligibleForOrder());
  }

  // ---- instance -------------------------------------------------------------------

  /** getSummary() : VehicleSummary — UC-02 step 3. */
  getSummary(): VehicleSummary {
    const dock = this.dockId ? db.docks.get(this.dockId) : undefined;
    return {
      vehicleId: this.id, type: this.type, model: this.model, soc: Math.round(this.soc), hubId: this.hubId,
      dock: dock?.label ?? null, ratePerHour: this.ratePerHour, fee: config().value("RESERVATION_FEE"), status: this.status,
    };
  }

  isDockedInService(): boolean {
    if (!this.dockId) return false;
    const d = db.docks.get(this.dockId);
    return !!d && d.latched && d.vehicleId === this.id && d.status !== "Out of Service";
  }

  /** deriveStatus() : VehicleStatus — Table 2.3-1 in BR-RES-01 order. */
  deriveStatus(): VehicleStatus {
    if (this.usage !== "Idle") return this.usage;
    if (this.technical === "Faulty" || this.hasBlockingIncident() || !this.isDockedInService()) return "Under Maintenance";
    if (this.technical === "Disconnected" || this.isStale()) return "Disconnected";
    if (this.energy === "Interrupted") return "Interrupted";
    if (this.energy === "Charging") return "Charging";
    if (this.energy === "Low Battery") return "Waiting for Charge";
    return "Available";
  }

  /** isReservable() : boolean — the single gate for UC-02 and UC-07. */
  isReservable(): boolean {
    return this.usage === "Idle" && this.technical === "Operational" && !this.isStale() && !this.hasBlockingIncident()
      && this.energy === "Sufficient" && this.soc >= config().value("LOW_BATTERY_SOC") && this.isDockedInService();
  }

  /** BR-RED-01 / BR-05: Available, or Charging with SoC at least REDISTRIBUTION_MIN_SOC. */
  isEligibleForOrder(): boolean {
    if (this.usage !== "Idle" || this.technical !== "Operational" || this.isStale() || this.hasBlockingIncident() || !this.isDockedInService()) return false;
    if (this.energy === "Sufficient") return true;
    return this.energy === "Charging" && this.soc >= config().value("REDISTRIBUTION_MIN_SOC");
  }

  /** holdIfAvailable(studentId : String) : boolean — atomic hold, UC-02 step 4, UC-07 4a. */
  holdIfAvailable(studentId: string): boolean {
    this.reevaluate();
    if (!this.isReservable()) return false;
    this.usage = "Held";
    this.heldBy = studentId;
    return true;
  }

  /** releaseHold() : void — UC-02 E2, UC-07 4b/E3. */
  releaseHold(): void {
    this.usage = "Idle";
    this.heldBy = null;
    this.reevaluate();
  }

  /** reserve() : void — a held vehicle becomes Reserved once payment succeeded. UC-02 step 6. */
  reserve(): void {
    this.usage = "Reserved";
  }

  /** checkPickup(location : GeoPoint) : PickupCheck — UC-07 step 4 conditions, E2. */
  checkPickup(location: GeoPoint): PickupCheck {
    this.reevaluate();
    if (!location.insideGeofence || location.hubId !== this.hubId) return { ok: false, reason: `You are not inside the ${this.hubId} Hub area.` };
    if (this.isStale()) return { ok: false, technical: true, reason: `${this.id} has sent no data for over ${config().value("DATA_STALE_AFTER") / 1000} s (DATA_STALE_AFTER).` };
    if (this.soc < config().value("LOW_BATTERY_SOC")) return { ok: false, technical: true, reason: `${this.id} battery is ${Math.round(this.soc)}%, below LOW_BATTERY_SOC ${config().value("LOW_BATTERY_SOC")}%.` };
    if (this.hasBlockingIncident()) return { ok: false, technical: true, reason: `${this.id} has an unresolved vehicle-failure incident.` };
    if (!this.isDockedInService()) return { ok: false, technical: true, reason: `${this.id} is not latched in an in-service dock.` };
    return { ok: true };
  }

  /** recheckBlocking() : boolean — re-test right before the unlock; false sends UC-07 to E2. */
  recheckBlocking(): boolean {
    return !this.hasBlockingIncident() && !this.isStale();
  }

  /** setStatus(state : UsageState) : void */
  setStatus(state: UsageState): void {
    this.usage = state;
    if (state === "Idle") this.heldBy = null;
  }

  /** revalidate() : boolean — eligibility at the moment an order commits. UC-10 step 10, E3. */
  revalidate(): boolean {
    this.reevaluate();
    return this.isEligibleForOrder();
  }

  /** dispatchTransfer(orderId : String) : void — UC-10 step 11. */
  dispatchTransfer(orderId: string): void {
    this.orderId = orderId;
    this.usage = "In Redistribution";
  }

  /** releaseFromOrder() : void — UC-10 2a, 2b; re-evaluated, not made Available blindly (BR-RED-01). */
  releaseFromOrder(): void {
    this.orderId = null;
    this.usage = "Idle";
    this.reevaluate();
  }

  /** BR-RES-01 for a shared vehicle. The usage region is left alone: an active allocation keeps its state. */
  reevaluate(): void {
    this.blockedBy = this.blocks.size ? [...this.blocks][0] : null;
    this.technical = this.hasBlockingIncident() ? "Faulty" : this.isStale() ? "Disconnected" : "Operational";
    if (this.energy === "Charging" || this.energy === "Interrupted") return;
    if (this.soc < config().value("LOW_BATTERY_SOC")) {
      if (this.energy !== "Low Battery") this.lowSince = clock().now();
      this.energy = "Low Battery";
    } else {
      this.energy = "Sufficient";
      this.lowSince = null;
    }
  }
}
