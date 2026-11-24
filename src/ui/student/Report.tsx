// S07 Report an issue (UC-06) and S08 report during a trip (UC-06 2b, UC-12 8c).
import { useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, api, cap, hm, useLive } from "../shared/live";
import type { Go, Home } from "./types";

interface Proposed { resourceId: string; kind: string; label: string; hubId: string | null; why: string; allocationId: string; category: string; location?: string | null }
interface Start { categories: string[]; proposals: Proposed[]; onTrip: boolean }
interface Resources { hubId: string; name: string; vehicles: Array<{ id: string; label: string; status: string }>; points: Array<{ id: string; label: string; status: string }>; spaces: Array<{ id: string; label: string; status: string }> }
export interface ReportResult { reportId: string; status: string; incidentId: string | null; category: string; resourceId: string; resourceLabel: string; hubId: string; time: number; repeated: boolean; attached?: boolean; pickupEnded?: { outcome: string; vehicleId: string | null } | null; incidentStatus?: string | null }

const CATS: Array<[string, string, string]> = [
  ["vehicle failure", "bike", "Vehicle failure"], ["charging point unavailable or faulty", "plug-zap", "Charging point"],
  ["parking space blocked or occupied", "square-parking", "Parking space"], ["Hub facility problem", "building-2", "Hub facility"], ["other", "message-circle", "Other"],
];
const KIND_ICON: Record<string, string> = { Vehicle: "motorbike", ChargingPoint: "plug-zap", ParkingSpace: "square-parking" };
const newKey = () => Math.random().toString(36).slice(2);

