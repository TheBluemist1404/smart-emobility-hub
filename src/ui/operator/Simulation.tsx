// O05 What-if simulation (UC-13) and O06 Apply recommendations (UC-14). Everything inside the
// violet frame is simulated; only "Confirm and apply" changes live state, through UC-10/UC-11.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, api, hm, hms } from "../shared/live";
import type { OpGo } from "./OperatorConsole";

type SType = "A demand surge" | "B return wave" | "C charging-point failure" | "D charging demand surge";
interface Seg { pointId: string; start: number; end: number }
interface ChargingDetail {
  hubId: string; window: { start: number; end: number }; points: string[]; installedKw: number; limitKw: number;
  normal: { served: number; unserved: number; waitMin: number; peakKw: number }; scenario: { served: number; unserved: number; waitMin: number; peakKw: number };
  moves: Array<{ sessionId: string; vehicleId: string; committed: boolean; from: Seg | null; to: Seg | null; outcome: string }>;
  surge?: { requests: number; durationMin: number; servedBefore: number; servedAfter: number; waitBefore: number; waitAfter: number; keep: string[]; sharedUnservedBefore: number; sharedUnservedAfter: number; placedAfter: Array<{ id: string; arrive: number; pointId: string | null; start: number | null }> };
}
interface Measure { hubId: string; demand: number; supply: number; shortage: number; overflow: number; demandMetPct: number; avgWaitMin: number; unservedCharging: number; sessionsToMove: number; freeDocks: number }
interface Rec { id: string; kind: string; title: string; detail: string; actionable: boolean; params: Record<string, unknown> }
interface Review { id: string; title: string; kind: string; useCase: string; check: string; change: string; note: string }
interface Outcome { id: string; title: string; outcome: string; reference: string | null; note: string; schedule?: { hubId: string; from: number; hours: number } }
interface SimState {
  baseline: { takenAt: number; hubs: Array<{ hubId: string; name: string; stale: boolean }>; points: Array<{ id: string; hubId: string; status: string }> };
  scenarios: Array<{ type: SType; title: string; hint: string }>; openedFrom: string | null; run: number;
  history: Array<{ run: number; type: string; hubs: string[]; at: number; demandMet: [number, number] }>;
  scenario: { id: string; type: SType; hubs: string[]; period: { start: number; end: number }; inputs: Array<{ name: string; value: unknown }> } | null;
  measures: Measure[]; after: Measure[]; recommendations: Rec[]; charging: ChargingDetail[]; now: number;
  totals: { demandMet: number; demandMetAfter: number; avgWait: number; avgWaitAfter: number; short: string[]; shortAfter: string[]; overflow: string[]; overflowAfter: string[]; unservedCharging: number; unservedChargingAfter: number } | null;
  review: Review[] | null; result: Outcome[] | null; drift?: { movedHubs: string[]; minutes: number }; liveAt?: number;
}

const H7 = 7 * 3600_000, DAY = 24 * 3600_000;
const ICON: Record<SType, string> = { "A demand surge": "trending-up", "B return wave": "corner-down-left", "C charging-point failure": "plug", "D charging demand surge": "battery-charging" };
const isCharging = (t: SType) => t === "C charging-point failure" || t === "D charging demand surge";

