// control.operations — IncidentController (control method descriptions 3.4), UC-12.
// The operator decides what a fault means (BR-INC-01). A block on a resource reaches the
// students who hold it: BR-RES-02 moves or cancels their allocations and MobileApp.notify
// pushes the outcome to the phone (the cross-actor push of the demo).
import { db, audit, nextId } from "../../domain/store";
import { clock, fmtHM } from "../../platform/clock/DemoClock";
import { Incident } from "../../domain/operations/Incident";
import { Action } from "../../domain/operations/Action";
import { IssueReport } from "../../domain/operations/IssueReport";
import { VehicleReservation } from "../../domain/allocation/VehicleReservation";
import { ParkingReservation } from "../../domain/allocation/ParkingReservation";
import { ChargingSession } from "../../domain/allocation/ChargingSession";
import { Trip } from "../../domain/allocation/Trip";
import { Allocation } from "../../domain/allocation/Allocation";
import { ChargingPoint } from "../../domain/network/ChargingPoint";
import { Vehicle } from "../../domain/network/Vehicle";
import { findResource, resourceLabel } from "../../domain/network/lookup";
import { MobileApp } from "../../api/push";
import { UserError } from "../../api/errors";
import { bus } from "../../platform/events/bus";
import type { ReservationController } from "../booking/ReservationController";
import type { RentalController } from "../booking/RentalController";
import type { ChargingController } from "./ChargingController";
import type { RedistributionController } from "./RedistributionController";

export interface ActionOutcome { allocationId: string; kind: string; studentId: string; outcome: "moved" | "cancelled" | "awaiting" | "closed"; detail: string }

const OPERATOR = "OP-014";
const vnd = (n: number) => `${n.toLocaleString("en-US")} VND`;

export class IncidentController {
  constructor(
    private readonly reservations: ReservationController,
    private readonly rental: RentalController,
    private readonly charging: ChargingController,
    private readonly redistribution: RedistributionController,
  ) {}

  /** listIncidents() : Incident[*] — UC-12 step 2 (plus the closed ones for the other tabs). */
  listIncidents() {
    const all = [...db.incidents.values()].sort((a, b) => b.createdAt - a.createdAt);
    const row = (i: Incident) => {
      const r = findResource(i.resourceId);
      const trip = r?.kind === "Vehicle" ? [...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === r.id && a.isActive()) as Trip | undefined : undefined;
      return { id: i.id, status: i.status, source: i.source, resourceId: i.resourceId, resourceLabel: r ? resourceLabel(r) : i.resourceId, hubId: i.hubId, onTrip: !!trip,
        category: i.category, createdAt: i.createdAt, owner: i.owner, blocking: i.blocking, reports: IssueReport.findLinked(i.id).length };
    };
    const open = all.filter((i) => i.isUnresolved());
    const oldest = open.filter((i) => i.status === "Open").reduce((m, i) => Math.min(m, i.createdAt), Infinity);
    return { active: open.map(row), resolved: all.filter((i) => i.status === "Resolved").map(row), dismissed: all.filter((i) => i.status === "Dismissed").map(row),
      counts: { open: open.filter((i) => i.status === "Open").length, inProgress: open.filter((i) => i.status === "In Progress").length }, oldestOpenAt: Number.isFinite(oldest) ? oldest : null };
  }

