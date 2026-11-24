// S09 Pick up (UC-07: scan, inspection, unlocking, trip started, unlock failed) and
// S10 Return and pay (UC-08: Hub full, trip summary, receipt, fare not paid).
import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { api, hhmmss, hm, hms, mmss, useLive, vnd } from "../shared/live";
import { Soc, chipTone } from "./Discover";
import { BankMeter } from "./Reserve";
import type { Go, Home, PickupSummary, TripView } from "./types";
import { BreakdownCard, type ReportResult } from "./Report";

const vehIcon = (t: string) => (t === "electric bicycle" ? "bike" : "motorbike");

/** The Trip tab: whichever of S09a-e / S10 fits the student's state right now. */
export function TripTab({ go, home, now }: { go: Go; home: Home; now: number }) {
  const [doneTrip, setDoneTrip] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  if (home.pickup) return <Pickup go={go} home={home} now={now} />;
  if (home.trip) return returning ? <S10Return home={home} trip={home.trip} now={now} onBack={() => setReturning(false)} /> : <S09Trip go={go} trip={home.trip} now={now} onEnd={() => setReturning(true)} />;
  const lt = home.lastTrip;
  if (lt && lt.id !== doneTrip && (lt.fareStatus === "Unpaid" || now - (lt.endTime ?? 0) < 30 * 60_000)) return <S10Summary trip={lt} now={now} onDone={() => { setDoneTrip(lt.id); go({ s: "S01" }); }} />;
  return <S09Scan go={go} home={home} />;
}

function S09Scan({ go, home }: { go: Go; home: Home }) {
  const vr = home.reservation && ["Confirmed", "Pickup In Progress"].includes(home.reservation.status) ? home.reservation : null;
  const [typing, setTyping] = useState(false);
  const [id, setId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const loc = home.location;
  const hubId = loc.hubId ?? vr?.hubId ?? "H01";
  const start = (vehicleId?: string) => api("/student/pickup", { vehicleId }).then(() => setErr(null)).catch((e: Error) => setErr(e.message));
  return (
    <>
      <div className="m-appbar" style={{ background: "var(--ink-900)" }}><span className="icon-btn on-dark clickable" onClick={() => go({ s: "S01" })}><Icon name="x" /></span>
        <div className="title"><div className="h4" style={{ color: "#fff" }}>Scan to pick up</div><div className="sub" style={{ color: "var(--ink-300)" }}>{vr ? `${vr.id} · ${vr.vehicleId}` : "Walk-up rental"}</div></div><span className="icon-btn on-dark"><Icon name="flashlight" /></span></div>
      <div className="content" style={{ paddingTop: 6 }}>
        <div className="viewfinder clickable" title={vr ? `Simulate scanning ${vr.vehicleId}` : "Type a vehicle ID below"} onClick={() => vr && start(vr.vehicleId)}>
          <div className="qr" /><div className="box"><i /><i /><i /><i /></div><div className="scanline" />
          <div className="cap">{vr ? `Tap to scan the QR code on ${vr.vehicleId}` : "Scan the QR code on the vehicle or the dock"}</div>
        </div>
        <div className="metric on-dark row" style={{ gap: 12, padding: 14 }}>
          <Icon name={loc.inside ? "map-pin" : "map-pin-off"} style={{ color: loc.inside ? "var(--volt)" : "#FF8A8A" }} />
          <div className="grow"><b>{loc.inside ? `You're at ${hubId}` : `You're outside the ${hubId} Hub area`}</b>
            <div style={{ fontSize: 12, color: "var(--ink-300)" }}>{loc.inside ? `Inside the Hub area${vr?.expiresAt ? ` · pick up before ${hm(vr.expiresAt)}` : ""}` : "Move closer to the docks"}</div></div>
        </div>
        {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>Can't start the pickup</b><p>{err}</p></div>}
        {home.blocked && <div className="banner danger compact"><span className="ic"><Icon name="ban" /></span><b>Pay the outstanding fare first.</b><p>Rentals are blocked (BR-PAY-04).</p></div>}
        {typing && (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1, height: 44 }} placeholder="e.g. EB-0221" value={id} onChange={(e) => setId(e.target.value)} />
            <button className="btn volt" onClick={() => start(id)}>Continue</button>
          </div>
        )}
      </div>
      <div className="actionbar" style={{ background: "var(--ink-900)", borderColor: "rgba(255,255,255,.08)" }}>
        <button className="btn volt block lg" onClick={() => setTyping(true)}><Icon name="keyboard" />Enter vehicle ID</button>
        <span className="small center" style={{ color: "var(--ink-300)" }}>Code damaged or unreadable? Type the ID printed on the vehicle.</span>
      </div>
    </>
  );
}

