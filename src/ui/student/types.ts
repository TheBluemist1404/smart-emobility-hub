// View-model shapes returned by /api/student/* (see src/api/studentRoutes.ts).
export interface PaymentView {
  id: string; amount: number; purpose: string; result: "Success" | "Failed" | null; transactionRef: string | null; failureCode: string | null;
  requestedAt: number; settledAt: number | null; open: boolean; lateResult: string | null; timeoutMs: number;
  refund: { id: string; amount: number; result: string | null; transactionRef: string | null } | null;
}
export interface VehicleSummary { vehicleId: string; type: string; model: string; soc: number; hubId: string; dock: string | null; ratePerHour: number; fee: number; status: string }
export interface AllocationView {
  id: string; kind: string; status: string; hubId: string; hubName: string; fee: number; expiresAt: number | null; createdAt: number; transactionRef: string | null;
  payment: PaymentView | null; history: Array<{ time: number; status: string; note?: string }>; holdMs?: number;
  vehicleId?: string; movedFrom?: string | null; vehicle?: VehicleSummary | null;
  spaceId?: string; spaceLabel?: string; window?: { start: number; end: number };
  pointId?: string | null; slot?: { pointId: string; start: number; end: number } | null; neededBy?: number | null; originalStart?: number | null; targetSoc?: number; sessionKind?: string;
}
export interface TripView {
  id: string; kind: "Trip"; status: "Open" | "Closed"; vehicleId: string; type: string; model: string; ratePerHour: number; soc: number;
  startTime: number; endTime: number | null; hubId: string; hubName: string; startDock: string; endHubId: string | null; endHubName: string | null; endDock: string | null;
  reservationId: string | null; distanceKm: number; fareSoFar: number; fare: number; fareStatus: "Unpaid" | "Paid" | "Waived" | null;
  fareBreakdown: Array<{ label: string; amount: number }>; transactionRef: string | null; payment: PaymentView | null; closedByIncident: string | null;
}
export interface Home {
  student: { id: string; name: string; vehicles: Array<{ id: string; type: string; label: string }> };
  blocked: { tripId: string; fare: number } | null;
  reservation: AllocationView | null;
  lastReservation: AllocationView | null;
  pickup: { vehicleId: string; state: "inspecting" | "unlocking" | "failed"; message: string | null; incidentId: string | null; reservationId: string | null } | null;
  trip: TripView | null;
  lastTrip: TripView | null;
  unread: number;
  location: { hubId: string | null; inside: boolean };
}
export interface RosterHub { hubId: string; name: string; category: string; openHours: string; available: number; freeParking: number; freeChargers: number; updatedAt: number; stale: boolean; distanceKm: number | null; status: string; x: number; y: number }
export interface HubDetail {
  hubId: string; name: string; category: string; openHours: string; available: number; freeParking: number; freeChargers: number; updatedAt: number; stale: boolean;
  vehicles: Array<{ vehicleId: string; type: string; model: string; soc: number; ratePerHour: number; status: string; why: string | null; reservable: boolean }>;
  parking: Array<{ hubId: string; type: string; free: number; total: number; stale: boolean }>;
  points: Array<{ pointId: string; power: string; status: string; busyUntil: number | null; stale: boolean }>;
}
export interface PickupSummary extends VehicleSummary {
  state: "inspecting" | "unlocking" | "failed"; message: string | null; incidentId: string | null; reservationId: string | null; walkUp: boolean;
  unlockFee: number; inspectionEndsAt: number; hubName: string;
}

export type Route =
  | { s: "S01" } | { s: "S02"; hubId: string; tab?: "vehicles" | "parking" | "charging" }
  | { s: "S03"; vehicleId: string } | { s: "VR"; id: string }
  | { s: "S09" } | { s: "S10" } | { s: "bookings" } | { s: "notifications" } | { s: "report" }
  | { s: "S05"; hubId?: string } | { s: "S06"; hubId?: string } | { s: "PR"; id: string } | { s: "CS"; id: string } | { s: "S07"; resourceId?: string } | { s: "S08" };
export type Go = (r: Route) => void;
