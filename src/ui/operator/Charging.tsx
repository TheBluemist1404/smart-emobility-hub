// O03 Smart charging schedule (UC-11 steps 2-16, 1a, 2a, 7a, 7b, E1-E5).
import { useState } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, api, hm, hms, useLive } from "../shared/live";
import type { OpGo } from "./OperatorConsole";

interface Block { sessionId: string; pointId: string; start: number; end: number; committed: boolean; status: string; vehicleId: string; soc: number | null; targetSoc: number; priority: number | null; emergency: boolean; originalStart: number | null; latestStart: number | null; moved: boolean; locked: boolean }
interface Proposal { hubId: string; horizon: { start: number; end: number }; hours: number; generatedAt: number; blocks: Block[]; current: Block[]; unserved: Array<{ sessionId: string; vehicleId: string; priority: number | null; reason: string }>; alerts: string[]; rejected: { sessionId: string; message: string } | null;
  kpis: { serviced: number; servicedWas: number; avgWait: number; avgWaitWas: number; peakKw: number; peakKwWas: number; limitKw: number; unserved: number; unservedWas: number; load: Array<{ t: number; proposed: number; current: number }> } }
interface Sched { hubId: string; name: string; stale: boolean; horizon: { start: number; end: number }; slotMs: number; peakKw: number; points: Array<{ id: string; power: string; kw: number; status: string; incidentId: string | null; updatedAt: number }>; blocks: Block[];
  queue: Array<{ sessionId: string; vehicleId: string; soc: number | null; priority: number | null; waitedMs: number; emergency: string | null; unserved: boolean; status: string | null; hubFlag: boolean }>; version: number; proposal: Proposal | null;
  policy: { params: Array<{ name: string; value: number; unit: string; min: number; max: number; meaning: string }>; peakKw: number | null } }

const HUBS: Array<[string, string]> = [["H01", "KTX Khu A"], ["H02", "KTX Khu B"], ["H03", "Ga Metro ĐHQG"], ["H04", "ĐH Bách khoa (Dĩ An)"], ["H05", "Nhà Văn hóa SV"], ["H06", "ĐH KHTN"], ["H07", "Thư viện Trung tâm"]];
const pointTone = (s: string) => ({ Available: "ok", "In Use": "info", "Out of Service": "danger", Disconnected: "neutral" } as Record<string, string>)[s] ?? "neutral";

