// Demo tools drawer: the demo clock and the simulator panel. It plays the IoT / Simulated
// Data Source and the Bank System. Shown on both views behind the "Demo tools" button.
import { useState, type ReactNode } from "react";
import { api, hms, mmss, useClock, useLive, vnd, type DemoState } from "../shared/live";
import { Icon } from "../shared/Icon";

const MIN = 60_000;

export function DemoTools({ side, extra }: { side: "student" | "operator"; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { now, state } = useClock();
  const post = (url: string, body: unknown) => api(`/demo${url}`, body).catch((e: Error) => alert(e.message));
  if (new URLSearchParams(location.search).get("tools") === "0") return null;

  return (
    <>
      <button className="btn sm demo-fab" style={{ background: "#0B1324", color: "#D2FF3D", border: "1px dashed #475069" }} onClick={() => setOpen(!open)}>
        <Icon name="flask-round" className="ic-sm" />Demo tools · <span className="mono">{hms(now)}</span>{state && state.speed !== 1 ? ` ×${state.speed}` : ""}{state?.paused ? " ⏸" : ""}
      </button>
      {open && state && (
        <div className="demo-drawer" role="dialog" aria-label="Demo tools">
          <div className="sec">
            <h4>Demo clock</h4>
            <div className="row between"><span className="clock">{hms(now)}</span><span className="small" style={{ color: "#8A93A8" }}>Mon 02/11/2026 · {side}</span></div>
            <div className="btns" style={{ marginTop: 6 }}>
              {[["+30 s", 0.5 * MIN], ["+1 min", MIN], ["+5 min", 5 * MIN], ["+15 min", 15 * MIN], ["+1 h", 60 * MIN]].map(([l, ms]) => (
                <button key={l as string} className="d" onClick={() => post("/clock", { action: "advance", ms })}>{l}</button>
              ))}
              <button className="d" onClick={() => post("/clock", { action: "next" })}>Next timer ⏭</button>
            </div>
            <div className="btns" style={{ marginTop: 6 }}>
              {[1, 10, 60].map((s) => <button key={s} className={`d${state.speed === s ? " on" : ""}`} onClick={() => post("/clock", { action: "speed", speed: s })}>×{s}</button>)}
              <button className="d" onClick={() => post("/clock", { action: state.paused ? "resume" : "pause" })}>{state.paused ? "Resume" : "Pause"}</button>
              <button className="d" onClick={() => { if (confirm("Reset the whole demo to 14:36:00 and the seed data?")) post("/reset", {}); }}>Reset demo</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {state.timers.length === 0 && <div className="tmr">No timers running</div>}
              {state.timers.slice(0, 6).map((t) => <div className="tmr" key={t.id}><span>{t.label}</span><span>{hms(t.dueAt)} · {mmss(t.dueAt - now)}</span></div>)}
            </div>
          </div>
          <BankSection state={state} post={post} />
          <IoTSection state={state} post={post} />
          {extra}
          <div className="sec">
            <h4>IoT event log</h4>
            {state.events.map((e, i) => <div className="tmr" key={i}><span>{e.text}</span><span>{hms(e.time)}</span></div>)}
          </div>
        </div>
      )}
    </>
  );
}

type Post = (url: string, body: unknown) => Promise<unknown>;

function BankSection({ state, post }: { state: DemoState; post: Post }) {
  return (
    <div className="sec">
      <h4>Bank System (UC-03)</h4>
      <div className="small" style={{ color: "#8A93A8" }}>Answer to every request · answers after {state.bank.delayMs / 1000} s</div>
      <div className="btns" style={{ marginTop: 4 }}>
        {["Success", "Failed", "Timeout", "Manual"].map((m) => <button key={m} className={`d${state.bank.mode === m ? " on" : ""}`} onClick={() => post("/bank", { mode: m })}>{m}</button>)}
      </div>
      <div className="small" style={{ color: "#8A93A8", marginTop: 6 }}>Next request only{state.bank.nextMode ? ` · armed: ${state.bank.nextMode}` : ""}</div>
      <div className="btns" style={{ marginTop: 4 }}>
        {["Failed", "Timeout"].map((m) => <button key={m} className={`d${state.bank.nextMode === m ? " on" : ""}`} onClick={() => post("/bank", { mode: m, once: true })}>Next: {m}</button>)}
      </div>
      {state.bank.outstanding.map((o) => (
        <div key={o.requestId} style={{ marginTop: 6 }}>
          <div className="tmr"><span>{o.type} {o.orderRef} · {vnd(o.amount)}</span><span>sent {hms(o.sentAt)}</span></div>
          <div className="btns">
            <button className="d" onClick={() => post("/bank/respond", { requestId: o.requestId, result: "Success" })}>Answer Success</button>
            <button className="d" onClick={() => post("/bank/respond", { requestId: o.requestId, result: "Failed" })}>Answer Failed</button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface SimContext { vehicles: Array<{ id: string; hubId: string; soc: number; status: string }>; points: Array<{ id: string; hubId: string; status: string }>; trips: Array<{ id: string; vehicleId: string; studentId: string }>; vacantDocks: Array<{ id: string; label: string; hubId: string }>; sessions: Array<{ id: string; pointId: string | null; status: string; start: number | null }>; transfers: Array<{ orderId: string; vehicleId: string; status: string; destDockId: string | null }> }

function IoTSection({ state, post }: { state: DemoState; post: Post }) {
  const { data: ctx } = useLive<SimContext>("/demo/context");
  const [veh, setVeh] = useState("EB-0217");
  const [soc, setSoc] = useState(15);
  const [pt, setPt] = useState("CP-H01-03");
  const [dock, setDock] = useState("");
  const trip = ctx?.trips[0];
  return (
    <div className="sec">
      <h4>IoT / Simulated Data Source</h4>
      <div className="small" style={{ color: "#8A93A8" }}>Dock unlock answer (UC-07)</div>
      <div className="btns" style={{ marginTop: 4 }}>
        {["Success", "Failure", "Timeout"].map((m) => <button key={m} className={`d${state.unlock.mode === m ? " on" : ""}`} onClick={() => post("/unlock", { mode: m })}>{m}</button>)}
        {state.unlock.pending > 0 && <button className="d" onClick={() => post("/unlock/late", {})}>Send late release ({state.unlock.pending})</button>}
      </div>

      <div className="small" style={{ color: "#8A93A8", marginTop: 8 }}>Hub feed (UC-01 E1, UC-09 E1)</div>
      <div className="btns" style={{ marginTop: 4 }}>
        {state.hubs.map((h) => {
          const off = state.silentHubs.includes(h.id);
          return <button key={h.id} className={`d${off ? " on" : ""}`} title={off ? "Disconnected — click to reconnect" : "Connected — click to cut the feed"} onClick={() => post("/hub", { hubId: h.id, connected: off })}>{h.id}{off ? " ✕" : ""}</button>;
        })}
      </div>

      <div className="small" style={{ color: "#8A93A8", marginTop: 8 }}>Battery level (NIFR-02)</div>
      <div className="btns" style={{ marginTop: 4, alignItems: "center" }}>
        <select value={veh} onChange={(e) => setVeh(e.target.value)}>
          {(ctx?.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.id} · {v.hubId} · {Math.round(v.soc)}% · {v.status}</option>)}
        </select>
        <input type="number" value={soc} min={0} max={100} style={{ width: 56 }} onChange={(e) => setSoc(Number(e.target.value))} />%
        <button className="d" onClick={() => post("/battery", { vehicleId: veh, soc })}>Set</button>
        <button className="d" onClick={() => post("/resource", { id: veh, connected: state.silentResources.includes(veh) })}>{state.silentResources.includes(veh) ? "Reconnect" : "Disconnect"}</button>
      </div>

      <div className="small" style={{ color: "#8A93A8", marginTop: 8 }}>Charging point (UC-11 E3 / E5)</div>
      <div className="btns" style={{ marginTop: 4 }}>
        <select value={pt} onChange={(e) => setPt(e.target.value)}>
          {(ctx?.points ?? []).map((p) => <option key={p.id} value={p.id}>{p.id} · {p.status}</option>)}
        </select>
        <button className="d" onClick={() => post("/point-fault", { pointId: pt })}>Report fault</button>
        <button className="d" onClick={() => post("/resource", { id: pt, connected: state.silentResources.includes(pt) })}>{state.silentResources.includes(pt) ? "Reconnect" : "Disconnect"}</button>
      </div>
      {(ctx?.sessions ?? []).filter((s) => s.status === "Scheduled").map((s) => (
        <div className="btns" key={s.id} style={{ marginTop: 4 }}>
          <button className={`d${state.pluggedIn.includes(s.id) ? " on" : ""}`} onClick={() => post("/plug-in", { sessionId: s.id })}>Plug in {s.id} at {s.pointId}</button>
        </div>
      ))}

      {trip && (
        <>
          <div className="small" style={{ color: "#8A93A8", marginTop: 8 }}>Dock latch (UC-08) · {trip.vehicleId}</div>
          <div className="btns" style={{ marginTop: 4 }}>
            <select value={dock} onChange={(e) => setDock(e.target.value)}>
              <option value="">choose a vacant dock…</option>
              {(ctx?.vacantDocks ?? []).map((d) => <option key={d.id} value={d.id}>{d.hubId} · {d.label}</option>)}
            </select>
            <button className="d" disabled={!dock} onClick={() => post("/latch", { dockId: dock, vehicleId: trip.vehicleId, engaged: true })}>Latch</button>
            <button className="d" disabled={!dock} onClick={() => post("/latch", { dockId: dock, vehicleId: trip.vehicleId, engaged: false })}>Not engaged</button>
          </div>
        </>
      )}
      {(ctx?.transfers ?? []).length > 0 && (
        <>
          <div className="small" style={{ color: "#8A93A8", marginTop: 8 }}>Redistribution field reports (UC-10)</div>
          {ctx!.transfers.map((t) => (
            <div className="btns" key={t.vehicleId} style={{ marginTop: 4 }}>
              <span className="small" style={{ minWidth: 120 }}>{t.orderId} · {t.vehicleId} · {t.status}</span>
              {t.status === "Assigned" && <button className="d" onClick={() => post("/transfer", { vehicleId: t.vehicleId, event: "departed" })}>Departed</button>}
              {t.status === "In Transit" && <button className="d" onClick={() => post("/transfer", { vehicleId: t.vehicleId, event: "arrived", dockId: t.destDockId })}>Arrived</button>}
              {(t.status === "In Transit" || t.status === "Assigned") && <button className="d" onClick={() => post("/transfer", { vehicleId: t.vehicleId, event: "breakdown" })}>Breakdown</button>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
