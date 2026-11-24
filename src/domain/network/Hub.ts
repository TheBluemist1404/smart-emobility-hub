// domain.network — Hub (entity method descriptions 1.1). Status and flags are computed by
// BR-HUB-01 from live data; no use case writes them (class-diagram.md 5.2).
import { db } from "../store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import type { CapacityFlag, HubCategory, HubStatus, VehicleType } from "../types";
import { Dock } from "./Dock";

export interface SearchCriteria { text?: string; type?: VehicleType | "any"; minSoc?: number; nearMe?: boolean }
export type LocationPermission = "granted" | "denied";

export interface HubSnapshot {
  hubId: string; name: string; category: HubCategory; status: HubStatus; flags: CapacityFlag[];
  occupancy: number | null; occupiedDocks: number; docksInService: number; vacantDocks: number; allocatedDocks: number;
  available: number; vehicles: number; lowBattery: number; freeParking: number; freeChargers: number; chargers: number;
  pointsOutOfService: number; updatedAt: number; stale: boolean; x: number; y: number;
}

export interface NetworkSnapshot {
  takenAt: number;
  hubs: HubSnapshot[];
  vehicles: Array<{ id: string; hubId: string; type: VehicleType; model: string; soc: number; status: string; eligible: boolean }>;
  points: Array<{ id: string; hubId: string; status: string; kw: number }>;
}

export interface Suggestion { fromHub: string; toHub: string; quantity: number; model: string; reason: string }