  /** openIncident(incidentId : String) : IncidentDetails — UC-12 step 4, E1. */
  openIncident(incidentId: string) {
    const i = this.mustGet(incidentId);
    const d = i.getDetails();
    const r = findResource(i.resourceId);
    let trip: Trip | undefined;
    let live: Record<string, unknown> | null = null;
    if (r instanceof Vehicle) {
      trip = [...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === r.id && a.isActive()) as Trip | undefined;
      live = { soc: Math.round(r.soc), type: r.type, model: r.model, location: trip ? "On the road" : r.hubId, onTrip: trip ? { id: trip.id, studentId: trip.studentId, startTime: trip.startTime } : null };
    }
    const reportedAt = IssueReport.findLinked(i.id).reduce((m, x) => Math.min(m, x.time), Infinity);
    const hub = db.hubs.get(i.resourceId);
    return {
      ...d, live, hubStale: hub ? hub.isStale() : null,
      // E1: the status cannot be confirmed when the resource (or its Hub) has gone quiet.
      unconfirmed: !!(d.resource?.stale || (hub && hub.isStale())),
      canVerifyBreakdown: !!trip && i.category === "vehicle failure" && i.isUnresolved(),
      breakdownTime: trip && Number.isFinite(reportedAt) ? reportedAt : null,
      affectedDetail: this.affected(i).map((a) => this.describe(a)),
    };
  }

  /** openFromAlert(resource : Resource) : IncidentDraft — UC-12 3b: the matching incident, or a pre-filled form. */
  openFromAlert(resourceId: string): { incidentId: string | null; draft: { resourceId: string; hubId: string; category: string; description: string } | null } {
    const r = findResource(resourceId);
    const hub = db.hubs.get(resourceId);
    const found = [...db.incidents.values()].find((i) => i.isUnresolved() && i.resourceId === resourceId);
    if (found) return { incidentId: found.id, draft: null };
    if (!r && !hub) throw new UserError(`Unknown resource ${resourceId}`, 404);
    return { incidentId: null, draft: { resourceId, hubId: hub?.id ?? r!.hubId, category: hub ? "Hub disconnected" : r!.kind === "Vehicle" ? "vehicle failure" : r!.kind === "ChargingPoint" ? "charging point unavailable or faulty" : "parking space blocked or occupied", description: hub?.isStale() ? `No data from ${hub.id} for over DATA_STALE_AFTER.` : "" } };
  }

  /** createIncident(resource, category, desc) : String — UC-12 3a: raised by the operator. */
  createIncident(resourceId: string, category: string, desc: string, operatorId = OPERATOR): string {
    if (!category.trim() || desc.trim().length < 5) throw new UserError("Choose a category and describe the problem.", 422);
    const r = findResource(resourceId);
    const hub = db.hubs.get(resourceId);
    if (!r && !hub) throw new UserError(`Unknown resource ${resourceId}`, 404);
    const dupe = [...db.incidents.values()].find((i) => i.isUnresolved() && i.resourceId === resourceId && i.category === category);
    if (dupe) return dupe.id;
    let inc: Incident;
    if (r) inc = Incident.findOrOpen(r, category, desc.trim(), "operator");
    else {
      inc = new Incident(nextId("INC", "num"), hub!.id, hub!.id, category, desc.trim(), "operator");
      db.incidents.set(inc.id, inc);
      inc.actions.push(new Action(`Opened by ${operatorId}: ${desc.trim()}`, operatorId, clock().now(), false, "system"));
    }
    audit(operatorId, "UC-12 incident created", inc.id, "", resourceId);
    bus.changed("incident");
    return inc.id;
  }

  /** startHandling(note : String) : void — UC-12 step 5. */
  startHandling(incidentId: string, note: string, version: number, operatorId = OPERATOR): void {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    if (i.status !== "Open") throw new UserError(`${i.id} is ${i.status}.`, 409);
    i.startHandling(operatorId, clock().now(), note.trim() || "Started handling");
    audit(operatorId, "UC-12 start handling", i.id, "Open", "In Progress");
    bus.changed("incident");
  }

