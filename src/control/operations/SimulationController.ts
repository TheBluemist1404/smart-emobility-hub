// control.operations — SimulationController (control method descriptions 3.5), UC-13 and UC-14.
// Writes to no entity. Scenarios A and B run on a detached copy (Hub.captureSnapshot); C and D ask
// the UC-11 planner for dry-run schedules (nothing stored, nothing marked). UC-14 applies changes
// only through RedistributionController and ChargingController, so each live change keeps its own
// use case's validation and audit.
import { db, audit } from "../../domain/store";
import { clock, fmtHM, HOUR, MINUTE } from "../../platform/clock/DemoClock";
import { Hub, type HubSnapshot, type NetworkSnapshot } from "../../domain/network/Hub";
import { SimulationScenario, type ChargingDetail, type ChargingMove, type Measure, type ScenarioInput } from "../../domain/operations/SimulationScenario";
import { Recommendation } from "../../domain/operations/Recommendation";
import { kmBetween, planOutflow, safeRoom } from "../../domain/operations/OutflowPlan";
import { UserError } from "../../api/errors";
import { config } from "../../platform/config/ConfigurationRegistry";
import { bus } from "../../platform/events/bus";
import type { ScenarioType, TimeWindow } from "../../domain/types";
import type { RedistributionController } from "./RedistributionController";
import type { ChargingController, KeepFree, ScheduleProposal } from "./ChargingController";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MODELS = ["e-bike", "e-motorbike"] as const;
/** Scenario D: each extra request needs one hour on a point (a typical 30 % → 80 % top-up). */
const SURGE_DURATION = 60 * MINUTE;

export const SCENARIOS: Array<{ type: ScenarioType; title: string; hint: string }> = [
  { type: "A demand surge", title: "A · Demand surge", hint: "More pickups than usual" },
  { type: "B return wave", title: "B · Return wave", hint: "Many returns to few Hubs" },
  { type: "C charging-point failure", title: "C · Charging-point failure", hint: "Points go Out of Service" },
  { type: "D charging demand surge", title: "D · Charging demand surge", hint: "More charging requests than usual" },
];

interface ReviewItem { id: string; title: string; kind: string; useCase: string; check: "Still valid" | "Adjusted to live state" | "No longer applicable" | "Advisory only"; change: string; note: string; quantity?: number }
interface ResultItem { id: string; title: string; outcome: string; reference: string | null; note: string; schedule?: { hubId: string; from: number; hours: number } }
const OPERATOR = "OP-014";

export class SimulationController {
  private baseline: NetworkSnapshot | null = null;
  private scenario: SimulationScenario | null = null;
  private review: ReviewItem[] | null = null;
  private runs = 2;
  private history: Array<{ run: number; type: string; hubs: string[]; at: number; demandMet: [number, number] }> = [];
  private result: ResultItem[] | null = null;

  constructor(private readonly charging?: ChargingController) {}

  /** startSimulation(hub : Hub) : Baseline — UC-13 step 2, E1. */
  startSimulation(hubId?: string) {
    if (hubId) {
      const h = db.hubs.get(hubId);
      if (!h) throw new UserError(`Unknown Hub ${hubId}`, 404);
      if (h.isStale()) throw new UserError(`${hubId} has no fresh data (E1). Refresh the network monitor before simulating.`, 409, "E1");
      // Opened from another Hub's warning (1a): an older result for other Hubs is closed (10c), so the
      // form and the result always describe the same run.
      if (this.scenario && !this.scenario.hubs.includes(hubId) && !this.review) this.discard();
    }
    if (!this.baseline || this.scenario === null) this.baseline = Hub.captureSnapshot();
    return this.state(hubId);
  }

