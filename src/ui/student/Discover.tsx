// S01 Find a Hub (UC-01 steps 1-5, 3a, 4a, E1) and S02 Hub detail (UC-01 steps 5-6).
import { useState } from "react";
import { Icon } from "../shared/Icon";
import { CampusMap, MAP_POS } from "../shared/CampusMap";
import { ago, hm, hms, useLive, vnd } from "../shared/live";
import type { Go, Home, HubDetail, RosterHub } from "./types";

const CAT_ICON: Record<string, string> = { Dormitory: "building-2", Metro: "train-front", School: "graduation-cap", Service: "landmark" };
const vehIcon = (type: string) => (type === "electric bicycle" || type === "e-bike" ? "bike" : "motorbike");
const socClass = (soc: number) => (soc < 20 ? " low" : soc < 70 ? " mid" : "");

export function Soc({ v, dark }: { v: number; dark?: boolean }) {
  return <span className={`soc${socClass(v)}`} style={{ ["--v" as string]: `${v}%` }}><span className="bar" style={dark ? { borderColor: "var(--ink-400)" } : undefined}><i /></span>{v}%</span>;
}

export function Fresh({ t, now, stale }: { t: number; now: number; stale?: boolean }) {
  return stale
    ? <span className="fresh stale">Last update <span className="mono">{hms(t)}</span> — counts may have changed</span>
    : <span className="fresh">Updated <span className="mono">{hms(t)}</span> · {ago(now, t)}</span>;
}