const CHECKS: Array<[string, string]> = [["disc-3", "Brakes grip front and back"], ["circle-dot", "Tires look inflated"], ["lightbulb", "Lights turn on"], ["battery-full", "Battery"]];

function Pickup({ go, home, now }: { go: Go; home: Home; now: number }) {
  const { data: p } = useLive<PickupSummary | null>("/student/pickup");
  const [checked, setChecked] = useState<boolean[]>([false, false, false, false]);
  const [err, setErr] = useState<string | null>(null);
  const unlockStart = useRef<number | null>(null);
  if (!p) return <div className="content"><span className="spinner" /></div>;

  if (p.state === "failed") {
    const vr = home.reservation;
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={() => api("/student/pickup/cancel", {})}><Icon name="x" /></span><div className="title"><div className="h4">Pickup</div><div className="sub">{p.hubId} · {p.hubName}</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <div className="result"><div className="badge danger"><Icon name="lock" /></div><div className="h2">{p.vehicleId} couldn't be unlocked</div>
            <p className="small muted" style={{ maxWidth: 290 }}>No trip was started and nothing extra is charged. We reported the dock to the operators ({p.incidentId}).</p></div>
          {vr && vr.status === "Confirmed" ? (
            <>
              <div className="card" style={{ overflow: "hidden" }}><div className="list">
                <div className="li"><div className="lead brand"><Icon name="ticket" /></div><div className="grow"><div className="t mono">{vr.id}</div><div className="s">Moved to a replacement vehicle</div></div><span className="chip info">{vr.status}</span></div>
                <div className="li"><div className="lead brand"><Icon name={vehIcon(vr.vehicle?.type ?? "")} /></div><div className="grow"><div className="t mono">{vr.vehicleId}</div><div className="s">{vr.vehicle?.model} · Dock {vr.vehicle?.dock} · {vr.vehicle?.soc}%</div></div><span className="chip info">{vr.vehicle?.status}</span></div>
              </div></div>
              <div className="banner info compact"><span className="ic"><Icon name="clock-3" /></span><b>Pick up {vr.vehicleId} before {hm(vr.expiresAt!)}.</b><p>If no same-type vehicle is free, the reservation becomes "Cancelled by System" and the fee is refunded.</p></div>
            </>
          ) : <div className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>{p.message}</b></div>}
        </div>
        <div className="actionbar">
          {vr && vr.status === "Confirmed"
            ? <button className="btn primary block lg" onClick={async () => { await api("/student/pickup/cancel", {}); await api("/student/pickup", { vehicleId: vr.vehicleId }).catch((e: Error) => alert(e.message)); }}><Icon name="scan-line" />Scan {vr.vehicleId}</button>
            : <button className="btn primary block lg" onClick={() => api("/student/pickup/cancel", {}).then(() => go({ s: "S01" }))}>Choose another vehicle</button>}
        </div>
      </>
    );
  }

  if (p.state === "unlocking") {
    if (!unlockStart.current) unlockStart.current = now;
    const el = now - unlockStart.current;
    return (
      <>
        <div className="m-appbar"><span /><div className="title"><div className="h4">Unlocking</div><div className="sub">{p.vehicleId} · Dock {p.dock}</div></div><span /></div>
        <div className="content" style={{ paddingTop: 40 }}>
          <div className="result"><div className="badge info"><Icon name="lock-open" /></div><div className="h2">Releasing your vehicle</div><p className="small muted" style={{ maxWidth: 280 }}>Waiting for the unlock result (up to 15 s).</p></div>
          <div className="card pad stack tight"><div className="row between"><span className="small strong">Unlock request · Dock {p.dock}</span><span className="mono small">{mmss(el)} / 00:15</span></div>
            <div className="meter info lg" style={{ ["--v" as string]: `${Math.min(100, Math.round((el / 15000) * 100))}%` }}><i /></div>
            <span className="hint"><Icon name="info" />Take the vehicle out when the app says it is unlocked.</span></div>
        </div>
      </>
    );
  }

  const left = p.inspectionEndsAt - now;
  const all = checked.every(Boolean);
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => api("/student/pickup/cancel", {})}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Check the vehicle</div><div className="sub">{p.vehicleId} · {p.hubId} · Dock {p.dock}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="card pad row" style={{ gap: 14 }}>
          <div className="ring sm warn" style={{ ["--p" as string]: Math.max(0, Math.round((left / 180_000) * 100)) }}><div><span className="t">{mmss(left)}</span></div></div>
          <div className="grow"><span className="chip info">{p.walkUp ? "Walk-up · vehicle Held" : "Pickup In Progress"}</span><p className="small muted" style={{ marginTop: 6 }}>Unlock within 3 min (INSPECTION_TIMEOUT). {p.walkUp ? "Unlock fee " + vnd(p.unlockFee) + " is added to the fare." : "Your reservation can't expire while you check."}</p></div>
        </div>
        <div className="section-title"><span className="h4">Before you ride</span><span className="small subtle">{checked.filter(Boolean).length} of 4 checked</span></div>
        <div className="stack tight">
          {CHECKS.map(([ic, label], i) => (
            <div key={label} className={`choice clickable${checked[i] ? " on" : ""}`} onClick={() => setChecked((cur) => cur.map((c, j) => (j === i ? !c : c)))}>
              <span className="check"><Icon name="check" /></span><Icon name={ic} /><b className="grow">{label}</b>{i === 3 && <Soc v={p.soc} />}
            </div>
          ))}
        </div>
        {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b></div>}
        <div className="row between" style={{ padding: "0 2px" }}>
          <a className="small row clickable" style={{ gap: 5, color: "var(--danger)" }} onClick={() => go({ s: "S07", resourceId: p.vehicleId })}><Icon name="triangle-alert" className="ic-sm" />Report a problem</a>
          <a className="small clickable" style={{ color: "var(--text-2)" }} onClick={() => api("/student/pickup/cancel", {})}>Cancel pickup</a>
        </div>
      </div>
      <div className="actionbar"><button className="btn primary block lg" disabled={!all} onClick={() => { unlockStart.current = null; api("/student/pickup/unlock", {}).catch((e: Error) => setErr(e.message)); }}><Icon name="lock-open" />Unlock &amp; Start Trip</button></div>
    </>
  );
}

