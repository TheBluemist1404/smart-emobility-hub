// S05 Reserve parking (UC-04) and S06 Schedule charging (UC-05), plus the live screens of a
// parking reservation (PR) and a charging session (CS): paying, confirmed, failed, ended.
import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { api, dayLabel, hm, mmss, useLive, vnd } from "../shared/live";
import { BankMeter, PaymentFailed } from "./Reserve";
import { chipTone } from "./Discover";
import type { AllocationView, Go, Home } from "./types";

const H7 = 7 * 3_600_000;
const MIN = 60_000;
const toInput = (ms: number) => new Date(ms + H7).toISOString().slice(0, 16);
const fromInput = (s: string) => Date.parse(`${s}:00Z`) - H7;
const roundUp = (ms: number, step = 30 * MIN) => Math.ceil(ms / step) * step;
const durLabel = (ms: number) => { const m = Math.round(ms / MIN); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`; };
const vehIcon = (t: string) => (t === "electric bicycle" ? "bike" : "motorbike");

function VehiclePicker({ home, value, onChange }: { home: Home; value: string; onChange: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("");
  const [plate, setPlate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const v = home.student.vehicles.find((x) => x.id === value);
  const add = () => api<{ id: string }>("/student/vehicle", { type, id: plate }).then((r) => { onChange(r.id); setAdding(false); setErr(null); }).catch((e: Error) => setErr(e.message));
  return (
    <div className="field"><label>Vehicle</label>
      <div className="input"><Icon name={vehIcon(v?.type ?? "")} />
        <select value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 0, flex: 1, font: "inherit", background: "transparent" }}>
          {home.student.vehicles.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.type === "electric bicycle" ? "e-bike" : "e-motorbike"}</option>)}
        </select></div>
      {!adding && <a className="small row clickable" style={{ gap: 4 }} onClick={() => setAdding(true)}><Icon name="plus" className="ic-sm" />Add vehicle</a>}
      {adding && (
        <div className="card pad stack tight">
          <div className="two">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">Type…</option><option value="electric bicycle">E-bike</option><option value="electric motorcycle">E-motorbike</option></select>
            <input className="input" placeholder="Plate or frame no." value={plate} onChange={(e) => setPlate(e.target.value)} />
          </div>
          {err && <span className="err"><Icon name="circle-alert" />{err}</span>}
          <div className="row"><button className="btn sm primary" onClick={add}>Save vehicle</button><button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

// ==== S05 Reserve parking =================================================================

interface ParkingStart { active: { id: string; status: string } | null; availability: Array<{ hubId: string; type: string; free: number; total: number; stale: boolean; measuredAt: number }>; hubs: Array<{ hubId: string; name: string; stale: boolean; updatedAt: number }>; maxDurationMs: number; horizonMs: number; graceMs: number }
interface ParkingOffer { hubId: string; hubName: string; space: { id: string; label: string; type: string } | null; arrival: number; departure: number; fee: number; vehicleId: string; graceMs: number; alternatives: Array<{ index: number; hubId: string; hubName: string; start: number; end: number; note: string; freeSpaces: number }> }

export function S05Parking({ go, home, now, hubId: hub0 }: { go: Go; home: Home; now: number; hubId?: string }) {
  const { data: st } = useLive<ParkingStart>("/student/parking/start");
  const [hubId, setHubId] = useState(hub0 ?? "H01");
  const [veh, setVeh] = useState(home.student.vehicles[0]?.id ?? "");
  const [arr, setArr] = useState(() => toInput(roundUp(now + 60 * MIN)));
  const [dep, setDep] = useState(() => toInput(roundUp(now + 4 * 60 * MIN)));
  const [offer, setOffer] = useState<ParkingOffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = fromInput(dep) <= fromInput(arr) ? "Departure must be after arrival." : null;
  const back = () => { api("/student/parking/discard", {}); offer ? setOffer(null) : go({ s: "S02", hubId, tab: "parking" }); };
  const find = () => api<ParkingOffer>("/student/parking/window", { hubId, vehicleId: veh, arrival: fromInput(arr), departure: fromInput(dep) }).then((o) => { setOffer(o); setErr(null); }).catch((e: Error) => setErr(e.message));
  const confirm = () => { setBusy(true); api<AllocationView>("/student/parking/confirm", {}).then((a) => go({ s: "PR", id: a.id })).catch((e: Error) => { setErr(e.message); setBusy(false); }); };

  if (offer) {
    const hasSpace = !!offer.space;
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={back}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Review reservation</div><div className="sub">{offer.hubId} · {offer.hubName}</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <ol className="steps"><li className="done">Choose</li><li className="now">Review</li><li>Pay</li><li>Done</li></ol>
          {hasSpace && (
            <div className="card pad-lg stack">
              <div className="row" style={{ gap: 12 }}><div className="lead" style={{ width: 52, height: 52, borderRadius: 15, background: "var(--brand-50)", color: "var(--brand-700)", display: "grid", placeItems: "center" }}><Icon name="square-parking" className="ic-lg" /></div>
                <div className="grow"><div className="mono" style={{ fontSize: 19 }}>{offer.space!.label}</div><div className="small muted">{offer.space!.type === "electric bicycle" ? "E-bike" : "E-motorbike"} space · {offer.hubId}</div></div></div>
              <div className="row" style={{ gap: 0, background: "var(--ink-50)", borderRadius: 12, padding: "10px 12px" }}>
                <div className="grow"><div className="xs subtle strong">ARRIVE</div><div className="mono" style={{ fontSize: 17 }}>{hm(offer.arrival)}</div><div className="xs muted">{dayLabel(offer.arrival)}</div></div>
                <Icon name="arrow-right" style={{ color: "var(--ink-400)" }} />
                <div className="grow right"><div className="xs subtle strong">LEAVE</div><div className="mono" style={{ fontSize: 17 }}>{hm(offer.departure)}</div><div className="xs muted">{durLabel(offer.departure - offer.arrival)}</div></div>
              </div>
              <dl className="kv"><dt>Vehicle</dt><dd className="mono">{offer.vehicleId}</dd><dt>Reservation fee</dt><dd className="total num">{vnd(offer.fee)}</dd></dl>
            </div>
          )}
          {hasSpace && <div className="banner warn"><span className="ic"><Icon name="clock-alert" /></span><b>Paid reservations cannot be cancelled.</b><p>If you don't check in within {offer.graceMs / MIN} min after {hm(offer.arrival)} (CHECKIN_GRACE), the reservation expires and the fee is not refunded.</p></div>}
          {offer.alternatives.length > 0 && (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="card-head" style={{ paddingBottom: 6 }}><span className="h4" style={{ fontSize: 14 }}><Icon name="shuffle" className="ic-sm" />Your window is full (6a)</span></div>
              <div className="card-body small muted" style={{ paddingBottom: 10 }}>No space free {hm(fromInput(arr))}–{hm(fromInput(dep))} at {hubId}. Alternatives:</div>
              <div className="list">
                {offer.alternatives.map((a) => (
                  <div key={a.index} className="li clickable" onClick={() => api<ParkingOffer>("/student/parking/alt", { index: a.index }).then(setOffer).catch((e: Error) => setErr(e.message))}>
                    <span className="cbx" /><div className="grow"><b>{a.hubId} · {hm(a.start)}–{hm(a.end)}</b><div className="s">{a.note}</div></div><span className="tag">{a.freeSpaces} free</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b></div>}
        </div>
        <div className="actionbar"><div className="sum"><span className="muted small">Pay now · Bank System</span><span className="price num">{hasSpace ? vnd(offer.fee) : "—"}</span></div>
          <div className="row"><button className="btn secondary" style={{ width: 112 }} onClick={() => { api("/student/parking/discard", {}); go({ s: "S02", hubId, tab: "parking" }); }}>Cancel</button>
            <button className="btn primary grow lg" disabled={!hasSpace || busy} onClick={confirm}><Icon name="lock" />Confirm &amp; Pay</button></div></div>
      </>
    );
  }

  const byHub = (h: string, t: string) => st?.availability.find((a) => a.hubId === h && a.type === t)?.free ?? 0;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={back}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Reserve parking</div><div className="sub">Private EV</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <ol className="steps"><li className="now">Choose</li><li>Review</li><li>Pay</li><li>Done</li></ol>
        {st?.active && <div className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>You already have {st.active.id} ({st.active.status}).</b><p>Only one active parking reservation is allowed (E1).</p></div>}
        <div className="field"><span className="label">Hub</span>
          {st?.hubs.filter((h) => h.hubId !== "H04" || true).map((h) => (
            <div key={h.hubId} className={`choice clickable${h.hubId === hubId ? " on" : ""}${h.stale ? " off" : ""}`} onClick={() => !h.stale && setHubId(h.hubId)}>
              <span className="radio" /><span className="hub-code">{h.hubId}</span>
              <div className="grow"><b>{h.name}</b>{h.stale ? <div className="small" style={{ color: "var(--stale)" }}>Last update {hm(h.updatedAt)} · possibly out of date</div> : <div className="small muted">{byHub(h.hubId, "electric motorcycle")} e-motorbike · {byHub(h.hubId, "electric bicycle")} e-bike spaces free</div>}</div>
            </div>
          ))}
        </div>
        <VehiclePicker home={home} value={veh} onChange={setVeh} />
        <div className="two">
          <div className="field"><label>Arrival</label><input className="input" type="datetime-local" value={arr} onChange={(e) => setArr(e.target.value)} /></div>
          <div className="field"><label>Departure</label><input className={`input${local ? " error" : ""}`} type="datetime-local" value={dep} onChange={(e) => setDep(e.target.value)} /></div>
        </div>
        {(local || err) && <span className="err" style={{ marginTop: -6 }}><Icon name="circle-alert" />{local ?? err}</span>}
        <span className="hint"><Icon name="info" />Up to {(st?.maxDurationMs ?? 0) / 3_600_000} h (PARKING_MAX_DURATION), within the next {(st?.horizonMs ?? 0) / 3_600_000} h (BOOKING_HORIZON).</span>
      </div>
      <div className="actionbar"><button className="btn primary block lg" disabled={!!local || !veh} onClick={find}>Find a space</button></div>
    </>
  );
}

// ==== S06 Schedule charging ===============================================================

interface ChargingStart { hubs: Array<{ hubId: string; name: string; stale: boolean; updatedAt: number; available: number; inUse: number; outOfService: number; disconnected: number }>; active: Array<{ id: string; vehicleId: string; status: string }>; horizonMs: number; graceMs: number; toleranceMs: number }
interface Proposal { hubId: string; hubName: string; pointId: string; power: string; slot: { pointId: string; start: number; end: number }; durationMs: number; fee: number; currentSoc: number; targetSoc: number; neededBy: number | null; vehicleId: string; graceMs: number; toleranceMs: number; alternatives: Array<{ index: number; hubId: string; hubName: string; pointId: string; slot: { start: number; end: number }; note: string }> }

export function S06Charging({ go, home, now, hubId: hub0 }: { go: Go; home: Home; now: number; hubId?: string }) {
  const { data: st } = useLive<ChargingStart>(`/student/charging/start`);
  const [hubId, setHubId] = useState(hub0 ?? "H01");
  const [veh, setVeh] = useState(home.student.vehicles[0]?.id ?? "");
  const [cur, setCur] = useState(32);
  const [tgt, setTgt] = useState(80);
  const [from, setFrom] = useState(() => toInput(roundUp(now + 30 * MIN)));
  const [to, setTo] = useState(() => toInput(roundUp(now + 150 * MIN)));
  const [needed, setNeeded] = useState("");
  const [prop, setProp] = useState<Proposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const h = st?.hubs.find((x) => x.hubId === hubId);
  const back = () => { api("/student/charging/discard", {}); prop ? setProp(null) : go({ s: "S02", hubId, tab: "charging" }); };
  const find = () => api<Proposal>("/student/charging/request", { hubId, vehicleId: veh, currentSoc: cur, targetSoc: tgt, from: fromInput(from), to: fromInput(to), neededBy: needed ? fromInput(needed) : null })
    .then((p) => { setProp(p); setErr(null); }).catch((e: Error) => setErr(e.message));
  const confirm = () => { setBusy(true); api<AllocationView>("/student/charging/confirm", {}).then((a) => go({ s: "CS", id: a.id })).catch((e: Error) => { setErr(e.message); setBusy(false); }); };

  if (prop) {
    const has = !!prop.pointId;
    const start = prop.slot.start, end = prop.slot.end;
    const t0 = Math.floor(start / (60 * MIN)) * 60 * MIN - 15 * MIN;
    const cells = Array.from({ length: 10 }, (_, i) => t0 + i * 15 * MIN);
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={back}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Review session</div><div className="sub">{prop.hubId} · {prop.hubName}</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <ol className="steps"><li className="done">Choose</li><li className="now">Review</li><li>Pay</li><li>Done</li></ol>
          {has && (
            <div className="card pad-lg stack">
              <div className="row between"><div><div className="eyebrow">Proposed slot</div><div className="mono" style={{ fontSize: 26, letterSpacing: "-.02em" }}>{hm(start)}–{hm(end)}</div><div className="small muted">{durLabel(prop.durationMs)} on <span className="mono">{prop.pointId}</span> · {prop.power}</div></div>
                <div className="lead" style={{ width: 52, height: 52, borderRadius: 15, background: "var(--ink-900)", color: "var(--volt)", display: "grid", placeItems: "center" }}><Icon name="battery-charging" className="ic-lg" /></div></div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length},1fr)`, gap: 3 }}>
                {cells.map((c) => <i key={c} style={{ height: 26, borderRadius: 5, background: c >= start && c < end ? "var(--brand-500)" : c >= end && c < end + prop.toleranceMs ? "repeating-linear-gradient(135deg,var(--brand-200) 0 6px,var(--brand-100) 6px 12px)" : "var(--ink-100)" }} />)}
              </div>
              <div className="row between xs subtle mono"><span>{hm(cells[0])}</span><span>{hm(cells[cells.length - 1] + 15 * MIN)}</span></div>
              <span className="hint"><Icon name="move-right" />Striped: up to {prop.toleranceMs / MIN} min later if rescheduled{prop.neededBy ? `, still before your needed-by ${hm(prop.neededBy)}` : ""}.</span>
              <hr className="hr" />
              <dl className="kv"><dt>Battery</dt><dd>{prop.currentSoc}% → {prop.targetSoc}%</dd><dt>Estimated cost · paid now</dt><dd className="total num">{vnd(prop.fee)}</dd></dl>
            </div>
          )}
          {has && <div className="banner warn"><span className="ic"><Icon name="clock-alert" /></span><b>No cancellation after payment.</b><p>Plug in within {prop.graceMs / MIN} min of the start (CHARGING_START_GRACE) or the session becomes "Expired" and the fee is not refunded.</p></div>}
          {has && <div className="banner info compact"><span className="ic"><Icon name="calendar-clock" /></span><b>The schedule may move your session up to {prop.toleranceMs / MIN} min later, never earlier{prop.neededBy ? ` and never past ${hm(prop.neededBy)}` : ""} (CHARGING_SHIFT_TOLERANCE, BR-CHG-02).</b></div>}
          {prop.alternatives.length > 0 && (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="card-head" style={{ paddingBottom: 6 }}><span className="h4" style={{ fontSize: 14 }}><Icon name="shuffle" className="ic-sm" />No slot fits your window (6a)</span></div>
              <div className="list">
                {prop.alternatives.map((a) => (
                  <div key={a.index} className="li clickable" onClick={() => api<Proposal>("/student/charging/alt", { index: a.index }).then(setProp).catch((e: Error) => setErr(e.message))}>
                    <span className="cbx" /><div className="grow"><b>{a.hubId} · {hm(a.slot.start)}–{hm(a.slot.end)}</b><div className="s">{a.note} · {a.pointId}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b></div>}
        </div>
        <div className="actionbar"><div className="sum"><span className="muted small">Pay now · Bank System</span><span className="price num">{has ? vnd(prop.fee) : "—"}</span></div>
          <div className="row"><button className="btn secondary" style={{ width: 112 }} onClick={() => { api("/student/charging/discard", {}); go({ s: "S02", hubId, tab: "charging" }); }}>Cancel</button>
            <button className="btn primary grow lg" disabled={!has || busy} onClick={confirm}><Icon name="lock" />Confirm &amp; Pay</button></div></div>
      </>
    );
  }

  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={back}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Schedule charging</div><div className="sub">{hubId} · {h?.name}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <ol className="steps"><li className="now">Choose</li><li>Review</li><li>Pay</li><li>Done</li></ol>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{st?.hubs.map((x) => <span key={x.hubId} className="tag clickable" style={x.hubId === hubId ? { background: "var(--ink-900)", color: "#fff" } : undefined} onClick={() => setHubId(x.hubId)}>{x.hubId}</span>)}</div>
        {h && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ paddingBottom: 8 }}><span className="h4" style={{ fontSize: 14 }}>Charging points at {h.hubId}</span>{h.stale ? <span className="chip stale">Possibly out of date</span> : <span className="fresh">Updated <span className="mono">{hm(h.updatedAt)}</span></span>}</div>
            <div className="row wrap" style={{ gap: 6, padding: "0 16px 14px" }}><span className="chip ok">{h.available} Available</span><span className="chip info">{h.inUse} In Use</span><span className="chip danger">{h.outOfService} Out of Service</span><span className="chip neutral">{h.disconnected} Disconnected</span></div>
          </div>
        )}
        {st?.active.filter((a) => a.vehicleId === veh).map((a) => <div key={a.id} className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>{veh} already has {a.id} ({a.status}).</b><p>A vehicle can have only one active charging session (E4).</p></div>)}
        <VehiclePicker home={home} value={veh} onChange={setVeh} />
        <div className="card pad stack">
          <div className="row between"><span className="small strong">Battery now → target</span><span className="mono strong">{cur}% → {tgt}%</span></div>
          <div style={{ position: "relative", height: 14, borderRadius: 99, background: "var(--ink-100)" }}>
            <i style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${cur}%`, borderRadius: 99, background: "#E2A336" }} />
            <i style={{ position: "absolute", left: `${cur}%`, top: 0, bottom: 0, width: `${Math.max(0, tgt - cur)}%`, background: "repeating-linear-gradient(135deg,var(--brand-200) 0 6px,var(--brand-100) 6px 12px)", borderRadius: "0 99px 99px 0" }} />
          </div>
          <div className="two">
            <div className="field"><label>Current</label><input className="input" type="number" min={0} max={100} value={cur} onChange={(e) => setCur(Number(e.target.value))} /></div>
            <div className="field"><label>Target</label><input className="input" type="number" min={0} max={100} value={tgt} onChange={(e) => setTgt(Number(e.target.value))} /></div>
          </div>
        </div>
        <div className="two">
          <div className="field"><label>Window from</label><input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Window to</label><input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="field"><label>Needed by <span className="opt">Optional</span></label><input className="input" type="datetime-local" value={needed} onChange={(e) => setNeeded(e.target.value)} />
          <span className="hint"><Icon name="shield-check" />If set, any later change keeps your session ending by this time.</span></div>
        {err && <span className="err"><Icon name="circle-alert" />{err}</span>}
      </div>
      <div className="actionbar"><button className="btn primary block lg" disabled={!veh} onClick={find}>Find a slot</button></div>
    </>
  );
}

// ==== Live PR / CS screens ================================================================

function PayingNow({ a, now, title, what }: { a: AllocationView; now: number; title: string; what: string }) {
  const hold = a.holdMs ?? 600_000;
  const left = a.createdAt + hold - now;
  return (
    <>
      <div className="m-appbar"><span /><div className="title"><div className="h4">Payment</div><div className="sub">{title}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="result"><div className="badge info"><span className="spinner" /></div><div className="h2">Waiting for your bank</div><p className="small muted" style={{ maxWidth: 280 }}>Confirm the payment in your bank app. Do not close this screen.</p></div>
        <div className="card pad-lg"><dl className="kv"><dt>Amount</dt><dd className="total num">{vnd(a.fee)}</dd><dt>For</dt><dd>{what}</dd><dt>Paid to</dt><dd>Smart E-Mobility Hub</dd><dt>Held for</dt><dd className="mono">{mmss(left)}</dd></dl></div>
        {a.payment && <BankMeter p={a.payment} now={now} />}
      </div>
      <div className="actionbar"><button className="btn block" disabled>Waiting…</button></div>
    </>
  );
}

function Ended({ a, go, title, note }: { a: AllocationView; go: Go; title: string; note?: string }) {
  const tone = chipTone(a.status);
  const refund = a.payment?.refund;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "bookings" })}><Icon name="x" /></span><div className="title"><div className="h4">{a.id}</div><div className="sub">{title}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 28 }}>
        <div className="result"><div className={`badge ${tone === "info" ? "info" : tone}`}><Icon name={tone === "ok" ? "circle-check" : tone === "warn" ? "clock-alert" : tone === "danger" ? "ban" : "info"} /></div><div className="h2">{a.status}</div>
          <p className="small muted" style={{ maxWidth: 290 }}>{note ?? a.history[a.history.length - 1]?.note ?? ""}</p></div>
        <div className="card pad-lg"><dl className="kv"><dt>Fee</dt><dd className="num">{vnd(a.fee)}</dd><dt>Status</dt><dd><span className={`chip ${tone}`}>{a.status}</span></dd>
          {refund && <><dt>Refund</dt><dd>{refund.result === "Success" ? <span className="chip ok">Refunded · {refund.transactionRef}</span> : <span className="chip info">Refund pending</span>}</dd></>}</dl></div>
        {a.status === "Expired" && <div className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>The fee is not refunded (BR-PAY-01).</b></div>}
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go({ s: "bookings" })}><Icon name="ticket" />View in Bookings</button></div>
    </>
  );
}

export function PRScreen({ go, id, now }: { go: Go; id: string; now: number }) {
  const { data: a } = useLive<AllocationView>(`/student/allocation/${id}`);
  if (!a) return <div className="content"><span className="spinner" /></div>;
  if (a.status === "Pending Payment") return <PayingNow a={a} now={now} title="Parking reservation · UC-04" what={`Parking · ${a.spaceLabel} · ${a.hubId}`} />;
  if (a.status === "Payment Failed") return <PaymentFailed a={a} title="Parking reservation · UC-04 E8" what="space" onRetry={() => go({ s: "S05", hubId: a.hubId })} onBack={() => go({ s: "S02", hubId: a.hubId, tab: "parking" })} />;
  if (a.status !== "Confirmed" && a.status !== "Checked-in") return <Ended a={a} go={go} title="Parking reservation" />;
  const w = a.window!;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "bookings" })}><Icon name="x" /></span><div className="title"><div className="h4">{a.status === "Checked-in" ? "Checked in" : "Parking reserved"}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="result"><div className="badge ok"><Icon name="circle-check" /></div><div className="h2">Space {a.spaceLabel} is yours</div><p className="small muted">Paid {vnd(a.fee)} · {a.transactionRef}</p></div>
        <div className="ticket">
          <div className="row between"><div><div className="lbl">Parking reservation</div><div className="code">{a.id}</div></div><span className="chip ok" style={{ background: "rgba(210,255,61,.12)", color: "var(--volt)", borderColor: "rgba(210,255,61,.3)" }}>{a.status}</span></div>
          <div className="cut" />
          <dl className="kv"><dt>Hub</dt><dd>{a.hubId} · {a.hubName}</dd><dt>Space</dt><dd><span className="mono">{a.spaceLabel}</span> · Booked</dd><dt>Window</dt><dd className="mono">{hm(w.start)} → {hm(w.end)}</dd><dt>Check in by</dt><dd className="mono" style={{ color: "var(--volt)" }}>{hm(w.start + 15 * MIN)}</dd></dl>
        </div>
        <div className="card" style={{ overflow: "hidden" }}><div className="list">
          <div className="li"><div className="lead brand"><Icon name="motorbike" /></div><div className="grow"><div className="t mono">{a.vehicleId}</div><div className="s">The barrier reads this plate at check-in</div></div></div>
          <div className="li"><div className="lead"><Icon name="calendar-check" /></div><div className="grow"><div className="t">{dayLabel(w.start)}/2026</div><div className="s">Check-in is detected by the space sensor</div></div></div>
        </div></div>
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go({ s: "bookings" })}><Icon name="ticket" />View in Bookings</button></div>
    </>
  );
}

export function CSScreen({ go, id, now }: { go: Go; id: string; now: number }) {
  const { data: a } = useLive<AllocationView>(`/student/allocation/${id}`);
  useEffect(() => undefined, [id]);
  if (!a) return <div className="content"><span className="spinner" /></div>;
  if (a.status === "Pending Payment") return <PayingNow a={a} now={now} title="Charging session · UC-05" what={`Charging · ${a.pointId} · ${a.hubId}`} />;
  if (a.status === "Payment Failed") return <PaymentFailed a={a} title="Charging session · UC-05 E8" what="slot" onRetry={() => go({ s: "S06", hubId: a.hubId })} onBack={() => go({ s: "S02", hubId: a.hubId, tab: "charging" })} />;
  if (!["Scheduled", "Charging"].includes(a.status) || !a.slot) return <Ended a={a} go={go} title="Charging session" />;
  const moved = a.originalStart && a.slot.start !== a.originalStart;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "bookings" })}><Icon name="x" /></span><div className="title"><div className="h4">{a.status === "Charging" ? "Charging now" : "Charging scheduled"}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="result"><div className="badge ok"><Icon name="battery-charging" /></div><div className="h2">{a.status === "Charging" ? `Charging until ${hm(a.slot.end)}` : `Charging at ${hm(a.slot.start)}`}</div><p className="small muted">Paid {vnd(a.fee)} · {a.transactionRef}</p></div>
        <div className="ticket">
          <div className="row between"><div><div className="lbl">Charging session</div><div className="code">{a.id}</div></div><span className="chip ok" style={{ background: "rgba(210,255,61,.12)", color: "var(--volt)", borderColor: "rgba(210,255,61,.3)" }}>{a.status}</span></div>
          <div className="cut" />
          <dl className="kv"><dt>Charging point</dt><dd><span className="mono">{a.slot.pointId}</span> · Booked</dd><dt>Slot</dt><dd className="mono">{hm(a.slot.start)} → {hm(a.slot.end)}</dd><dt>Plug in by</dt><dd className="mono" style={{ color: "var(--volt)" }}>{hm(a.expiresAt ?? a.slot.start)}</dd>{a.neededBy ? <><dt>Needed by</dt><dd className="mono">{hm(a.neededBy)}</dd></> : null}</dl>
        </div>
        {moved && <div className="banner info compact"><span className="ic"><Icon name="calendar-clock" /></span><b>Moved {Math.round((a.slot.start - a.originalStart!) / MIN)} min later by the schedule (BR-CHG-02).</b></div>}
        <div className="card pad row top" style={{ gap: 12 }}><div className="lead" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--info-bg)", color: "var(--info)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="bell-ring" /></div>
          <div><b>Your slot is reserved for you</b><p className="small muted">It is not placed in the shared-vehicle charging queue. The schedule can only move it up to 15 min later, and you are always told.</p></div></div>
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go({ s: "bookings" })}><Icon name="ticket" />View in Bookings</button></div>
    </>
  );
}
