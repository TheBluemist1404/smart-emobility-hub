// S11 My bookings and S12 Notifications.
import { Fragment, useState } from "react";
import { Icon } from "../shared/Icon";
import { api, dayLabel, hm, mmss, useLive, vnd } from "../shared/live";
import { chipTone } from "./Discover";
import type { AllocationView, Go, Home, Route, TripView } from "./types";

type Row = (AllocationView | TripView) & { active: boolean; createdAt: number };
const MIN = 60_000;

export function routeFor(ref: string | undefined): Route | null {
  if (!ref) return null;
  if (ref.startsWith("VR-")) return { s: "VR", id: ref };
  if (ref.startsWith("PR-")) return { s: "PR", id: ref };
  if (ref.startsWith("CS-")) return { s: "CS", id: ref };
  if (ref.startsWith("TR-")) return { s: "S09" };
  return null;
}

function rowInfo(a: Row): { icon: string; title: string; sub: string; notes: Array<{ icon: string; text: string; tone?: string }> } {
  const notes: Array<{ icon: string; text: string; tone?: string }> = [];
  const refund = "payment" in a ? a.payment?.refund : null;
  if (a.status === "Payment Failed") notes.push({ icon: "shield-check", text: "No fee was charged" });
  if (a.status === "Expired") notes.push({ icon: "circle-minus", text: "Fee not refunded — the deadline passed", tone: "warn" });
  if (refund) notes.push(refund.result === "Success" ? { icon: "circle-check", text: `Refunded · ${refund.transactionRef}`, tone: "ok" } : { icon: "hourglass", text: `Refund of ${vnd(refund.amount)} requested · Refund pending` });
  if (a.kind === "Trip") {
    const t = a as TripView;
    if (t.fareStatus === "Unpaid") notes.push({ icon: "ban", text: `Fare ${vnd(t.fare)} unpaid — bookings blocked`, tone: "warn" });
    return { icon: t.type === "electric bicycle" ? "bike" : "motorbike", title: `Trip · ${t.id}`, sub: `${dayLabel(t.startTime)} ${hm(t.startTime)} · ${t.vehicleId} · ${t.hubId}${t.endHubId ? ` → ${t.endHubId}` : ""}`, notes };
  }
  const v = a as AllocationView;
  if (v.kind === "VehicleReservation") return { icon: v.vehicle?.type === "electric motorcycle" ? "motorbike" : "bike", title: `Vehicle · ${v.id}`, sub: `${dayLabel(v.createdAt)} ${hm(v.createdAt)} · ${v.vehicleId} · ${v.hubId}`, notes };
  if (v.kind === "ParkingReservation") {
    if (v.status === "Confirmed") notes.push({ icon: "clock-3", text: `Check in by ${hm(v.window!.start + 15 * MIN)} or the fee is not refunded` });
    return { icon: "square-parking", title: `Parking · ${v.id}`, sub: `${dayLabel(v.window!.start)} ${hm(v.window!.start)}–${hm(v.window!.end)} · ${v.spaceLabel} · ${v.hubId}`, notes };
  }
  if (v.slot && v.originalStart && v.slot.start !== v.originalStart) notes.unshift({ icon: "calendar-clock", text: `Moved ${Math.round((v.slot.start - v.originalStart) / MIN)} min later by the schedule${v.neededBy ? ` · still before ${hm(v.neededBy)}` : ""}` });
  return { icon: "plug-zap", title: `Charging · ${v.id}`, sub: v.slot ? `${dayLabel(v.slot.start)} ${hm(v.slot.start)}–${hm(v.slot.end)} · ${v.slot.pointId}` : `${dayLabel(v.createdAt)} · ${v.hubId}`, notes };
}

