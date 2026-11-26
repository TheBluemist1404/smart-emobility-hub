// domain.operations — Recommendation (entity method descriptions 3.7).
import type { ApplyOutcome, RecommendationKind } from "../types";
import type { NetworkSnapshot } from "../network/Hub";

export type Validity = "valid" | "invalid" | "advisory-only";

export class Recommendation {
  outcome: ApplyOutcome | null = null;
  reference: string | null = null;
  validity: Validity | null = null;
  validityNote: string | null = null;

  constructor(
    public readonly id: string,
    public readonly kind: RecommendationKind,
    public readonly title: string,
    public readonly detail: string,
    /** transfer: source, destination, quantity, model. charging plan: hub, point IDs excluded. alternative Hub: hubs. */
    public readonly params: { fromHub?: string; toHub?: string; quantity?: number; model?: string; hubId?: string; points?: string[]; hubs?: string[]; window?: { start: number; end: number }; purpose?: "failure" | "surge" },
  ) {}

  /** Only UC-10 or UC-11 actions can be applied; alternative Hubs stay advisory (UC-13 step 9). */
  isActionable(): boolean {
    return this.kind !== "alternative Hub";
  }

  /** revalidate(liveState : NetworkSnapshot) : Validity — UC-14 step 3. */
  revalidate(live: NetworkSnapshot): Validity {
    if (!this.isActionable()) { this.validity = "advisory-only"; this.validityNote = "Alternative-Hub advice is never applied to live state."; return this.validity; }
    if (this.kind === "transfer") {
      const src = live.hubs.find((h) => h.hubId === this.params.fromHub);
      const dst = live.hubs.find((h) => h.hubId === this.params.toHub);
      const q = this.params.quantity ?? 0;
      const eligible = live.vehicles.filter((v) => v.hubId === this.params.fromHub && v.eligible && (this.params.model === "any" || v.model === this.params.model)).length;
      if (!src || !dst || src.stale || dst.stale) { this.validity = "invalid"; this.validityNote = "A Hub of this transfer is not reporting."; }
      else if (eligible < q) { this.validity = "invalid"; this.validityNote = `Only ${eligible} eligible ${this.params.model} now at ${src.hubId} (needs ${q}).`; }
      else if (dst.vacantDocks < q) { this.validity = "invalid"; this.validityNote = `Only ${dst.vacantDocks} net free docks now at ${dst.hubId} (needs ${q}).`; }
      else { this.validity = "valid"; this.validityNote = `${eligible} eligible at ${src.hubId}, ${dst.vacantDocks} free docks at ${dst.hubId}.`; }
      return this.validity;
    }
    const hub = live.hubs.find((h) => h.hubId === this.params.hubId);
    if (!hub || hub.stale) { this.validity = "invalid"; this.validityNote = "The Hub is not reporting."; }
    else if (this.params.window && this.params.window.end <= live.takenAt) { this.validity = "invalid"; this.validityNote = "The simulated window has already ended."; }
    else if (this.params.window && (this.params.points ?? []).some((p) => !live.points.some((x) => x.id === p && x.hubId === hub.hubId))) { this.validity = "invalid"; this.validityNote = "A point of this plan no longer exists at the Hub."; }
    else { this.validity = "valid"; this.validityNote = `${hub.freeChargers} charging points free now at ${hub.hubId}.`; }
    return this.validity;
  }

  /** recordOutcome(outcome : ApplyOutcome, reference : String) : void — UC-14 step 8. */
  recordOutcome(outcome: ApplyOutcome, reference: string | null): void {
    this.outcome = outcome;
    this.reference = reference;
  }
}