export function O03Charging({ go, now, hubId: hub0 }: { go: OpGo; now: number; hubId: string }) {
  const [hubId, setHub] = useState(hub0);
  const [hours, setHours] = useState(4);
  const { data: s } = useLive<Sched>(`/operator/charging/${hubId}?hours=${hours}`);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [emer, setEmer] = useState<{ id: string; reason: string } | null>(null);
  const [policy, setPolicy] = useState(false);
  const p = s?.proposal ?? null;
  const call = (url: string, body: unknown = {}) => api(url, body).then((r) => { setErr(null); return r; }).catch((e: ApiError) => { setErr(e.message); throw e; });
  const gen = () => call(`/operator/charging/${hubId}/generate`, { hours }).then(() => setMsg(null)).catch(() => {});
  const apply = () => call(`/operator/charging/${hubId}/apply`).then((r) => { const x = r as { applied: number; shifted: string[]; cancelled: string[]; version: number }; setMsg(`Applied version ${x.version}: ${x.applied} sessions scheduled${x.shifted.length ? `, ${x.shifted.join(", ")} moved (student notified)` : ""}${x.cancelled.length ? `, ${x.cancelled.join(", ")} cancelled and refunded` : ""}.`); }).catch(() => {});

  if (!s) return <div className="c-body"><span className="spinner" /></div>;
  const hz = p?.horizon ?? s.horizon;
  const span = hz.end - hz.start;
  const slots = Math.round(span / s.slotMs);
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - hz.start) / span) * 100))}%`;
  const blocks = p ? p.blocks : s.blocks;
  const k = p?.kpis;
  const delta = (a: number, b: number, unit = "", better: "up" | "down" = "up") => { const d = a - b; if (!d) return <span className="subtle">no change</span>; const good = better === "up" ? d > 0 : d < 0; return <span className={good ? "delta-up" : "delta-down"}>{d > 0 ? "+" : "−"}{Math.abs(d)}{unit}</span>; };

  const onDrop = (pointId: string, e: React.DragEvent<HTMLDivElement>) => {
    if (!drag || !p) return;
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const b = p.blocks.find((x) => x.sessionId === drag)!;
    const grabbed = Number(e.dataTransfer.getData("text/offset") || 0);
    const t = hz.start + ((e.clientX - r.left) / r.width) * span - grabbed;
    void b;
    call(`/operator/charging/${hubId}/move`, { sessionId: drag, pointId, start: t }).catch(() => {});
    setDrag(null);
  };

  return (
    <div className="c-body">
      <div className="page-head">
        <div><h1>Smart charging · {hubId}</h1>
          <p className="row" style={{ gap: 10 }}><span>{p ? <>Proposal generated <span className="mono">{hms(p.generatedAt)}</span> · not applied</> : <>Committed schedule · version <span className="mono">{s.version}</span></>}</span><span className="tag param">SCHEDULE_TIMESLOT = {s.slotMs / 60000} min</span></p></div>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="filter"><span>Hub</span><select className="input sm" style={{ width: 200 }} value={hubId} onChange={(e) => { setHub(e.target.value); setMsg(null); setErr(null); }}>{HUBS.map(([h, n]) => <option key={h} value={h}>{h} · {n}</option>)}</select></label>
          <label className="filter"><span>Horizon</span><select className="input sm" style={{ width: 150 }} value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[2, 4, 6].map((h) => <option key={h} value={h}>Next {h} hours</option>)}</select></label>
          <button className="btn ghost" onClick={() => setPolicy(!policy)}><Icon name="sliders-horizontal" />Policy</button>
          <button className="btn secondary" disabled={s.stale} onClick={gen}><Icon name="sparkles" />Generate Schedule</button>
        </div>
      </div>

      {s.stale && <div className="banner neutral"><span className="ic"><Icon name="wifi-off" /></span><b>{hubId} is Disconnected (E5).</b><p>Its charging points cannot be scheduled until the Hub reports again.</p></div>}
      {policy && <Policy s={s} onClose={() => setPolicy(false)} />}

      <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="battery-charging" /></span>Vehicles serviced</div><div className="v">{k ? k.serviced : blocks.length} {k && <small>was {k.servicedWas}</small>}</div><div className="d">{k ? <>{delta(k.serviced, k.servicedWas)} in the horizon</> : "in the horizon"}</div></div>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="hourglass" /></span>Average wait</div><div className="v">{k ? k.avgWait : "–"} <small>min{k ? ` · was ${k.avgWaitWas}` : ""}</small></div><div className="d">{k ? delta(k.avgWait, k.avgWaitWas, " min", "down") : "generate to compare"}</div></div>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="gauge" /></span>Peak load</div><div className="v">{k ? k.peakKw : "–"} <small>kW{k ? ` · was ${k.peakKwWas}` : ""}</small></div><div className="d">under the {s.peakKw} kW limit</div></div>
        <div className="kpi"><div className="l"><span className="ic" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}><Icon name="circle-off" /></span>Unserved requests</div><div className="v">{k ? k.unserved : s.queue.length} {k && <small>was {k.unservedWas}</small>}</div><div className="d">{p?.unserved[0] ? `${p.unserved[0].vehicleId}${p.unserved[0].priority !== null ? ` · P ${p.unserved[0].priority.toFixed(2)}` : ""} (E1)` : k ? "all served" : "waiting in the queue"}</div></div>
      </div>

      <div className="grid g-12">
        <section className="card r-stack-md" style={{ gridColumn: "span 9", overflow: "hidden" }}>
          <div className="card-head"><span className="h4"><Icon name="calendar-range" />Timeline · {hm(hz.start)}–{hm(hz.end)}</span>
            <div className="row" style={{ gap: 14, fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
              <span className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: "var(--ink-900)" }} />Student · committed reservation</span>
              <span className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: "var(--brand-500)" }} />Shared vehicle</span>
              <span className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: "var(--warn-bg)", border: "1.5px dashed var(--warn)" }} />Moved (7b)</span></div></div>
          <div className="tl" style={{ padding: "0 0 4px", gridTemplateColumns: `150px repeat(${slots}, minmax(0, 1fr))` }}>
            <div className="hd" style={{ border: 0 }} />
            {Array.from({ length: slots }, (_, i) => { const t = hz.start + i * s.slotMs; return <div key={i} className={`hd${new Date(t).getUTCMinutes() === 0 ? " hour" : ""}`}>{i % Math.max(1, Math.round(slots / 8)) === 0 ? hm(t) : ""}</div>; })}
            {s.points.map((pt, pi) => {
              const down = pt.status === "Out of Service" || pt.status === "Disconnected";
              return [
                <div key={`l${pt.id}`} className="lane"><b>{pt.id}</b><span className={`chip ${pointTone(pt.status)}`}>{pt.status}</span></div>,
                <div key={`t${pt.id}`} className={`track${down ? " out" : ""}`} style={{ gridColumn: `span ${slots}`, ...(down ? {} : { backgroundImage: `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px calc(100% / ${slots}))` }) }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(pt.id, e)}>
                  <span className="now" style={{ left: pct(now) }}>{pi === 0 && <span className="lbl">{hm(now)}</span>}</span>
                  {down && <div className="blk" style={{ left: "2%", width: "70%", color: "var(--danger)", justifyContent: "center" }}><span className="row" style={{ gap: 6 }}><Icon name="plug" className="ic-sm" />{pt.status}{pt.incidentId ? ` · ${pt.incidentId}` : ""}{pt.status === "Out of Service" ? " (E3)" : " (E5)"} · no sessions planned</span></div>}
                  {blocks.filter((b) => b.pointId === pt.id).map((b) => {
                    const rejected = p?.rejected?.sessionId === b.sessionId;
                    const cls = b.committed ? "student" : b.moved ? "moved" : "shared";
                    return (
                      <div key={b.sessionId} className={`blk ${cls}`} draggable={!!p && !b.locked} title={b.locked ? "Charging now" : p ? "Drag to another point or time" : ""}
                        onDragStart={(e) => { setDrag(b.sessionId); const r = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect(); e.dataTransfer.setData("text/offset", String(((e.clientX - e.currentTarget.getBoundingClientRect().left) / r.width) * span)); }}
                        style={{ left: pct(b.start), width: `calc(${pct(b.end)} - ${pct(b.start)} - 3px)`, ...(rejected ? { boxShadow: "0 0 0 2px var(--danger)" } : {}), ...(b.emergency ? { outline: "2px solid var(--danger)" } : {}), cursor: p && !b.locked ? "grab" : "default" }}>
                        {b.committed ? <span className="row" style={{ gap: 5 }}><Icon name="lock" className="ic-sm" />{b.sessionId}<span className="opt"> · committed</span></span> : <span>{b.vehicleId}{b.locked ? " · charging" : b.priority !== null ? ` · P ${b.priority.toFixed(2)}` : ""}</span>}
                        <small>{b.committed ? <>{hm(b.start)}–{hm(b.end)}<span className="opt"> · {rejected ? "move rejected" : `shift ≤ +${((b.latestStart ?? 0) - (b.originalStart ?? 0)) / 60000} min`}</span></> : b.moved ? `moved (7b) · ${hm(b.start)}` : `${b.soc ?? "?"}% → ${b.targetSoc}%`}</small>
                      </div>
                    );
                  })}
                </div>,
              ];
            })}
          </div>
          {k && (
            <div className="card-body" style={{ paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="row between" style={{ marginBottom: 8 }}><span className="eyebrow">Hub load per slot · proposed vs current plan</span><span className="small subtle">Limit {k.limitKw} kW</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", alignItems: "end" }}>
                <div className="stack tight small"><span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: "var(--brand-500)" }} />Proposed</span><span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, border: "1.5px solid var(--ink-300)" }} />Current plan</span></div>
                <div style={{ position: "relative", height: 80 }}>
                  {(() => { const top = Math.max(k.limitKw * 1.1, ...k.load.map((l) => Math.max(l.proposed, l.current)), 1); return (
                    <>
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(k.limitKw / top) * 100}%`, borderTop: "1.5px dashed var(--danger)" }} />
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${k.load.length},1fr)`, gap: 4, height: 80, alignItems: "end" }}>{k.load.map((l) => <i key={l.t} style={{ height: `${(l.proposed / top) * 100}%`, background: "var(--brand-500)", borderRadius: "4px 4px 1px 1px" }} />)}</div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${k.load.length},1fr)`, gap: 4, height: 80, alignItems: "end", position: "absolute", inset: 0, pointerEvents: "none" }}>{k.load.map((l) => <i key={l.t} style={{ height: `${(l.current / top) * 100}%`, border: l.current ? "1.5px solid var(--ink-300)" : undefined, borderBottom: 0, borderRadius: "4px 4px 0 0" }} />)}</div>
                    </>); })()}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="card r-stack-md" style={{ gridColumn: "span 3", alignSelf: "start" }}>
          <div className="card-head"><span className="h4"><Icon name="list-ordered" />Charging Queue</span><span className="small subtle">{s.queue.length} waiting</span></div>
          <div className="list">
            {s.queue.map((q) => {
              const un = p?.unserved.some((u) => u.sessionId === q.sessionId);
              return (
                <div key={q.sessionId} className="li" style={{ alignItems: "flex-start" }}>
                  <div className="grow"><div className="row between"><b className="mono">{q.vehicleId}</b><span className="mono small strong">P {q.priority?.toFixed(q.priority === 0.725 ? 3 : 2) ?? "–"}</span></div>
                    <div className="s">{q.soc}% · waited {Math.round(q.waitedMs / 60000)} min{q.hubFlag ? " · Hub flagged (D = 1)" : ""}</div>
                    {q.emergency && <div className="xs" style={{ color: "var(--danger)" }}>Emergency: {q.emergency}</div>}
                    {un && <span className="chip warn nodot" style={{ marginTop: 4 }}>Not served in horizon · E1</span>}
                    {p && !q.emergency && (emer?.id === q.sessionId
                      ? <div className="row" style={{ gap: 4, marginTop: 6 }}><input className="input sm grow" placeholder="Justification" value={emer.reason} onChange={(e) => setEmer({ id: q.sessionId, reason: e.target.value })} /><button className="btn danger sm" onClick={() => call(`/operator/charging/${hubId}/emergency`, { sessionId: q.sessionId, reason: emer.reason }).then(() => setEmer(null)).catch(() => {})}>Set</button></div>
                      : <a className="xs clickable" onClick={() => setEmer({ id: q.sessionId, reason: "" })}>Emergency priority (7a)…</a>)}
                  </div>
                </div>
              );
            })}
            {s.queue.length === 0 && <div className="li small subtle">No shared vehicle is waiting for charge.</div>}
          </div>
          <div className="card-body"><span className="hint wrap-any"><Icon name="info" />P = W_SOC(1 − SoC/100) + W_DEMAND·D + W_WAIT·min(wait/CHARGING_MAX_WAIT, 1) (BR-CHG-01). Student sessions are not in this queue and get no P.</span></div>
        </section>
      </div>

      {p?.rejected && <div className="banner danger"><span className="ic"><Icon name="ban" /></span><b>Move rejected (E2)</b><p>{p.rejected.message}</p></div>}
      {p && p.alerts.length > 0 && <div className="banner warn"><span className="ic"><Icon name="triangle-alert" /></span><b>Before applying</b><p>{p.alerts.join(" ")}</p></div>}
      {err && <div className="banner danger"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b>{/E4/.test(err) && <div className="actions"><button className="btn secondary sm" onClick={gen}>Generate again</button></div>}</div>}
      {msg && <div className="banner ok"><span className="ic"><Icon name="circle-check" /></span><b>Schedule applied</b><p>{msg}</p></div>}
      {p && (
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <span className="small subtle grow">Drag a block to another point or slot (step 10). Committed student sessions may only move up to CHARGING_SHIFT_TOLERANCE later.</span>
          <button className="btn ghost" onClick={() => call(`/operator/charging/${hubId}/discard`).then(() => setMsg(null)).catch(() => {})}>Discard Proposal</button>
          <button className="btn primary" onClick={apply}><Icon name="check" />Apply Schedule</button>
        </div>
      )}
      {!p && <span className="small subtle">The timeline shows the committed schedule. Generate a proposal to compare it on numbers (step 8). <a className="clickable" onClick={() => go({ nav: "incidents" })}>Charging incidents</a></span>}
    </div>
  );
}