function S09Trip({ go, trip, now, onEnd }: { go: Go; trip: TripView; now: number; onEnd: () => void }) {
  const { data: reports } = useLive<ReportResult[]>("/student/reports");
  const bd = reports?.find((r) => r.resourceId === trip.vehicleId && r.category === "vehicle failure" && r.time >= trip.startTime);
  return (
    <>
      <div className="m-appbar"><span /><div className="title"><div className="h4">Your trip</div><div className="sub">Started {hm(trip.startTime)} at {trip.hubId}</div></div><span className="icon-btn"><Icon name="ellipsis" /></span></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="trip stack">
          <div className="row between"><span className="lbl">Trip time</span><span className="chip info" style={{ background: "rgba(232,238,255,.12)", color: "#B9CBFB", borderColor: "rgba(185,203,251,.3)" }}>In Use</span></div>
          <div className="big">{hhmmss(now - trip.startTime)}</div>
          <div className="three" style={{ marginTop: 6 }}>
            <div><div className="lbl">Battery</div><div className="row" style={{ gap: 6, marginTop: 4 }}><span className="soc" style={{ ["--v" as string]: `${trip.soc}%` }}><span className="bar" style={{ borderColor: "var(--ink-400)" }}><i /></span></span><b>{trip.soc}%</b></div></div>
            <div><div className="lbl">Distance</div><b style={{ display: "block", marginTop: 4 }}>{trip.distanceKm} km</b></div>
            <div><div className="lbl">Fare so far</div><b style={{ display: "block", marginTop: 4 }}>{vnd(trip.fareSoFar)}</b></div>
          </div>
        </div>
        <div className="card" style={{ overflow: "hidden" }}><div className="list">
          <div className="li"><div className="lead brand"><Icon name={vehIcon(trip.type)} /></div><div className="grow"><div className="t mono">{trip.vehicleId}</div><div className="s">{trip.model} · {trip.ratePerHour.toLocaleString("en-US")} VND/h</div></div><span className="chip info">In Use</span></div>
          {trip.reservationId && <div className="li"><div className="lead brand"><Icon name="ticket" /></div><div className="grow"><div className="t mono">{trip.reservationId}</div><div className="s">Reservation used</div></div><span className="chip ok">Fulfilled</span></div>}
          <div className="li"><div className="lead brand"><Icon name="route" /></div><div className="grow"><div className="t mono">{trip.id}</div><div className="s">From {trip.hubId} · dock {trip.startDock}</div></div><span className="chip info">Open</span></div>
        </div></div>
        {bd && <BreakdownCard r={bd} />}
        <div className="card pad stack tight"><b>How to return</b><p className="small muted">Push the vehicle into any vacant dock at a Hub until it clicks, then tap End Trip. The fare is paid through the Bank System.</p></div>
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={onEnd}><Icon name="flag" />End Trip</button>
        {!bd && <button className="btn ghost block" style={{ height: 34, color: "var(--danger)" }} onClick={() => go({ s: "S08" })}><Icon name="triangle-alert" />The vehicle broke down</button>}</div>
    </>
  );
}

