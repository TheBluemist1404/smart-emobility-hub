// Builds the in-memory entities from seed/seed.json (the brief allows hard-coded data).
import { readFileSync } from "node:fs";
import { db, clearStore, setCounter } from "../domain/store";
import { Hub } from "../domain/network/Hub";
import { Dock } from "../domain/network/Dock";
import { Vehicle } from "../domain/network/Vehicle";
import { ChargingPoint } from "../domain/network/ChargingPoint";
import { ParkingSpace } from "../domain/network/ParkingSpace";
import { findResource } from "../domain/network/lookup";
import { StudentAccount } from "../domain/allocation/StudentAccount";
import { VehicleReservation } from "../domain/allocation/VehicleReservation";
import { ParkingReservation } from "../domain/allocation/ParkingReservation";
import { ChargingSession } from "../domain/allocation/ChargingSession";
import { Trip } from "../domain/allocation/Trip";
import { Payment } from "../domain/allocation/Payment";
import { Incident } from "../domain/operations/Incident";
import { Action } from "../domain/operations/Action";
import { IssueReport } from "../domain/operations/IssueReport";
import { RedistributionOrder } from "../domain/operations/RedistributionOrder";
import { VehicleTransfer } from "../domain/operations/VehicleTransfer";
import type { HubCategory, UsageState, VehicleType, IssueCategory } from "../domain/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const t = (s: string | null | undefined): number => (s ? Date.parse(s) : 0);
const setCreated = (o: object, time: number) => {
  (o as Any).createdAt = time;
  const h = (o as Any).history as Array<{ time: number }> | undefined;
  if (h?.[0]) h[0].time = time;
};

export function readSeed(): Any {
  return JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf-8"));
}

