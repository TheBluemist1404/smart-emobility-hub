// control.operations — MonitoringController (control method descriptions 3.1), UC-09.
// Also the StatusListener that applies accepted status updates (NIFR-01, NIFR-04) to the
// network and runs the DATA_STALE_AFTER sweep (UC-09 E1).
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { Hub, type HubSnapshot } from "../../domain/network/Hub";
import { Incident } from "../../domain/operations/Incident";
import { OperatorConsole } from "../../api/push";
import type { IoTEvent, StatusListener } from "../../gateway/iot/StatusListener";
import type { HubCategory, HubStatus } from "../../domain/types";

export interface FilterCriteria { category?: HubCategory | "all"; status?: HubStatus | "all"; vehicleType?: string; sort?: "usage" | "code" }
export interface Overview {
  updatedAt: number; hubs: HubSnapshot[]; reporting: number;
  kpis: { vehiclesReady: number; pointsFree: number; pointsTotal: number; pointsOutOfService: number; docksInService: number; hubsOnAlert: number; overloaded: number; risk: number; disconnected: number; incidentsOpen: number; incidentsInProgress: number };
}

export class MonitoringController implements StatusListener {
  /** Severity last acknowledged per Hub, so an alert is not repeated until it shifts (5a). */
  private acknowledged = new Map<string, string>();
  private warned = new Set<string>();

  /** openNetwork() : Overview — UC-09 step 3. */
  openNetwork(): Overview {
    return this.classifyHubs(Hub.getLatestStatus());
  }

  /** openHub(hubId : String) : HubDetails — from a warning notification, UC-09 1a. */
  openHub(hubId: string) { return this.getHubDetails(hubId); }

  /** getHubDetails(hubId : String) : HubDetails — UC-09 step 9. */
  getHubDetails(hubId: string) {
    const h = db.hubs.get(hubId);
    if (!h) throw new Error(`Unknown Hub ${hubId}`);
    const d = h.getDetails();
    const nearby = [...db.hubs.values()].filter((x) => x.id !== hubId && !x.isStale())
      .map((x) => ({ hubId: x.id, name: x.name, netFreeDocks: x.netFreeDocks(), status: x.status, available: x.snapshot().available, km: Math.round(Math.hypot(x.x - h.x, x.y - h.y) * 0.04 * 10) / 10 }))
      .sort((a, b) => b.netFreeDocks - a.netFreeDocks).slice(0, 3);
    return { ...d, nearby, acknowledged: this.acknowledged.get(hubId) ?? null, history: this.history(h) };
  }

  /** A believable 2-hour occupancy line ending at the live value (the MVP keeps no time series). */
  private history(h: Hub): number[] {
    const now = h.occupancy().R * 100;
    const seed = h.id.charCodeAt(2);
    return Array.from({ length: 24 }, (_, i) => {
      const k = i / 23;
      return Math.max(0, Math.min(100, Math.round(now * (0.6 + 0.4 * k) + Math.sin(i * 0.9 + seed) * 6 * (1 - k))));
    });
  }

