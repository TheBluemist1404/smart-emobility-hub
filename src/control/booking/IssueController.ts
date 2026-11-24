// control.booking — IssueController (control method descriptions 2.4), UC-06 Report Issue.
import { db, nextId, audit } from "../../domain/store";
import { clock, fmtHM } from "../../platform/clock/DemoClock";
import { IssueReport, type Submission } from "../../domain/operations/IssueReport";
import { Incident } from "../../domain/operations/Incident";
import { Action } from "../../domain/operations/Action";
import { VehicleReservation } from "../../domain/allocation/VehicleReservation";
import { ParkingReservation } from "../../domain/allocation/ParkingReservation";
import { ChargingSession } from "../../domain/allocation/ChargingSession";
import { Trip } from "../../domain/allocation/Trip";
import { findResource, resourceLabel } from "../../domain/network/lookup";
import { ISSUE_CATEGORIES, type IssueCategory } from "../../domain/types";
import { OperatorConsole } from "../../api/push";
import { UserError } from "../../api/errors";
import type { RentalController } from "./RentalController";

export interface Violation { field: "category" | "description" | "resource"; message: string }
export interface ProposedResource { resourceId: string; kind: string; label: string; hubId: string | null; why: string; allocationId: string; category: IssueCategory; location?: string | null }

const CATEGORY_KIND: Record<string, string | null> = {
  "vehicle failure": "Vehicle", "charging point unavailable or faulty": "ChargingPoint", "parking space blocked or occupied": "ParkingSpace", "Hub facility problem": "Hub", other: null,
};

export class IssueController {
  /** Submission keys already filed, so a resend after E2 is recognised (6a). */
  private readonly sent = new Map<string, string>();

  constructor(private readonly rental: RentalController) {}

  /** startReport(studentId : String) : ReportOptions — UC-06 step 2, 2a, 2b. */
  startReport(studentId: string) {
    const s = db.students.get(studentId);
    if (!s) throw new UserError("Unknown student", 404);
    const proposals: ProposedResource[] = [];
    const pickup = this.rental.pickupFor(studentId);
    if (pickup) proposals.push({ resourceId: pickup.vehicleId, kind: "Vehicle", label: pickup.vehicleId, hubId: db.vehicles.get(pickup.vehicleId)?.hubId ?? null, why: "Picking up", allocationId: pickup.reservationId ?? "walk-up", category: "vehicle failure" });
    for (const a of s.getActiveAllocations()) {
      if (a instanceof Trip) {
        const v = db.vehicles.get(a.vehicleId)!;
        proposals.push({ resourceId: v.id, kind: "Vehicle", label: v.id, hubId: null, why: "On your trip", allocationId: a.id, category: "vehicle failure", location: `Last reported by the vehicle at ${fmtHM(v.lastUpdateTime)}` });
      } else if (a instanceof VehicleReservation && !proposals.some((p) => p.resourceId === a.vehicleId)) {
        proposals.push({ resourceId: a.vehicleId, kind: "Vehicle", label: a.vehicleId, hubId: a.hubId, why: a.status === "Pickup In Progress" ? "Picking up" : "Reserved", allocationId: a.id, category: "vehicle failure" });
      } else if (a instanceof ParkingReservation) {
        proposals.push({ resourceId: a.spaceId, kind: "ParkingSpace", label: db.spaces.get(a.spaceId)?.label ?? a.spaceId, hubId: a.hubId, why: a.id, allocationId: a.id, category: "parking space blocked or occupied" });
      } else if (a instanceof ChargingSession && a.isCommittedReservation() && a.pointId) {
        proposals.push({ resourceId: a.pointId, kind: "ChargingPoint", label: a.pointId, hubId: a.hubId, why: a.id, allocationId: a.id, category: "charging point unavailable or faulty" });
      }
    }
    return { categories: ISSUE_CATEGORIES, proposals, onTrip: !!s.hasOngoingTrip() };
  }

  /** The resources of a Hub, for "Choose another Hub and resource" (UC-06 step 3). */
  resourcesAt(hubId: string) {
    const h = db.hubs.get(hubId);
    if (!h) throw new UserError(`Unknown Hub ${hubId}`, 404);
    return {
      hubId, name: h.name,
      vehicles: [...db.vehicles.values()].filter((v) => v.hubId === hubId && v.usage !== "In Use").map((v) => ({ id: v.id, label: v.id, status: v.status })),
      points: [...db.points.values()].filter((p) => p.hubId === hubId).map((p) => ({ id: p.id, label: p.id, status: p.status })),
      spaces: [...db.spaces.values()].filter((p) => p.hubId === hubId).map((p) => ({ id: p.id, label: p.label, status: p.status })),
    };
  }

  /** uploadPhoto(photo : Photo) : boolean — the MVP keeps only the file name (UC-06 E1 is not simulated). */
  uploadPhoto(name: string): boolean { return name.trim().length > 0; }

