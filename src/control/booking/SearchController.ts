// control.booking — SearchController (control method descriptions 2.1), UC-01.
import { db } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Hub, type LocationPermission, type SearchCriteria } from "../../domain/network/Hub";
import { Vehicle } from "../../domain/network/Vehicle";
import { ParkingSpace } from "../../domain/network/ParkingSpace";
import { ChargingPoint } from "../../domain/network/ChargingPoint";

export interface RosterHub {
  hubId: string; name: string; category: string; openHours: string; available: number; freeParking: number; freeChargers: number;
  updatedAt: number; stale: boolean; distanceKm: number | null; status: string; x: number; y: number;
}
export interface Roster { hubs: RosterHub[]; criteria: SearchCriteria; updatedAt: number; empty: boolean }

export class SearchController {
  private cached: Roster | null = null;

  /** openSearch(permission : LocationPermission) : SearchOptions — UC-01 step 2. */
  openSearch(permission: LocationPermission) {
    const criteria = this.applyDefaultCriteria(permission);
    return { nearMeOffered: permission === "granted", filters: ["Hub name", "location", "vehicle type", "minimum battery SoC"], roster: this.search(criteria) };
  }

  /** search(criteria : SearchCriteria) : Roster — UC-01 step 4; empty list for 4a, never an error. */
  search(criteria: SearchCriteria): Roster {
    const hubs = Hub.findMatchingHubs(criteria).map((h) => {
      this.markStale(h);
      const s = h.snapshot();
      return {
        hubId: h.id, name: h.name, category: h.category, openHours: h.openHours, available: s.available, freeParking: s.freeParking, freeChargers: s.freeChargers,
        updatedAt: h.lastUpdateTime, stale: s.stale, distanceKm: criteria.nearMe ? h.distanceKm() : null, status: s.status, x: h.x, y: h.y,
      };
    });
    this.cached = { hubs, criteria, updatedAt: clock().now(), empty: hubs.length === 0 };
    return this.cached;
  }

  /** The S02 view of one Hub: vehicles, parking and charging, each with its update time. UC-01 steps 5-6. */
  hubDetail(hubId: string) {
    const h = db.hubs.get(hubId);
    if (!h) throw new Error(`Unknown Hub ${hubId}`);
    const stale = h.isStale();
    const low = config().value("LOW_BATTERY_SOC");
    const vehicles = Vehicle.getVehicles([h]).filter((v) => v.dockId || v.usage !== "Idle")
      .sort((a, b) => Number(b.status === "Available") - Number(a.status === "Available") || b.soc - a.soc)
      .map((v) => {
        const status = v.status;
        const why = status === "Available" ? null
          : status === "Reserved" ? (v.heldBy === "2412345" ? "Reserved by you" : "Reserved by another student")
          : status === "Held" ? "Held for a payment"
          : status === "Waiting for Charge" ? `Below ${low}% · not rentable`
          : status === "Disconnected" ? "No live data · can't be reserved"
          : "Not rentable";
        return { vehicleId: v.id, type: v.type, model: v.model, soc: Math.round(v.soc), ratePerHour: v.ratePerHour, status, why, reservable: status === "Available" && !stale };
      });
    const parking = ParkingSpace.getAvailability([h]);
    const points = ChargingPoint.getStatus([h]);
    return { ...h.snapshot(), openHours: h.openHours, vehicles, parking, points, stale };
  }

  /** closeSearch() : void — UC-01 step 12. */
  closeSearch(): void {
    this.cached = null;
  }

  /** - applyDefaultCriteria(permission) : SearchCriteria — UC-01 3a. */
  private applyDefaultCriteria(permission: LocationPermission): SearchCriteria {
    return { text: "", type: "any", minSoc: 0, nearMe: permission === "granted" };
  }

  /** - markStale(hub : Hub) : void — UC-01 E1: a silent Hub's vehicles are "Disconnected" and can't be reserved. */
  private markStale(h: Hub): void {
    if (!h.isStale()) return;
    for (const v of db.vehicles.values()) if (v.hubId === h.id) v.reevaluate();
  }
}