  /**
   * saveAction(note, blockRequested) : ActionOutcome — UC-12 step 6, E2. With a block, the
   * resource is blocked, the affected allocations are moved or cancelled (BR-RES-02) and the
   * students are told. Rejected wholesale if the incident changed since it was opened.
   */
  saveAction(incidentId: string, note: string, blockRequested: boolean, version: number, operatorId = OPERATOR): ActionOutcome[] {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    if (!i.isUnresolved()) throw new UserError(`${i.id} is ${i.status}.`, 409);
    if (!note.trim() && !blockRequested) throw new UserError("Write what was done.", 422);
    if (i.status === "Open") i.startHandling(operatorId, clock().now(), "Started handling");
    const r = findResource(i.resourceId);
    if (blockRequested && !r) throw new UserError("A Hub cannot be blocked; block its docks, points or vehicles instead.", 422);
    const outcomes: ActionOutcome[] = [];
    if (blockRequested && r && !r.blocks.has(i.id)) {
      const affected = this.affected(i);
      r.block(i.id);
      for (const a of affected) outcomes.push(this.handleAffected(i, a, r.id));
      if (r instanceof ChargingPoint) {
        const res = this.charging.reschedulePoint(r, `blocked by ${operatorId} on ${i.id}`);
        for (const id of res.moved) outcomes.push({ allocationId: id, kind: "ChargingSession", studentId: db.allocations.get(id)!.studentId, outcome: "moved", detail: "moved within CHARGING_SHIFT_TOLERANCE (UC-11 1a)" });
        for (const id of res.cancelled) outcomes.push({ allocationId: id, kind: "ChargingSession", studentId: db.allocations.get(id)!.studentId, outcome: "cancelled", detail: "no point within tolerance; refund requested" });
      }
      if (r instanceof Vehicle && r.usage === "In Redistribution") {
        this.redistribution.breakdown(r.id);
        outcomes.push({ allocationId: r.orderId ?? "order", kind: "VehicleTransfer", studentId: "-", outcome: "awaiting", detail: "transfer Removed by UC-10 E5" });
      }
    }
    const summary = outcomes.length ? ` · ${outcomes.map((o) => `${o.allocationId} ${o.outcome}`).join(", ")}` : "";
    i.addAction(new Action(`${blockRequested ? `Blocked ${r ? resourceLabel(r) : i.resourceId}` : ""}${blockRequested && note.trim() ? " · " : ""}${note.trim()}${summary}`, operatorId, clock().now(), blockRequested, "action"));
    audit(operatorId, blockRequested ? "UC-12 block resource" : "UC-12 action", i.id, "", note);
    bus.changed("incident");
    return outcomes;
  }

  private affected(i: Incident): Allocation[] {
    return Allocation.findActive(i.resourceId).filter((a) => !(a instanceof ChargingSession && !a.isCommittedReservation()));
  }

  private describe(a: Allocation) {
    const extra = a instanceof ParkingReservation ? ` · ${fmtHM(a.window.start)}–${fmtHM(a.window.end)}` : a instanceof ChargingSession && a.slot ? ` · ${fmtHM(a.slot.start)}–${fmtHM(a.slot.end)}` : "";
    return { id: a.id, kind: a.kind, status: a.status, studentId: a.studentId, detail: `${a.kind.replace(/([a-z])([A-Z])/g, "$1 $2")}${extra}` };
  }