  /** - validateReport(category, description, resource) : Violation — UC-06 step 5, E3. */
  private validateReport(category: string, description: string, resourceId: string): Violation | null {
    if (!ISSUE_CATEGORIES.includes(category as IssueCategory)) return { field: "category", message: "Choose what's wrong." };
    if (description.trim().length < 5) return { field: "description", message: "Describe the issue." };
    const want = CATEGORY_KIND[category];
    const hub = db.hubs.get(resourceId);
    const r = findResource(resourceId);
    if (!hub && !r) return { field: "resource", message: "Choose the affected Hub and resource." };
    if (want === "Hub" && !hub) return { field: "resource", message: "For a Hub facility problem, choose the Hub." };
    if (want && want !== "Hub" && r?.kind !== want) return { field: "resource", message: `The resource does not match "${category}".` };
    return null;
  }

  /**
   * submitReport(category, resource, description, photos) : String — UC-06 steps 5-8, 6a, 6b, E3.
   * `key` identifies the submission on the phone, so a resend after a lost connection (E2) is a repeat.
   */
  submitReport(studentId: string, category: IssueCategory, resourceId: string, description: string, photos: string[], key?: string) {
    if (key && this.sent.has(key)) return this.result(db.reports.get(this.sent.get(key)!)!, true);
    const v = this.validateReport(category, description, resourceId);
    if (v) throw new UserError(v.message, 422, `E3:${v.field}`);
    const hub = db.hubs.get(resourceId);
    const r = findResource(resourceId);
    const hubId = hub?.id ?? r!.hubId;
    const sub: Submission = { studentId, resourceId, category, description: description.trim(), photos: photos.filter((p) => this.uploadPhoto(p)), time: clock().now() };

    // 6a: the same student already filed this exact text for this resource.
    const repeat = [...db.reports.values()].find((x) => x.status === "Open" && x.resourceId === resourceId && x.category === category && x.submissions.some((s) => s.studentId === studentId && s.description === sub.description));
    if (repeat) { if (key) this.sent.set(key, repeat.id); return this.result(repeat, true); }

    // 6b: an Open report with the same category exists for this resource (not for a Hub).
    let rep = !hub ? [...db.reports.values()].find((x) => x.status === "Open" && x.resourceId === resourceId && x.category === category) ?? null : null;
    let attached = false;
    if (rep) { rep.attach(sub.description, sub.photos, sub.time, studentId); attached = true; }
    else {
      rep = new IssueReport(this.nextReportId(), sub, hubId);
      db.reports.set(rep.id, rep);
      // BR-INC-02: link to the unresolved incident for the resource and category, or open one.
      const inc = r ? Incident.findOrOpen(r, category, sub.description, "student report") : this.hubIncident(hubId, category, sub.description);
      rep.linkTo(inc);
      if (!inc.actions.some((a) => a.note.includes(rep!.id))) inc.actions.push(new Action(`Report ${rep.id} from student ${studentId}: ${sub.description}`, "system", sub.time, false, "system"));
      OperatorConsole.warn(`New report ${rep.id}: ${category} · ${r ? resourceLabel(r) : hubId} → ${inc.id}`, hubId, "Report");
    }
    if (key) this.sent.set(key, rep.id);
    audit(studentId, attached ? "UC-06 report attached" : "UC-06 report filed", rep.id, "", resourceId);

    // UC-07 6a: a report about the vehicle being picked up ends that pickup (BR-RES-02 for a reservation).
    const p = this.rental.pickupFor(studentId);
    const moved = p && p.vehicleId === resourceId ? this.rental.reportedDuringPickup(studentId) : null;
    return { ...this.result(rep, false), attached, pickupEnded: moved };
  }

  private hubIncident(hubId: string, category: IssueCategory, description: string): Incident {
    const found = [...db.incidents.values()].find((i) => i.isUnresolved() && i.resourceId === hubId && i.category === category);
    if (found) return found;
    const inc = new Incident(nextId("INC", "num"), hubId, hubId, category, description, "student report");
    db.incidents.set(inc.id, inc);
    inc.actions.push(new Action(`Opened from student report: ${description}`, "system", clock().now(), false, "system"));
    return inc;
  }

  private nextReportId(): string {
    const prefix = "IR-20261102-";
    const max = [...db.reports.keys()].filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))).reduce((m, n) => Math.max(m, n), 30);
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  private result(rep: IssueReport, repeated: boolean) {
    const r = findResource(rep.resourceId);
    return { reportId: rep.id, status: rep.status, incidentId: rep.incidentId, category: rep.category, resourceId: rep.resourceId, resourceLabel: r ? resourceLabel(r) : rep.resourceId, hubId: rep.hubId, time: rep.time, repeated,
      attached: false, pickupEnded: null as ReturnType<RentalController["reportedDuringPickup"]> };
  }

  /** discardReport() : void — UC-06 4a. Nothing is stored server-side before submit. */
  discardReport(): void { /* the draft lives on the phone */ }

  /** S12 / S08: the student's own reports. */
  reportsOf(studentId: string) {
    return [...db.reports.values()].filter((r) => r.submissions.some((s) => s.studentId === studentId)).sort((a, b) => b.time - a.time)
      .map((r) => ({ ...this.result(r, false), incidentStatus: r.incidentId ? db.incidents.get(r.incidentId)?.status ?? null : null }));
  }
}