export function S07Report({ go, home, resourceId: preset, trip }: { go: Go; home: Home; resourceId?: string; trip?: boolean }) {
  const { data: st } = useLive<Start>("/student/report/start");
  const [cat, setCat] = useState(trip ? "vehicle failure" : "");
  const [res, setRes] = useState<string>(preset ?? "");
  const [other, setOther] = useState(false);
  const [hub, setHub] = useState("H01");
  const { data: rs } = useLive<Resources>(other ? `/student/report/resources/${hub}` : null);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [err, setErr] = useState<{ field: string; msg: string } | null>(null);
  const [done, setDone] = useState<ReportResult | null>(null);
  const key = useMemo(newKey, []);
  const tripVeh = home.trip?.vehicleId;
  const proposals = (st?.proposals ?? []).filter((p) => !trip || p.resourceId === tripVeh);
  const chosen = res || (proposals.length && !other ? proposals.find((p) => !cat || p.category === cat)?.resourceId ?? "" : "");

  const send = () => api<ReportResult>("/student/report", { category: cat, resourceId: other && ["Hub facility problem", "other"].includes(cat) && !res ? hub : chosen, description: text, photos, key })
    .then((r) => { setDone(r); setErr(null); })
    .catch((e: ApiError) => setErr({ field: e.code?.split(":")[1] ?? "", msg: e.message }));

  if (done) return trip ? <S08Sent go={go} r={done} /> : <S07Sent go={go} r={done} />;

  const tripCard = trip && home.trip && (
    <>
      <div className="card pad row" style={{ gap: 12 }}><div className="lead" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--info-bg)", color: "var(--info)", display: "grid", placeItems: "center" }}><Icon name="motorbike" className="ic-lg" /></div>
        <div className="grow"><div className="mono" style={{ fontSize: 17 }}>{home.trip.vehicleId}</div><div className="small muted">Trip {home.trip.id} · started {hm(home.trip.startTime)}</div></div></div>
      <div className="field"><span className="label">Category</span><div className="row"><span className="btn sm tonal" style={{ borderColor: "var(--brand-600)" }}><Icon name="bike" />Vehicle failure</span><span className="small subtle">Set for trips</span></div></div>
      <div className="field"><span className="label">Location</span><div className="card pad row" style={{ gap: 10 }}><Icon name="locate-fixed" style={{ color: "var(--brand-700)" }} /><div className="grow"><b>Away from a Hub</b><div className="small muted">{proposals[0]?.location ?? "Last reported by the vehicle"}</div></div></div></div>
    </>
  );

  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go(trip ? { s: "S09" } : { s: "S01" })}><Icon name="chevron-left" /></span><div className="title"><div className="h4">{trip ? "Report a breakdown" : "Report an issue"}</div><div className="sub">{trip ? "During your trip" : "Sent to the operators"}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        {tripCard}
        {!trip && (
          <div className="field"><span className="label">What's wrong?</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {CATS.map(([c, ic, l]) => <span key={c} className={`btn sm ${cat === c ? "tonal" : "secondary"} clickable`} style={cat === c ? { borderColor: "var(--brand-600)" } : undefined} onClick={() => { setCat(c); setRes(""); }}><Icon name={ic} />{l}</span>)}
            </div>
            {err?.field === "category" && <span className="err"><Icon name="circle-alert" />{err.msg}</span>}
          </div>
        )}
        {!trip && (
          <div className="field"><span className="label">Which one? <span className="opt small">{proposals.length ? "Things you're using or have reserved" : "Choose the Hub and resource"}</span></span>
            {!other && proposals.map((p) => (
              <div key={p.resourceId} className={`choice clickable${chosen === p.resourceId ? " on" : ""}`} onClick={() => { setRes(p.resourceId); if (!cat) setCat(p.category); }}>
                <span className="radio" /><div className="lead" style={{ width: 36, height: 36, borderRadius: 10, background: chosen === p.resourceId ? "var(--info-bg)" : "var(--ink-100)", color: chosen === p.resourceId ? "var(--info)" : undefined, display: "grid", placeItems: "center" }}><Icon name={KIND_ICON[p.kind] ?? "map-pin"} /></div>
                <div className="grow"><b className="mono">{p.label}</b><div className="small muted">{p.why} · {p.hubId ?? "away from a Hub"}</div></div>
              </div>
            ))}
            {!other && <a className="small row clickable" style={{ gap: 4 }} onClick={() => { setOther(true); setRes(""); }}><Icon name="map-pin" className="ic-sm" />Choose another Hub and resource</a>}
            {other && (
              <div className="card pad stack tight">
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{["H01", "H02", "H03", "H04", "H05", "H06", "H07"].map((h) => <span key={h} className="tag clickable" style={h === hub ? { background: "var(--ink-900)", color: "#fff" } : undefined} onClick={() => { setHub(h); setRes(""); }}>{h}</span>)}</div>
                {!["Hub facility problem", "other"].includes(cat) && rs && (
                  <select className="input" value={res} onChange={(e) => setRes(e.target.value)}>
                    <option value="">Choose the resource…</option>
                    {(cat === "charging point unavailable or faulty" ? rs.points : cat === "parking space blocked or occupied" ? rs.spaces : rs.vehicles).map((x) => <option key={x.id} value={x.id}>{x.label} · {x.status}</option>)}
                  </select>
                )}
                {["Hub facility problem", "other"].includes(cat) && <span className="small muted">The report is about Hub {hub}.</span>}
                {proposals.length > 0 && <a className="small clickable" onClick={() => setOther(false)}>Back to my bookings</a>}
              </div>
            )}
            {err?.field === "resource" && <span className="err"><Icon name="circle-alert" />{err.msg}</span>}
          </div>
        )}
        <div className="field"><label>{trip ? "What happened?" : "Describe the issue"}</label>
          <textarea className={`input area${err?.field === "description" ? " error" : ""}`} rows={3} placeholder={trip ? "e.g. the motor cut out and won't restart" : "e.g. the rear brake doesn't grip"} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit", resize: "none" }} />
          {err?.field === "description" && <span className="err"><Icon name="circle-alert" />{err.msg}</span>}
        </div>
        {!trip && (
          <div className="field"><label>Photos <span className="opt">Optional · up to 3</span></label>
            <div className="row" style={{ gap: 8 }}>
              {photos.map((p) => <div key={p} className="placeholder-img clickable" style={{ width: 84, height: 84 }} title="Remove" onClick={() => setPhotos(photos.filter((x) => x !== p))}>{p}</div>)}
              {photos.length < 3 && <div className="clickable" style={{ width: 84, height: 84, borderRadius: 12, border: "1.5px dashed var(--ink-300)", display: "grid", placeItems: "center", color: "var(--ink-500)" }} onClick={() => setPhotos([...photos, `photo-${photos.length + 1}.jpg`])}><Icon name="camera" /></div>}
            </div>
          </div>
        )}
        {trip && <div className="banner info"><span className="ic"><Icon name="info" /></span><b>Your trip continues until an operator handles the incident.</b><p>If the operator confirms the breakdown, the trip ends at the time you reported it and the fare is waived.</p></div>}
        {err && !["category", "description", "resource"].includes(err.field) && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err.msg}</b></div>}
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={send}><Icon name="send" />Send report</button>
        {!trip && <button className="btn ghost block" style={{ height: 30 }} onClick={() => go({ s: "S01" })}>Cancel</button>}</div>
    </>
  );
}

