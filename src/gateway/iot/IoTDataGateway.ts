// gateway.iot — IoTDataGateway (control method descriptions 4.1). The single boundary to the
// IoT or simulated data source. Everything physical goes through it.
import { bus } from "../../platform/events/bus";
import { clock } from "../../platform/clock/DemoClock";
import type { IoTEvent, StatusListener } from "./StatusListener";
import type { UnlockResult } from "../../domain/types";

/** What sits on the far side of the gateway: real Hub hardware, or the SimulatedDataSource. */
export interface DataSourceAdapter {
  unlock(dockId: string, vehicleId: string, reply: (r: UnlockResult) => void): void;
  receiveProfiles(pointIds: string[]): void;
}

export class IoTDataGateway {
  private static instance: IoTDataGateway | null = null;
  private listeners: StatusListener[] = [];
  private adapter: DataSourceAdapter | null = null;
  readonly eventLog: Array<{ time: number; text: string }> = [];

  static getInstance(): IoTDataGateway {
    if (!IoTDataGateway.instance) IoTDataGateway.instance = new IoTDataGateway();
    return IoTDataGateway.instance;
  }
  static reset(): void { IoTDataGateway.instance = new IoTDataGateway(); }

  connect(adapter: DataSourceAdapter): void { this.adapter = adapter; }

  /**
   * requestUnlock(dockId : String, vehicleId : String) : UnlockResult — an explicit
   * Success/Failure, never a silent command. The caller applies DOCK_UNLOCK_TIMEOUT.
   */
  requestUnlock(dockId: string, vehicleId: string, reply: (r: UnlockResult) => void): void {
    this.log(`unlock requested: dock ${dockId}, vehicle ${vehicleId}`);
    if (!this.adapter) { reply({ result: "Failure", reason: "no data source", at: clock().now() }); return; }
    this.adapter.unlock(dockId, vehicleId, (r) => { this.log(`unlock ${r.result}: dock ${dockId}`); reply(r); bus.changed("unlock"); });
  }

  /** dispatchProfiles(points : ChargingPoint[*]) : void — UC-11 step 16. */
  dispatchProfiles(pointIds: string[]): void {
    this.log(`charging profiles dispatched to ${pointIds.length} point(s)`);
    this.adapter?.receiveProfiles(pointIds);
  }

  /** subscribe(listener : StatusListener) : void */
  subscribe(listener: StatusListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  /** Called by the data source for every pushed event. */
  publish(e: IoTEvent): void {
    if (e.type !== "heartbeat" && e.type !== "telemetry") this.log(describe(e));
    for (const l of this.listeners) {
      try { l.onIoTEvent(e); } catch (err) { console.error("[iot] listener failed", err); }
    }
    if (e.type !== "telemetry") bus.changed(`iot:${e.type}`);
  }

  private log(text: string): void {
    this.eventLog.push({ time: clock().now(), text });
    if (this.eventLog.length > 200) this.eventLog.shift();
  }
}

function describe(e: IoTEvent): string {
  switch (e.type) {
    case "latched": return `latch: ${e.vehicleId} in dock ${e.dockId}`;
    case "latchNotEngaged": return `latch NOT engaged: dock ${e.dockId}`;
    case "departed": return `departed: ${e.vehicleId}`;
    case "arrived": return `arrived: ${e.vehicleId} at dock ${e.dockId}`;
    case "breakdown": return `breakdown: ${e.vehicleId}`;
    case "pointFault": return `charging point fault: ${e.pointId}`;
    case "chargingStarted": return `charging started: ${e.sessionId} on ${e.pointId}`;
    case "chargingEnded": return `charging ended: ${e.sessionId} on ${e.pointId}`;
    case "parkingSensor": return `parking sensor ${e.spaceId}: ${e.occupied ? "occupied" : "left"}`;
    default: return e.type;
  }
}

export const iot = (): IoTDataGateway => IoTDataGateway.getInstance();