export function S01HubSearch({ go, now, home }: { go: Go; now: number; home: Home | null }) {
  const [nearMe, setNearMe] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const qs = new URLSearchParams({ nearMe: nearMe ? "1" : "0", ...(text ? { text } : {}), ...(type ? { type } : {}) }).toString();
  const { data } = useLive<{ hubs: RosterHub[]; empty: boolean }>(`/student/search?${qs}`);
  const hubs = data?.hubs ?? [];
  const sorted = nearMe ? [...hubs].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)) : hubs;
  const first = sorted[0];
  const vr = home?.reservation;

  return (
    <>
      <div className="m-hero">
        <div className="row between top">
          <div><div className="greet">Good afternoon, {home?.student.name.split(" ").pop() ?? "Khoa"}</div><h1>Find a Hub</h1></div>
          <div className="hero-actions"><span className="icon-btn on-dark clickable" aria-label="Notifications" onClick={() => go({ s: "notifications" })}><Icon name="bell" />{home?.unread ? <span className="dot" /> : null}</span></div>
        </div>
        <div className="input" style={{ marginTop: 16, border: 0, height: 48 }}>
          <Icon name="search" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search Hub name or code" style={{ border: 0, outline: 0, flex: 1, font: "inherit", background: "transparent" }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ border: 0, font: "inherit", fontSize: 12, background: "transparent", color: "var(--text-2)" }} aria-label="Vehicle type">
            <option value="">Any vehicle</option><option value="electric bicycle">E-bike</option><option value="electric motorcycle">E-motorbike</option>
          </select>
        </div>
        <div className="row between" style={{ marginTop: 14 }}>
          <div className="row clickable" style={{ gap: 10 }} onClick={() => setNearMe(!nearMe)}>
            <span className={`toggle${nearMe ? " on" : ""}`} />
            <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>Use my location</div>
              <div style={{ fontSize: 11.5, color: nearMe ? "var(--volt)" : "var(--ink-300)" }}>{nearMe ? "On · near Thư viện Trung tâm" : "Optional · off"}</div></div>
          </div>
          <span className="seg on-dark">
            <span className={`clickable${view === "list" ? " on" : ""}`} onClick={() => setView("list")}><Icon name="list" className="ic-sm" />List</span>
            <span className={`clickable${view === "map" ? " on" : ""}`} onClick={() => setView("map")}><Icon name="map" className="ic-sm" />Map</span>
          </span>
        </div>
      </div>

      {view === "map" && (
        <CampusMap style={{ height: 380, borderRadius: 0 }} scale={nearMe ? "You are here ●" : undefined}
          pins={sorted.map((h) => ({ code: h.hubId, x: MAP_POS[h.hubId]?.[0] ?? h.x, y: MAP_POS[h.hubId]?.[1] ?? h.y, label: h.distanceKm !== null ? `${h.distanceKm} km` : `${h.available} veh.`, s: h.stale ? "stale" : "ok", sel: h === first && nearMe, onClick: () => go({ s: "S02", hubId: h.hubId }) }))} />
      )}

      <div className="content" style={view === "map" ? { marginTop: -22, position: "relative", zIndex: 2, background: "var(--canvas)", borderRadius: "22px 22px 0 0", boxShadow: "0 -8px 20px -12px rgba(7,13,26,.25)" } : undefined}>
        {home?.blocked && (
          <div className="banner danger compact"><span className="ic"><Icon name="ban" /></span><b>Fare {vnd(home.blocked.fare)} unpaid.</b>
            <p>New reservations and rentals are blocked until it is paid (BR-PAY-04). <a className="clickable" onClick={() => go({ s: "S10" })}>Pay now</a></p></div>
        )}
        {vr && vr.status === "Confirmed" && (
          <div className="banner info compact clickable" onClick={() => go({ s: "VR", id: vr.id })}><span className="ic"><Icon name="ticket" /></span>
            <b>{vr.id} · {vr.vehicleId} reserved at {vr.hubId}</b><p>Pick up before <span className="mono">{hm(vr.expiresAt!)}</span>. Tap to open.</p></div>
        )}
        {vr && vr.status === "Pending Payment" && (
          <div className="banner info compact clickable" onClick={() => go({ s: "VR", id: vr.id })}><span className="ic"><Icon name="loader" /></span><b>{vr.id} waiting for payment</b><p>Tap to open.</p></div>
        )}
        {view === "list" && !nearMe && !text && !type && (
          <div className="banner neutral compact"><span className="ic"><Icon name="navigation-off" /></span><b>Location is optional.</b><p>Without it you see the default campus Hubs, sorted by code.</p></div>
        )}
        <div className="section-title"><span className="h4">{nearMe ? "Hubs near you" : text || type ? "Matching Hubs" : "Default campus Hubs"}</span><span className="small subtle">{hubs.length} Hubs</span></div>
        {data?.empty && (
          <div className="banner neutral"><span className="ic"><Icon name="search-x" /></span><b>No Hub matches.</b><p>Change the name, vehicle type or turn off a filter (UC-01 4a).</p></div>
        )}
        {(view === "map" ? sorted.slice(0, 1) : sorted).map((h) => (
          <article key={h.hubId} className={`hub-card clickable${h.stale ? " is-stale" : ""}`} onClick={() => go({ s: "S02", hubId: h.hubId })} style={view === "map" ? { boxShadow: "var(--e3)" } : undefined}>
            <div className="top">
              <span className="hub-code lg">{h.hubId}</span>
              <div className="grow"><div className="name">{h.name}</div>
                <div className="where">{h.distanceKm !== null ? <><Icon name="navigation" className="ic-sm" />{h.distanceKm} km · {Math.max(1, Math.round(h.distanceKm * 13))} min walk</> : <><Icon name={CAT_ICON[h.category] ?? "map-pin"} className="ic-sm" />{h.category}</>}</div></div>
              {h.stale ? <span className="chip stale">Possibly out of date</span> : <Icon name="chevron-right" style={{ color: "var(--ink-400)" }} />}
            </div>
            <div className="stats">
              <div><div className="v"><Icon name="bike" />{h.available}</div><div className="l">Vehicles available</div></div>
              <div><div className="v"><Icon name="square-parking" />{h.freeParking}</div><div className="l">Free parking</div></div>
              <div><div className="v"><Icon name="plug-zap" />{h.freeChargers}</div><div className="l">Free chargers</div></div>
            </div>
            <div className="foot"><Fresh t={h.updatedAt} now={now} stale={h.stale} /></div>
          </article>
        ))}
        {view === "map" && (
          <div className="row" style={{ gap: 8, overflow: "hidden" }}>
            {sorted.slice(1, 3).map((h) => <span className="tag clickable" key={h.hubId} onClick={() => go({ s: "S02", hubId: h.hubId })}><span className="hub-code" style={{ height: 18, fontSize: 10 }}>{h.hubId}</span>{h.distanceKm !== null ? `${h.distanceKm} km · ` : ""}{h.available} vehicles</span>)}
          </div>
        )}
      </div>
    </>
  );
}

