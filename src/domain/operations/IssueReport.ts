// domain.operations — IssueReport (entity method descriptions 3.1). ReportStatus Open/Closed.
import { db } from "../store";
import type { IssueCategory, ReportStatus } from "../types";
import type { Incident } from "./Incident";

export interface Submission { studentId: string; resourceId: string; category: IssueCategory; description: string; photos: string[]; time: number }

export class IssueReport {
  status: ReportStatus = "Open";
  incidentId: string | null = null;
  readonly submissions: Submission[] = [];

  constructor(public readonly id: string, first: Submission, public readonly hubId: string) {
    this.submissions.push(first);
  }

  get studentId(): string { return this.submissions[0].studentId; }
  get resourceId(): string { return this.submissions[0].resourceId; }
  get category(): IssueCategory { return this.submissions[0].category; }
  get time(): number { return this.submissions[0].time; }

  /** static findExisting(submission : Submission) : IssueReport — same student, resource, category, still Open. UC-06 step 8. */
  static findExisting(s: Submission): IssueReport | null {
    return [...db.reports.values()].find((r) => r.status === "Open" && r.studentId === s.studentId && r.resourceId === s.resourceId && r.category === s.category) ?? null;
  }

  /** static findLinked(incidentId : String) : IssueReport[*] — UC-12 step 4. */
  static findLinked(incidentId: string): IssueReport[] {
    return [...db.reports.values()].filter((r) => r.incidentId === incidentId);
  }

  /** static closeLinked(incidentId : String) : void — UC-12 steps 10, 11. */
  static closeLinked(incidentId: string): IssueReport[] {
    const linked = IssueReport.findLinked(incidentId);
    for (const r of linked) r.status = "Closed";
    return linked;
  }

  /** attach(description, photos, time, studentId) : void — a further submission. UC-06 step 8. */
  attach(description: string, photos: string[], time: number, studentId: string): void {
    this.submissions.push({ ...this.submissions[0], description, photos, time, studentId });
  }

  /** linkTo(incident : Incident) : void — UC-06 step 9 (BR-INC-02). */
  linkTo(incident: Incident): void {
    this.incidentId = incident.id;
  }
}