interface Docks { hubId: string; name: string; vacant: Array<{ dockId: string; label: string }>; nearby: Array<{ hubId: string; name: string; vacant: number; distanceKm: number }> }

function S10Return({ home, trip, now, onBack }: { home: Home; trip: TripView; now: number; onBack: () => void }) {
  const [hubId, setHubId] = useState(home.location.hubId ?? trip.hubId);
  const { data: d } = useLive<Docks>(`/student/docks/${hubId}`);
  const [msg, setMsg] = useState<string | null>(null);
  const end = () => api<{ status: string; message?: string }>("/student/trip/end", {}).then((r) => setMsg(r.message ?? null));
  const full = d && d.vacant.length === 0;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={onBack}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Return {trip.vehicleId}</div><div className="sub">Trip {hhmmss(now - trip.startTime)}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="small muted">Returning at</span>
          {["H01", "H02", "H03", "H04", "H05", "H07"].map((h) => <span key={h} className={`tag clickable${h === hubId ? " on" : ""}`} style={h === hubId ? { background: "var(--ink-900)", color: "#fff" } : undefined} onClick={() => setHubId(h)}>{h}</span>)}
        </div>
        {d && full && (
          <>
            <div className="card pad-lg row top" style={{ gap: 14 }}><div className="lead" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--warn-bg)", color: "var(--warn)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="circle-parking-off" className="ic-lg" /></div>
              <div><div className="h3">{d.hubId} is full</div><p className="small muted">All docks at {d.name} are occupied. Your trip continues; return at a nearby Hub.</p></div></div>
            <div className="section-title"><span className="h4">Hubs with vacant docks nearby</span></div>
            <div className="card" style={{ overflow: "hidden" }}><div className="list">
              {d.nearby.map((n) => <div className="li clickable" key={n.hubId} onClick={() => setHubId(n.hubId)}><span className="hub-code lg">{n.hubId}</span><div className="grow"><div className="t">{n.name}</div><div className="s">{n.distanceKm} km · {Math.max(1, Math.round(n.distanceKm * 5))} min ride</div></div><span className="chip ok">{n.vacant} vacant</span></div>)}
            </div></div>
          </>
        )}
        {d && !full && (
          <div className="card pad-lg stack tight">
            <div className="row between"><b>{d.hubId} · {d.name}</b><span className="chip ok">{d.vacant.length} vacant</span></div>
            <p className="small muted">Push {trip.vehicleId} into any vacant dock until it clicks. The dock reports the latch and the trip closes by itself.</p>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{d.vacant.slice(0, 8).map((x) => <span key={x.dockId} className="tag mono">{x.label}</span>)}{d.vacant.length > 8 && <span className="tag">+{d.vacant.length - 8}</span>}</div>
          </div>
        )}
        {msg && <div className="banner warn"><span className="ic"><Icon name="triangle-alert" /></span><b>Not docked yet</b><p>{msg}</p></div>}
        <span className="fresh">Docks updated <span className="mono">{hms(now)}</span></span>
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={end}><Icon name="flag" />I've docked it — End Trip</button></div>
    </>
  );
}

