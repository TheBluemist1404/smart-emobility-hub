// domain.operations — Incident (entity method descriptions 3.2).
// IncidentStatus: Open -> In Progress -> Resolved; Dismissed for a false or duplicate one.
import { db, nextId } from "../store";
import { clock } from "../../platform/clock/DemoClock";
import { Action } from "./Action";
import { IssueReport } from "./IssueReport";
import { findResource, resourceLabel } from "../network/lookup";
import type { IncidentCategory, IncidentStatus, OrderStatus } from "../types";
import type { Resource } from "../network/Resource";
import type { Allocation } from "../allocation/Allocation";

export type IncidentSource = "student report" | "system" | "operator" | "network warning";

export class Incident {
  status: IncidentStatus = "Open";
  version = 1;
  owner: string | null = null;
  /** Set once an operator confirmed the block (UC-12 step 6). */
  blocking = false;
  readonly actions: Action[] = [];
  readonly awaiting: string[] = [];
  readonly orders: Array<{ orderId: string; status: OrderStatus }> = [];
  readonly reschedules: string[] = [];
  progressNote: string | null = null;
  pending: string | null = null;
  resolution: string | null = null;
  dismissReason: string | null = null;
  duplicateOf: string | null = null;
  readonly createdAt = clock().now();
  closedAt: number | null = null;

  constructor(
    public readonly id: string,
    public readonly resourceId: string,
    public readonly hubId: string,
    public readonly category: IncidentCategory,
    public description: string,
    public readonly source: IncidentSource,
  ) {}

  isUnresolved(): boolean { return this.status === "Open" || this.status === "In Progress"; }

  /** static findCurrent() : Incident[*] — Open and In Progress, newest first. UC-12 step 2. */
  static findCurrent(): Incident[] {
    return [...db.incidents.values()].filter((i) => i.isUnresolved()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** static findMatching(resource : Resource) : Incident — UC-12 3b. */
  static findMatching(resource: Resource): Incident | null {
    return [...db.incidents.values()].find((i) => i.isUnresolved() && i.resourceId === resource.id) ?? null;
  }

  /** static findOrOpen(resource, category) : Incident — the first report opens it, later ones join. UC-06 step 9. */
  static findOrOpen(resource: Resource, category: IncidentCategory, description = "", source: IncidentSource = "student report"): Incident {
    const found = [...db.incidents.values()].find((i) => i.isUnresolved() && i.resourceId === resource.id && i.category === category);
    if (found) return found;
    const inc = new Incident(nextId("INC", "num"), resource.id, resource.hubId, category, description, source);
    db.incidents.set(inc.id, inc);
    inc.actions.push(new Action(`Opened from ${source}: ${description || category}`, source === "operator" ? "operator" : "system", inc.createdAt, false, "system"));
    // BR-RES-01: an unresolved vehicle-failure incident, even unconfirmed, keeps the vehicle from new allocations.
    if (resource.kind === "Vehicle" && category === "vehicle failure") resource.noteFault(inc.id);
    return inc;
  }

  /** getDetails() : IncidentDetails — UC-12 step 4. */
  getDetails() {
    const r = findResource(this.resourceId);
    return {
      id: this.id, status: this.status, version: this.version, category: this.category, description: this.description, source: this.source,
      hubId: this.hubId, owner: this.owner, blocking: this.blocking, createdAt: this.createdAt,
      resource: r ? { id: r.id, kind: r.kind, label: resourceLabel(r), ...r.getLatestStatus() } : null,
      reports: IssueReport.findLinked(this.id).map((x) => ({ id: x.id, studentId: x.studentId, category: x.category, status: x.status, time: x.time, text: x.submissions.map((s) => s.description).join(" / "), photos: x.submissions.reduce((n, s) => n + s.photos.length, 0) })),
      actions: this.actions.map((a) => ({ ...a })),
      affected: [...db.allocations.values()].filter((a) => a.resourceId === this.resourceId && a.isActive()).map((a) => ({ id: a.id, kind: a.kind, status: a.status, studentId: a.studentId })),
      awaiting: [...this.awaiting], orders: [...this.orders], reschedules: [...this.reschedules],
      progressNote: this.progressNote, pending: this.pending, resolution: this.resolution, dismissReason: this.dismissReason, duplicateOf: this.duplicateOf,
    };
  }

  /** checkUnchanged(version : int) : boolean — UC-12 E2. */
  checkUnchanged(version: number): boolean {
    return this.version === version;
  }

  /** reload() : Incident — UC-12 E2. */
  reload(): Incident {
    return db.incidents.get(this.id)!;
  }

  private bump(): void { this.version++; }

  /** startHandling(operator, time, note) : void — UC-12 step 5. */
  startHandling(operator: string, time: number, note: string): void {
    this.status = "In Progress";
    this.owner = operator;
    this.actions.push(new Action(note || "Taken for handling", operator, time, false, "assessment"));
    this.bump();
  }

  /** addAction(action : Action, operator : String, time : DateTime) : void — append-only. UC-12 steps 6, 7. */
  addAction(action: Action, _operator?: string, _time?: number): void {
    this.actions.push(action);
    if (action.blockRequested) this.blocking = true;
    this.bump();
  }

  /** recordAwaiting(allocation : Allocation) : void — UC-12 step 6. */
  recordAwaiting(allocation: Allocation): void {
    if (!this.awaiting.includes(allocation.id)) this.awaiting.push(allocation.id);
  }

  /** recordOrder(orderId : String, status : OrderStatus) : void — UC-12 8a. */
  recordOrder(orderId: string, status: OrderStatus): void {
    const o = this.orders.find((x) => x.orderId === orderId);
    if (o) o.status = status; else this.orders.push({ orderId, status });
    this.bump();
  }

  /** recordRescheduling(result : ScheduleResult) : void — UC-12 8b. */
  recordRescheduling(result: string): void {
    this.reschedules.push(result);
    this.bump();
  }

  /** recordProgress(note : String, pending : String) : void — UC-12 step 9. */
  recordProgress(note: string, pending: string): void {
    this.progressNote = note;
    this.pending = pending;
    this.bump();
  }

  private release(): void {
    const r = findResource(this.resourceId);
    if (r) { r.clearIncident(this.id); r.reevaluate(); }
    IssueReport.closeLinked(this.id);
    this.closedAt = clock().now();
  }

  /** resolve(resolution, operator, time) : void — UC-12 step 10. */
  resolve(resolution: string, operator: string, time: number): void {
    this.status = "Resolved";
    this.resolution = resolution;
    this.actions.push(new Action(`Resolved: ${resolution}`, operator, time, false, "resolution"));
    this.bump();
    this.release();
  }

  /** dismiss(reason : String, originalId : String) : void — UC-12 step 11. */
  dismiss(reason: string, originalId: string | null, operator = "operator"): void {
    this.status = "Dismissed";
    this.dismissReason = reason;
    this.duplicateOf = originalId;
    this.actions.push(new Action(`Dismissed: ${reason}${originalId ? ` (duplicate of ${originalId})` : ""}`, operator, clock().now(), false, "dismissal"));
    this.bump();
    this.release();
  }
}
