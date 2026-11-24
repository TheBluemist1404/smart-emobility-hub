// control.operations — SimulationController (control method descriptions 3.5), UC-13 and UC-14.
// Writes to no entity. The scenario runs on a detached copy (Hub.captureSnapshot); UC-14
// applies changes only through RedistributionController and ChargingController, so each live
// change keeps its own use case's validation and audit.
import { db, audit } from "../../domain/store";
import { clock, fmtHM, HOUR, MINUTE } from "../../platform/clock/DemoClock";
import { Hub, type NetworkSnapshot } from "../../domain/network/Hub";
import { SimulationScenario, type Measure, type ScenarioInput } from "../../domain/operations/SimulationScenario";
import { Recommendation } from "../../domain/operations/Recommendation";
import { UserError } from "../../api/errors";
import { bus } from "../../platform/events/bus";
import type { ScenarioType, TimeWindow } from "../../domain/types";
import type { RedistributionController } from "./RedistributionController";
import type { ChargingController } from "./ChargingController";

export const SCENARIOS: Array<{ type: ScenarioType; title: string; hint: string }> = [
  { type: "A demand surge", title: "A · Demand surge", hint: "More pickups than usual" },
  { type: "B return wave", title: "B · Return wave", hint: "Many returns to few Hubs" },
  { type: "C charging-point failure", title: "C · Charging-point failure", hint: "Points go Out of Service" },
];

interface ReviewItem { id: string; title: string; kind: string; useCase: string; check: "Still valid" | "Adjusted to live state" | "No longer applicable" | "Advisory only"; change: string; note: string; quantity?: number }
const OPERATOR = "OP-014";

export class SimulationController {
  private baseline: NetworkSnapshot | null = null;
  private scenario: SimulationScenario | null = null;
  private review: ReviewItem[] | null = null;
  private runs = 2;
  private history: Array<{ run: number; type: string; hubs: string[]; at: number; demandMet: [number, number] }> = [];
  private result: Array<{ id: string; title: string; outcome: string; reference: string | null; note: string }> | null = null;

  /** startSimulation(hub : Hub) : Baseline — UC-13 step 2, E1. */
  startSimulation(hubId?: string) {
    if (hubId) {
      const h = db.hubs.get(hubId);
      if (!h) throw new UserError(`Unknown Hub ${hubId}`, 404);
      if (h.isStale()) throw new UserError(`${hubId} has no fresh data (E1). Refresh the network monitor before simulating.`, 409, "E1");
    }
    if (!this.baseline || this.scenario === null) this.baseline = Hub.captureSnapshot();
    return this.state(hubId);
  }

  state(hubId?: string) {
    const b = this.baseline ?? Hub.captureSnapshot();
    const s = this.scenario;
    return {
      baseline: { takenAt: b.takenAt, hubs: b.hubs.map((h) => ({ hubId: h.hubId, name: h.name, stale: h.stale })), points: b.points },
      scenarios: SCENARIOS, openedFrom: hubId ?? null, run: this.runs, history: this.history,
      scenario: s ? { id: s.id, type: s.type, hubs: s.hubs, period: s.period, inputs: s.inputs } : null,
      measures: s?.measures ?? [], after: s?.after ?? [], recommendations: (s?.recommendations ?? []).map((r) => ({ ...r, actionable: r.isActionable() })),
      totals: s ? this.totals(s.measures, s.after) : null, review: this.review, result: this.result,
    };
  }

