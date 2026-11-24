// S03 Reserve shared vehicle (UC-02 steps 2, 4, 6-7) and S04 Payment (UC-03 a-d), reused by
// every booking: PaymentWait / PaymentOutcome take any allocation with a payment.
import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { api, hm, hms, mmss, useLive, vnd } from "../shared/live";
import { Soc } from "./Discover";
import type { AllocationView, Go, PaymentView, VehicleSummary } from "./types";

const MIN = 60_000;
const vehIcon = (t: string) => (t === "electric bicycle" ? "bike" : "motorbike");

export function S03Review({ go, vehicleId }: { go: Go; vehicleId: string }) {
  const [sum, setSum] = useState<(VehicleSummary & { hubName: string; holdMs: number; paymentHoldMs: number }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof sum>("/student/reserve/request", { vehicleId }).then(setSum).catch((e: Error) => setErr(e.message)); }, [vehicleId]);
  const back = () => { api("/student/reserve/discard", {}); go(sum ? { s: "S02", hubId: sum.hubId } : { s: "S01" }); };
  const confirm = async () => {
    setBusy(true);
    try { const vr = await api<AllocationView>("/student/reserve/confirm", { vehicleId }); go({ s: "VR", id: vr.id }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={back}><Icon name="chevron-left" /></span><div className="title"><div className="h4">Reserve vehicle</div><div className="sub">{sum ? `${sum.hubId} · ${sum.hubName}` : vehicleId}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 4 }}>
        <ol className="steps"><li className="done">Choose</li><li className="now">Review</li><li>Pay</li><li>Done</li></ol>
        {err && <div className="banner danger"><span className="ic"><Icon name="circle-x" /></span><b>Can't reserve {vehicleId}</b><p>{err}</p></div>}
        {sum && (
          <>
            <div className="card pad-lg row" style={{ gap: 14 }}>
              <div className="veh" style={{ padding: 0, border: 0 }}><div className="pic ok" style={{ width: 64, height: 64, borderRadius: 18 }}><Icon name={vehIcon(sum.type)} className="ic-lg" /></div></div>
              <div className="grow"><div className="mono" style={{ fontSize: 20 }}>{sum.vehicleId}</div><div className="small muted">{sum.model} · {sum.ratePerHour.toLocaleString("en-US")} VND/h after pickup</div>
                <div className="row" style={{ marginTop: 6 }}><Soc v={sum.soc} /><span className="chip ok">{sum.status}</span></div></div>
            </div>
            <div className="card pad-lg">
              <dl className="kv">
                <dt>Pickup Hub</dt><dd>{sum.hubId} · {sum.hubName}</dd>
                <dt>Dock</dt><dd className="mono">{sum.dock}</dd>
                <dt>Held for you</dt><dd>{sum.holdMs / MIN} min after payment</dd>
                <dt /><dd><span className="tag param">VEHICLE_RESERVATION_HOLD</span></dd>
                <hr className="hr" />
                <dt>Reservation fee</dt><dd className="total num">{vnd(sum.fee)}</dd>
              </dl>
            </div>
            <div className="banner warn"><span className="ic"><Icon name="clock-alert" /></span><b>The fee is not refunded if you don't pick up.</b><p>If you don't reach the vehicle within {sum.holdMs / MIN} min, the reservation expires and the vehicle is released (BR-PAY-01).</p></div>
            <div className="hint"><Icon name="landmark" />You confirm this payment with your bank through the Bank System.</div>
          </>
        )}
      </div>
      <div className="actionbar">
        <div className="sum"><span className="muted small">Pay now</span><span className="price num">{sum ? vnd(sum.fee) : "—"}</span></div>
        <div className="row"><button className="btn secondary" style={{ width: 112 }} onClick={back}>Cancel</button>
          <button className="btn primary grow lg" disabled={!sum || busy || !!err} onClick={confirm}><Icon name="lock" />Confirm &amp; Pay</button></div>
      </div>
    </>
  );
}

