// domain.operations — Action (entity method descriptions 3.3). No operations: an
// append-only audit record.
export class Action {
  constructor(
    public readonly note: string,
    public readonly operator: string,
    public readonly time: number,
    public readonly blockRequested: boolean,
    public readonly kind: "assessment" | "action" | "corrective" | "verification" | "progress" | "resolution" | "dismissal" | "system" = "action",
  ) {}
}
