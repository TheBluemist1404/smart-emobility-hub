// The "IoT / Simulated Data Source" actor of the use-case model. It plays the physical
// world — docks, latch sensors, charging points, vehicle telemetry — and talks to the
// system only through IoTDataGateway. The simulator panel drives it.
import { db } from "../../domain/store";
import { clock, SECOND, MINUTE } from "../../platform/clock/DemoClock";
import { bus } from "../../platform/events/bus";
import { iot, type DataSourceAdapter } from "./IoTDataGateway";
import { ChargingSession } from "../../domain/allocation/ChargingSession";
import type { UnlockResult } from "../../domain/types";

export type UnlockMode = "Success" | "Failure" | "Timeout";
const HEARTBEAT = 5 * SECOND;

export class SimulatedDataSource implements DataSourceAdapter {
  private static instance: SimulatedDataSource | null = null;
  unlockMode: UnlockMode = "Success";
  nextUnlockMode: UnlockMode | null = null;
  unlockDelayMs = 3 * SECOND;
  /** Hubs whose whole feed is cut (UC-01 E1, UC-09 E1). */
  readonly silentHubs = new Set<string>();
  /** Single resources that stopped reporting (UC-11 E5). */
  readonly silentResources = new Set<string>();
  /** Private sessions whose car is plugged in (the student arrived). */
  readonly pluggedIn = new Set<string>();
  /** The student's phone GPS (UC-07 E1). hubId null = "at the Hub of the vehicle". */
  studentLocation: { hubId: string | null; inside: boolean } = { hubId: null, inside: true };
  private lateUnlocks: Array<{ dockId: string; vehicleId: string; reply: (r: UnlockResult) => void }> = [];
  private running = false;

  static getInstance(): SimulatedDataSource {
    if (!SimulatedDataSource.instance) SimulatedDataSource.instance = new SimulatedDataSource();
    return SimulatedDataSource.instance;
  }
  static reset(): void { SimulatedDataSource.instance = new SimulatedDataSource(); }

  start(): void {
    if (this.running) return;
    this.running = true;
    iot().connect(this);
    const loop = () => { this.beat(); clock().after(HEARTBEAT, "heartbeat", loop, true); };
    clock().after(HEARTBEAT, "heartbeat", loop, true);
  }

  // ---- adapter side (requests from the system) ----------------------------------

  unlock(dockId: string, vehicleId: string, reply: (r: UnlockResult) => void): void {
    const mode = this.nextUnlockMode ?? this.unlockMode;
    this.nextUnlockMode = null;
    if (mode === "Timeout") { this.lateUnlocks.push({ dockId, vehicleId, reply }); return; }
    clock().after(this.unlockDelayMs, `Dock ${db.docks.get(dockId)?.label ?? dockId} answers unlock (${mode})`, () =>
      reply({ result: mode === "Success" ? "Success" : "Failure", reason: mode === "Failure" ? "lock pin did not release" : undefined, at: clock().now() }));
  }

  receiveProfiles(_pointIds: string[]): void { /* the points accept the profiles silently */ }

  /** A release confirmation that arrives after DOCK_UNLOCK_TIMEOUT (UC-07 E3 step 5). */
  sendLateUnlock(): boolean {
    const u = this.lateUnlocks.shift();
    if (!u) return false;
    u.reply({ result: "Success", reason: "late confirmation", at: clock().now() });
    return true;
  }
  pendingUnlocks(): number { return this.lateUnlocks.length; }

  // ---- the physical world ticking ------------------------------------------------