/** The live view of one vehicle reservation: S03b while paying, S04c/d on failure, S03c once confirmed. */
export function VRScreen({ go, id, now }: { go: Go; id: string; now: number }) {
  const { data: a } = useLive<AllocationView>(`/student/allocation/${id}`);
  if (!a) return <div className="content"><span className="spinner" /></div>;
  const p = a.payment;
  if (a.status === "Pending Payment") {
    const left = a.createdAt + (a.holdMs ?? 120_000) - now;
    return (
      <>
        <div className="m-appbar"><span /><div className="title"><div className="h4">Waiting for payment</div><div className="sub">Don't close the app</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <ol className="steps"><li className="done">Choose</li><li className="done">Review</li><li className="now">Pay</li><li>Done</li></ol>
          <div className="card pad-lg stack" style={{ alignItems: "center", textAlign: "center", paddingTop: 26, paddingBottom: 24 }}>
            <div className="ring info" style={{ ["--p" as string]: Math.max(0, Math.round((left / (a.holdMs ?? 120_000)) * 100)) }}><div><span className="t">{mmss(left)}</span><span className="u">left to pay</span></div></div>
            <div className="h3" style={{ marginTop: 6 }}>{a.vehicleId} is held for you</div>
            <p className="small muted" style={{ maxWidth: 270 }}>Payment must complete within <b>{(a.holdMs ?? 0) / MIN} min</b>, or the hold is released and nothing is charged.</p>
            <span className="tag param">PAYMENT_HOLD_VEHICLE = {(a.holdMs ?? 0) / MIN} min</span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}><div className="list">
            <div className="li"><div className="lead info"><Icon name="bike" /></div><div className="grow"><div className="t">Vehicle <span className="mono">{a.vehicleId}</span></div><div className="s">Others can't reserve it now</div></div><span className="chip info">{a.vehicle?.status}</span></div>
            <div className="li"><div className="lead info"><Icon name="ticket" /></div><div className="grow"><div className="t">Your reservation</div><div className="s">{vnd(a.fee)} · Bank System</div></div><span className="chip info">Pending Payment</span></div>
          </div></div>
          {p && <BankMeter p={p} now={now} />}
          <div className="row" style={{ gap: 10, padding: "2px 4px" }}><span className="spinner" style={{ width: 20, height: 20, borderWidth: 3 }} /><span className="small muted">Confirm the payment in your bank app…</span></div>
        </div>
      </>
    );
  }
  if (a.status === "Payment Failed") return <PaymentFailed a={a} title="Vehicle reservation · UC-02" what="vehicle" onRetry={() => go({ s: "S03", vehicleId: a.movedFrom ?? a.vehicleId! })} onBack={() => go({ s: "S02", hubId: a.hubId })} />;
  if (a.status === "Confirmed" || a.status === "Pickup In Progress") {
    const left = (a.expiresAt ?? now) - now;
    const total = 15 * MIN;
    return (
      <>
        <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "S01" })}><Icon name="x" /></span><div className="title"><div className="h4">Reservation confirmed</div></div><span /></div>
        <div className="content" style={{ paddingTop: 4 }}>
          <div className="result" style={{ paddingTop: 2 }}><div className="badge ok"><Icon name="circle-check" /></div><div className="h2">You're all set</div><p className="small muted">Paid {vnd(a.fee)} · {a.transactionRef}</p></div>
          {a.movedFrom && <div className="banner info compact"><span className="ic"><Icon name="replace" /></span><b>Vehicle replaced: {a.movedFrom} → {a.vehicleId}</b><p>Same Hub, same fee, new pickup window (BR-RES-02).</p></div>}
          <div className="ticket">
            <div className="row between"><div><div className="lbl">Vehicle reservation</div><div className="code">{a.id}</div></div>
              <span className="chip ok" style={{ background: "rgba(210,255,61,.12)", color: "var(--volt)", borderColor: "rgba(210,255,61,.3)" }}>{a.status}</span></div>
            <div className="cut" />
            <dl className="kv"><dt>Vehicle</dt><dd><span className="mono">{a.vehicleId}</span> · {a.vehicle?.status}</dd><dt>Hub</dt><dd>{a.hubId} · {a.hubName}</dd><dt>Dock</dt><dd className="mono">{a.vehicle?.dock ?? "—"}</dd><dt>Pick up before</dt><dd className="mono" style={{ color: "var(--volt)" }}>{hm(a.expiresAt!)}</dd></dl>
          </div>
          <div className="card pad row" style={{ gap: 14 }}>
            <div className="ring sm" style={{ ["--p" as string]: Math.max(0, Math.round((left / total) * 100)) }}><div><span className="t">{mmss(left)}</span><span className="u">left</span></div></div>
            <div className="grow"><b>Pickup window</b><p className="small muted">Scan the vehicle at the Hub before {hm(a.expiresAt!)}. After that it expires and the fee is not refunded.</p></div>
          </div>
        </div>
        <div className="actionbar">
          <button className="btn primary block lg"><Icon name="navigation" />Directions to {a.hubId}</button>
          <button className="btn ghost block" style={{ height: 30 }} onClick={() => go({ s: "S09" })}><Icon name="qr-code" />I'm at the Hub — scan to pick up</button>
        </div>
      </>
    );
  }
  // Expired, Cancelled by System, Fulfilled.
  const tone = a.status === "Fulfilled" ? "ok" : a.status === "Expired" ? "warn" : "danger";
  const refund = p?.refund;
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={() => go({ s: "S01" })}><Icon name="x" /></span><div className="title"><div className="h4">{a.id}</div><div className="sub">Vehicle reservation</div></div><span /></div>
      <div className="content" style={{ paddingTop: 28 }}>
        <div className="result"><div className={`badge ${tone}`}><Icon name={a.status === "Fulfilled" ? "circle-check" : a.status === "Expired" ? "clock-alert" : "ban"} /></div>
          <div className="h2">{a.status === "Fulfilled" ? "Picked up" : a.status === "Expired" ? "Reservation expired" : "Cancelled by System"}</div>
          <p className="small muted" style={{ maxWidth: 290 }}>{a.history[a.history.length - 1]?.note ?? ""}</p></div>
        <div className="card pad-lg"><dl className="kv"><dt>Vehicle</dt><dd className="mono">{a.vehicleId}</dd><dt>Fee</dt><dd className="num">{vnd(a.fee)}</dd><dt>Status</dt><dd><span className={`chip ${tone}`}>{a.status}</span></dd>
          {refund && <><dt>Refund</dt><dd>{refund.result === "Success" ? <span className="chip ok">Refunded · {refund.transactionRef}</span> : <span className="chip info">Refund pending</span>}</dd></>}</dl></div>
        {a.status === "Expired" && <div className="banner warn compact"><span className="ic"><Icon name="info" /></span><b>The fee is not refunded (BR-PAY-01).</b><p>The vehicle was released for other students.</p></div>}
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={() => go({ s: "S02", hubId: a.hubId })}>Back to {a.hubId}</button></div>
    </>
  );
}