export function loadSeed(seed: Any = readSeed()): void {
  clearStore();

  for (const h of seed.hubs) db.hubs.set(h.id, new Hub(h.id, h.name, h.category as HubCategory, h.openHours, h.x, h.y, t(h.lastUpdate)));
  for (const d of seed.docks) db.docks.set(d.id, new Dock(d.id, d.hubId, d.label, db.hubs.get(d.hubId)!.lastUpdateTime));
  for (const p of seed.points) db.points.set(p.id, new ChargingPoint(p.id, p.hubId, p.power, db.hubs.get(p.hubId)!.lastUpdateTime));
  for (const s of seed.spaces) db.spaces.set(s.id, new ParkingSpace(s.id, s.hubId, s.label, s.type as VehicleType, db.hubs.get(s.hubId)!.lastUpdateTime));

  for (const v of seed.vehicles) {
    const veh = new Vehicle(v.id, v.hubId, v.type, v.soc, t(v.updated));
    veh.odometerKm = v.odometerKm;
    if (v.dock) {
      const d = db.docks.get(v.dock)!;
      d.latched = true; d.vehicleId = v.id; veh.dockId = d.id;
    }
    if (v.usage) veh.usage = v.usage as UsageState;
    veh.heldBy = v.heldBy ?? null;
    veh.orderId = v.orderId ?? null;
    db.vehicles.set(v.id, veh);
  }

  for (const s of seed.students) {
    const acc = new StudentAccount(s.id, s.name, s.email ?? "");
    for (const pv of s.vehicles ?? []) acc.addVehicle(pv.type, pv.id);
    db.students.set(s.id, acc);
  }

  const seedPayment = (orderRef: string, studentId: string, amount: number, tx: string | null, purpose: string, at: number, refund?: string) => {
    if (!tx) return null;
    const p = new Payment(`PAY-${orderRef}`, "Charge", orderRef, studentId, amount, purpose);
    (p as Any).requestedAt = at;
    p.settle("Success", tx, null);
    (p as Any).settledAt = at;
    db.payments.set(p.id, p);
    if (refund) {
      const r = new Payment(`PAY-${orderRef}-R`, "Refund", orderRef, studentId, amount, `Refund · ${purpose}`);
      r.originalRef = tx;
      if (refund === "Success") r.settle("Success", tx.replace(/-(\d+)$/, (_m, n) => `-${Number(n) + 5}`), null);
      db.payments.set(r.id, r);
    }
    return p;
  };

  for (const r of seed.vehicleReservations) {
    const vr = new VehicleReservation(r.id, r.studentId, r.vehicleId, r.hubId);
    vr.status = r.status; vr.fee = r.fee; vr.transactionRef = r.tx ?? null; vr.expiresAt = t(r.expires);
    setCreated(vr, t(r.created));
    vr.paymentId = seedPayment(r.id, r.studentId, r.fee, r.tx, "Vehicle reservation · UC-02", t(r.created), r.refund)?.id ?? null;
    db.allocations.set(vr.id, vr);
  }

  for (const r of seed.parkingReservations) {
    const pr = new ParkingReservation(r.id, r.studentId, r.spaceId, r.hubId, { start: t(r.start), end: t(r.end) }, r.plate);
    pr.status = r.status; pr.fee = r.fee; pr.transactionRef = r.tx ?? null;
    pr.expiresAt = t(r.start) + 15 * 60_000;
    pr.movedFrom = r.movedFrom ?? null;
    if (r.status === "Checked-in") pr.checkedInAt = t(r.start);
    setCreated(pr, t(r.created));
    pr.paymentId = seedPayment(r.id, r.studentId, r.fee, r.tx, "Parking reservation · UC-04", t(r.created), r.refund)?.id ?? null;
    if (["Confirmed", "Checked-in"].includes(r.status)) db.spaces.get(r.spaceId)!.windows.push({ start: t(r.start), end: t(r.end), state: "Booked", ref: r.id });
    db.allocations.set(pr.id, pr);
  }

  for (const c of seed.chargingSessions) {
    const committed = c.kind === "committed reservation";
    const cs = new ChargingSession(c.id, c.studentId, c.kind, committed ? c.pointId : c.vehicleRef, c.hubId, c.vehicleRef);
    cs.status = c.status;
    cs.slot = { pointId: c.pointId, start: t(c.start), end: t(c.end) };
    cs.originalStart = c.originalStart ? t(c.originalStart) : t(c.start);
    cs.neededBy = c.neededBy ? t(c.neededBy) : null;
    cs.targetSoc = c.targetSoc ?? 80;
    cs.fee = c.fee ?? 0;
    cs.transactionRef = c.tx ?? null;
    cs.waitingSince = c.waitingSince ? t(c.waitingSince) : t(c.created);
    if (committed) {
      cs.window = { start: t(c.start), end: t(c.end) };
      cs.expiresAt = t(c.start) + 15 * 60_000;
      (cs as Any).currentSoc = c.currentSoc;
      setCreated(cs, t(c.created));
      cs.paymentId = seedPayment(c.id, c.studentId, c.fee, c.tx, "Charging session · UC-05", t(c.created))?.id ?? null;
    }
    const p = db.points.get(c.pointId)!;
    if (["Scheduled", "Charging"].includes(c.status)) p.bookings.push({ start: t(c.start), end: t(c.end), state: "Booked", ref: c.id });
    if (c.status === "Charging") {
      p.activeSessionId = c.id;
      const v = db.vehicles.get(c.vehicleRef);
      if (v) v.energy = "Charging";
    }
    db.allocations.set(cs.id, cs);
  }

  for (const tr of seed.trips) {
    const v = db.vehicles.get(tr.vehicleId)!;
    const trip = new Trip(tr.id, tr.studentId, tr.vehicleId, tr.hubId, tr.reservationId, tr.startSoc, v.odometerKm - 6, tr.startDock);
    (trip as Any).startTime = t(tr.start);
    setCreated(trip, t(tr.start));
    db.allocations.set(trip.id, trip);
  }

  for (const i of seed.incidents) {
    const inc = new Incident(i.id, i.resourceId, i.hubId, i.category, i.description, i.source);
    inc.status = i.status;
    inc.owner = i.owner ?? null;
    (inc as Any).createdAt = t(i.created);
    inc.actions.push(new Action(`Opened from ${i.source}: ${i.description}`, i.source === "operator" ? "OP-014" : "system", t(i.created), false, "system"));
    for (const a of i.actions ?? []) inc.actions.push(new Action(a.note, "OP-014", t(a.time), !!a.block, a.block ? "action" : "assessment"));
    inc.blocking = !!i.blocking && i.source !== "system" ? true : inc.blocking;
    inc.resolution = i.resolution ?? null;
    inc.dismissReason = i.dismissReason ?? null;
    if (!inc.isUnresolved()) inc.closedAt = t(i.created) + 3_600_000;
    db.incidents.set(inc.id, inc);
    const r = findResource(i.resourceId);
    if (r && inc.isUnresolved()) {
      if (i.blocking) r.block(inc.id);
      else if (r.kind === "Vehicle" && i.category === "vehicle failure") r.noteFault(inc.id);
    }
  }

  for (const r of seed.reports) {
    const rep = new IssueReport(r.id, { studentId: r.studentId, resourceId: r.resourceId, category: r.category as IssueCategory, description: r.description, photos: Array.from({ length: r.photos }, (_, k) => `photo-${k + 1}.jpg`), time: t(r.time) }, r.hubId);
    rep.status = r.status; rep.incidentId = r.incidentId;
    db.reports.set(rep.id, rep);
  }

  for (const o of seed.orders) {
    const ord = new RedistributionOrder(o.id, o.fromHub, o.toHub, o.model, o.quantity, t(o.deadline), "OP-014", "manual");
    ord.status = o.status;
    (ord as Any).createdAt = t(o.created);
    ord.history[0].time = t(o.created);
    (ord as Any).team = o.team;
    for (const tr of o.transfers) {
      const vt = new VehicleTransfer(o.id, tr.vehicleId, o.toHub, tr.destDock);
      vt.status = tr.status;
      ord.transfers.push(vt);
      if (tr.destDock && ["Assigned", "In Transit"].includes(tr.status)) db.docks.get(tr.destDock)!.allocatedTo = o.id;
    }
    if (ord.isOverdue()) ord.flagOverdue();
    db.orders.set(ord.id, ord);
  }

  db.notifications.push(...seed.notifications.map((n: Any) => ({ ...n, time: t(n.time) })));
  db.alerts.push(...seed.alerts.map((a: Any) => ({ ...a, time: t(a.time) })));

  // BR-RES-01 once over everything, docks first because vehicles read their dock.
  for (const d of db.docks.values()) d.reevaluate();
  for (const p of db.points.values()) p.reevaluate();
  for (const s of db.spaces.values()) s.reevaluate();
  for (const v of db.vehicles.values()) v.reevaluate();

  setCounter("INC", 192);
  setCounter("RO", 314);
  setCounter("TR", 941);
  setCounter("NT", 3);
}