function S07Sent({ go, r }: { go: Go; r: ReportResult }) {
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "S01" })}><Icon name="x" /></span><div className="title"><div className="h4">Report sent</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="result"><div className="badge ok"><Icon name="send" /></div><div className="h2">Thanks, we've got it</div><p className="small muted" style={{ maxWidth: 290 }}>{r.repeated ? "You already sent this one; here is the same report." : r.attached ? "Someone reported this too; your details were added to that report." : "An operator will handle it. You'll be notified when it's resolved."}</p></div>
        <div className="ticket">
          <div className="row between"><div><div className="lbl">Issue report</div><div className="code" style={{ fontSize: 22 }}>{r.reportId}</div></div><span className="chip warn" style={{ background: "rgba(255,241,214,.12)", color: "#FFD48A", borderColor: "rgba(255,212,138,.35)" }}>{r.status}</span></div>
          <div className="cut" />
          <dl className="kv"><dt>Category</dt><dd>{cap(r.category)}</dd><dt>Resource</dt><dd className="mono">{r.resourceLabel}</dd><dt>Sent</dt><dd className="mono">{hm(r.time)}</dd></dl>
        </div>
        <div className="card pad stack tight">
          <b>What happens next</b>
          <div className="row top" style={{ gap: 10 }}><span className="chip warn">Open</span><span className="small muted">Linked to incident <span className="mono strong">{r.incidentId}</span>. An operator will handle it.</span></div>
          <div className="row top" style={{ gap: 10 }}><span className="chip info">In Progress</span><span className="small muted">An operator checks it.</span></div>
          <div className="row top" style={{ gap: 10 }}><span className="chip ok">Resolved</span><span className="small muted">You get a notification.</span></div>
        </div>
        {r.pickupEnded
          ? <div className="banner info compact"><span className="ic"><Icon name="replace" /></span><b>Your pickup was ended.</b><p>{r.pickupEnded.outcome === "moved" ? `Your reservation now holds ${r.pickupEnded.vehicleId} (BR-RES-02).` : r.pickupEnded.outcome === "cancelled" ? "No same-type vehicle was free, so the reservation was cancelled and refunded." : "The vehicle was released."}</p></div>
          : <div className="banner info compact"><span className="ic"><Icon name="info" /></span><b>Your bookings are not changed by the report.</b><p>An operator decides what happens to {r.resourceLabel} (BR-INC-01).</p></div>}
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go(r.pickupEnded?.outcome === "moved" ? { s: "S09" } : { s: "S01" })}>Done</button></div>
    </>
  );
}

function S08Sent({ go, r }: { go: Go; r: ReportResult }) {
  return (
    <>
      <div className="m-appbar"><span /><div className="title"><div className="h4">Breakdown reported</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <BreakdownCard r={r} />
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go({ s: "S09" })}>Back to my trip</button></div>
    </>
  );
}

export function BreakdownCard({ r }: { r: ReportResult }) {
  return (
    <>
      <div className="card pad-lg stack">
        <div className="row between"><b>Breakdown reported</b><span className={`chip ${r.incidentStatus === "In Progress" ? "info" : "warn"}`}>{r.incidentStatus ?? r.status}</span></div>
        <div className="small muted">Report <span className="mono strong">{r.reportId}</span> · incident <span className="mono strong">{r.incidentId}</span> · {hm(r.time)}</div>
        <div className="stack tight" style={{ borderLeft: "2px solid var(--line-strong)", paddingLeft: 14, marginLeft: 6 }}>
          <div><b className="small">{hm(r.time)} · Reported</b><div className="xs subtle">Fare stops here if confirmed</div></div>
          <div style={r.incidentStatus === "In Progress" ? undefined : { color: "var(--text-3)" }}><b className="small">Operator checking</b><div className="xs subtle">Usually within 10 min</div></div>
          <div style={{ color: "var(--text-3)" }}><b className="small">Trip closed · fare Waived</b><div className="xs">After confirmation</div></div>
        </div>
      </div>
      <div className="banner neutral compact"><span className="ic"><Icon name="hand" /></span><b>Stay near the vehicle if you can.</b><p>Staff may call you on 09xx xxx 345.</p></div>
    </>
  );
}
