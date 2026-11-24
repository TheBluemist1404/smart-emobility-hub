// The student app's HTTP side (MobileApp boundary). One demo student: Nguyen Minh Khoa.
import { Router, type Request } from "express";
import { db } from "../domain/store";
import { config } from "../platform/config/ConfigurationRegistry";
import { clock } from "../platform/clock/DemoClock";
import { bus } from "../platform/events/bus";
import { dataSource } from "../gateway/iot/SimulatedDataSource";
import { VehicleReservation } from "../domain/allocation/VehicleReservation";
import { ParkingReservation } from "../domain/allocation/ParkingReservation";
import { ChargingSession } from "../domain/allocation/ChargingSession";
import { Trip } from "../domain/allocation/Trip";
import type { Allocation } from "../domain/allocation/Allocation";
import { ctl } from "./controllers";
import { UserError } from "./errors";

export const STUDENT = "2412345";

const wrap = (fn: (req: Request) => unknown) => (req: Request, res: { json: (x: unknown) => void }, next: (e: unknown) => void) => {
  try { const out = fn(req); bus.changed("student"); res.json(out ?? { ok: true }); } catch (e) { next(e); }
};

function paymentView(orderRef: string) {
  const p = ctl.payment.latestFor(orderRef);
  if (!p) return null;
  const refund = ctl.payment.latestFor(orderRef, "Refund");
  return {
    id: p.id, amount: p.amount, purpose: p.purpose, result: p.result, transactionRef: p.transactionRef, failureCode: p.failureCode,
    requestedAt: p.requestedAt, settledAt: p.settledAt, open: p.open, lateResult: p.lateResult,
    timeoutMs: config().value("PAYMENT_GATEWAY_TIMEOUT"),
    refund: refund ? { id: refund.id, amount: refund.amount, result: refund.result, transactionRef: refund.transactionRef } : null,
  };
}

export function allocationView(a: Allocation) {
  const base = { id: a.id, kind: a.kind, status: a.status, hubId: a.hubId, hubName: db.hubs.get(a.hubId)?.name ?? a.hubId, fee: a.fee, expiresAt: a.expiresAt, createdAt: a.createdAt, transactionRef: a.transactionRef, payment: paymentView(a.id), history: a.history };
  if (a instanceof VehicleReservation) {
    const v = db.vehicles.get(a.vehicleId);
    return { ...base, vehicleId: a.vehicleId, movedFrom: a.movedFrom, vehicle: v ? { ...v.getSummary(), dock: v.dockId ? db.docks.get(v.dockId)?.label : null } : null, holdMs: config().value("PAYMENT_HOLD_VEHICLE") };
  }
  if (a instanceof ParkingReservation) {
    const sp = db.spaces.get(a.spaceId);
    return { ...base, spaceId: a.spaceId, spaceLabel: sp?.label, window: a.window, vehicleId: a.privateVehicleId, holdMs: config().value("PAYMENT_HOLD_BOOKING") };
  }
  if (a instanceof ChargingSession) {
    return { ...base, pointId: a.pointId, slot: a.slot, vehicleId: a.vehicleRef, neededBy: a.neededBy, originalStart: a.originalStart, targetSoc: a.targetSoc, sessionKind: a.sessionKind, holdMs: config().value("PAYMENT_HOLD_BOOKING") };
  }
  if (a instanceof Trip) return tripView(a);
  return base;
}

export function tripView(t: Trip) {
  const v = db.vehicles.get(t.vehicleId)!;
  const now = clock().now();
  const end = t.endTime ?? now;
  const minutes = Math.max(1, Math.ceil((end - t.startTime) / 60000));
  return {
    id: t.id, kind: t.kind, status: t.status, vehicleId: t.vehicleId, type: v.type, model: v.model, ratePerHour: v.ratePerHour, soc: Math.round(v.soc),
    startTime: t.startTime, endTime: t.endTime, hubId: t.hubId, hubName: db.hubs.get(t.hubId)?.name, startDock: t.startDock,
    endHubId: t.endHubId, endHubName: t.endHubId ? db.hubs.get(t.endHubId)?.name : null, endDock: t.endDock, reservationId: t.reservationId,
    distanceKm: t.status === "Open" ? Math.max(0, Math.round((v.odometerKm - t.startOdometerKm) * 10) / 10) : t.distanceKm,
    fareSoFar: Math.round((minutes * v.ratePerHour) / 60) + config().value("UNLOCK_FEE"),
    fare: t.fare, fareStatus: t.fareStatus, fareBreakdown: t.fareBreakdown, transactionRef: t.transactionRef, payment: paymentView(t.id), closedByIncident: t.closedByIncident,
  };
}