  /** BR-INC-01: each allocation goes to the use case that owns it. */
  private handleAffected(i: Incident, a: Allocation, resourceId: string): ActionOutcome {
    const base = { allocationId: a.id, kind: a.kind, studentId: a.studentId };
    if (a.status === "Pending Payment") { i.recordAwaiting(a); return { ...base, outcome: "awaiting", detail: "payment still open; the paying use case releases the hold (E9)" }; }
    if (a instanceof VehicleReservation) {
      if (a.status === "Pickup In Progress") { i.recordAwaiting(a); return { ...base, outcome: "awaiting", detail: "pickup re-checks the vehicle before the unlock (UC-07 E2)" }; }
      const out = this.reservations.moveOrCancelVehicleReservation(a, `an operator blocked ${resourceId} on ${i.id}`);
      return { ...base, outcome: out, detail: out === "moved" ? `moved to ${a.vehicleId} (BR-RES-02)` : out === "cancelled" ? `no replacement free · ${vnd(a.fee)} refund requested (BR-PAY-02)` : "awaiting" };
    }
    if (a instanceof ParkingReservation) {
      if (a.status === "Checked-in") { i.recordAwaiting(a); return { ...base, outcome: "awaiting", detail: "student already parked; staff handle it on site" }; }
      const out = this.reservations.moveOrCancelParking(a, `an operator blocked it on ${i.id}`);
      return { ...base, outcome: out, detail: out === "moved" ? `moved to ${db.spaces.get(a.spaceId)?.label} (BR-RES-02)` : out === "cancelled" ? `no replacement free · ${vnd(a.fee)} refund requested (BR-PAY-02)` : "awaiting" };
    }
    if (a instanceof Trip) { i.recordAwaiting(a); return { ...base, outcome: "awaiting", detail: "the trip stays open until return or a verified breakdown (8c)" }; }
    i.recordAwaiting(a);
    return { ...base, outcome: "awaiting", detail: "handled by its own use case" };
  }

  /** recordCorrective(action : Action) : void — UC-12 steps 7, 8a, 8b. */
  recordCorrective(incidentId: string, note: string, ref: { orderId?: string; schedule?: string } = {}, operatorId = OPERATOR): void {
    const i = this.mustGet(incidentId);
    if (ref.orderId) { const o = db.orders.get(ref.orderId); if (o) i.recordOrder(o.id, o.status); }
    if (ref.schedule) i.recordRescheduling(ref.schedule);
    i.addAction(new Action(`Corrective: ${note}${ref.orderId ? ` (order ${ref.orderId})` : ""}${ref.schedule ? ` (${ref.schedule})` : ""}`, operatorId, clock().now(), false, "corrective"));
    bus.changed("incident");
  }

  /**
   * recordVerification(verdict, time) : void — UC-12 8c. A verified breakdown closes the trip at
   * the reported time, waives the fare (BR-PAY-05), keeps the vehicle out of service and tells the student.
   */
  recordVerification(incidentId: string, version: number, operatorId = OPERATOR): ActionOutcome {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    const v = db.vehicles.get(i.resourceId);
    const trip = v ? [...db.allocations.values()].find((a) => a instanceof Trip && a.vehicleId === v.id && a.isActive()) as Trip | undefined : undefined;
    if (!v || !trip) throw new UserError("There is no open trip on this vehicle to close.", 409);
    const reported = IssueReport.findLinked(i.id).filter((r) => r.studentId === trip.studentId).reduce((m, r) => Math.min(m, r.time), Infinity);
    const at = Number.isFinite(reported) ? reported : clock().now();
    if (i.status === "Open") i.startHandling(operatorId, clock().now(), "Started handling");
    trip.closeTrip(at);
    trip.closedByIncident = i.id;
    trip.fare = 0;
    trip.fareBreakdown = [{ label: "Fare waived · verified breakdown", amount: 0 }];
    trip.setFare("Waived");
    v.setStatus("Idle");
    v.dockId = null;
    v.block(i.id);
    i.addAction(new Action(`Verified breakdown during trip ${trip.id}: trip closed at ${fmtHM(at)}, fare Waived (8c). ${v.id} Under Maintenance.`, operatorId, clock().now(), true, "verification"));
    this.notifyAffectedStudents([{ allocationId: trip.id, kind: "Trip", studentId: trip.studentId, outcome: "closed", detail: `closed at ${fmtHM(at)}` }], i);
    audit(operatorId, "UC-12 breakdown verified", i.id, "", trip.id);
    bus.changed("incident");
    return { allocationId: trip.id, kind: "Trip", studentId: trip.studentId, outcome: "closed", detail: `closed at ${fmtHM(at)}, fare Waived` };
  }

