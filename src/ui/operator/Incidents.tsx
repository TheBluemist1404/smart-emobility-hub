// O04 Incidents (UC-12 steps 2-11, 3a, 3b, 5a, 6, 7, 8a, 8b, 8c, 9, 9b, E1, E2).
import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, api, cap, hm, hms, useLive } from "../shared/live";
import type { OpGo } from "./OperatorConsole";

interface Row { id: string; status: string; source: string; resourceId: string; resourceLabel: string; hubId: string; onTrip: boolean; category: string; createdAt: number; owner: string | null; blocking: boolean; reports: number }
interface List { active: Row[]; resolved: Row[]; dismissed: Row[]; counts: { open: number; inProgress: number }; oldestOpenAt: number | null }
interface Outcome { allocationId: string; kind: string; studentId: string; outcome: string; detail: string }
interface Detail {
  id: string; status: string; version: number; category: string; description: string; source: string; hubId: string; owner: string | null; blocking: boolean; createdAt: number;
  resource: { id: string; kind: string; label: string; status: string; confirmedAt: number; stale: boolean } | null;
  reports: Array<{ id: string; studentId: string; status: string; time: number; text: string; photos: number }>;
  actions: Array<{ note: string; operator: string; time: number; blockRequested: boolean; kind: string }>;
  affectedDetail: Array<{ id: string; kind: string; status: string; studentId: string; detail: string }>;
  awaiting: string[]; orders: Array<{ orderId: string; status: string }>; reschedules: string[]; progressNote: string | null; pending: string | null; resolution: string | null; dismissReason: string | null; duplicateOf: string | null;
  live: { soc: number; type: string; model: string; location: string; onTrip: { id: string; studentId: string; startTime: number } | null } | null;
  unconfirmed: boolean; canVerifyBreakdown: boolean; breakdownTime: number | null;
}

const tone = (s: string) => ({ Open: "warn", "In Progress": "info", Resolved: "ok", Dismissed: "neutral" } as Record<string, string>)[s] ?? "neutral";
const srcLabel = (s: string) => ({ "student report": "Student report", system: "System", operator: "Operator", "network warning": "System · UC-09" } as Record<string, string>)[s] ?? s;
const CATS = ["vehicle failure", "charging point unavailable or faulty", "parking space blocked or occupied", "Hub facility problem", "Hub disconnected", "other"];