export function S11Bookings({ go, home, now }: { go: Go; home: Home | null; now: number }) {
  const { data } = useLive<{ active: Row[]; past: Row[] }>("/student/bookings");
  const [tab, setTab] = useState<"active" | "past">("active");
  const list = (tab === "active" ? data?.active : data?.past) ?? [];
  const vr = home?.reservation && ["Confirmed", "Pickup In Progress"].includes(home.reservation.status) ? home.reservation : null;
  const rows = list.filter((a) => !(vr && a.id === vr.id));
  const open = (a: Row) => go(a.kind === "Trip" ? { s: "S09" } : routeFor(a.id) ?? { s: "bookings" });
  return (
    <>
      <div className="m-hero" style={{ paddingBottom: 18 }}>
        <div className="row between"><div><div className="greet">{home?.student.name} · {home?.student.id}</div><h1>My bookings</h1></div>
          <span className="icon-btn on-dark clickable" onClick={() => go({ s: "notifications" })}><Icon name="bell" />{home?.unread ? <span className="dot" /> : null}</span></div>
        <div className="seg on-dark" style={{ marginTop: 14, width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <span className={`clickable${tab === "active" ? " on" : ""}`} style={{ justifyContent: "center" }} onClick={() => setTab("active")}>Active · {data?.active.length ?? 0}</span>
          <span className={`clickable${tab === "past" ? " on" : ""}`} style={{ justifyContent: "center" }} onClick={() => setTab("past")}>Past · {data?.past.length ?? 0}</span>
        </div>
      </div>
      <div className="content">
        {tab === "active" && vr && (
          <div className="ticket" style={{ padding: "16px 18px" }}>
            <div className="row between"><div className="lbl">Next up · pick up before {hm(vr.expiresAt!)}</div><span className="mono" style={{ color: "var(--volt)", fontSize: 20 }}>{mmss(vr.expiresAt! - now)}</span></div>
            <div className="row" style={{ gap: 12, marginTop: 10 }}><div className="lead" style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(210,255,61,.12)", color: "var(--volt)", display: "grid", placeItems: "center" }}><Icon name="bike" /></div>
              <div className="grow"><b>Vehicle {vr.vehicleId}</b><div style={{ fontSize: 12.5, color: "var(--ink-300)" }}>{vr.id} · {vr.hubId} {vr.hubName} · Dock {vr.vehicle?.dock}</div></div></div>
            <div className="row" style={{ marginTop: 12, gap: 8 }}><button className="btn volt sm grow" onClick={() => go({ s: "S09" })}><Icon name="qr-code" />Scan to pick up</button>
              <button className="btn sm" style={{ background: "rgba(255,255,255,.08)", color: "#fff", borderColor: "rgba(255,255,255,.14)" }} onClick={() => go({ s: "VR", id: vr.id })}><Icon name="ticket" />Details</button></div>
          </div>
        )}
        {rows.length === 0 && !vr && <div className="banner neutral"><span className="ic"><Icon name="ticket" /></span><b>Nothing here yet.</b><p>{tab === "active" ? "Reserve a vehicle, a parking space or a charging slot from a Hub." : "Finished and cancelled bookings appear here."}</p></div>}
        {rows.length > 0 && (
          <div className="card" style={{ overflow: "hidden" }}>
            {rows.map((a) => {
              const info = rowInfo(a);
              const tone = chipTone(a.status);
              return (
                <div key={a.id} className="bk clickable" onClick={() => open(a)}>
                  <div className="lead" style={{ width: 44, height: 44, borderRadius: 13, background: `var(--${tone === "neutral" || tone === "stale" ? "ink-100" : tone + "-bg"})`, color: `var(--${tone === "neutral" || tone === "stale" ? "ink-700" : tone})`, display: "grid", placeItems: "center" }}><Icon name={info.icon} /></div>
                  <div><div className="t">{info.title}</div><div className="s">{info.sub.split(" · ").map((part, i) => <Fragment key={i}>{i ? " · " : ""}<span style={{ whiteSpace: "nowrap" }}>{part}</span></Fragment>)}</div></div>
                  <span className={`chip ${tone}`}>{a.kind === "Trip" && (a as TripView).fareStatus ? `${a.status} · ${(a as TripView).fareStatus}` : a.status}</span>
                  {info.notes.map((n) => <div key={n.text} className="note" style={n.tone ? { background: `var(--${n.tone}-bg)`, color: `var(--${n.tone})` } : undefined}><Icon name={n.icon} />{n.text}</div>)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

interface Notif { id: string; time: number; title: string; body: string; tone: string; ref?: string; read: boolean }
const TONE_ICON: Record<string, [string, string]> = { ok: ["circle-check", "ok"], info: ["bell", "info"], warn: ["triangle-alert", "warn"], danger: ["ban", "danger"], neutral: ["bell", "ink"] };

export function S12Notifications({ go, now }: { go: Go; now: number }) {
  const { data } = useLive<Notif[]>("/student/notifications");
  const list = data ?? [];
  const dayStart = now - ((now + 7 * 3_600_000) % 86_400_000);
  const today = list.filter((n) => n.time >= dayStart);
  const earlier = list.filter((n) => n.time < dayStart);
  const unread = list.filter((n) => !n.read).length;
  const item = (n: Notif) => {
    const [ic, tone] = TONE_ICON[n.tone] ?? TONE_ICON.info;
    const r = routeFor(n.ref);
    return (
      <div key={n.id} className={`notif${n.read ? "" : " unread"}`} onClick={() => { if (!n.read) api("/student/notifications/read", { id: n.id }); }}>
        <div className="lead" style={{ width: 42, height: 42, borderRadius: 13, background: `var(--${tone === "ink" ? "ink-100" : tone + "-bg"})`, color: `var(--${tone === "ink" ? "ink-700" : tone})`, display: "grid", placeItems: "center" }}><Icon name={ic} /></div>
        <div><div className="row between"><span className="t">{n.title}</span><span className="when">{n.time >= dayStart ? hm(n.time) : dayLabel(n.time)}</span></div>
          <p>{n.body}</p>
          {r && <div className="row" style={{ marginTop: 8 }}><a className="small clickable" onClick={() => go(r)}>View {n.ref}</a></div>}</div>
      </div>
    );
  };
  return (
    <>
      <div className="m-hero" style={{ paddingBottom: 18 }}>
        <div className="row between"><div><div className="greet">{unread} new</div><h1>Notifications</h1></div><span className="icon-btn on-dark clickable" onClick={() => go({ s: "S01" })}><Icon name="x" /></span></div>
      </div>
      <div className="content">
        <div className="section-title"><span className="h4">Today</span>{unread > 0 && <a className="small clickable" onClick={() => api("/student/notifications/read", {})}>Mark all read</a>}</div>
        {today.length ? <div className="card" style={{ overflow: "hidden" }}>{today.map(item)}</div> : <p className="small muted">Nothing today.</p>}
        {earlier.length > 0 && <><div className="section-title"><span className="h4">Earlier</span></div><div className="card" style={{ overflow: "hidden" }}>{earlier.map(item)}</div></>}
      </div>
    </>
  );
}
