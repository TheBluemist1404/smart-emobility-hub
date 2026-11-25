// domain.operations — SimulationScenario (entity method descriptions 3.6). Runs on a
// detached baseline (Hub.captureSnapshot) and can never change live state: it only reads
// the plain JSON copy it was given.
import type { NetworkSnapshot } from "../network/Hub";
import type { ScenarioType, TimeWindow } from "../types";
import type { Recommendation } from "./Recommendation";

export interface ScenarioInput { name: "extraDemand" | "extraDemandPct" | "extraReturns" | "failedPoints"; value: number | string[] }

export interface Measure {
  hubId: string; demand: number; supply: number; shortage: number; overflow: number; demandMetPct: number;
  avgWaitMin: number; unservedCharging: number; sessionsToMove: number; freeDocks: number;
}

export class SimulationScenario {
  measures: Measure[] = [];
  recommendations: Recommendation[] = [];
  after: Measure[] = [];
  readonly createdAt: number;

  constructor(
    public readonly id: string,
    public readonly type: ScenarioType,
    public readonly hubs: string[],
    public readonly period: TimeWindow,
    public readonly inputs: ScenarioInput[],
    public readonly baseline: NetworkSnapshot,
  ) {
    this.createdAt = baseline.takenAt;
  }

  input<T extends ScenarioInput["value"]>(name: ScenarioInput["name"]): T | undefined {
    return this.inputs.find((i) => i.name === name)?.value as T | undefined;
  }

  /**
   * simulate() : Measure[*] — BR-SIM-01 on the baseline: per affected Hub, demand vs supply,
   * shortage or dock overflow, share of demand met, average wait, unserved charging requests.
   */
  simulate(): Measure[] {
    this.measures = this.hubs.map((id) => this.measureHub(id, { extraSupply: 0, extraDocks: 0, extraPoints: 0 }));
    return this.measures;
  }

  /** measuresAfter(recommendations : Recommendation[*]) : Measure[*] — UC-13 step 9 "after" figures. */
  measuresAfter(recs: Recommendation[]): Measure[] {
    this.after = this.hubs.map((id) => {
      let extraSupply = 0, extraDocks = 0, extraPoints = 0;
      for (const r of recs) {
        if (r.kind === "transfer" && r.params.toHub === id) { extraSupply += r.params.quantity ?? 0; extraDocks -= r.params.quantity ?? 0; }
        if (r.kind === "transfer" && r.params.fromHub === id) { extraSupply -= r.params.quantity ?? 0; extraDocks += r.params.quantity ?? 0; }
        if (r.kind === "charging plan" && r.params.hubId === id) {
          extraPoints += r.params.points?.length ?? 0;
          // A charging plan before the period turns low-battery vehicles into supply (scenarios A and B).
          if (this.type !== "C charging-point failure") extraSupply += r.params.quantity ?? 0;
        }
      }
      return this.measureHub(id, { extraSupply, extraDocks, extraPoints });
    });
    return this.after;
  }

  private measureHub(hubId: string, adj: { extraSupply: number; extraDocks: number; extraPoints: number }): Measure {
    const h = this.baseline.hubs.find((x) => x.hubId === hubId)!;
    const hours = Math.max(0.25, (this.period.end - this.period.start) / 3_600_000);
    // Baseline demand: one pickup per hour for every four docks in service (a campus rule of thumb).
    const baseDemand = Math.round((h.docksInService / 4) * hours);
    const extra = this.type === "A demand surge"
      ? (this.input<number>("extraDemand") ?? 0) + Math.round(baseDemand * ((this.input<number>("extraDemandPct") ?? 0) / 100)) : 0;
    const demand = baseDemand + extra;
    // Scenario B: the returned vehicles can be picked up again, and each pickup frees a dock, so
    // overflow = returns − (free docks + pickups) (TC-UC13-02).
    const returns = this.type === "B return wave" ? (this.input<number>("extraReturns") ?? 0) : 0;
    const supply = h.available + adj.extraSupply + returns;
    const shortage = Math.max(0, demand - supply);
    const freeDocks = h.vacantDocks + adj.extraDocks;
    const overflow = Math.max(0, returns - (freeDocks + demand));
    const failed = this.type === "C charging-point failure" ? (this.input<string[]>("failedPoints") ?? []).filter((p) => this.baseline.points.some((x) => x.id === p && x.hubId === hubId)).length : 0;
    const workingPoints = Math.max(0, h.chargers - h.pointsOutOfService - failed + adj.extraPoints);
    const waitingLow = h.lowBattery;
    const slotsInPeriod = Math.floor(hours * 2) * workingPoints;
    const unservedCharging = this.type === "C charging-point failure" ? Math.max(0, waitingLow - slotsInPeriod) : 0;
    const sessionsToMove = this.type === "C charging-point failure" ? Math.max(0, failed - adj.extraPoints) : 0;
    const demandMetPct = demand === 0 ? 100 : Math.round((Math.min(demand, supply) / demand) * 100);
    const avgWaitMin = shortage === 0 ? 0 : Math.round(Math.min(60, (shortage / Math.max(1, demand)) * 60 * hours));
    return { hubId, demand, supply, shortage, overflow, demandMetPct, avgWaitMin, unservedCharging, sessionsToMove, freeDocks };
  }
}
