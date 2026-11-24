// gateway.iot — StatusListener (development view 5.1). Implemented by RentalController
// (UC-08 latch), ChargingController (UC-11) and MonitoringController / RedistributionController
// (UC-09, UC-10). It is the parameter type of IoTDataGateway.subscribe().

export interface TelemetryReading { soc: number; odometerKm: number; at: number }

export type IoTEvent =
  | { type: "heartbeat"; hubId: string; at: number; resources: "all" | string[] }
  | { type: "telemetry"; vehicleId: string; soc: number; odometerKm: number; at: number }
  | { type: "latched"; dockId: string; vehicleId: string; telemetry: TelemetryReading }
  | { type: "latchNotEngaged"; dockId: string; vehicleId: string }
  | { type: "departed"; vehicleId: string; at: number }
  | { type: "arrived"; vehicleId: string; dockId: string; at: number }
  | { type: "breakdown"; vehicleId: string; at: number }
  | { type: "pointFault"; pointId: string; at: number }
  | { type: "chargingStarted"; pointId: string; sessionId: string; at: number }
  | { type: "chargingEnded"; pointId: string; sessionId: string; at: number }
  | { type: "parkingSensor"; spaceId: string; occupied: boolean; at: number };

export interface StatusListener {
  onIoTEvent(e: IoTEvent): void;
}