  /** - validate(inputs : ScenarioInput[*]) : Violation — UC-13 E2. */
  private validate(type: ScenarioType, hubs: string[], period: TimeWindow, inputs: ScenarioInput[]): { field: string; message: string } | null {
    if (!SCENARIOS.some((x) => x.type === type)) return { field: "type", message: "Choose a scenario type." };
    if (!hubs.length) return { field: "hubs", message: "Choose at least one Hub." };
    for (const h of hubs) {
      const s = this.baseline!.hubs.find((x) => x.hubId === h);
      if (!s) return { field: "hubs", message: `Unknown Hub ${h}.` };
      if (s.stale) return { field: "hubs", message: `${h} was Disconnected in the baseline and cannot be simulated (E1).` };
    }
    if (!(period.end > period.start)) return { field: "period", message: "The end must be after the start." };
    if (period.end - period.start > 12 * HOUR) return { field: "period", message: "The period can be at most 12 h." };
    if (period.start < this.baseline!.takenAt - 15 * MINUTE || period.start > this.baseline!.takenAt + 24 * HOUR) return { field: "period", message: "The period must start within the next 24 h." };
    const val = (n: ScenarioInput["name"]) => inputs.find((i) => i.name === n)?.value;
    if (type === "A demand surge") {
      const pct = Number(val("extraDemandPct") ?? 0);
      if (!Number.isFinite(pct) || pct < -90 || pct > 300) return { field: "extraDemandPct", message: "Pickup demand must be between −90% and +300%." };
    }
    if (type === "B return wave") {
      const n = Number(val("extraReturns") ?? 0);
      if (!Number.isInteger(n) || n < 1 || n > 300) return { field: "extraReturns", message: "Extra returns must be a whole number from 1 to 300." };
    }
    if (type === "C charging-point failure") {
      const pts = (val("failedPoints") as string[] | undefined) ?? [];
      if (!pts.length) return { field: "failedPoints", message: "Choose at least one charging point." };
      const bad = pts.find((p) => !this.baseline!.points.some((x) => x.id === p && hubs.includes(x.hubId)));
      if (bad) return { field: "failedPoints", message: `${bad} is not a charging point of the chosen Hubs.` };
    }
    return null;
  }

  /** defineScenario(type, hubs, period, inputs) : Summary — UC-13 step 4, E2. */
  defineScenario(type: ScenarioType, hubs: string[], period: TimeWindow, inputs: ScenarioInput[]) {
    if (!this.baseline) this.baseline = Hub.captureSnapshot();
    const v = this.validate(type, hubs, period, inputs);
    if (v) throw new UserError(v.message, 422, `E2:${v.field}`);
    this.scenario = new SimulationScenario(`SIM-${String(this.runs + 1).padStart(2, "0")}`, type, hubs, period, inputs, this.baseline);
    this.review = null; this.result = null;
    return { type, hubs, period, inputs, baselineAt: this.baseline.takenAt };
  }

  /** run() : Measure[*] — UC-13 step 6, E3. Works only on the copy; a failure leaves live state untouched. */
  run() {
    const s = this.scenario;
    if (!s) throw new UserError("Define a scenario first.", 409);
    try {
      s.simulate();
      s.recommendations = this.recommend(s);
      s.measuresAfter(s.recommendations.filter((r) => r.isActionable()));
    } catch (e) {
      throw new UserError(`The simulation failed (E3): ${(e as Error).message}. Live data was not changed.`, 500, "E3");
    }
    this.runs++;
    const t = this.totals(s.measures, s.after);
    this.history.unshift({ run: this.runs, type: s.type, hubs: s.hubs, at: clock().now(), demandMet: [t.demandMet, t.demandMetAfter] });
    audit(OPERATOR, "UC-13 simulation run", s.id, "", s.type);
    return this.state();
  }

  private totals(m: Measure[], a: Measure[]) {
    const sum = (xs: Measure[], f: (x: Measure) => number) => xs.reduce((s, x) => s + f(x), 0);
    const met = (xs: Measure[]) => { const d = sum(xs, (x) => x.demand); return d ? Math.round((sum(xs, (x) => Math.min(x.demand, x.supply)) / d) * 100) : 100; };
    const wait = (xs: Measure[]) => (xs.length ? Math.round(sum(xs, (x) => x.avgWaitMin) / xs.length) : 0);
    return {
      demandMet: met(m), demandMetAfter: a.length ? met(a) : met(m), avgWait: wait(m), avgWaitAfter: a.length ? wait(a) : wait(m),
      short: m.filter((x) => x.shortage > 0).map((x) => x.hubId), shortAfter: a.filter((x) => x.shortage > 0).map((x) => x.hubId),
      overflow: m.filter((x) => x.overflow > 0).map((x) => x.hubId), overflowAfter: a.filter((x) => x.overflow > 0).map((x) => x.hubId),
      unservedCharging: sum(m, (x) => x.unservedCharging), unservedChargingAfter: sum(a, (x) => x.unservedCharging),
    };
  }