export function O04Incidents({ go, now, incidentId, draftFor }: { go: OpGo; now: number; incidentId?: string; draftFor?: string }) {
  const { data } = useLive<List>("/operator/incidents");
  const [tab, setTab] = useState<"active" | "resolved" | "dismissed">("active");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(incidentId ?? null);
  const [creating, setCreating] = useState<string | null>(draftFor ?? null);
  useEffect(() => { if (incidentId) setSel(incidentId); }, [incidentId]);
  useEffect(() => { if (draftFor) setCreating(draftFor); }, [draftFor]);
  const rows = (data?.[tab] ?? []).filter((r) => !q || `${r.id} ${r.resourceId} ${r.resourceLabel} ${r.hubId}`.toLowerCase().includes(q.toLowerCase()));
  const pick = sel ?? data?.active[0]?.id ?? null;
  const oldest = data?.oldestOpenAt ? Math.round((now - data.oldestOpenAt) / 60000) : null;

  return (
    <div className="c-body">
      <div className="page-head">
        <div><h1>Incidents</h1><p className="small subtle">{data?.counts.open ?? 0} Open · {data?.counts.inProgress ?? 0} In Progress{oldest !== null ? ` · oldest open ${oldest} min` : ""}</p></div>
        <button className="btn primary" onClick={() => setCreating("")}><Icon name="plus" />New incident</button>
      </div>
      <div className="grid g-12">
        <section className="card span-7 r-stack-md" style={{ overflow: "hidden", alignSelf: "start" }}>
          <div className="card-head">
            <div className="seg">{(["active", "resolved", "dismissed"] as const).map((t) => <span key={t} className={`clickable${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)} {data?.[t].length ?? 0}</span>)}</div>
            <input className="input sm" style={{ width: 210 }} placeholder="Incident, resource, Hub" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table className="table">
            <thead><tr><th>Incident</th><th>Status</th><th>Source</th><th>Resource</th><th>Category</th><th className="r">Reported</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={`clickable${pick === r.id ? " sel" : ""}`} onClick={() => { setSel(r.id); setCreating(null); }}>
                <td className="mono strong">{r.id}</td><td><span className={`chip ${tone(r.status)}`}>{r.status}</span></td><td className="small">{srcLabel(r.source)}</td>
                <td><b className="mono small">{r.resourceId}</b>{r.onTrip ? <div className="xs subtle">On the road · trip</div> : r.hubId !== r.resourceId && <div className="xs subtle">{r.hubId}</div>}</td>
                <td className="small">{cap(r.category)}</td><td className="r mono small">{hm(r.createdAt)}</td></tr>))}
              {rows.length === 0 && <tr><td colSpan={6} className="subtle">No incidents.</td></tr>}</tbody>
          </table>
        </section>
        <div className="span-5 stack r-stack-md">
          {creating !== null ? <Create resourceId={creating} onDone={(id) => { setCreating(null); setSel(id); setTab("active"); }} onCancel={() => setCreating(null)} />
            : pick ? <Panel id={pick} go={go} now={now} /> : <div className="banner neutral"><span className="ic"><Icon name="siren" /></span><b>No incident selected.</b></div>}
        </div>
      </div>
    </div>
  );
}

function Create({ resourceId, onDone, onCancel }: { resourceId: string; onDone: (id: string) => void; onCancel: () => void }) {
  const [r, setR] = useState(resourceId);
  const [cat, setCat] = useState(resourceId.startsWith("H0") ? "Hub disconnected" : "vehicle failure");
  const [desc, setDesc] = useState(resourceId.startsWith("H0") ? `No data from ${resourceId} for over DATA_STALE_AFTER.` : "");
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card">
      <div className="card-head"><span className="h4"><Icon name="plus" />New incident (3a)</span><span className="chip warn">Open</span></div>
      <div className="card-body stack">
        <label className="field"><span className="label">Resource or Hub</span><input className="input" placeholder="e.g. EB-0217, CP-H01-02, H01-P-B12, H06" value={r} onChange={(e) => setR(e.target.value.trim())} /></label>
        <label className="field"><span className="label">Category</span><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select></label>
        <label className="field"><span className="label">Description</span><textarea className="input area" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ fontFamily: "inherit" }} /></label>
        {err && <span className="err"><Icon name="circle-alert" />{err}</span>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => api<{ id: string }>("/operator/incidents", { resourceId: r, category: cat, description: desc }).then((x) => onDone(x.id)).catch((e: ApiError) => setErr(e.message))}>Create incident</button></div>
      </div>
    </section>
  );
}

function Panel({ id, go, now }: { id: string; go: OpGo; now: number }) {
  const { data: d, reload } = useLive<Detail>(`/operator/incidents/${id}`);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [mode, setMode] = useState<null | "resolve" | "dismiss" | "progress">(null);
  const [text, setText] = useState("");
  const [dup, setDup] = useState("");
  // The version the operator opened; a stale one is rejected (E2) and the panel reloads.
  const [ver, setVer] = useState<number | null>(null);
  useEffect(() => { setOutcomes(null); setMode(null); setErr(null); setNote(""); setVer(null); }, [id]);
  useEffect(() => { if (d && ver === null) setVer(d.version); }, [d, ver]);
  if (!d) return <span className="spinner" />;
  const version = ver ?? d.version;
  const changed = ver !== null && d.version !== ver;
  const post = (path: string, body: Record<string, unknown> = {}) => api<{ outcomes?: Outcome[] }>(`/operator/incidents/${id}/${path}`, { ...body, version })
    .then(async (r) => {
      // Our own write bumped the version: adopt the server's new version, so it is not mistaken for someone else's change.
      const latest = await fetch(`/api/operator/incidents/${id}`).then((x) => x.json()) as Detail;
      setVer(latest.version); setErr(null); setNote(""); setMode(null); setText(""); if (r?.outcomes) setOutcomes(r.outcomes); reload(); return r;
    })
    .catch((e: ApiError) => { setErr(e.message); });
  const open = d.status === "Open" || d.status === "In Progress";
  const r = d.resource;

  return (
    <>
      {(outcomes?.length ?? 0) > 0 && (
        <section className="card" style={{ borderColor: "var(--info-line, var(--line))" }}>
          <div className="card-head"><span className="h4"><Icon name="users" />Affected allocations · {d.id} (step 7)</span><span className="small subtle">Handled {hm(now)}</span></div>
          <div className="list">{outcomes!.map((o) => (
            <div key={o.allocationId} className="li"><div className="grow"><div className="t mono">{o.allocationId}</div><div className="s">{o.detail}{o.studentId !== "-" ? ` · student ${o.studentId} notified` : ""}</div></div>
              <span className={`chip ${o.outcome === "moved" ? "ok" : o.outcome === "cancelled" ? "danger" : "info"}`}>{o.outcome === "moved" ? "Confirmed · moved" : o.outcome === "cancelled" ? "Cancelled by System" : o.outcome === "closed" ? "Closed" : "Awaiting"}</span></div>))}</div>
          <div className="card-body"><span className="hint"><Icon name="info" />Payment holds, pickups, charging sessions, trips and transfers stay with their own use cases (BR-PAY-03).</span></div>
        </section>
      )}
      <section className="card">
        <div className="card-head"><div><div className="row" style={{ gap: 8 }}><span className="h3 mono">{d.id}</span><span className={`chip ${tone(d.status)}`}>{d.status}</span></div>
          <div className="small subtle">{cap(d.category)} · {srcLabel(d.source)}{d.owner ? ` · handled by ${d.owner === "OP-014" ? "Tran Lan" : d.owner}` : ""}</div></div></div>
        <div className="card-body stack">
          {changed && <div className="banner warn compact"><span className="ic"><Icon name="refresh-cw" /></span><b>Someone else changed {d.id}.</b><p>Your next save would be rejected (E2). <a className="clickable" onClick={() => setVer(d.version)}>Load the latest</a></p></div>}
          <div className="card pad" style={{ boxShadow: "none" }}>
            <div className="row between"><span className="eyebrow">Resource · live</span><span className="fresh">{r ? <>Updated <span className="mono">{hms(r.confirmedAt)}</span></> : "Hub"}</span></div>
            <div className="row between" style={{ marginTop: 8 }}><div><b className="mono">{r ? r.label : d.hubId}</b>{d.live?.onTrip && <div className="small muted">Trip by {d.live.onTrip.studentId} since {hm(d.live.onTrip.startTime)} · not at a Hub</div>}</div>{r && <span className={`chip ${r.status === "Available" ? "ok" : r.status === "Out of Service" || r.status === "Under Maintenance" ? "danger" : r.stale ? "neutral" : "info"}`}>{r.status}</span>}</div>
            {d.live && <dl className="kv" style={{ marginTop: 8 }}><dt>Battery</dt><dd>{d.live.soc}%</dd><dt>Location</dt><dd>{d.live.location}</dd><dt>Model</dt><dd>{d.live.model}</dd></dl>}
            {d.unconfirmed && <div className="banner warn compact" style={{ marginTop: 8 }}><span className="ic"><Icon name="wifi-off" /></span><b>Status cannot be confirmed (E1).</b><p>No fresh data; act on site information.</p></div>}
          </div>
          <p className="small">{d.description}</p>
          {d.reports.length > 0 && <><span className="eyebrow">Linked reports (5a)</span>
            {d.reports.map((x) => <div key={x.id} className="card pad" style={{ boxShadow: "none" }}><div className="row between"><b className="mono small">{x.id}</b><span className="xs subtle">{hm(x.time)} · {x.studentId}{x.photos ? ` · ${x.photos} photo${x.photos > 1 ? "s" : ""}` : ""}</span></div><p className="small muted">"{x.text}"</p></div>)}</>}
          {d.affectedDetail.length > 0 && <><span className="eyebrow">Allocations on this resource</span>
            {d.affectedDetail.map((a) => <div key={a.id} className="row between small"><span><b className="mono">{a.id}</b> · {a.detail} · {a.studentId}</span><span className="chip info">{a.status}</span></div>)}</>}
          {(d.orders.length > 0 || d.reschedules.length > 0 || d.awaiting.length > 0) && <div className="stack tight small">
            {d.orders.map((o) => <span key={o.orderId}>Order <b className="mono">{o.orderId}</b> · {o.status} (8a)</span>)}
            {d.reschedules.map((x) => <span key={x}>Charging: {x} (8b)</span>)}
            {d.awaiting.length > 0 && <span className="subtle">Awaiting their own use case: {d.awaiting.join(", ")}</span>}</div>}
          <span className="eyebrow">Actions</span>
          <div className="stack tight" style={{ borderLeft: "2px solid var(--line-strong)", paddingLeft: 12 }}>
            {d.actions.map((a, i) => <div key={i} className="small"><b className="mono">{hm(a.time)}</b> · {a.note}{a.blockRequested ? <span className="chip danger nodot" style={{ marginLeft: 6 }}>block</span> : null}</div>)}
          </div>
          {d.progressNote && <div className="banner neutral compact"><span className="ic"><Icon name="bookmark" /></span><b>Progress: {d.progressNote}</b>{d.pending && <p>Pending: {d.pending}</p>}</div>}
          {d.resolution && <div className="banner ok compact"><span className="ic"><Icon name="circle-check" /></span><b>Resolved</b><p>{d.resolution}</p></div>}
          {d.dismissReason && <div className="banner neutral compact"><span className="ic"><Icon name="circle-slash" /></span><b>Dismissed</b><p>{d.dismissReason}{d.duplicateOf ? ` · duplicate of ${d.duplicateOf}` : ""}</p></div>}

          {open && <>
            <textarea className="input area" rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontFamily: "inherit" }} />
            {d.canVerifyBreakdown && <>
              <span className="hint"><Icon name="info" />Confirming closes the trip at {d.breakdownTime ? hm(d.breakdownTime) : "the report time"} and waives the fare (8c, BR-PAY-05). {r?.id} then becomes "Under Maintenance" and the student is notified.</span>
              <button className="btn primary block" onClick={() => post("verify")}><Icon name="shield-check" />Confirm breakdown during trip</button></>}
            <div className="row wrap" style={{ gap: 8 }}>
              {d.status === "Open" && <button className="btn secondary sm" onClick={() => post("start", { note })}><Icon name="play" />Start handling</button>}
              {note.trim() && <button className="btn secondary sm" onClick={() => post("action", { note, block: false })}><Icon name="save" />Save note</button>}
              {r && !d.blocking && <button className="btn danger sm" onClick={() => post("action", { note, block: true })}><Icon name="ban" />Block resource</button>}
              <button className="btn secondary sm" onClick={() => setMode("resolve")}><Icon name="circle-check" />Resolve</button>
              <button className="btn ghost sm" onClick={() => setMode("dismiss")}>Dismiss…</button>
              <button className="btn ghost sm" onClick={() => setMode("progress")}>Save progress</button>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn ghost sm" onClick={() => go({ nav: "orders", order: { fromHub: "", toHub: d.hubId, quantity: 1, model: "e-bike", incidentId: d.id } })}><Icon name="truck" />Redistribution order (8a)</button>
              {(r?.kind === "ChargingPoint" || d.category.includes("charging")) && <button className="btn ghost sm" onClick={() => { api(`/operator/incidents/${id}/corrective`, { note: "Charging schedule adjusted in UC-11", schedule: `UC-11 proposal for ${d.hubId} reviewed` }); go({ nav: "charging", hubId: d.hubId }); }}><Icon name="plug-zap" />Adjust charging (8b)</button>}
            </div>
            {mode && (
              <div className="card pad stack tight" style={{ boxShadow: "none" }}>
                <b className="small">{mode === "resolve" ? "How was it resolved?" : mode === "dismiss" ? "Why dismiss it? (false or duplicate report, 9b)" : "What is still pending? (step 9)"}</b>
                <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "resolve" ? "e.g. brake cable replaced" : mode === "dismiss" ? "e.g. duplicate of another incident" : "e.g. waiting for the technician"} />
                {mode === "dismiss" && <input className="input sm" value={dup} onChange={(e) => setDup(e.target.value.trim().toUpperCase())} placeholder="Original incident (optional), e.g. INC-0190" />}
                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}><button className="btn ghost sm" onClick={() => setMode(null)}>Back</button>
                  <button className="btn primary sm" onClick={() => mode === "resolve" ? post("resolve", { resolution: text }) : mode === "dismiss" ? post("dismiss", { reason: text, originalId: dup || null }) : post("progress", { note: note || "Partial work saved", pending: text })}>Confirm</button></div>
              </div>
            )}
            <span className="hint"><Icon name="info" />Dismiss asks for a reason (false or duplicate report, 9b). Blocking moves or cancels the students' bookings (BR-RES-02) and notifies them.</span>
          </>}
          {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b>{/E2/.test(err) && <div className="actions"><button className="btn secondary sm" onClick={() => { setVer(null); setErr(null); reload(); }}>Reload</button></div>}</div>}
        </div>
      </section>
    </>
  );
}