export class Hub {
  /** Hub-level link state: false while the simulator has cut the Hub's feed. */
  connected = true;
  private forcedStatus: HubStatus | null = null;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly category: HubCategory,
    public readonly openHours: string,
    public readonly x: number,
    public readonly y: number,
    public lastUpdateTime: number,
  ) {}

  // ---- static -------------------------------------------------------------------

  /** static getDefaultHubs(perm : LocationPermission) : Hub[*] — UC-01 step 2. */
  static getDefaultHubs(perm: LocationPermission): Hub[] {
    const all = [...db.hubs.values()];
    if (perm === "granted") return all.sort((a, b) => a.distanceKm() - b.distanceKm());
    return all.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** static findMatchingHubs(criteria : SearchCriteria) : Hub[*] — empty list, never an error (UC-01 4a). */
  static findMatchingHubs(c: SearchCriteria): Hub[] {
    const text = (c.text ?? "").trim().toLowerCase();
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
    return Hub.getDefaultHubs(c.nearMe ? "granted" : "denied").filter((h) => {
      if (text && !norm(`${h.id} ${h.name} ${h.category}`).includes(norm(text))) return false;
      if ((c.type && c.type !== "any") || c.minSoc) {
        const ok = [...db.vehicles.values()].some((v) => v.hubId === h.id && v.status === "Available"
          && (!c.type || c.type === "any" || v.type === c.type) && v.soc >= (c.minSoc ?? 0));
        if (!ok) return false;
      }
      return true;
    });
  }

  /** static getLatestStatus() : HubSnapshot[*] — UC-09 overview. */
  static getLatestStatus(): HubSnapshot[] {
    return [...db.hubs.values()].map((h) => h.snapshot());
  }

  /** static captureSnapshot() : NetworkSnapshot — a detached copy for UC-13 step 2. */
  static captureSnapshot(): NetworkSnapshot {
    const snap: NetworkSnapshot = {
      takenAt: clock().now(),
      hubs: Hub.getLatestStatus(),
      vehicles: [...db.vehicles.values()].map((v) => ({ id: v.id, hubId: v.hubId, type: v.type, model: v.model, soc: v.soc, status: v.status, eligible: v.isEligibleForOrder() })),
      points: [...db.points.values()].map((p) => ({ id: p.id, hubId: p.hubId, status: p.status, kw: p.kw })),
    };
    return JSON.parse(JSON.stringify(snap)) as NetworkSnapshot;
  }

  /** static loadLiveState() : NetworkSnapshot — UC-14 step 2. */
  static loadLiveState(): NetworkSnapshot {
    return Hub.captureSnapshot();
  }

  // ---- instance -----------------------------------------------------------------

  /** Schematic distance from the student's position on the campus map (mockup S01 b). */
  distanceKm(): number {
    const dx = this.x - 30, dy = this.y - 44;
    return Math.round(Math.sqrt(dx * dx + dy * dy) * 0.03 * 10) / 10 || 0.2;
  }

  docks(): Dock[] { return [...db.docks.values()].filter((d) => d.hubId === this.id); }

  occupancy(): { occupied: number; inService: number; R: number } {
    const d = this.docks();
    const inService = d.filter((x) => x.status !== "Out of Service").length;
    const occupied = d.filter((x) => x.status === "Occupied").length;
    return { occupied, inService, R: inService ? occupied / inService : 0 };
  }

  /** Current Hub status by BR-HUB-01 (first matching condition). */
  get status(): HubStatus {
    if (this.forcedStatus) return this.forcedStatus;
    if (this.isStale()) return "Disconnected";
    const { R } = this.occupancy();
    const c = config();
    if (R * 100 >= c.value("HUB_OVERLOADED")) return "Overloaded";
    if (R * 100 >= c.value("HUB_RISK")) return "Risk of Overload";
    if (R * 100 >= c.value("HUB_BUSY")) return "Busy";
    return "Normal";
  }

  /** setStatus(status : HubStatus) — UC-09 E1 marks a silent Hub "Disconnected"; null returns to BR-HUB-01. */
  setStatus(status: HubStatus | null): void {
    this.forcedStatus = status;
  }

  /** getFlags() : CapacityFlag[*] — independent of the status and of each other. */
  getFlags(): CapacityFlag[] {
    if (this.isStale()) return [];
    const flags: CapacityFlag[] = [];
    const { inService } = this.occupancy();
    const vs = [...db.vehicles.values()].filter((v) => v.hubId === this.id && v.usage !== "In Use");
    const available = vs.filter((v) => v.status === "Available").length;
    if (available < (config().value("HUB_SHORTAGE_RATIO") / 100) * inService) flags.push("Vehicle Shortage");
    const low = vs.filter((v) => v.soc < config().value("LOW_BATTERY_SOC")).length;
    if (vs.length && low / vs.length > config().value("HUB_LOW_BATTERY_RATIO") / 100) flags.push("Insufficient Fully Charged Vehicles");
    return flags;
  }

  snapshot(): HubSnapshot {
    const { occupied, inService, R } = this.occupancy();
    const d = this.docks();
    const vs = [...db.vehicles.values()].filter((v) => v.hubId === this.id && v.usage !== "In Use");
    const now = { start: clock().now(), end: clock().now() + 60_000 };
    const pts = [...db.points.values()].filter((p) => p.hubId === this.id);
    const stale = this.isStale();
    return {
      hubId: this.id, name: this.name, category: this.category, status: this.status, flags: this.getFlags(),
      occupancy: stale ? null : Math.round(R * 100), occupiedDocks: occupied, docksInService: inService,
      vacantDocks: d.filter((x) => x.status === "Vacant").length, allocatedDocks: d.filter((x) => x.status === "Allocated").length,
      available: vs.filter((v) => v.status === "Available").length, vehicles: vs.length,
      lowBattery: vs.filter((v) => v.soc < config().value("LOW_BATTERY_SOC")).length,
      freeParking: [...db.spaces.values()].filter((s) => s.hubId === this.id && s.status === "In Service" && s.isFree(now)).length,
      freeChargers: pts.filter((p) => p.status === "Available" && p.isFree(now)).length, chargers: pts.length,
      pointsOutOfService: pts.filter((p) => p.status === "Out of Service").length,
      updatedAt: this.lastUpdateTime, stale, x: this.x, y: this.y,
    };
  }

  /** getDetails() : HubDetails — UC-09 step 9. */
  getDetails() {
    return {
      ...this.snapshot(), openHours: this.openHours,
      docks: this.docks().map((x) => ({ id: x.id, label: x.label, status: x.status, vehicleId: x.vehicleId })),
      vehicles: [...db.vehicles.values()].filter((v) => v.hubId === this.id && v.usage !== "In Use")
        .map((v) => ({ id: v.id, type: v.type, model: v.model, soc: Math.round(v.soc), status: v.status })),
      points: [...db.points.values()].filter((p) => p.hubId === this.id).map((p) => ({ id: p.id, power: p.power, status: p.status, busyUntil: p.busyUntil() })),
      spaces: [...db.spaces.values()].filter((s) => s.hubId === this.id).map((s) => ({ id: s.id, label: s.label, type: s.type, status: s.status })),
    };
  }

  /** getRebalancingSuggestions() : Suggestion[*] — advisory source/destination pairs. UC-10 step 2. */
  getRebalancingSuggestions(): Suggestion[] {
    if (this.isStale()) return [];
    const flags = this.getFlags();
    if (!flags.includes("Vehicle Shortage")) return [];
    const need = Math.max(1, Math.ceil((config().value("HUB_SHORTAGE_RATIO") / 100) * this.occupancy().inService * 2) - this.snapshot().available);
    const out: Suggestion[] = [];
    for (const src of db.hubs.values()) {
      if (src.id === this.id || src.isStale()) continue;
      const surplus = src.snapshot().available - Math.ceil((config().value("HUB_SHORTAGE_RATIO") / 100) * src.occupancy().inService * 2);
      if (surplus <= 0) continue;
      const q = Math.min(surplus, need, this.netFreeDocks());
      if (q > 0) out.push({ fromHub: src.id, toHub: this.id, quantity: q, model: "e-bike", reason: `${this.id} has Vehicle Shortage; ${src.id} has ${surplus} spare` });
    }
    return out.sort((a, b) => b.quantity - a.quantity).slice(0, 2);
  }

  /** netFreeDocks() : int — Vacant docks; Allocated ones are already promised. UC-10 step 6, E2. */
  netFreeDocks(): number {
    return Dock.findVacant(this).length;
  }

  /** allocateDocks(quantity : int) : Dock[*] — fails rather than over-allocating. UC-10 step 10. */
  allocateDocks(quantity: number, orderId: string): Dock[] {
    const vacant = Dock.findVacant(this);
    if (vacant.length < quantity) throw new Error(`${this.id} has only ${vacant.length} net free docks`);
    const chosen = vacant.slice(0, quantity);
    for (const d of chosen) { d.allocatedTo = orderId; d.reevaluate(); }
    return chosen;
  }

  /** releaseDocks(docks : Dock[*]) — UC-10 2b, 2c, E5. */
  releaseDocks(docks: Dock[]): void {
    for (const d of docks) { d.allocatedTo = null; d.reevaluate(); }
  }

  /** setDockOccupied(dockId : String) : void — an incoming transfer latched. UC-10 2a. */
  setDockOccupied(dockId: string): void {
    const d = db.docks.get(dockId);
    if (!d) return;
    d.allocatedTo = null;
    d.latched = true;
    d.reevaluate();
  }

  /** isStale() : boolean */
  isStale(): boolean {
    return clock().now() - this.lastUpdateTime > config().value("DATA_STALE_AFTER");
  }
}