function S10Summary({ trip, now, onDone }: { trip: TripView; now: number; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const p = trip.payment;
  const paying = trip.fareStatus === "Unpaid" && (!p || p.result === null);
  useEffect(() => setErr(null), [trip.fareStatus]);
  const dur = hhmmss((trip.endTime ?? now) - trip.startTime);
  if (trip.fareStatus === "Paid" || trip.fareStatus === "Waived") {
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={onDone}><Icon name="x" /></span><div className="title"><div className="h4">Receipt</div></div><span className="icon-btn"><Icon name="share-2" /></span></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <div className="result"><div className="badge ok"><Icon name="receipt" /></div><div className="h2">Thanks for riding</div><p className="small muted">{trip.fareStatus === "Waived" ? "Fare waived" : "Fare paid"} · see you next time</p></div>
          <div className="card pad-lg"><dl className="kv"><dt>Fare</dt><dd className="total num">{vnd(trip.fare)}</dd><dt>Status</dt><dd><span className="chip ok">{trip.fareStatus}</span></dd>
            <dt>Transaction</dt><dd className="mono small">{trip.transactionRef ?? "—"}</dd><dt>Route</dt><dd>{trip.hubId} → {trip.endHubId}</dd><dt>Time</dt><dd className="mono">{hm(trip.startTime)} → {hm(trip.endTime!)}</dd></dl></div>
          <div className="card pad row" style={{ gap: 12 }}><div className="lead" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--brand-50)", color: "var(--brand-700)", display: "grid", placeItems: "center" }}><Icon name="leaf" /></div>
            <div className="grow small"><b>{trip.distanceKm} km on electric power</b><div className="muted">About {(trip.distanceKm * 0.14).toFixed(1)} kg CO₂ saved vs. a petrol motorbike</div></div></div>
        </div>
        <div className="actionbar"><button className="btn primary block lg" onClick={onDone}>Done</button></div>
      </>
    );
  }
  if (!paying) {
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={onDone}><Icon name="x" /></span><div className="title"><div className="h4">Fare not paid</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <div className="result"><div className="badge danger"><Icon name="circle-x" /></div><div className="h2">We couldn't take the fare</div>
            <p className="small muted" style={{ maxWidth: 280 }}>{p?.failureCode === "timeout" ? "No answer from the Bank System in time." : `Declined by the Bank System${p?.failureCode ? `: ${p.failureCode}` : ""}.`} The trip is closed; only the payment is outstanding.</p></div>
          <div className="card pad-lg"><dl className="kv"><dt>Fare</dt><dd className="total num">{vnd(trip.fare)}</dd><dt>Status</dt><dd><span className="chip warn">Unpaid</span></dd><dt>Trip</dt><dd>Closed at {hm(trip.endTime!)} · {trip.endHubId}</dd></dl></div>
          <div className="banner danger"><span className="ic"><Icon name="ban" /></span><b>New reservations and rentals are blocked until the fare is paid (BR-PAY-04).</b><p>Parking and charging you already booked are not affected.</p></div>
          {err && <div className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>{err}</b></div>}
        </div>
        <div className="actionbar"><button className="btn primary block lg" onClick={() => api("/student/fare/pay", {}).catch((e: Error) => setErr(e.message))}><Icon name="credit-card" />Pay now · {vnd(trip.fare)}</button></div>
      </>
    );
  }
  return (
    <>
      <div className="m-appbar"><span /><div className="title"><div className="h4">Trip ended</div><div className="sub">Docked at {trip.endHubId} · {trip.endDock}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <div className="trip stack">
          <div className="row between"><span className="lbl">Trip closed at {hm(trip.endTime!)}</span><span className={`chip ${chipTone("Unpaid")}`} style={{ background: "rgba(255,241,214,.12)", color: "#FFD48A", borderColor: "rgba(255,212,138,.35)" }}>Unpaid</span></div>
          <div className="big">{trip.fare.toLocaleString("en-US")} <span style={{ fontSize: 18, color: "var(--white)" }}>VND</span></div>
          <div className="three" style={{ marginTop: 4 }}><div><div className="lbl">Duration</div><b>{dur}</b></div><div><div className="lbl">Distance</div><b>{trip.distanceKm} km</b></div><div><div className="lbl">Vehicle</div><b className="mono">{trip.vehicleId}</b></div></div>
        </div>
        <div className="card pad-lg"><dl className="kv">
          {trip.fareBreakdown.map((b) => <span key={b.label} style={{ display: "contents" }}><dt>{b.label}</dt><dd className="num">{vnd(b.amount)}</dd></span>)}
          <dt>Out-of-zone return</dt><dd className="num">0 VND</dd><hr className="hr" /><dt><b>Fare</b></dt><dd className="total num">{vnd(trip.fare)}</dd></dl></div>
        {p && <BankMeter p={p} now={now} />}
        <div className="row" style={{ gap: 10, padding: "0 4px" }}><span className="spinner" style={{ width: 20, height: 20, borderWidth: 3 }} /><span className="small muted">Paying the fare through the Bank System…</span></div>
      </div>
    </>
  );
}