/** S04a: the bank response meter, up to PAYMENT_GATEWAY_TIMEOUT. */
export function BankMeter({ p, now }: { p: PaymentView; now: number }) {
  const el = Math.max(0, Math.min(p.timeoutMs, now - p.requestedAt));
  return (
    <div className="card pad stack tight">
      <div className="row between"><span className="small strong">Bank response</span><span className="small mono">{mmss(el)} / {mmss(p.timeoutMs)}</span></div>
      <div className="meter info" style={{ ["--v" as string]: `${Math.round((el / p.timeoutMs) * 100)}%` }}><i /></div>
      <span className="hint"><Icon name="timer" />Up to {p.timeoutMs / 1000} s (PAYMENT_GATEWAY_TIMEOUT)</span>
    </div>
  );
}

/** S04c (declined) and S04d (no response), for any booking. */
export function PaymentFailed({ a, title, what, onRetry, onBack }: { a: AllocationView; title: string; what: "vehicle" | "space" | "slot"; onRetry: () => void; onBack: () => void }) {
  const p = a.payment;
  const timedOut = p?.failureCode === "timeout" || !p || p.result === null || a.history.some((h) => h.note?.includes("hold ran out") || h.note?.includes("no answer"));
  const late = p?.lateResult === "Success";
  return (
    <>
      <div className="m-appbar"><span className="icon-btn clickable" onClick={onBack}><Icon name="x" /></span><div className="title"><div className="h4">Payment</div><div className="sub">{title}</div></div><span /></div>
      <div className="content" style={{ paddingTop: 28 }}>
        {timedOut
          ? <div className="result"><div className="badge warn"><Icon name="clock-alert" /></div><div className="h2">No response from your bank</div><p className="small muted" style={{ maxWidth: 290 }}>We waited and did not receive a result in time.</p></div>
          : <div className="result"><div className="badge danger"><Icon name="circle-x" /></div><div className="h2">Payment failed</div><p className="small muted" style={{ maxWidth: 290 }}>Declined by the Bank System{p?.failureCode ? `: ${p.failureCode}` : ""}.</p></div>}
        <div className="banner ok compact"><span className="ic"><Icon name="shield-check" /></span><b>No fee was charged.</b>
          <p>{timedOut ? "If the bank later confirms a charge, it is refunded automatically (BR-PAY-03)." : `The hold on your ${what} has been released.`}</p></div>
        {late && <div className="banner info compact"><span className="ic"><Icon name="rotate-ccw" /></span><b>Your bank confirmed late.</b><p>{p?.refund?.result === "Success" ? `Refunded · ${p.refund.transactionRef}` : "The refund is on its way."}</p></div>}
        <div className="card pad-lg"><dl className="kv"><dt>Amount</dt><dd className="num">{vnd(a.fee)}</dd><dt>Reservation</dt><dd><span className="chip danger">Payment Failed</span></dd>
          <dt>{what === "vehicle" ? "Vehicle" : what === "space" ? "Space" : "Slot"}</dt><dd>Released</dd>{p?.requestedAt ? <><dt>Requested</dt><dd className="mono">{hms(p.requestedAt)}</dd></> : null}</dl></div>
      </div>
      <div className="actionbar"><button className="btn primary block lg" onClick={onRetry}><Icon name="rotate-ccw" />Try again</button><button className="btn ghost block" style={{ height: 30 }} onClick={onBack}>Back to Hub</button></div>
    </>
  );
}