  /** BR-SIM-01 recommendations: transfers to cover shortage or overflow, a charging plan for C, alternative-Hub advice. */
  private recommend(s: SimulationScenario): Recommendation[] {
    const b = s.baseline;
    const recs: Recommendation[] = [];
    let n = 1;
    const id = () => `R${n++}`;
    const avail = new Map(b.hubs.map((h) => [h.hubId, h.available]));
    const docks = new Map(b.hubs.map((h) => [h.hubId, h.vacantDocks]));
    const own = new Map(s.measures.map((m) => [m.hubId, m.demand]));
    const surplus = (h: string) => (avail.get(h) ?? 0) - (own.get(h) ?? 0) - 2;
    const eligibleAt = (h: string) => b.vehicles.filter((v) => v.hubId === h && v.eligible && v.model === "e-bike").length;
    const donors = () => b.hubs.filter((h) => !h.stale).map((h) => ({ h, spare: Math.min(surplus(h.hubId), eligibleAt(h.hubId)) })).filter((x) => x.spare > 0).sort((x, y) => y.spare - x.spare);
    // Scenario C is about charging capacity: its recommendations are charging plans only.
    const short = s.type === "C charging-point failure" ? [] : s.measures.filter((m) => m.shortage > 0).sort((x, y) => y.shortage - x.shortage);
    const by = fmtHM(s.period.start);
    for (const m of short) {
      let need = m.shortage;
      for (const d of donors()) {
        if (need <= 0 || d.h.hubId === m.hubId) continue;
        const q = Math.min(need, d.spare, docks.get(m.hubId) ?? 0);
        if (q <= 0) continue;
        recs.push(new Recommendation(id(), "transfer", `Transfer ${q} e-bike${q > 1 ? "s" : ""} ${d.h.hubId} → ${m.hubId}, arrive before ${by}`, `Redistribution order (UC-10) · covers ${q} of ${m.hubId}'s shortage of ${m.shortage}`, { fromHub: d.h.hubId, toHub: m.hubId, quantity: q, model: "e-bike" }));
        avail.set(d.h.hubId, (avail.get(d.h.hubId) ?? 0) - q); avail.set(m.hubId, (avail.get(m.hubId) ?? 0) + q);
        docks.set(m.hubId, (docks.get(m.hubId) ?? 0) - q); docks.set(d.h.hubId, (docks.get(d.h.hubId) ?? 0) + q);
        need -= q;
      }
      const alt = b.hubs.filter((h) => !h.stale && h.hubId !== m.hubId && surplus(h.hubId) > 0).map((h) => ({ h, km: Math.round(Math.hypot(h.x - b.hubs.find((x) => x.hubId === m.hubId)!.x, h.y - b.hubs.find((x) => x.hubId === m.hubId)!.y) * 0.04 * 10) / 10 })).sort((x, y) => x.km - y.km)[0];
      if (alt) recs.push(new Recommendation(id(), "alternative Hub", `Point students at ${m.hubId} to ${alt.h.hubId} (${alt.km} km) when ${m.hubId} is short`, "Alternative-Hub advice · information only, never applied as a live change", { hubs: [m.hubId, alt.h.hubId] }));
    }
    for (const m of s.measures.filter((x) => x.overflow > 0)) {
      const dest = b.hubs.filter((h) => !h.stale && h.hubId !== m.hubId && !s.hubs.includes(h.hubId)).sort((x, y) => (docks.get(y.hubId) ?? 0) - (docks.get(x.hubId) ?? 0))[0];
      const q = Math.min(m.overflow, eligibleAt(m.hubId), docks.get(dest?.hubId ?? "") ?? 0);
      if (dest && q > 0) recs.push(new Recommendation(id(), "transfer", `Transfer ${q} e-bike${q > 1 ? "s" : ""} ${m.hubId} → ${dest.hubId} before ${by} to free docks`, `Redistribution order (UC-10) · frees ${q} docks for the return wave`, { fromHub: m.hubId, toHub: dest.hubId, quantity: q, model: "e-bike" }));
    }
    if (s.type === "C charging-point failure") {
      const failed = s.input<string[]>("failedPoints") ?? [];
      for (const m of s.measures.filter((x) => x.unservedCharging > 0 || x.sessionsToMove > 0)) {
        const pts = failed.filter((p) => b.points.some((x) => x.id === p && x.hubId === m.hubId));
        recs.push(new Recommendation(id(), "charging plan", `Reschedule charging at ${m.hubId} without ${pts.join(", ")}`, `Charging plan (UC-11) · ${m.sessionsToMove} session(s) to move, ${m.unservedCharging} request(s) unserved before`, { hubId: m.hubId, points: pts }));
      }
    } else {
      // Low-battery vehicles can be charged before the period: at a short Hub they become its own
      // supply, at a donor Hub they keep stock for the transfers.
      const lead = Math.max(1, Math.floor((s.period.start - b.takenAt) / (30 * MINUTE)));
      const covered = new Map<string, number>();
      for (const r of recs) if (r.kind === "transfer") covered.set(r.params.toHub!, (covered.get(r.params.toHub!) ?? 0) + (r.params.quantity ?? 0));
      const targets = new Set([...short.map((m) => m.hubId), ...recs.filter((r) => r.kind === "transfer").map((r) => r.params.fromHub!)]);
      for (const h of targets) {
        const hs = b.hubs.find((x) => x.hubId === h)!;
        const m = s.measures.find((x) => x.hubId === h);
        const gap = m ? Math.max(0, m.shortage - (covered.get(h) ?? 0)) : hs.lowBattery;
        const q = Math.min(gap, hs.lowBattery, hs.freeChargers * lead);
        if (q >= 1) recs.push(new Recommendation(id(), "charging plan", `Charge ${q} low-battery e-bike${q > 1 ? "s" : ""} at ${h} before ${by}`, `Charging plan (UC-11) · ${hs.lowBattery} below LOW_BATTERY_SOC, ${hs.freeChargers} point(s) free`, { hubId: h, points: [], quantity: q }));
      }
    }
    return recs;
  }