  /** saveProgress(note : String, pending : String) : void — UC-12 step 9. */
  saveProgress(incidentId: string, note: string, pending: string, version: number, operatorId = OPERATOR): void {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    i.recordProgress(note, pending);
    i.addAction(new Action(`Progress saved: ${note}${pending ? ` · pending: ${pending}` : ""}`, operatorId, clock().now(), false, "progress"));
    bus.changed("incident");
  }

  /** resolve(incidentId : String) : void — UC-12 step 10. */
  resolve(incidentId: string, resolution: string, version: number, operatorId = OPERATOR): void {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    if (!i.isUnresolved()) throw new UserError(`${i.id} is ${i.status}.`, 409);
    if (!resolution.trim()) throw new UserError("Say how it was resolved.", 422);
    i.resolve(resolution.trim(), operatorId, clock().now());
    this.afterClose(i);
    this.notifyReporters(i, `was resolved by an operator: ${resolution.trim()}`);
    audit(operatorId, "UC-12 resolved", i.id, "", resolution);
    bus.changed("incident");
  }

  /** dismiss(reason : String, originalId : String) : void — UC-12 step 11 / 9b. */
  dismiss(incidentId: string, reason: string, originalId: string | null, version: number, operatorId = OPERATOR): void {
    const i = this.mustGet(incidentId);
    this.checkVersion(i, version);
    if (!i.isUnresolved()) throw new UserError(`${i.id} is ${i.status}.`, 409);
    if (!reason.trim()) throw new UserError("Give a reason (false or duplicate report).", 422);
    if (originalId && !db.incidents.get(originalId)) throw new UserError(`Unknown incident ${originalId}`, 404);
    i.dismiss(reason.trim(), originalId, operatorId);
    this.afterClose(i);
    this.notifyReporters(i, `was closed without action: ${reason.trim()}`);
    audit(operatorId, "UC-12 dismissed", i.id, "", reason);
    bus.changed("incident");
  }

  /** After a close the resource is re-evaluated; a freed point lets the queue be rescheduled. */
  private afterClose(i: Incident): void {
    const r = findResource(i.resourceId);
    if (r instanceof Vehicle) r.reevaluate();
    if (r instanceof ChargingPoint) r.scheduleVersion++;
  }

  /** - notifyAffectedStudents(allocations) : void — UC-12 step 6, 8c. */
  private notifyAffectedStudents(outcomes: ActionOutcome[], i: Incident): void {
    for (const o of outcomes) if (o.kind === "Trip" && o.outcome === "closed") {
      const t = db.allocations.get(o.allocationId) as Trip;
      MobileApp.notify(o.studentId, "Trip closed · fare waived", `An operator confirmed the breakdown of ${t.vehicleId} (${i.id}). Trip ${t.id} was closed at ${fmtHM(t.endTime!)} and the fare is waived. Thank you for reporting it.`, "ok", t.id);
    }
  }

  /** - notifyReporters(outcome) : void — UC-12 steps 10, 11: a report is never silently closed. */
  private notifyReporters(i: Incident, how: string): void {
    const told = new Set<string>();
    for (const rep of IssueReport.findLinked(i.id)) for (const s of rep.submissions) {
      if (told.has(s.studentId) || !db.students.has(s.studentId)) continue;
      told.add(s.studentId);
      MobileApp.notify(s.studentId, i.status === "Resolved" ? "Report resolved" : "Report closed", `Report ${rep.id} about ${rep.resourceId} ${how}`, i.status === "Resolved" ? "ok" : "neutral", rep.id);
    }
  }

  private checkVersion(i: Incident, version: number): void {
    if (Number.isFinite(version) && !i.checkUnchanged(version))
      throw new UserError(`${i.id} was changed by someone else since you opened it (E2). Nothing was saved; review the latest state.`, 409, "E2");
  }

  private mustGet(id: string): Incident {
    const i = db.incidents.get(id);
    if (!i) throw new UserError(`Unknown incident ${id}`, 404);
    return i;
  }
}