  private beat(): void {
    const now = clock().now();
    for (const h of db.hubs.values()) {
      if (this.silentHubs.has(h.id)) continue;
      const silent = [...this.silentResources];
      iot().publish({ type: "heartbeat", hubId: h.id, at: now, resources: silent.length ? silent : "all" });
    }
    // Vehicles on a trip report over 4G wherever they are.
    for (const v of db.vehicles.values()) {
      if (v.usage !== "In Use" || this.silentResources.has(v.id)) continue;
      const mins = HEARTBEAT / MINUTE;
      iot().publish({ type: "telemetry", vehicleId: v.id, soc: Math.max(0, v.soc - 0.35 * mins), odometerKm: v.odometerKm + 0.12 * mins, at: now });
    }
    // Charging points: start Scheduled sessions whose slot has begun, end finished ones.
    for (const s of db.allocations.values()) {
      if (!(s instanceof ChargingSession) || !s.slot) continue;
      const p = db.points.get(s.slot.pointId);
      if (!p || this.silentHubs.has(p.hubId) || this.silentResources.has(p.id)) continue;
      if (s.status === "Scheduled" && s.slot.start <= now && now < s.slot.end && p.status !== "Out of Service" && !p.activeSessionId) {
        if (s.isCommittedReservation() && !this.pluggedIn.has(s.id)) continue;
        iot().publish({ type: "chargingStarted", pointId: p.id, sessionId: s.id, at: now });
      } else if (s.status === "Charging") {
        const v = db.vehicles.get(s.vehicleRef);
        if (v) v.soc = Math.min(100, v.soc + (p.kw / 7) * 1.2 * (HEARTBEAT / MINUTE));
        s.energyKwh += (p.kw * HEARTBEAT) / 3_600_000;
        if (now >= s.slot.end || (v && v.soc >= s.targetSoc)) iot().publish({ type: "chargingEnded", pointId: p.id, sessionId: s.id, at: now });
      }
    }
  }

  // ---- simulator panel controls --------------------------------------------------

  disconnectHub(hubId: string): void { this.silentHubs.add(hubId); bus.changed("sim"); }
  reconnectHub(hubId: string): void {
    this.silentHubs.delete(hubId);
    iot().publish({ type: "heartbeat", hubId, at: clock().now(), resources: "all" });
  }
  disconnectResource(id: string): void { this.silentResources.add(id); bus.changed("sim"); }
  reconnectResource(id: string): void {
    this.silentResources.delete(id);
    const r = db.vehicles.get(id) ?? db.points.get(id) ?? db.docks.get(id);
    if (r) iot().publish({ type: "heartbeat", hubId: r.hubId, at: clock().now(), resources: [...this.silentResources] });
  }

  setBattery(vehicleId: string, soc: number): void {
    const v = db.vehicles.get(vehicleId);
    if (!v) return;
    iot().publish({ type: "telemetry", vehicleId, soc, odometerKm: v.odometerKm, at: clock().now() });
  }

  pointFault(pointId: string): void { iot().publish({ type: "pointFault", pointId, at: clock().now() }); }
  latch(dockId: string, vehicleId: string): void {
    const v = db.vehicles.get(vehicleId);
    iot().publish({ type: "latched", dockId, vehicleId, telemetry: { soc: v?.soc ?? 50, odometerKm: v?.odometerKm ?? 0, at: clock().now() } });
  }
  latchNotEngaged(dockId: string, vehicleId: string): void { iot().publish({ type: "latchNotEngaged", dockId, vehicleId }); }
  departed(vehicleId: string): void { iot().publish({ type: "departed", vehicleId, at: clock().now() }); }
  arrived(vehicleId: string, dockId: string): void { iot().publish({ type: "arrived", vehicleId, dockId, at: clock().now() }); }
  breakdown(vehicleId: string): void { iot().publish({ type: "breakdown", vehicleId, at: clock().now() }); }
  plugIn(sessionId: string): void { this.pluggedIn.add(sessionId); bus.changed("sim"); }
  parkingSensor(spaceId: string, occupied: boolean): void { iot().publish({ type: "parkingSensor", spaceId, occupied, at: clock().now() }); }
}

export const dataSource = (): SimulatedDataSource => SimulatedDataSource.getInstance();