  /** filter(criteria : FilterCriteria) : Hub[*] — UC-09 4a. */
  filter(c: FilterCriteria): HubSnapshot[] {
    let hubs = Hub.getLatestStatus();
    if (c.category && c.category !== "all") hubs = hubs.filter((h) => h.category === c.category);
    if (c.status && c.status !== "all") hubs = hubs.filter((h) => h.status === c.status);
    if (c.vehicleType && c.vehicleType !== "all") hubs = hubs.filter((h) => [...db.vehicles.values()].some((v) => v.hubId === h.hubId && v.model === c.vehicleType));
    if (c.sort === "code") return hubs.sort((a, b) => a.hubId.localeCompare(b.hubId));
    return hubs.sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1));
  }

  /** acknowledge(alert : Alert) : void — UC-09 step 8 / 5a "Acknowledge". */
  acknowledge(alertOrHubId: string, operatorId: string): void {
    const a = db.alerts.find((x) => x.id === alertOrHubId) ?? db.alerts.slice().reverse().find((x) => x.hubId === alertOrHubId && !x.acknowledgedBy);
    const hubId = a?.hubId ?? alertOrHubId;
    const h = db.hubs.get(hubId);
    if (h) this.acknowledged.set(hubId, `${h.status}|${h.getFlags().join(",")}`);
    if (a) { a.acknowledgedBy = operatorId; a.acknowledgedAt = clock().now(); }
    this.logAudit(operatorId, clock().now(), `acknowledged alert ${a?.id ?? ""} for ${hubId}`);
  }

  isAcknowledged(hubId: string): boolean {
    const h = db.hubs.get(hubId);
    return !!h && this.acknowledged.get(hubId) === `${h.status}|${h.getFlags().join(",")}`;
  }

  /** - classifyHubs(snapshots) : Overview — BR-HUB-01 colours and the indicators. */
  private classifyHubs(hubs: HubSnapshot[]): Overview {
    const live = hubs.filter((h) => !h.stale);
    const incidents = Incident.findCurrent();
    return {
      updatedAt: Math.max(...live.map((h) => h.updatedAt), 0), hubs, reporting: live.length,
      kpis: {
        vehiclesReady: live.reduce((s, h) => s + h.available, 0),
        pointsFree: live.reduce((s, h) => s + h.freeChargers, 0),
        pointsTotal: hubs.reduce((s, h) => s + h.chargers, 0),
        pointsOutOfService: hubs.reduce((s, h) => s + h.pointsOutOfService, 0),
        docksInService: live.reduce((s, h) => s + h.docksInService, 0),
        hubsOnAlert: hubs.filter((h) => ["Overloaded", "Risk of Overload", "Disconnected"].includes(h.status)).length,
        overloaded: hubs.filter((h) => h.status === "Overloaded").length,
        risk: hubs.filter((h) => h.status === "Risk of Overload").length,
        disconnected: hubs.filter((h) => h.status === "Disconnected").length,
        incidentsOpen: incidents.filter((i) => i.status === "Open").length,
        incidentsInProgress: incidents.filter((i) => i.status === "In Progress").length,
      },
    };
  }

  /** - retry(attempts : int) : HubSnapshot[*] — UC-09 E2. The in-memory service never fails, so one attempt suffices. */
  private retry(attempts = config().value("DATA_SERVICE_RETRIES")): HubSnapshot[] {
    for (let i = 0; i <= attempts; i++) {
      try { return Hub.getLatestStatus(); } catch { /* try again */ }
    }
    return [];
  }

  /** - logAudit(operatorId : String, time : DateTime) : void */
  private logAudit(operatorId: string, time: number, what: string): void {
    audit(operatorId, "UC-09 acknowledge", what, undefined, undefined, time);
  }

  // ---- StatusListener: accepted updates from the IoT / Simulated Data Source ---------

  onIoTEvent(e: IoTEvent): void {
    if (e.type === "heartbeat") {
      const h = db.hubs.get(e.hubId);
      if (!h) return;
      const wasStale = h.isStale();
      h.lastUpdateTime = e.at;
      h.setStatus(null);
      const silent = new Set(e.resources === "all" ? [] : e.resources);
      for (const m of [db.docks, db.points, db.spaces] as const)
        for (const r of m.values()) if (r.hubId === h.id && !silent.has(r.id)) { r.lastUpdateTime = e.at; }
      for (const v of db.vehicles.values()) if (v.hubId === h.id && v.usage !== "In Use" && !silent.has(v.id)) v.lastUpdateTime = e.at;
      for (const p of db.points.values()) if (p.hubId === h.id) p.reevaluate();
      for (const v of db.vehicles.values()) if (v.hubId === h.id) v.reevaluate();
      if (wasStale) {
        this.warned.delete(`stale:${h.id}`);
        OperatorConsole.warn(`${h.id} · ${h.name} is reporting again.`, h.id, "Hub reconnected");
      }
    } else if (e.type === "telemetry") {
      const v = db.vehicles.get(e.vehicleId);
      if (!v) return;
      v.soc = e.soc; v.odometerKm = e.odometerKm; v.lastUpdateTime = e.at;
      v.reevaluate();
    }
  }

  /** The DATA_STALE_AFTER sweep (scheduler job), every MONITOR_REFRESH. */
  startSweep(): void {
    const sweep = () => {
      this.checkStale();
      clock().after(config().value("MONITOR_REFRESH"), "stale sweep", sweep, true);
    };
    clock().after(config().value("MONITOR_REFRESH"), "stale sweep", sweep, true);
  }

  checkStale(silent = false): void {
    for (const h of this.retry()) {
      const hub = db.hubs.get(h.hubId)!;
      if (h.stale) {
        for (const p of db.points.values()) if (p.hubId === hub.id) p.reevaluate();
        for (const v of db.vehicles.values()) if (v.hubId === hub.id) v.reevaluate();
        const key = `stale:${hub.id}`;
        if (!this.warned.has(key) && !Incident.findCurrent().some((i) => i.resourceId === hub.id)) {
          this.warned.add(key);
          if (silent) continue;
          OperatorConsole.warn(`${hub.id} · ${hub.name} is Disconnected: no data for over ${config().value("DATA_STALE_AFTER") / 1000} s (E1).`, hub.id, "Hub disconnected (E1)");
          const inc = new Incident(nextId("INC", "num"), hub.id, hub.id, "Hub disconnected", `No data from ${hub.id} for over DATA_STALE_AFTER.`, "network warning");
          db.incidents.set(inc.id, inc);
        } else this.warned.add(key);
      } else if (["Overloaded", "Risk of Overload"].includes(h.status) || h.flags.length) {
        const key = `${h.hubId}|${h.status}|${h.flags.join(",")}`;
        if (!this.warned.has(key) && !this.isAcknowledged(h.hubId)) {
          this.warned.add(key);
          if (silent) continue;
          const what = [h.status !== "Normal" && h.status !== "Busy" ? `${h.status} (R = ${h.occupancy}%)` : "", ...h.flags].filter(Boolean).join(" · ");
          if (!db.alerts.some((a) => a.hubId === h.hubId && !a.acknowledgedBy && a.message.includes(what)))
            OperatorConsole.warn(`${h.hubId} · ${what}`, h.hubId, h.flags.includes("Insufficient Fully Charged Vehicles") && h.status === "Normal" ? "Insufficient Fully Charged Vehicles (5b)" : "Overload warning (5a)");
        }
      }
    }
  }
}