export function studentRoutes(): Router {
  const r = Router();
  const s = () => db.students.get(STUDENT)!;
  const location = (vehicleHub: string) => {
    const l = dataSource().studentLocation;
    return { hubId: l.hubId ?? vehicleHub, insideGeofence: l.inside };
  };

  /** The home view model: everything the app needs to decide which screen and banner to show. */
  r.get("/home", (_req, res) => {
    const st = s();
    const vr = st.getActiveAllocations().find((a) => a instanceof VehicleReservation) as VehicleReservation | undefined;
    const lastVr = vr ?? ([...db.allocations.values()].filter((a) => a instanceof VehicleReservation && a.studentId === STUDENT).sort((a, b) => b.createdAt - a.createdAt)[0] as VehicleReservation | undefined);
    const trip = st.hasOngoingTrip();
    const lastTrip = [...db.allocations.values()].filter((a) => a instanceof Trip && a.studentId === STUDENT && a.status === "Closed").sort((a, b) => (b as Trip).endTime! - (a as Trip).endTime!)[0] as Trip | undefined;
    const unpaid = st.unpaidTrip();
    const pickup = ctl.rental.pickupFor(STUDENT);
    res.json({
      student: { id: st.id, name: st.name, vehicles: st.vehicles.map((v) => ({ id: v.id, type: v.type, label: v.label })) },
      blocked: unpaid ? { tripId: unpaid.id, fare: unpaid.fare } : null,
      reservation: vr ? allocationView(vr) : null,
      lastReservation: lastVr ? allocationView(lastVr) : null,
      pickup: pickup ? { vehicleId: pickup.vehicleId, state: pickup.state, message: pickup.message, incidentId: pickup.incidentId, reservationId: pickup.reservationId } : null,
      trip: trip ? tripView(trip) : null,
      lastTrip: lastTrip ? tripView(lastTrip) : null,
      unread: db.notifications.filter((n) => n.studentId === STUDENT && !n.read).length,
      location: dataSource().studentLocation,
    });
  });

  // UC-01
  r.get("/search", (req, res) => {
    const q = req.query as Record<string, string>;
    const nearMe = q.nearMe === "1";
    if (!q.text && !q.type && !q.minSoc) return res.json(ctl.search.openSearch(nearMe ? "granted" : "denied").roster);
    res.json(ctl.search.search({ text: q.text ?? "", type: (q.type as never) || "any", minSoc: Number(q.minSoc ?? 0), nearMe }));
  });
  r.get("/hub/:id", (req, res) => res.json(ctl.search.hubDetail(req.params.id)));

  // UC-02
  r.post("/reserve/request", wrap((req) => ctl.reservation.requestReservation(req.body.vehicleId, STUDENT)));
  r.post("/reserve/confirm", wrap((req) => allocationView(ctl.reservation.confirmReservation(req.body.vehicleId, STUDENT))));
  r.post("/reserve/discard", wrap(() => ctl.reservation.discardRequest(STUDENT)));
  r.get("/allocation/:id", (req, res) => {
    const a = db.allocations.get(req.params.id);
    if (!a || a.studentId !== STUDENT) return res.status(404).json({ error: "Not found" });
    res.json(allocationView(a));
  });

  // UC-07
  r.post("/pickup", wrap((req) => {
    const vr = VehicleReservation.findConfirmed(STUDENT);
    const id = (req.body.vehicleId as string | undefined)?.trim().toUpperCase() || null;
    const vehicleHub = db.vehicles.get(vr?.vehicleId ?? id ?? "")?.hubId;
    if (!vehicleHub) throw new UserError(`No vehicle ${id ?? ""} found. Check the ID printed on the vehicle.`, 404, "E1");
    return ctl.rental.requestPickup(STUDENT, id, location(vehicleHub));
  }));
  r.post("/pickup/unlock", wrap(() => ctl.rental.unlockAndStartTrip(STUDENT)));
  r.post("/pickup/cancel", wrap(() => ctl.rental.cancelPickup(STUDENT)));
  r.get("/pickup", (_req, res) => {
    const p = ctl.rental.pickupFor(STUDENT);
    res.json(p ? ctl.rental.summary(p) : null);
  });

  // UC-08
  r.get("/trip/:id", (req, res) => {
    const t = db.allocations.get(req.params.id);
    if (!(t instanceof Trip) || t.studentId !== STUDENT) return res.status(404).json({ error: "Not found" });
    res.json(tripView(t));
  });
  r.get("/docks/:hubId", (req, res) => res.json(ctl.rental.getVacantDocks(req.params.hubId)));
  r.post("/trip/end", wrap(() => ctl.rental.endTrip(STUDENT)));
  r.post("/fare/pay", wrap(() => ctl.rental.payFare(STUDENT)));

  // UC-04 Reserve parking space
  r.get("/parking/start", (_req, res) => res.json(ctl.reservation.startReservation(STUDENT)));
  r.post("/vehicle", wrap((req) => ctl.reservation.registerVehicle(STUDENT, req.body.type, String(req.body.id ?? ""))));
  r.post("/parking/window", wrap((req) => ctl.reservation.submitTimeWindow(STUDENT, req.body.hubId, req.body.vehicleId, Number(req.body.arrival), Number(req.body.departure))));
  r.post("/parking/alt", wrap((req) => ctl.reservation.chooseAlternative(STUDENT, Number(req.body.index))));
  r.post("/parking/confirm", wrap(() => allocationView(ctl.reservation.confirmReservation(STUDENT))));
  r.post("/parking/discard", wrap(() => ctl.reservation.discardRequest(STUDENT)));

  // UC-05 Schedule charging session
  r.get("/charging/start", (req, res) => res.json(ctl.charging.startScheduling(STUDENT, req.query.hubId as string | undefined)));
  r.post("/charging/request", wrap((req) => {
    const b = req.body as Record<string, unknown>;
    return ctl.charging.submitRequest(STUDENT, { hubId: String(b.hubId), privateVehicleId: String(b.vehicleId), from: Number(b.from), to: Number(b.to), neededBy: b.neededBy ? Number(b.neededBy) : null, currentSoc: Number(b.currentSoc), targetSoc: Number(b.targetSoc) });
  }));
  r.post("/charging/alt", wrap((req) => ctl.charging.chooseAlternative(STUDENT, Number(req.body.index))));
  r.post("/charging/confirm", wrap(() => allocationView(ctl.charging.confirmProposal(STUDENT))));
  r.post("/charging/discard", wrap(() => ctl.charging.discardRequest(STUDENT)));

  // UC-06 Report issue
  r.get("/report/start", (_req, res) => res.json(ctl.issue.startReport(STUDENT)));
  r.get("/report/resources/:hubId", (req, res) => res.json(ctl.issue.resourcesAt(req.params.hubId)));
  r.post("/report", wrap((req) => ctl.issue.submitReport(STUDENT, req.body.category, String(req.body.resourceId ?? ""), String(req.body.description ?? ""), (req.body.photos as string[]) ?? [], req.body.key)));
  r.get("/reports", (_req, res) => res.json(ctl.issue.reportsOf(STUDENT)));

  // S11 My bookings
  r.get("/bookings", (_req, res) => {
    const mine = [...db.allocations.values()].filter((a) => a.studentId === STUDENT && (a.kind !== "ChargingSession" || (a as ChargingSession).isCommittedReservation()));
    const views = mine.sort((a, b) => b.createdAt - a.createdAt).map((a) => ({ ...allocationView(a), active: a.isActive(), createdAt: a.createdAt }));
    res.json({ active: views.filter((v) => v.active), past: views.filter((v) => !v.active) });
  });

  // S12 notifications
  r.get("/notifications", (_req, res) => res.json(db.notifications.filter((n) => n.studentId === STUDENT).sort((a, b) => b.time - a.time)));
  r.post("/notifications/read", wrap((req) => {
    for (const n of db.notifications) if (n.studentId === STUDENT && (!req.body.id || n.id === req.body.id)) n.read = true;
  }));

  return r;
}