export function S02HubDetail({ go, now, hubId, tab: tab0, home }: { go: Go; now: number; hubId: string; tab?: "vehicles" | "parking" | "charging"; home: Home | null }) {
  const [tab, setTab] = useState(tab0 ?? "vehicles");
  const { data: h } = useLive<HubDetail>(`/student/hub/${hubId}`);
  if (!h) return <div className="content"><span className="spinner" /></div>;
  const firstAvail = h.vehicles.find((v) => v.reservable)?.vehicleId;
  const tabs = (
    <div className="tabs">
      <span className={`clickable${tab === "vehicles" ? " on" : ""}`} onClick={() => setTab("vehicles")}><Icon name="bike" className="ic-sm" />Vehicles <span className="count">{h.vehicles.length}</span></span>
      <span className={`clickable${tab === "parking" ? " on" : ""}`} onClick={() => setTab("parking")}><Icon name="square-parking" className="ic-sm" />Parking</span>
      <span className={`clickable${tab === "charging" ? " on" : ""}`} onClick={() => setTab("charging")}><Icon name="plug-zap" className="ic-sm" />Charging</span>
    </div>
  );
  const blocked = !!home?.blocked;
  const mine = home?.reservation?.vehicleId;
  return (
    <>
      <div className="m-hero" style={{ paddingBottom: 20 }}>
        <div className="row between"><span className="icon-btn on-dark clickable" onClick={() => go({ s: "S01" })}><Icon name="chevron-left" /></span><span className="icon-btn on-dark"><Icon name="star" /></span></div>
        <div className="row" style={{ marginTop: 14, gap: 12 }}><span className="hub-code lg">{h.hubId}</span>
          {h.stale ? <span className="chip stale">Possibly out of date · {hms(h.updatedAt)}</span> : <span className="fresh" style={{ color: "var(--ink-300)" }}>Updated <span className="mono" style={{ color: "var(--ink-200)" }}>{hms(h.updatedAt)}</span> · {ago(now, h.updatedAt)}</span>}</div>
        <h1 style={{ marginTop: 8 }}>{h.name}</h1>
        <div style={{ fontSize: 12.5, color: "var(--ink-300)", marginTop: 2 }}>{h.category} · Open {h.openHours}</div>
        <div className="metrics" style={{ marginTop: 16 }}>
          <div className="metric on-dark"><div className="v">{h.available}</div><div className="l"><Icon name="bike" />Vehicles</div></div>
          <div className="metric on-dark"><div className="v">{h.freeParking}</div><div className="l"><Icon name="square-parking" />Parking</div></div>
          <div className="metric on-dark"><div className="v">{h.freeChargers}</div><div className="l"><Icon name="plug-zap" />Chargers</div></div>
        </div>
      </div>
      <div className="content">
        {tabs}
        {h.stale && <div className="banner stale compact"><span className="ic"><Icon name="wifi-off" /></span><b>{h.hubId} has sent no data since {hms(h.updatedAt)}.</b><p>Its vehicles show as "Disconnected" and can't be reserved until it reports again (UC-01 E1).</p></div>}
        {blocked && tab === "vehicles" && <div className="banner danger compact"><span className="ic"><Icon name="ban" /></span><b>Reservations are blocked.</b><p>Pay the outstanding fare first (BR-PAY-04).</p></div>}
        {tab === "vehicles" && (
          <>
            <div className="row between"><span className="small strong">Shared vehicles</span><span className="fresh">Updated <span className="mono">{hms(h.updatedAt)}</span></span></div>
            <div className="card" style={{ overflow: "hidden" }}>
              {h.vehicles.map((v) => (
                <div key={v.vehicleId} className={`veh${v.reservable ? "" : " unavail"}`}>
                  <div className={`pic${v.reservable ? " ok" : ""}`}><Icon name={vehIcon(v.type)} /></div>
                  <div className="grow"><div className="id">{v.vehicleId}</div><div className="meta">{v.model} · <Soc v={v.soc} /></div><div className="meta">{v.vehicleId === mine ? "Reserved by you" : v.why ?? `${v.ratePerHour.toLocaleString("en-US")} VND/h`}</div></div>
                  {v.reservable
                    ? <div className="stack tight" style={{ alignItems: "flex-end" }}><span className="chip ok">Available</span><button className={`btn ${v.vehicleId === firstAvail ? "primary" : "tonal"} xs`} disabled={blocked || !!mine} onClick={() => go({ s: "S03", vehicleId: v.vehicleId })}>Reserve</button></div>
                    : <span className={`chip ${chipTone(v.status)}`}>{v.status}</span>}
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "parking" && (
          <section className="card">
            <div className="card-head"><span className="h4"><Icon name="square-parking" />Parking · private EV</span><span className="fresh">Updated <span className="mono">{hms(h.updatedAt)}</span></span></div>
            <div className="card-body stack">
              {h.parking.map((p) => (
                <div className="stack tight" key={p.type}>
                  <div className="row between"><span className="row" style={{ gap: 6 }}><Icon name={vehIcon(p.type)} className="ic-sm" /><b>{p.type === "electric bicycle" ? "E-bike" : "E-motorbike"} spaces</b></span><span className="num"><b>{p.free}</b> <span className="muted">of {p.total} free</span></span></div>
                  <div className="meter" style={{ ["--v" as string]: `${Math.round((p.free / Math.max(1, p.total)) * 100)}%` }}><i /></div>
                </div>
              ))}
              <button className="btn primary block" onClick={() => go({ s: "S05", hubId: h.hubId })}><Icon name="calendar-plus" />Reserve parking</button>
            </div>
          </section>
        )}
        {(tab === "parking" || tab === "charging") && (
          <section className="card">
            <div className="card-head"><span className="h4"><Icon name="plug-zap" />Charging points</span><span className="fresh">Updated <span className="mono">{hms(h.updatedAt)}</span></span></div>
            <div className="list">
              {h.points.map((p) => (
                <div key={p.pointId} className={`li${p.status === "Out of Service" ? " dim" : ""}`}>
                  <div className={`lead ${p.status === "In Use" ? "info" : p.status === "Out of Service" ? "danger" : "brand"}`}><Icon name={p.status === "In Use" ? "battery-charging" : p.status === "Out of Service" ? "plug" : "plug-zap"} /></div>
                  <div className="grow"><div className="t mono">{p.pointId}</div><div className="s">{p.power}{p.busyUntil ? ` · busy until ${hm(p.busyUntil)}` : ""}{p.status === "Out of Service" ? " · reported faulty" : ""}</div></div>
                  <span className={`chip ${p.status === "Available" ? "ok" : p.status === "In Use" ? "info" : p.status === "Out of Service" ? "danger" : "neutral"}`}>{p.status}</span>
                </div>
              ))}
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}><button className={`btn ${tab === "charging" ? "primary" : "secondary"} block`} onClick={() => go({ s: "S06", hubId: h.hubId })}><Icon name="calendar-clock" />Schedule charging</button></div>
          </section>
        )}
      </div>
    </>
  );
}

export function chipTone(status: string): string {
  switch (status) {
    case "Available": case "Confirmed": case "Paid": case "Fulfilled": case "Completed": case "Checked-in": case "Resolved": return "ok";
    case "Reserved": case "Held": case "In Use": case "Pending Payment": case "Pickup In Progress": case "Scheduled": case "Charging": case "Open": case "In Progress": return "info";
    case "Waiting for Charge": case "Unpaid": case "Expired": case "Interrupted": case "Queued": return "warn";
    case "Under Maintenance": case "Payment Failed": case "Cancelled by System": case "Out of Service": return "danger";
    case "Disconnected": return "stale";
    default: return "neutral";
  }
}
