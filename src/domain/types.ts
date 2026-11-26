// Status types of class-diagram.md section 5, value for value.

// 5.1 Types with a Sub2 state chart
export type UsageState = "Idle" | "Held" | "Reserved" | "In Use" | "In Redistribution";
export type TechnicalState = "Operational" | "Faulty" | "Disconnected";
export type EnergyState = "Sufficient" | "Low Battery" | "Charging" | "Interrupted";
export type VehicleStatus =
  | "Available" | "Held" | "Reserved" | "In Use" | "Waiting for Charge" | "Charging"
  | "Interrupted" | "In Redistribution" | "Under Maintenance" | "Disconnected";
export type VehicleReservationStatus =
  | "Pending Payment" | "Confirmed" | "Pickup In Progress" | "Fulfilled" | "Payment Failed" | "Expired" | "Cancelled by System";
export type ParkingReservationStatus =
  | "Pending Payment" | "Confirmed" | "Checked-in" | "Completed" | "Payment Failed" | "Expired" | "Cancelled by System";
export type PrivateChargingStatus =
  | "Pending Payment" | "Payment Failed" | "Scheduled" | "Charging" | "Completed" | "Expired" | "Cancelled by System";
export type SharedChargingStatus = "Waiting" | "Scheduled" | "Charging" | "Completed";
export type FareStatus = "Unpaid" | "Paid" | "Waived";
export type IncidentStatus = "Open" | "In Progress" | "Resolved" | "Dismissed";
export type ReportStatus = "Open" | "Closed";
export type OrderStatus = "Draft" | "Assigned" | "In Transit" | "Completed" | "Partially Completed" | "Cancelled";
export type TransferStatus = "Assigned" | "In Transit" | "Arrived" | "Removed" | "Released";

// 5.2 Types with states but no state chart
export type DockStatus = "Vacant" | "Occupied" | "Allocated" | "Out of Service";
export type SpaceStatus = "In Service" | "Out of Service";
export type PointStatus = "Available" | "In Use" | "Out of Service" | "Disconnected";
export type WindowState = "Free" | "Held" | "Booked";
export type HubStatus = "Normal" | "Busy" | "Risk of Overload" | "Overloaded" | "Disconnected";
export type CapacityFlag = "Vehicle Shortage" | "Insufficient Fully Charged Vehicles";
export type TripStatus = "Open" | "Closed";
export type ApplyOutcome = "Applied" | "Not Applied" | "Pending Reconciliation";

// 5.3 Fixed enumerations
export type HubCategory = "Metro" | "Dormitory" | "School" | "Service";
export type VehicleType = "electric bicycle" | "electric motorcycle";
export type SessionKind = "committed reservation" | "Charging Queue request";
export type ScenarioType = "A demand surge" | "B return wave" | "C charging-point failure" | "D charging demand surge";
export type PaymentType = "Charge" | "Refund";
export type PaymentResult = "Success" | "Failed";
export type IssueCategory =
  | "vehicle failure" | "charging point unavailable or faulty" | "parking space blocked or occupied" | "Hub facility problem" | "other";
export type IncidentCategory = IssueCategory | string;
export type RecommendationKind = "transfer" | "charging plan" | "alternative Hub";

export const ISSUE_CATEGORIES: IssueCategory[] = [
  "vehicle failure", "charging point unavailable or faulty", "parking space blocked or occupied", "Hub facility problem", "other",
];

// 5.4 Records an operation returns (not states)
export interface TimeWindow { start: number; end: number }
export interface Slot { pointId: string; start: number; end: number }
export interface ResourceStatus { status: string; confirmedAt: number; stale: boolean }
export interface UnlockResult { result: "Success" | "Failure"; reason?: string; at: number }
export interface AllocationOutcome { allocationId: string; outcome: "moved" | "cancelled" | "awaiting"; detail: string }
export interface GeoPoint { hubId: string; insideGeofence: boolean }
export interface Telemetry { soc: number; odometerKm: number; at: number }
export interface Booking { start: number; end: number; state: WindowState; ref: string }

export const overlaps = (a: TimeWindow, b: TimeWindow): boolean => a.start < b.end && b.start < a.end;