/** The same rules the server checks (UC-13 E2), run on every keystroke so "Valid" is never stale. */
function checkInputs(type: SType, hubs: string[], from: string, to: string, pct: string, returns: string, points: string[], extra: string, hubPoints: number): { field: string; message: string } | null {
  if (!hubs.length) return { field: "hubs", message: "Choose at least one Hub." };
  if (!/^\d\d:\d\d$/.test(from) || !/^\d\d:\d\d$/.test(to)) return { field: "period", message: "Enter a start and an end time." };
  const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  if (mins(to) <= mins(from)) return { field: "period", message: "The end must be after the start." };
  if (mins(to) - mins(from) > 12 * 60) return { field: "period", message: "The period can be at most 12 h." };
  const num = (x: string) => (x.trim() === "" ? NaN : Number(x));
  if (type === "A demand surge") { const v = num(pct); if (!Number.isFinite(v) || v < -90 || v > 300) return { field: "extraDemandPct", message: "Pickup demand must be between −90% and +300%." }; }
  if (type === "B return wave") { const v = num(returns); if (!Number.isInteger(v) || v < 1 || v > 300) return { field: "extraReturns", message: "Extra returns must be a whole number from 1 to 300." }; }
  if (type === "C charging-point failure" && !points.length) return { field: "failedPoints", message: "Choose at least one charging point." };
  if (type === "D charging demand surge") {
    if (!hubPoints) return { field: "hubs", message: "The chosen Hubs have no charging points." };
    const v = num(extra); if (!Number.isInteger(v) || v < 1 || v > 60) return { field: "extraChargingRequests", message: "Extra charging requests must be a whole number from 1 to 60." };
  }
  return null;
}
const toMs = (now: number, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return Math.floor((now + H7) / DAY) * DAY - H7 + (h * 60 + m) * 60_000; };
const nextHalf = (now: number) => hm(Math.ceil(now / 1_800_000) * 1_800_000);
const addH = (hhmm: string, h: number) => { const [a, b] = hhmm.split(":").map(Number); const t = (a * 60 + b + h * 60) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

export function O05Simulation({ go, now, hubId }: { go: OpGo; now: number; hubId?: string }) {
  const [st, setSt] = useState<SimState | null>(null);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [type, setType] = useState<SType>("A demand surge");
  const [hubs, setHubs] = useState<string[]>(hubId ? [hubId] : ["H02"]);
  const [from, setFrom] = useState(nextHalf(now));
  const [to, setTo] = useState(addH(nextHalf(now), 2));
  const [pct, setPct] = useState("60");
  const [returns, setReturns] = useState("25");
  const [points, setPoints] = useState<string[]>([]);
  const [extra, setExtra] = useState("12");
  const synced = useRef<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const call = async (url: string, body: unknown = {}) => {
    setBusy(true);
    try { const s = await api<SimState>(`/operator/sim/${url}`, body); setSt(s); setErr(null); return s; }
    catch (e) { const code = (e as ApiError).code ?? ""; setErr({ field: code.startsWith("E2:") ? code.slice(3) : undefined, message: (e as Error).message }); return null; }
    finally { setBusy(false); }
  };
  useEffect(() => { void call("start", { hubId }); }, [hubId]);
  useEffect(() => { if (st?.scenario) setSel(st.recommendations.filter((r) => r.actionable).map((r) => r.id)); }, [st?.scenario?.id, st?.run]);
  // The form always shows the inputs of the result on the right (another operator's run included).
  useEffect(() => {
    const sc = st?.scenario;
    if (!sc || synced.current === `${sc.id}-${st?.run}`) return;
    synced.current = `${sc.id}-${st?.run}`;
    setType(sc.type); setHubs(sc.hubs); setFrom(hm(sc.period.start)); setTo(hm(sc.period.end));
    const v = (n: string) => sc.inputs.find((i) => i.name === n)?.value;
    if (v("extraDemandPct") !== undefined) setPct(String(v("extraDemandPct")));
    if (v("extraReturns") !== undefined) setReturns(String(v("extraReturns")));
    if (v("extraChargingRequests") !== undefined) setExtra(String(v("extraChargingRequests")));
    if (Array.isArray(v("failedPoints"))) setPoints(v("failedPoints") as string[]);
  }, [st?.scenario?.id, st?.run]);

  const runIt = async () => {
    // A blank field is sent as null, so the server reports it (E2) instead of running it as 0.
    const num = (x: string) => (x.trim() === "" ? null : Number(x));
    const inputs = type === "A demand surge" ? [{ name: "extraDemandPct", value: num(pct) }]
      : type === "B return wave" ? [{ name: "extraReturns", value: num(returns) }]
      : type === "D charging demand surge" ? [{ name: "extraChargingRequests", value: num(extra) }] : [{ name: "failedPoints", value: points.filter((p) => hubs.some((h) => p.startsWith(`CP-${h}-`))) }];
    setBusy(true);
    try {
      if (!st?.scenario) await api("/operator/sim/start", {});
      await api("/operator/sim/define", { type, hubs, start: toMs(now, from), end: toMs(now, to), inputs });
    } catch (e) { const code = (e as ApiError).code ?? ""; setErr({ field: code.startsWith("E2:") ? code.slice(3) : undefined, message: (e as Error).message }); setBusy(false); return; }
    setBusy(false);
    await call("run");
  };

  if (!st) return <div className="c-body"><div className="page-head"><div><h1>What-if simulation</h1></div></div>{err && <div className="banner danger"><span className="ic"><Icon name="circle-alert" /></span><b>Cannot start.</b><p>{err.message}</p></div>}</div>;
  if (st.result) return <Result st={st} go={go} now={appliedAt ?? now} onDone={() => call("discard")} />;
  if (st.review) return <ReviewView st={st} onCancel={() => call("cancel")} onConfirm={() => { setAppliedAt(now); void call("confirm"); }} busy={busy} />;

  const s = st.scenario && st.measures.length ? st : null;
  const t = s?.totals;
  const hubName = (id: string) => st.baseline.hubs.find((h) => h.hubId === id)?.name ?? id;
  const hubPoints = st.baseline.points.filter((p) => hubs.includes(p.hubId));
  const local = checkInputs(type, hubs, from, to, pct, returns, points.filter((p) => hubPoints.some((x) => x.id === p)), extra, hubPoints.length);
  // A live local error wins; a server error stays only until the inputs change.
  const shown = local ?? (err?.field ? err : null);
  const fieldErr = (f: string) => (shown?.field === f ? <span className="hint" style={{ color: "var(--danger)" }}><Icon name="circle-alert" />{shown.message}</span> : null);
  const selected = sel.filter((id) => s?.recommendations.find((r) => r.id === id)?.actionable);

  return (
    <div className="c-body">
      <div className="page-head">
        <div><h1>What-if simulation</h1><p>{st.openedFrom ? `Opened from the ${st.openedFrom} warning (1a) · ` : ""}Run #{st.run + (s ? 0 : 1)} today</p></div>
        <div className="row"><button className="btn ghost" onClick={() => setShowHist(!showHist)}><Icon name="history" />Previous runs</button></div>
      </div>
      {showHist && (
        <section className="card"><div className="list">
          {st.history.length === 0 && <div className="li"><div className="grow small muted">No runs yet in this demo.</div></div>}
          {st.history.map((h) => <div className="li" key={h.run}><div className="lead sim"><Icon name="flask-conical" /></div><div className="grow"><div className="t">Run #{h.run} · {h.type} · {h.hubs.join(", ")}</div><div className="s">{hms(h.at)} · demand met {h.demandMet[0]}% → {h.demandMet[1]}%</div></div></div>)}
        </div></section>
      )}
      {err && !err.field && <div className="banner danger"><span className="ic"><Icon name="circle-alert" /></span><b>{err.message.includes("E1") ? "No fresh data (E1)." : "Not run."}</b><p>{err.message}</p></div>}

      <div className="sim-frame">
        <div className="sim-banner"><span className="pill">SIMULATION</span>Results do not change live data. Baseline captured {hms(st.baseline.takenAt)} (live state unchanged).<span className="grow" /><span style={{ fontWeight: 600, opacity: 0.85 }}>Isolated copy · {st.baseline.hubs.length} Hubs</span></div>
        <div className="inner">
          <div className="grid g-12">
            <section className="card span-4 r-stack-md">
              <div className="card-head"><span className="h4"><Icon name="sliders-horizontal" />Scenario</span>{shown ? <span className="chip danger">Invalid</span> : <span className="chip ok">Valid</span>}</div>
              <div className="card-body stack">
                <div className="stack tight">
                  {st.scenarios.map((x) => (
                    <div key={x.type} className={`choice clickable${type === x.type ? " on" : ""}`} onClick={() => { setType(x.type); setErr(null); if (x.type === "C charging-point failure" && !points.length) setPoints([]); }}>
                      <span className="radio" /><div className="grow"><b>{x.title}</b><div className="small muted">{x.hint}</div></div><Icon name={ICON[x.type]} />
                    </div>
                  ))}
                </div>
                <div className="field"><label>Hubs</label>
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {st.baseline.hubs.map((h) => (
                      <button key={h.hubId} disabled={h.stale} title={h.stale ? "Disconnected in the baseline (E1)" : h.name}
                        className={`chip clickable ${hubs.includes(h.hubId) ? "sim" : "neutral"}`} style={{ opacity: h.stale ? 0.45 : 1, border: 0, cursor: h.stale ? "not-allowed" : "pointer" }}
                        onClick={() => { setHubs(hubs.includes(h.hubId) ? hubs.filter((x) => x !== h.hubId) : [...hubs, h.hubId].sort()); setErr(null); }}>{h.hubId}</button>
                    ))}
                  </div>{fieldErr("hubs")}
                </div>
                <div className="two">
                  <div className="field"><label>From</label><input className="input sm" type="time" value={from} onChange={(e) => { setFrom(e.target.value); setErr(null); }} /></div>
                  <div className="field"><label>To</label><input className="input sm" type="time" value={to} onChange={(e) => { setTo(e.target.value); setErr(null); }} /></div>
                </div>{fieldErr("period")}
                {type === "A demand surge" && <div className="field"><label>Pickup demand vs. baseline (%)</label><input className={`input sm${shown?.field === "extraDemandPct" ? " error" : ""}`} type="number" value={pct} onChange={(e) => { setPct(e.target.value); setErr(null); }} /><span className="hint"><Icon name="info" />Allowed −90% to +300%.</span>{fieldErr("extraDemandPct")}</div>}
                {type === "B return wave" && <div className="field"><label>Extra returns in the period</label><input className={`input sm${shown?.field === "extraReturns" ? " error" : ""}`} type="number" value={returns} onChange={(e) => { setReturns(e.target.value); setErr(null); }} /><span className="hint"><Icon name="info" />Whole number from 1 to 300, spread over the chosen Hubs.</span>{fieldErr("extraReturns")}</div>}
                {type === "D charging demand surge" && <div className="field"><label>Extra charging requests in the period</label><input className={`input sm${shown?.field === "extraChargingRequests" ? " error" : ""}`} type="number" value={extra} onChange={(e) => { setExtra(e.target.value); setErr(null); }} /><span className="hint"><Icon name="info" />Whole number from 1 to 60, spread evenly over the period and the chosen Hubs. Each needs 1 h on a point.</span>{fieldErr("extraChargingRequests")}</div>}
                {type === "C charging-point failure" && (
                  <div className="field"><label>Points that fail</label>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {hubPoints.length === 0 && <span className="small muted">The chosen Hubs have no charging points.</span>}
                      {hubPoints.map((p) => <button key={p.id} className={`chip clickable mono ${points.includes(p.id) ? "sim" : "neutral"}`} style={{ border: 0 }} title={p.status} onClick={() => { setPoints(points.includes(p.id) ? points.filter((x) => x !== p.id) : [...points, p.id]); setErr(null); }}>{p.id}</button>)}
                    </div>{fieldErr("failedPoints")}
                  </div>
                )}
              </div>
              <div className="row" style={{ padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
                <button className={`btn ${s ? "secondary" : "primary"} grow`} disabled={busy || !!local} title={local ? local.message : undefined} onClick={runIt}><Icon name={s ? "rotate-ccw" : "play"} />{s ? "Rerun (10a)" : "Run simulation"}</button>
              </div>
            </section>

            <div className="span-8 stack loose r-stack-md">
              {!s && <div className="card pad-lg"><p className="muted">Choose a scenario and run it. The simulation uses the baseline copy only.</p></div>}
              {s && t && isCharging(s.scenario!.type) && <ChargingResult st={s} t={t} />}
              {s && t && !isCharging(s.scenario!.type) && (
                <>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                    <Kpi icon="users" label="Demand met" v={`${t.demandMet}%`} after={`→ ${t.demandMetAfter}%`} d={<span className="sim-tag">simulated</span>} />
                    <Kpi icon="hourglass" label="Average wait" v={`${t.avgWait}`} after={`min → ${t.avgWaitAfter}`} d={<span className="sim-tag">simulated</span>} />
                    <Kpi icon="circle-minus" label="Hubs short" v={`${t.short.length}`} after={`→ ${t.shortAfter.length}`} d={t.short.length ? `${t.short.join(", ")} below S/D` : "none"} />
                    {<Kpi icon="layout-grid" label="Dock overflow" v={`${t.overflow.length}`} after={`→ ${t.overflowAfter.length}`} d={t.overflow.length ? `${t.overflow.join(", ")} above capacity` : "none"} />}
                  </div>
                  <section className="card">
                    <div className="card-head"><span className="h4"><Icon name="chart-column" />Measures per Hub · {hm(s.scenario!.period.start)}–{hm(s.scenario!.period.end)}</span>
                      <div className="row small" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: "#C9B5F5" }} />Before</span><span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: "var(--sim)" }} />After recommendations</span><span className="sim-tag">simulated</span></div></div>
                    <table className="table">
                      <thead><tr><th>Hub</th><th className="r">D</th><th className="r">S</th><th style={{ width: 190 }}>Demand met</th><th className="r">Wait (min)</th><th>BR-SIM-01 flag</th></tr></thead>
                      <tbody>
                        {s.measures.map((m) => {
                          const a = s.after.find((x) => x.hubId === m.hubId) ?? m;
                          return (
                            <tr key={m.hubId}>
                              <td><div className="hubcell"><span className="hub-code">{m.hubId}</span><b>{hubName(m.hubId)}</b></div></td>
                              <td className="r num">{m.demand}</td><td className="r num">{m.supply}</td>
                              <td><div className="stack" style={{ gap: 4 }}>
                                <div className="row"><div className="meter grow" style={{ ["--v" as string]: `${m.demandMetPct}%` }}><i style={{ background: "#C9B5F5" }} /></div><span className="num small" style={{ width: 34 }}>{m.demandMetPct}%</span></div>
                                <div className="row"><div className="meter sim grow" style={{ ["--v" as string]: `${a.demandMetPct}%` }}><i /></div><b className="num small simval" style={{ width: 34 }}>{a.demandMetPct}%</b></div>
                              </div></td>
                              <td className="r num">{m.avgWaitMin === a.avgWaitMin ? m.avgWaitMin : `${m.avgWaitMin} → ${a.avgWaitMin}`}</td>
                              <td><Flag m={m} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                </>
              )}
            </div>
          </div>

          {s && s.charging.length > 0 && s.charging.map((c) => <ChargingPlanCard key={c.hubId} c={c} type={s.scenario!.type} />)}
          {s && s.scenario!.period.start > st.now + 15 * 60_000 && (
            <div className="banner info"><span className="ic"><Icon name="calendar-clock" /></span><b>This run is for a later window: {hm(s.scenario!.period.start)}–{hm(s.scenario!.period.end)} (now {hm(st.now)}).</b>
              <p>Applying changes only what happens in that window: {isCharging(s.scenario!.type) ? "the chosen points take no session in it, and sessions before it stay as they are" : `transfers are due before ${hm(s.scenario!.period.start)}`}. Smart charging shows it under "Open charging schedule" on the result.</p></div>
          )}
          {s && (
            <>
              <section className="card">
                <div className="card-head"><span className="h4"><Icon name="lightbulb" />Recommendations (BR-SIM-01)</span><span className="small subtle">Select the ones to apply · only UC-10 and UC-11 actions are selectable</span></div>
                <div className="list">
                  {s.recommendations.length === 0 && <div className="li"><div className="grow small muted">No action needed: every Hub meets demand in this scenario.</div></div>}
                  {s.recommendations.map((r) => {
                    const on = sel.includes(r.id);
                    return (
                      <div key={r.id} className={`li${r.actionable ? " clickable" : " dim"}`} onClick={() => r.actionable && setSel(on ? sel.filter((x) => x !== r.id) : [...sel, r.id])}>
                        <span className={`cbx${!r.actionable ? " dis" : on ? " on" : ""}`}>{on && r.actionable && <Icon name="check" />}</span>
                        <div className={`lead${r.actionable ? " sim" : ""}`}><Icon name={r.kind === "transfer" ? "truck" : r.kind === "charging plan" ? "plug-zap" : "signpost"} /></div>
                        <div className="grow"><div className="t">{r.title}</div><div className="s">{r.detail}</div></div>
                        {r.actionable ? <span className="chip sim">Recommendation</span> : <span className="chip neutral">Advisory</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
              <div className="row" style={{ gap: 10 }}>
                <span className="small muted grow">Closing the result discards it; no live state changes (10c).</span>
                <button className="btn secondary" disabled={busy} onClick={() => call("discard")}><Icon name="x" />Discard result</button>
                <button className="btn primary" disabled={busy || !selected.length} onClick={() => call("apply", { ids: selected })}><Icon name="arrow-right" />Apply {selected.length} selected… (UC-14)</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, v, after, d }: { icon: string; label: string; v: string; after: string; d: React.ReactNode }) {
  return <div className="kpi"><div className="l"><span className="ic" style={{ background: "var(--sim-bg)", color: "var(--sim)" }}><Icon name={icon} /></span>{label}</div><div className="v simval">{v} <small>{after}</small></div><div className="d">{d}</div></div>;
}

function Flag({ m }: { m: Measure }) {
  if (m.shortage > 0) return <span className={`chip ${m.demandMetPct < 70 ? "danger" : "warn"}`}>Shortage −{m.shortage}</span>;
  if (m.overflow > 0) return <span className="chip danger">Dock overflow {m.overflow}</span>;
  if (m.unservedCharging > 0 || m.sessionsToMove > 0) return <span className="chip warn">{m.sessionsToMove} session{m.sessionsToMove === 1 ? "" : "s"} to move · {m.unservedCharging} unserved</span>;
  if (m.supply > m.demand) return <span className="chip info">Surplus {m.supply - m.demand}</span>;
  return <span className="chip ok">Balanced</span>;
}

const CHECK_TONE: Record<string, string> = { "Still valid": "ok", "Adjusted to live state": "warn", "No longer applicable": "neutral", "Advisory only": "neutral" };

function ReviewView({ st, onCancel, onConfirm, busy }: { st: SimState; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  const r = st.review!;
  const n = (c: string) => r.filter((x) => x.check === c).length;
  const applicable = r.filter((x) => x.check === "Still valid" || x.check === "Adjusted to live state").length;
  const sc = st.scenario!;
  return (
    <div className="c-body">
      <div className="page-head"><div><h1>Apply recommendations</h1><p>From simulation run #{st.run} · scenario {sc.type[0]} · {sc.type.slice(2)} at {sc.hubs.join(", ")}</p></div></div>
      <div className="banner info"><span className="ic"><Icon name="refresh-ccw-dot" /></span><b>Rechecked against the live state at {hms(st.liveAt ?? 0)} (baseline {hms(st.baseline.takenAt)}).</b>
        <p>No live change has been made. {n("Still valid")} still valid as simulated, {n("Adjusted to live state")} adjusted and {n("No longer applicable")} no longer applies.{st.drift?.movedHubs.length ? ` Live counts moved at ${st.drift.movedHubs.join(", ")} since the baseline.` : ""}</p></div>
      <section className="card" style={{ overflow: "hidden" }}>
        <table className="table">
          <thead><tr><th style={{ width: 44 }} /><th>Recommendation</th><th>Live check</th><th>Concrete change</th><th>Depends on</th></tr></thead>
          <tbody>
            {r.map((x) => {
              const ok = x.check === "Still valid" || x.check === "Adjusted to live state";
              return (
                <tr key={x.id} className={ok ? "" : "dim"}>
                  <td><span className={`cbx${ok ? " on" : " dis"}`}>{ok && <Icon name="check" />}</span></td>
                  <td><b>{x.title}</b><div className="xs subtle">{x.useCase}</div></td>
                  <td><span className={`chip ${CHECK_TONE[x.check]}`}>{x.check}</span>{x.check !== "Still valid" && <div className="xs" style={{ marginTop: 4, fontWeight: 600, color: x.check === "Adjusted to live state" ? "var(--warn)" : undefined }}>{x.note}</div>}</td>
                  <td className={ok ? "" : "subtle"}>{ok ? <b className="mono">{x.change}</b> : x.change}</td>
                  <td className="small subtle">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="card row" style={{ padding: "14px 18px", gap: 12 }}>
        <span className="hint grow" style={{ fontSize: 13 }}><Icon name="info" />Each change is checked again right before it is made (6a). A change that no longer fits is recorded "Not Applied".</span>
        <button className="btn secondary" disabled={busy} onClick={onCancel}>Cancel (5a)</button>
        <button className="btn primary" disabled={busy || !applicable} onClick={onConfirm}><Icon name="check" />Confirm and apply {applicable} change{applicable === 1 ? "" : "s"}</button>
      </div>
    </div>
  );
}

function Result({ st, go, now, onDone }: { st: SimState; go: OpGo; now: number; onDone: () => void }) {
  const border: Record<string, string> = { Applied: "var(--ok)", "Pending Reconciliation": "#E2A336", "Not Applied": "var(--ink-300)" };
  const tone: Record<string, string> = { Applied: "ok", "Pending Reconciliation": "warn", "Not Applied": "neutral" };
  return (
    <div className="c-body">
      <div className="page-head"><div><h1>Result</h1><p>Applied {hms(now)} by Tran Lan · recorded in the audit log</p></div>
        <div className="row"><button className="btn secondary" onClick={() => go({ nav: "orders" })}><Icon name="truck" />Open orders</button><button className="btn primary" onClick={onDone}>Done</button></div></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {st.result!.map((o) => (
          <div key={o.id} className="card pad-lg stack tight" style={{ alignItems: "flex-start", borderTop: `4px solid ${border[o.outcome]}` }}>
            <span className={`chip ${tone[o.outcome]}`}>{o.outcome}</span><b style={{ fontSize: 15 }}>{o.title}</b>
            {o.reference && <div className="mono" style={{ fontSize: 20 }}>{o.reference}</div>}
            <span className="small muted">{o.note}</span>
            {o.schedule && o.outcome !== "Not Applied" && <button className="btn secondary sm" onClick={() => go({ nav: "charging", hubId: o.schedule!.hubId, from: o.schedule!.from, hours: o.schedule!.hours })}><Icon name="calendar-range" />Open charging schedule · {o.schedule.hubId}</button>}
          </div>
        ))}
        {st.result!.length === 0 && <div className="card pad-lg"><p className="muted">Nothing was applied.</p></div>}
      </div>
    </div>
  );
}

function ChargingResult({ st, t }: { st: SimState; t: NonNullable<SimState["totals"]> }) {
  const c = st.scenario!.type === "C charging-point failure";
  const moves = st.charging.reduce((n, x) => n + x.moves.filter((m) => m.outcome === "moved" || m.outcome === "shifted").length, 0);
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Kpi icon="battery-charging" label={c ? "Charging requests met" : "Surge requests met"} v={`${t.demandMet}%`} after={`→ ${t.demandMetAfter}%`} d={<span className="sim-tag">simulated</span>} />
        <Kpi icon="hourglass" label={c ? "Average charging wait" : "Surge average wait"} v={`${t.avgWait}`} after={`min → ${t.avgWaitAfter}`} d={c ? "normal plan → with the failure" : "before → with the plan"} />
        <Kpi icon="plug-zap" label="Unserved charging" v={`${t.unservedCharging}`} after={`→ ${t.unservedChargingAfter}`} d={c ? "no re-plan → re-planned" : "surge requests"} />
        <Kpi icon="move" label={c ? "Sessions moved" : "Points kept free"} v={c ? `${moves}` : `${st.charging.reduce((n, x) => n + x.points.length, 0)}`} after="" d={c ? "to another point or time" : "in the window, for the surge"} />
      </div>
    </>
  );
}

const OUT_TONE: Record<string, string> = { moved: "info", shifted: "neutral", "stops early": "warn", unserved: "warn", "cancelled, fee refunded": "danger" };

function ChargingPlanCard({ c, type }: { c: ChargingDetail; type: SType }) {
  const fail = type === "C charging-point failure";
  const w = `${hm(c.window.start)}–${hm(c.window.end)}`;
  const row = (label: string, a: number | string, b: number | string, unit = "") => <tr><td>{label}</td><td className="r num">{a}{unit}</td><td className="r num"><b className="simval">{b}{unit}</b></td></tr>;
  return (
    <section className="card">
      <div className="card-head"><span className="h4"><Icon name="calendar-range" />{c.hubId} charging plan · {w}</span>
        <span className="small subtle">{fail ? <>Failing: <b className="mono">{c.points.join(", ")}</b></> : c.points.length ? <>Kept free for the surge: <b className="mono">{c.points.join(", ")}</b></> : "No point needs to be kept free"} · limit {c.limitKw} kW <span className="sim-tag">simulated</span></span></div>
      <div className="card-body grid" style={{ gridTemplateColumns: "minmax(220px, 1fr) 2fr", gap: 18, alignItems: "start" }}>
        <table className="table">
          <thead><tr><th /><th className="r">{fail ? "Normal" : "Today's plan"}</th><th className="r">{fail ? "With failure" : "With the plan"}</th></tr></thead>
          <tbody>
            {c.surge && row("Surge requests served", `${c.surge.servedBefore}/${c.surge.requests}`, `${c.surge.servedAfter}/${c.surge.requests}`)}
            {c.surge && row("Surge average wait", c.surge.waitBefore, c.surge.waitAfter, " min")}
            {row(fail ? "Sessions served" : "Shared sessions served", c.normal.served, c.scenario.served)}
            {row(fail ? "Requests unserved" : "Shared vehicles unserved", c.normal.unserved, c.scenario.unserved)}
            {row("Average wait (queue)", c.normal.waitMin, c.scenario.waitMin, " min")}
            {row("Peak load", c.normal.peakKw, c.scenario.peakKw, " kW")}
          </tbody>
        </table>
        <div className="stack tight">
          <span className="eyebrow">{fail ? "Sessions on the failing points, and what the re-plan does with them" : "Shared sessions the plan moves out of the kept points"}</span>
          {c.moves.length === 0 && <span className="small muted">No session is affected.</span>}
          {c.moves.length > 0 && (
            <table className="table">
              <thead><tr><th>Session</th><th>Planned</th><th>In the scenario</th><th>Outcome</th></tr></thead>
              <tbody>{c.moves.map((m) => (
                <tr key={m.sessionId}>
                  <td><b className="mono small">{m.vehicleId}</b><div className="xs subtle">{m.sessionId}{m.committed ? " · student, paid" : " · shared"}</div></td>
                  <td className="mono small">{m.from ? `${m.from.pointId} ${hm(m.from.start)}–${hm(m.from.end)}` : "—"}</td>
                  <td className="mono small">{m.to ? `${m.to.pointId} ${hm(m.to.start)}–${hm(m.to.end)}` : "—"}</td>
                  <td><span className={`chip ${OUT_TONE[m.outcome] ?? "neutral"}`}>{m.outcome}</span></td>
                </tr>))}</tbody>
            </table>
          )}
          <span className="hint"><Icon name="info" />{fail
            ? `"moved": was on a failing point in ${w}. "shifted": moved to make room. "stops early": already charging, so it would stop when the point fails. Apply keeps ${c.points.join(", ")} free in ${w} (they stay In Service) and commits this plan; Smart charging then shows it.`
            : `Each surge request needs ${c.surge?.durationMin ?? 60} min on a point and arrives spread over ${w}. Apply keeps ${c.points.join(", ") || "no point"} free in ${w} for students' bookings; shared vehicles charge outside it. A session already charging on a kept point finishes as planned.`}</span>
        </div>
      </div>
    </section>
  );
}