  state(hubId?: string) {
    const b = this.baseline ?? Hub.captureSnapshot();
    const s = this.scenario;
    return {
      baseline: { takenAt: b.takenAt, hubs: b.hubs.map((h) => ({ hubId: h.hubId, name: h.name, stale: h.stale })), points: b.points },
      scenarios: SCENARIOS, openedFrom: hubId ?? null, run: this.runs, history: this.history, now: clock().now(),
      scenario: s ? { id: s.id, type: s.type, hubs: s.hubs, period: s.period, inputs: s.inputs } : null,
      measures: s?.measures ?? [], after: s?.after ?? [], charging: s?.charging ?? [],
      recommendations: (s?.recommendations ?? []).map((r) => ({ ...r, actionable: r.isActionable() })),
      totals: s && s.measures.length ? this.totals(s.measures, s.after) : null, review: this.review, result: this.result,
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
    const num = (raw: unknown) => (typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN);
    if (type === "A demand surge") {
      const pct = num(val("extraDemandPct"));
      if (!Number.isFinite(pct) || pct < -90 || pct > 300) return { field: "extraDemandPct", message: "Pickup demand must be between −90% and +300%." };
    }
    if (type === "B return wave") {
      const n = num(val("extraReturns"));
      if (!Number.isInteger(n) || n < 1 || n > 300) return { field: "extraReturns", message: "Extra returns must be a whole number from 1 to 300." };
    }
    if (type === "C charging-point failure") {
      const pts = (val("failedPoints") as string[] | undefined) ?? [];
      if (!pts.length) return { field: "failedPoints", message: "Choose at least one charging point." };
      const bad = pts.find((p) => !this.baseline!.points.some((x) => x.id === p && hubs.includes(x.hubId)));
      if (bad) return { field: "failedPoints", message: `${bad} is not a charging point of the chosen Hubs.` };
    }
    if (type === "D charging demand surge") {
      const n = num(val("extraChargingRequests"));
      if (!Number.isInteger(n) || n < 1 || n > 60) return { field: "extraChargingRequests", message: "Extra charging requests must be a whole number from 1 to 60." };
      if (!hubs.some((h) => this.baseline!.points.some((x) => x.hubId === h))) return { field: "hubs", message: "The chosen Hubs have no charging points." };
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
      if (s.type === "C charging-point failure" || s.type === "D charging demand surge") this.runCharging(s);
      else {
        s.simulate();
        s.recommendations = this.recommend(s);
        s.measuresAfter(s.recommendations.filter((r) => r.isActionable()));
      }
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

  // ==== Scenarios A and B: vehicles and docks =====================================

  /**
   * BR-SIM-01 recommendations for A and B. Transfers never fill a destination above the safe
   * ceiling (HUB_BUSY) and never take from a Hub that is short itself; an overflowing Hub sends
   * its excess to several Hubs, nearest first (OutflowPlan, the same rule as UC-10).
   */
  private recommend(s: SimulationScenario): Recommendation[] {
    const b = s.baseline;
    const recs: Recommendation[] = [];
    let n = 1;
    const id = () => `R${n++}`;
    const ceilingPct = config().value("HUB_BUSY");
    const shortRatio = config().value("HUB_SHORTAGE_RATIO") / 100;
    const live = b.hubs.filter((h) => !h.stale);
    const hubOf = (h: string) => b.hubs.find((x) => x.hubId === h)!;
    const avail = new Map(b.hubs.map((h) => [h.hubId, h.available]));
    // Docks each Hub can still take below the ceiling; transfers planned in this run use it up.
    const room = new Map(b.hubs.map((h) => [h.hubId, h.stale ? 0 : safeRoom(h, ceilingPct)]));
    const own = new Map(s.measures.map((m) => [m.hubId, m.demand]));
    const room0 = new Map(room);
    const eligible = new Map(b.hubs.map((h) => [h.hubId, new Map(MODELS.map((m) => [m, b.vehicles.filter((v) => v.hubId === h.hubId && v.eligible && v.model === m).length]))]));
    const eligibleAt = (h: string) => MODELS.reduce((t, m) => t + (eligible.get(h)!.get(m) ?? 0), 0);
    const take = (h: string, q: number) => { const out: Array<{ model: string; q: number }> = []; for (const m of MODELS) { const e = eligible.get(h)!; const k = Math.min(q, e.get(m) ?? 0); if (k > 0) { out.push({ model: m, q: k }); e.set(m, (e.get(m) ?? 0) - k); q -= k; } } return out; };
    // A donor keeps its own pickups (if in the scenario) and HUB_SHORTAGE_RATIO of its docks; a Hub
    // flagged Vehicle Shortage never donates.
    const spare = (h: HubSnapshot) => (h.flags.includes("Vehicle Shortage") ? 0 : Math.min(eligibleAt(h.hubId), (avail.get(h.hubId) ?? 0) - (own.get(h.hubId) ?? 0) - Math.ceil(shortRatio * h.docksInService) - 1));
    const by = fmtHM(s.period.start);
    const sent = new Map<string, number>(), redirected = new Map<string, number>();
    const short = s.measures.filter((m) => m.shortage > 0 && m.overflow === 0).sort((x, y) => y.shortage - x.shortage);
    const advice = (m: Measure, why: string) => {
      const here = hubOf(m.hubId);
      const alt = live.filter((h) => h.hubId !== m.hubId && !s.hubs.includes(h.hubId) && spare(h) > 0).map((h) => ({ h, km: kmBetween(here, h) })).sort((x, y) => x.km - y.km)[0];
      if (alt) recs.push(new Recommendation(id(), "alternative Hub", `Point students at ${m.hubId} to ${alt.h.hubId} (${alt.km} km) ${why}`, "Alternative-Hub advice · information only, never applied as a live change", { hubs: [m.hubId, alt.h.hubId] }));
    };
    for (const m of short) {
      let need = Math.min(m.shortage, room.get(m.hubId) ?? 0);
      const here = hubOf(m.hubId);
      // Nearest donor first.
      const donors = live.filter((h) => h.hubId !== m.hubId && spare(h) > 0).sort((x, y) => kmBetween(here, x) - kmBetween(here, y));
      for (const d of donors) {
        if (need <= 0) break;
        const q = Math.min(need, spare(d));
        if (q <= 0) continue;
        for (const part of take(d.hubId, q)) {
          recs.push(new Recommendation(id(), "transfer", `Transfer ${part.q} ${part.model}${part.q > 1 ? "s" : ""} ${d.hubId} → ${m.hubId}, arrive before ${by}`, `Redistribution order (UC-10) · covers ${part.q} of ${m.hubId}'s shortage of ${m.shortage} · ${d.hubId} is ${kmBetween(here, d)} km away and keeps its own stock`, { fromHub: d.hubId, toHub: m.hubId, quantity: part.q, model: part.model }));
          avail.set(d.hubId, (avail.get(d.hubId) ?? 0) - part.q); avail.set(m.hubId, (avail.get(m.hubId) ?? 0) + part.q);
          room.set(m.hubId, (room.get(m.hubId) ?? 0) - part.q); room.set(d.hubId, (room.get(d.hubId) ?? 0) + part.q);
          need -= part.q;
        }
      }
      if (room0.get(m.hubId) === 0 && m.shortage > 0) {
        const h = hubOf(m.hubId);
        recs.push(new Recommendation(id(), "alternative Hub", `No transfer into ${m.hubId}: it is at ${h.occupancy}% of its docks`, `Moving vehicles in would push ${m.hubId} above the ${ceilingPct}% safe ceiling (BR-HUB-01). Its supply has to come from charging its ${h.lowBattery} low-battery vehicles (see the charging plan) or from students using another Hub.`, { hubs: [m.hubId] }));
      }
      advice(m, `when ${m.hubId} is short`);
    }
    // Overflow (scenario B): before T, move vehicles out to Hubs outside the wave, nearest first, each
    // up to the safe ceiling. The Hub keeps enough for its pickups plus HUB_SHORTAGE_RATIO of its docks,
    // counting the vehicles the wave brings back (TC-UC13-02).
    for (const m of s.measures.filter((x) => x.overflow > 0)) {
      const hs = hubOf(m.hubId);
      const keep = Math.ceil(shortRatio * hs.docksInService);
      const returns = s.input<number>("extraReturns") ?? 0;
      const movable = eligibleAt(m.hubId);
      const ownNeed = Math.max(0, (avail.get(m.hubId) ?? 0) + returns - m.demand - keep);
      const canGo = Math.max(0, Math.min(m.overflow, movable, ownNeed));
      const dests = live.filter((h) => h.hubId !== m.hubId && !s.hubs.includes(h.hubId));
      const plan = planOutflow(hs, canGo, dests, ceilingPct, (d) => room.get(d.hubId) ?? 0);
      for (const leg of plan.legs) {
        for (const part of take(m.hubId, leg.quantity)) {
          recs.push(new Recommendation(id(), "transfer", `Transfer ${part.q} ${part.model}${part.q > 1 ? "s" : ""} ${m.hubId} → ${leg.toHub} before ${by} to free docks`, `Redistribution order (UC-10) · frees ${part.q} of the ${m.overflow} docks ${m.hubId} is short in the return wave · ${leg.toHub} is ${leg.km} km away, filled up to ${ceilingPct}%`, { fromHub: m.hubId, toHub: leg.toHub, quantity: part.q, model: part.model }));
          room.set(leg.toHub, (room.get(leg.toHub) ?? 0) - part.q); avail.set(m.hubId, (avail.get(m.hubId) ?? 0) - part.q);
          sent.set(leg.toHub, (sent.get(leg.toHub) ?? 0) + part.q);
        }
      }
      const left = m.overflow - plan.placed;
      if (left > 0) {
        const why = plan.placed < canGo ? `the Hubs outside the wave have no more room below ${ceilingPct}%`
          : movable < m.overflow && movable <= ownNeed ? `only ${plural(movable, "vehicle")} at ${m.hubId} can be moved now (the rest are reserved, charging below REDISTRIBUTION_MIN_SOC or waiting for charge)`
          : `${m.hubId} must keep enough vehicles for its own pickups`;
        // Returns that still find no dock: send the students to the nearest Hubs with free docks (UC-08 1a).
        const targets = planOutflow(hs, left, dests, 100, (d) => Math.max(0, d.vacantDocks - (sent.get(d.hubId) ?? 0) - (redirected.get(d.hubId) ?? 0)));
        for (const l of targets.legs) redirected.set(l.toHub, (redirected.get(l.toHub) ?? 0) + l.quantity);
        if (targets.legs.length) recs.push(new Recommendation(id(), "alternative Hub", `Send ${left} returning student${left === 1 ? "" : "s"} from ${m.hubId} to ${targets.legs.map((l) => `${l.toHub} (${l.quantity}, ${l.km} km)`).join(", ")}`, `Alternative-Hub advice · ${left} of the ${m.overflow} returns would still find no dock: ${why}.`, { hubs: [m.hubId, ...targets.legs.map((l) => l.toHub)] }));
      }
    }
    // Low-battery vehicles can be charged before the period: at a short Hub they become its own
    // supply, at a donor Hub they keep stock for the transfers.
    const lead = Math.max(1, Math.floor((s.period.start - b.takenAt) / (30 * MINUTE)));
    const covered = new Map<string, number>();
    for (const r of recs) if (r.kind === "transfer") covered.set(r.params.toHub!, (covered.get(r.params.toHub!) ?? 0) + (r.params.quantity ?? 0));
    const targets = new Set([...short.map((m) => m.hubId), ...recs.filter((r) => r.kind === "transfer").map((r) => r.params.fromHub!)]);
    for (const h of targets) {
      const hs = hubOf(h);
      const m = s.measures.find((x) => x.hubId === h);
      const gap = m ? Math.max(0, m.shortage - (covered.get(h) ?? 0)) : hs.lowBattery;
      const q = Math.min(gap, hs.lowBattery, hs.freeChargers * lead);
      if (q >= 1) recs.push(new Recommendation(id(), "charging plan", `Charge ${q} low-battery vehicle${q > 1 ? "s" : ""} at ${h} before ${by}`, `Charging plan (UC-11) · ${hs.lowBattery} below LOW_BATTERY_SOC, ${plural(hs.freeChargers, "point")} free`, { hubId: h, points: [], quantity: q }));
    }
    // Advisory items last, after the actions.
    return [...recs.filter((r) => r.isActionable()), ...recs.filter((r) => !r.isActionable())];
  }

  // ==== Scenarios C and D: charging, through the UC-11 planner (dry runs) ============

  private hoursFor(window: TimeWindow): number {
    return Math.max(1, Math.ceil((window.end - clock().now()) / HOUR));
  }

  private planStats(p: ScheduleProposal) {
    return { served: p.blocks.length, unserved: p.unserved.length, waitMin: p.kpis.avgWait, peakKw: p.kpis.peakKw };
  }

  private runCharging(s: SimulationScenario): void {
    const ch = this.charging;
    if (!ch) throw new Error("the charging planner is not available");
    const recs: Recommendation[] = [];
    let n = 1;
    const id = () => `R${n++}`;
    const w = s.period;
    const win = `${fmtHM(w.start)}–${fmtHM(w.end)}`;
    s.measures = []; s.after = []; s.charging = [];
    const altFor = (hubId: string) => {
      const here = db.hubs.get(hubId)!;
      return [...db.hubs.values()].filter((h) => h.id !== hubId && !h.isStale() && !s.hubs.includes(h.id) && h.snapshot().freeChargers > 0)
        .map((h) => ({ h, km: kmBetween(here, h), free: h.snapshot().freeChargers })).sort((a, b) => a.km - b.km)[0] ?? null;
    };
    const hubsWithPoints = s.hubs.filter((h) => [...db.points.values()].some((p) => p.hubId === h));
    const extra = s.input<number>("extraChargingRequests") ?? 0;
    hubsWithPoints.forEach((hubId, idx) => {
      const hours = this.hoursFor(w);
      const base = ch.generateSchedule(hubId, hours, { dryRun: true });
      const limitKw = ch.peakKw(hubId), installedKw = ch.installedKw(hubId);
      if (s.type === "C charging-point failure") {
        const failed = (s.input<string[]>("failedPoints") ?? []).filter((p) => db.points.get(p)?.hubId === hubId);
        if (!failed.length) return;
        const keep: KeepFree = { hubId, points: failed, window: w, ref: s.id, reason: `what-if ${s.id}` };
        const fail = ch.generateSchedule(hubId, hours, { dryRun: true, extraKeepFree: [keep] });
        const moves = this.diffPlans(base, fail, failed, w);
        const hit = moves.filter((m) => m.from && failed.includes(m.from.pointId) && m.from.start < w.end && m.from.end > w.start);
        const lost = hit.filter((m) => m.outcome !== "stops early").length;
        const normal = this.planStats(base), after = this.planStats(fail);
        const requests = normal.served + normal.unserved;
        s.charging.push({ hubId, window: w, points: failed, installedKw, limitKw, normal, scenario: after, moves });
        // Before: the points fail and nothing is re-planned, so their sessions in the window are lost.
        s.measures.push(this.chargeMeasure(hubId, requests, normal.served - lost, normal.waitMin, normal.unserved + lost, hit.length));
        s.after.push(this.chargeMeasure(hubId, requests, after.served, after.waitMin, after.unserved, 0));
        const moved = moves.filter((m) => m.outcome === "moved" || m.outcome === "shifted").length;
        const cancelled = moves.filter((m) => m.outcome === "cancelled, fee refunded").length;
        recs.push(new Recommendation(id(), "charging plan", `Re-plan charging at ${hubId} without ${failed.join(", ")} for ${win}`,
          `Charging plan (UC-11) · ${plural(moved, "session")} move, ${cancelled} cancelled with a refund, ${plural(after.unserved, "request")} unserved · applying keeps ${failed.length === 1 ? "this point" : "these points"} free in ${win}; ${failed.length === 1 ? "it stays" : "they stay"} In Service`,
          { hubId, points: failed, window: w, purpose: "failure" }));
        if (after.unserved > normal.unserved) { const a = altFor(hubId); if (a) recs.push(new Recommendation(id(), "alternative Hub", `Point students who need to charge at ${hubId} to ${a.h.id} (${a.km} km, ${plural(a.free, "point")} free now)`, "Alternative-Hub advice · information only, never applied as a live change", { hubs: [hubId, a.h.id] })); }
        return;
      }
      // D: extra charging requests at this Hub, spread evenly over the window.
      const count = Math.floor(extra / hubsWithPoints.length) + (idx < extra % hubsWithPoints.length ? 1 : 0);
      if (count <= 0) return;
      const span = w.end - w.start;
      const reqs = Array.from({ length: count }, (_, i) => ({ id: `${hubId}-X${String(i + 1).padStart(2, "0")}`, arrive: w.start + Math.floor((i * span) / count), durationMs: SURGE_DURATION }));
      const latest = w.end - config().value("SCHEDULE_TIMESLOT");
      const score = (p: ScheduleProposal) => { const placed = ch.placeExtra(p, reqs, latest); const served = placed.filter((x) => x.start !== null); return { p, placed, served: served.length, wait: served.length ? Math.round(served.reduce((t, x) => t + (x.waitMs ?? 0), 0) / served.length / MINUTE) : 0 }; };
      const before = score(base);
      // Keep points free in the window one at a time while that serves more of the surge.
      const usable = [...db.points.values()].filter((p) => p.hubId === hubId && p.status !== "Out of Service" && p.status !== "Disconnected").map((p) => p.id).sort();
      let best = before, kept: string[] = [];
      for (;;) {
        let next: { r: ReturnType<typeof score>; k: string[] } | null = null;
        for (const pt of usable.filter((x) => !kept.includes(x))) {
          const k = [...kept, pt];
          const r = score(ch.generateSchedule(hubId, hours, { dryRun: true, extraKeepFree: [{ hubId, points: k, window: w, ref: s.id, reason: `what-if ${s.id}` }] }));
          if (!next || r.served > next.r.served || (r.served === next.r.served && (r.p.unserved.length < next.r.p.unserved.length || (r.p.unserved.length === next.r.p.unserved.length && r.wait < next.r.wait)))) next = { r, k };
        }
        if (!next || next.r.served <= best.served) break;
        best = next.r; kept = next.k;
      }
      const normal = this.planStats(base), after = this.planStats(best.p);
      s.charging.push({
        hubId, window: w, points: kept, installedKw, limitKw, normal, scenario: after, moves: kept.length ? this.diffPlans(base, best.p, kept, w, false) : [],
        surge: { requests: count, durationMin: SURGE_DURATION / MINUTE, servedBefore: before.served, servedAfter: best.served, waitBefore: before.wait, waitAfter: best.wait, keep: kept,
          sharedUnservedBefore: normal.unserved, sharedUnservedAfter: after.unserved, placedAfter: best.placed.map((x) => ({ id: x.id, arrive: reqs.find((r) => r.id === x.id)!.arrive, pointId: x.pointId, start: x.start })) },
      });
      s.measures.push(this.chargeMeasure(hubId, count, before.served, before.wait, count - before.served, 0));
      s.after.push(this.chargeMeasure(hubId, count, best.served, best.wait, count - best.served, 0));
      if (kept.length) recs.push(new Recommendation(id(), "charging plan", `Keep ${kept.join(", ")} free ${win} for the charging surge at ${hubId}`,
        `Charging plan (UC-11) · surge served ${before.served} → ${best.served} of ${count}, average wait ${before.wait} → ${best.wait} min; shared vehicles waiting unserved ${normal.unserved} → ${after.unserved} (they charge outside the window)`,
        { hubId, points: kept, window: w, purpose: "surge" }));
      if (count - best.served > 0) { const a = altFor(hubId); if (a) recs.push(new Recommendation(id(), "alternative Hub", `Point ${count - best.served} student${count - best.served === 1 ? "" : "s"} who can't charge at ${hubId} to ${a.h.id} (${a.km} km, ${plural(a.free, "point")} free now)`, "Alternative-Hub advice · information only, never applied as a live change", { hubs: [hubId, a.h.id] })); }
    });
    s.recommendations = [...recs.filter((r) => r.isActionable()), ...recs.filter((r) => !r.isActionable())];
  }

  private chargeMeasure(hubId: string, demand: number, supply: number, waitMin: number, unserved: number, toMove: number): Measure {
    return { hubId, demand, supply: Math.max(0, supply), shortage: Math.max(0, demand - supply), overflow: 0, demandMetPct: demand ? Math.round((Math.max(0, Math.min(demand, supply)) / demand) * 100) : 100, avgWaitMin: waitMin, unservedCharging: unserved, sessionsToMove: toMove, freeDocks: 0 };
  }

  /** Which sessions a scenario plan puts somewhere else than the normal plan. */
  private diffPlans(base: ScheduleProposal, next: ScheduleProposal, points: string[], w: TimeWindow, failing = true): ChargingMove[] {
    const out: ChargingMove[] = [];
    const seg = (b: { pointId: string; start: number; end: number }) => ({ pointId: b.pointId, start: b.start, end: b.end });
    for (const b of base.blocks) {
      const n = next.blocks.find((x) => x.sessionId === b.sessionId);
      const onPoint = points.includes(b.pointId) && b.start < w.end && b.end > w.start;
      // Already charging: a failing point stops it; a point kept free for a surge lets it finish.
      if (b.locked && onPoint && !failing) continue;
      if (b.locked && onPoint) { out.push({ sessionId: b.sessionId, vehicleId: b.vehicleId, committed: b.committed, from: seg(b), to: null, outcome: "stops early" }); continue; }
      if (n && n.pointId === b.pointId && n.start === b.start) continue;
      if (n) out.push({ sessionId: b.sessionId, vehicleId: b.vehicleId, committed: b.committed, from: seg(b), to: seg(n), outcome: onPoint ? "moved" : "shifted" });
      else out.push({ sessionId: b.sessionId, vehicleId: b.vehicleId, committed: b.committed, from: seg(b), to: null, outcome: b.committed ? "cancelled, fee refunded" : "unserved" });
    }
    return out.sort((a, b) => (a.from?.start ?? 0) - (b.from?.start ?? 0));
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
      if (v === "valid") return { ...base, check: "Still valid", change: `Order ${r.params.fromHub} → ${r.params.toHub} · ${q} ${r.params.model ?? "vehicle"}${q > 1 ? "s" : ""}`, note: r.validityNote ?? "", quantity: q };
      if (can >= 1) return { ...base, check: "Adjusted to live state", change: `${q} → ${can} vehicle${can > 1 ? "s" : ""} · order ${r.params.fromHub} → ${r.params.toHub}`, note: r.validityNote ?? "", quantity: can };
      return { ...base, check: "No longer applicable", change: 'Will be recorded "Not Applied"', note: r.validityNote ?? "" };
    }
    if (v === "valid") {
      const w = r.params.window;
      const change = w ? `Keep ${r.params.points!.join(", ")} free ${fmtHM(w.start)}–${fmtHM(w.end)} at ${r.params.hubId} and re-plan its schedule` : `Schedule change at ${r.params.hubId}`;
      return { ...base, check: "Still valid", change, note: r.validityNote ?? "" };
    }
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
    const out: ResultItem[] = [];
    for (const item of this.review) {
      const r = s.recommendations.find((x) => x.id === item.id)!;
      if (item.check === "Advisory only") continue;
      const now = this.reloadAndRevalidate(r);
      if (now.check === "No longer applicable") { r.recordOutcome("Not Applied", null); out.push({ id: r.id, title: r.title, outcome: "Not Applied", reference: null, note: now.note }); continue; }
      try {
        if (r.kind === "transfer") {
          const oid = redistribution.createAssignedOrder(r.params.fromHub!, r.params.toHub!, [], OPERATOR, r.params.model ?? "e-bike", now.quantity ?? r.params.quantity, Math.max(s.period.start, clock().now() + 15 * MINUTE));
          r.recordOutcome("Applied", oid);
          // 6a: the live state may hold fewer vehicles than simulated; say so instead of a silent cut.
          const asked = r.params.quantity ?? 0, got = now.quantity ?? asked;
          const size = got < asked ? `Adjusted to ${got} of ${asked} vehicles (live state changed)` : plural(got, "vehicle");
          out.push({ id: r.id, title: r.title, outcome: "Applied", reference: oid, note: `${size} · Assigned · due ${fmtHM(db.orders.get(oid)!.deadline)}` });
        } else {
          const hubId = r.params.hubId!;
          const w = r.params.window;
          let hours = 4;
          let keep: KeepFree | null = null;
          if (w) {
            // Scenarios C and D: the plan the simulation showed keeps these points free in the window.
            keep = { hubId, points: r.params.points ?? [], window: w, ref: `${s.id}/${r.id}`, reason: r.params.purpose === "surge" ? `what-if ${s.id}: kept for the charging surge` : `what-if ${s.id}: planned as if they fail` };
            charging.addKeepFree(keep);
            hours = this.hoursFor(w);
          }
          let res, total = 0;
          try { const prop = charging.generateSchedule(hubId, hours); total = prop.blocks.length; res = charging.commitSchedule(prop, OPERATOR); }
          catch (e) { if (keep) charging.removeKeepFree(hubId, keep.ref); throw e; }
          const stale = [...db.points.values()].filter((x) => x.hubId === hubId && x.isStale());
          // E3: the schedule is committed but a point did not confirm the profile dispatch.
          const outcome = stale.length ? "Pending Reconciliation" : "Applied";
          r.recordOutcome(outcome, `schedule v${res.version}`);
          const future = w && w.start > clock().now() + config().value("SCHEDULE_TIMESLOT");
          const keptNote = w ? ` ${keep!.points.join(", ")} ${keep!.points.length === 1 ? "takes" : "take"} no session ${fmtHM(w.start)}–${fmtHM(w.end)}${future ? " (a later window: sessions before it are unchanged)" : ""}; ${keep!.points.length === 1 ? "it stays" : "they stay"} In Service.` : "";
          const moved = res.shifted.length ? ` ${res.shifted.join(", ")} moved (students notified).` : "";
          const cancelled = res.cancelled.length ? ` ${res.cancelled.join(", ")} cancelled and refunded.` : "";
          out.push({ id: r.id, title: r.title, outcome, reference: `Schedule v${res.version}`,
            note: stale.length ? `Committed; dispatch to ${stale.map((x) => x.id).join(", ")} not confirmed yet (E3).` : `${plural(total, "session")} in the committed plan at ${hubId} (${res.applied} newly scheduled, the rest already charging).${keptNote}${moved}${cancelled}`,
            schedule: { hubId, from: w ? Math.max(clock().now(), w.start - HOUR) : clock().now(), hours: w ? Math.min(6, Math.max(2, Math.ceil((w.end - Math.max(clock().now(), w.start - HOUR)) / HOUR))) : 4 } });
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