  // ==== UC-14 Apply simulation recommendations =======================================

  /** - compareWithBaseline(liveState) : Drift — UC-14 step 3. */
  private compareWithBaseline(live: NetworkSnapshot): { movedHubs: string[]; minutes: number } {
    const b = this.baseline!;
    const movedHubs = live.hubs.filter((h) => { const o = b.hubs.find((x) => x.hubId === h.hubId); return o && (o.available !== h.available || o.vacantDocks !== h.vacantDocks || o.stale !== h.stale); }).map((h) => h.hubId);
    return { movedHubs, minutes: Math.round((live.takenAt - b.takenAt) / MINUTE) };
  }

  /** apply(recommendations) : ReviewResult — UC-14 step 2-5: revalidate against live; nothing changes yet. */
  apply(ids: string[]) {
    const s = this.scenario;
    if (!s || !s.measures.length) throw new UserError("Run a simulation first.", 409);
    const chosen = s.recommendations.filter((r) => ids.includes(r.id));
    if (!chosen.length) throw new UserError("Select at least one recommendation.", 422);
    const live = Hub.loadLiveState();
    const drift = this.compareWithBaseline(live);
    this.review = chosen.map((r) => this.reviewOne(r, live));
    this.result = null;
    return { ...this.state(), drift, liveAt: live.takenAt };
  }