function Policy({ s, onClose }: { s: Sched; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, number>>(Object.fromEntries(s.policy.params.map((p) => [p.name, p.unit === "ms" ? p.value / 60000 : p.value])));
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const save = () => {
    const out = Object.fromEntries(s.policy.params.map((p) => [p.name, p.unit === "ms" ? vals[p.name] * 60000 : vals[p.name]]));
    api<{ violation: { message: string } | null }>("/operator/policy", { values: out }).then((r) => { if (r.violation) { setErr(r.violation.message); setOk(false); } else { setErr(null); setOk(true); } });
  };
  return (
    <section className="card">
      <div className="card-head"><span className="h4"><Icon name="sliders-horizontal" />Charging policy (2a)</span><span className="small subtle">Hub peak capacity {s.policy.peakKw} kW</span></div>
      <div className="card-body grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {s.policy.params.map((p) => (
          <label key={p.name} className="field" title={p.meaning}><span className="label mono" style={{ fontSize: 11 }}>{p.name}</span>
            <input className="input sm" type="number" step={p.unit === "weight" || p.unit === "ratio" ? 0.05 : 1} value={vals[p.name]} onChange={(e) => { setVals({ ...vals, [p.name]: Number(e.target.value) }); setOk(false); }} />
            <span className="xs subtle">{p.unit === "ms" ? "min" : p.unit}</span></label>
        ))}
      </div>
      <div className="card-body row" style={{ gap: 10 }}>
        {err && <span className="err"><Icon name="circle-alert" />{err}</span>}{ok && <span className="small" style={{ color: "var(--ok)" }}>Saved. Generate the schedule again to use it.</span>}
        <span className="grow" /><button className="btn ghost sm" onClick={onClose}>Close</button><button className="btn primary sm" onClick={save}>Save policy</button>
      </div>
    </section>
  );
}