  private reviewOne(r: Recommendation, live: NetworkSnapshot): ReviewItem {
    const base = { id: r.id, title: r.title, kind: r.kind, useCase: r.kind === "transfer" ? "UC-10" : r.kind === "charging plan" ? "UC-11" : "—" };
    const v = r.revalidate(live);
    if (v === "advisory-only") return { ...base, check: "Advisory only", change: "Information only", note: r.validityNote ?? "" };
    if (r.kind === "transfer") {
      const q = r.params.quantity ?? 0;
      const eligible = live.vehicles.filter((x) => x.hubId === r.params.fromHub && x.eligible && x.model === r.params.model).length;
      const free = live.hubs.find((h) => h.hubId === r.params.toHub)?.vacantDocks ?? 0;
      const can = Math.min(q, eligible, free);
      if (v === "valid") return { ...base, check: "Still valid", change: `Order ${r.params.fromHub} → ${r.params.toHub} · ${q} vehicle${q > 1 ? "s" : ""}`, note: r.validityNote ?? "", quantity: q };
      if (can >= 1) return { ...base, check: "Adjusted to live state", change: `${q} → ${can} vehicle${can > 1 ? "s" : ""} · order ${r.params.fromHub} → ${r.params.toHub}`, note: r.validityNote ?? "", quantity: can };
      return { ...base, check: "No longer applicable", change: 'Will be recorded "Not Applied"', note: r.validityNote ?? "" };
    }
    if (v === "valid") return { ...base, check: "Still valid", change: `Schedule change at ${r.params.hubId}${r.params.points?.length ? ` without ${r.params.points.join(", ")}` : ""}`, note: r.validityNote ?? "" };
    return { ...base, check: "No longer applicable", change: 'Will be recorded "Not Applied"', note: r.validityNote ?? "" };
  }

  /** cancel() : void — UC-14 5a: back to the result, nothing applied. */
  cancel(): void { this.review = null; }

  /** - reloadAndRevalidate() : Validity — right before each commit, so a change during review is never overwritten. */
  private reloadAndRevalidate(r: Recommendation): ReviewItem {
    return this.reviewOne(r, Hub.loadLiveState());
  }

  /** confirm(selection) : ApplyResult[*] — UC-14 steps 6-9, via UC-10 and UC-11 only. */
  confirm(redistribution: RedistributionController, charging: ChargingController) {
    const s = this.scenario;
    if (!s || !this.review) throw new UserError("Review the recommendations first.", 409);
    const out: NonNullable<SimulationController["result"]> = [];
    for (const item of this.review) {
      const r = s.recommendations.find((x) => x.id === item.id)!;
      if (item.check === "Advisory only") continue;
      const now = this.reloadAndRevalidate(r);
      if (now.check === "No longer applicable") { r.recordOutcome("Not Applied", null); out.push({ id: r.id, title: r.title, outcome: "Not Applied", reference: null, note: now.note }); continue; }
      try {
        if (r.kind === "transfer") {
          const oid = redistribution.createAssignedOrder(r.params.fromHub!, r.params.toHub!, [], OPERATOR, r.params.model ?? "e-bike", now.quantity ?? r.params.quantity, Math.max(s.period.start, clock().now() + 15 * MINUTE));
          r.recordOutcome("Applied", oid);
          out.push({ id: r.id, title: r.title, outcome: "Applied", reference: oid, note: `${now.quantity} vehicle(s) · Assigned · due ${fmtHM(db.orders.get(oid)!.deadline)}` });
        } else {
          const hubId = r.params.hubId!;
          const p = charging.generateSchedule(hubId);
          const res = charging.commitSchedule(p, OPERATOR);
          const stale = [...db.points.values()].filter((x) => x.hubId === hubId && x.isStale());
          // E3: the schedule is committed but a point did not confirm the profile dispatch.
          const outcome = stale.length ? "Pending Reconciliation" : "Applied";
          r.recordOutcome(outcome, `schedule v${res.version}`);
          out.push({ id: r.id, title: r.title, outcome, reference: `Schedule v${res.version}`, note: stale.length ? `Committed; dispatch to ${stale.map((x) => x.id).join(", ")} not confirmed yet (E3).` : `${res.applied} session(s) scheduled at ${hubId}` });
        }
      } catch (e) {
        r.recordOutcome("Not Applied", null);
        out.push({ id: r.id, title: r.title, outcome: "Not Applied", reference: null, note: (e as Error).message });
      }
    }
    this.result = out;
    this.review = null;
    audit(OPERATOR, "UC-14 recommendations applied", s.id, "", out.map((o) => `${o.id}:${o.outcome}`).join(","));
    bus.changed("simulation");
    return this.state();
  }

  /** discard() : void — UC-13 step 12 / 10c: close the result and release the baseline. */
  discard(): void {
    this.scenario = null; this.baseline = null; this.review = null; this.result = null;
  }
}
