// O01 Network monitor (UC-09 steps 2-9, 4a, 5a, 5b, E1).
import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { CampusMap, MAP_POS, type Pin } from "../shared/CampusMap";
import { ago, api, hms, useLive } from "../shared/live";
import type { OpGo } from "./OperatorConsole";

export interface HubSnap {
  hubId: string; name: string; category: string; status: string; flags: string[]; occupancy: number | null; occupiedDocks: number; docksInService: number;
  vacantDocks: number; allocatedDocks: number; available: number; vehicles: number; lowBattery: number; freeChargers: number; chargers: number; pointsOutOfService: number;
  updatedAt: number; stale: boolean; x: number; y: number; readyOfType?: number;
}
interface Overview { updatedAt: number; hubs: HubSnap[]; reporting: number; kpis: Record<string, number> }
interface HubDetail extends Omit<HubSnap, "vehicles"> {
  docks: Array<{ id: string; label: string; status: string }>; vehicles: Array<{ id: string; status: string; soc: number }>; points: Array<{ id: string; status: string }>;
  nearby: Array<{ hubId: string; name: string; netFreeDocks: number; status: string; km: number }>; acknowledged: string | null; history: number[];
  orderSeed: { fromHub: string; toHub: string; quantity: number; model: string } | null;
}
interface Alert { id: string; time: number; hubId?: string; kind: string; message: string; acknowledgedBy?: string }

export const statusTone = (s: string) => ({ Overloaded: "danger", "Risk of Overload": "warn", Busy: "info", Normal: "ok", Disconnected: "neutral" } as Record<string, string>)[s] ?? "neutral";
const CAT = ["all", "Dormitory", "School", "Metro", "Service"];
const STATUS = ["all", "Normal", "Busy", "Risk of Overload", "Overloaded", "Disconnected"];

export function O01Monitor({ go, now, hubId }: { go: OpGo; now: number; hubId?: string }) {
  const [f, setF] = useState({ category: "all", status: "all", vehicleType: "all", sort: "usage" });
  const qs = new URLSearchParams(f).toString();
  const { data: o } = useLive<Overview>(`/operator/network?${qs}`);
  const { data: all } = useLive<Overview>("/operator/network");
  const { data: alerts } = useLive<Alert[]>("/operator/alerts");
  const [sel, setSel] = useState<string | null>(hubId ?? null);
  useEffect(() => { if (hubId) setSel(hubId); }, [hubId]);
  const hubs = o?.hubs ?? [];
  const pick = sel ?? (all?.hubs.slice().sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1))[0]?.hubId ?? null);
  const { data: d } = useLive<HubDetail>(pick ? `/operator/hub/${pick}` : null);
  const k = all?.kpis;
  const total = all?.hubs.length ?? 7;

  const stale = (all?.hubs ?? []).filter((h) => h.stale);
  const lowBatt = (all?.hubs ?? []).filter((h) => !h.stale && h.flags.includes("Insufficient Fully Charged Vehicles"));
  const openAlerts = (alerts ?? []).filter((a) => !a.acknowledgedBy);
  const alertFor = (h: string, kind: RegExp) => openAlerts.find((a) => a.hubId === h && kind.test(a.kind));

  const pins: Pin[] = (all?.hubs ?? []).map((h) => ({ code: h.hubId, x: MAP_POS[h.hubId]?.[0] ?? h.x, y: MAP_POS[h.hubId]?.[1] ?? h.y, label: h.status, s: statusTone(h.status) as Pin["s"], sel: h.hubId === pick, onClick: () => setSel(h.hubId) }));

  return (
    <div className="c-body">
      <div className="page-head">
        <div><h1>Network monitor</h1>
          <p className="row" style={{ gap: 10 }}><span className="fresh">Updated <span className="mono">{hms(o?.updatedAt ?? 0)}</span> · {ago(now, o?.updatedAt ?? now)}</span><span className="tag param">MONITOR_REFRESH = 5 s</span><span className="small subtle">{o?.reporting ?? "–"} of {total} Hubs reporting</span></p></div>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <Filter label="Category" value={f.category} options={CAT} all="All categories" onChange={(v) => setF({ ...f, category: v })} />
          <Filter label="Status" value={f.status} options={STATUS} all="All statuses" onChange={(v) => setF({ ...f, status: v })} />
          <Filter label="Vehicle type" value={f.vehicleType} options={["all", "e-bike", "e-motorbike"]} all="All vehicles" onChange={(v) => setF({ ...f, vehicleType: v })} />
          <label className="filter"><span>Sort</span><select className="input sm" style={{ width: 160 }} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="usage">Usage, high first</option><option value="code">Hub code</option></select></label>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="bike" /></span>Vehicles ready</div><div className="v">{k?.vehiclesReady ?? "–"} <small>Available</small></div><div className="d">across reporting Hubs</div></div>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="plug-zap" /></span>Charging points free</div><div className="v">{k?.pointsFree ?? "–"} <small>of {k?.pointsTotal ?? "–"}</small></div><div className="d">{k?.pointsOutOfService ?? 0} Out of Service</div></div>
        <div className="kpi"><div className="l"><span className="ic"><Icon name="layout-grid" /></span>Docks in service</div><div className="v">{k?.docksInService ?? "–"}</div><div className="d">{all?.reporting ?? "–"} of {total} Hubs reporting</div></div>
        <div className="kpi" style={k?.hubsOnAlert ? { borderColor: "var(--danger-line)" } : undefined}><div className="l"><span className="ic" style={k?.hubsOnAlert ? { background: "var(--danger-bg)", color: "var(--danger)" } : undefined}><Icon name="triangle-alert" /></span>Hubs on alert</div><div className="v" style={k?.hubsOnAlert ? { color: "var(--danger)" } : undefined}>{k?.hubsOnAlert ?? 0}</div><div className="d"><span className="nw">{k?.overloaded ?? 0} Overloaded ·</span> <span className="nw">{k?.risk ?? 0} Risk ·</span> <span className="nw">{k?.disconnected ?? 0} Disconnected</span></div></div>
        <div className="kpi clickable" onClick={() => go({ nav: "incidents" })}><div className="l"><span className="ic"><Icon name="siren" /></span>Active incidents</div><div className="v">{(k?.incidentsOpen ?? 0) + (k?.incidentsInProgress ?? 0)}</div><div className="d"><span className="nw">{k?.incidentsOpen ?? 0} Open ·</span> <span className="nw">{k?.incidentsInProgress ?? 0} In Progress</span></div></div>
      </div>

      {(stale.length > 0 || lowBatt.length > 0) && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
          {stale.map((h) => (
            <div key={h.hubId} className="banner neutral"><span className="ic"><Icon name="wifi-off" /></span><b>{h.hubId} · {h.name} is Disconnected (E1)</b>
              <p>No data since {hms(h.updatedAt)} (over DATA_STALE_AFTER 60 s). Removed from automatic recommendations; other Hubs keep refreshing.</p>
              <div className="actions"><button className="btn secondary sm" onClick={async () => { const r = await api<{ incidentId: string | null }>("/operator/incidents/from-alert", { resourceId: h.hubId }); go({ nav: "incidents", incidentId: r.incidentId ?? undefined, draftFor: r.incidentId ? undefined : h.hubId }); }}><Icon name="siren" />Open incident</button></div></div>
          ))}
          {lowBatt.map((h) => {
            const a = alertFor(h.hubId, /5b|Insufficient/);
            return (
              <div key={h.hubId} className="banner warn"><span className="ic"><Icon name="battery-low" /></span><b>{h.hubId} · Insufficient Fully Charged Vehicles (5b)</b>
                <p>{h.vehicles ? Math.round((h.lowBattery / h.vehicles) * 100) : 0}% of shared vehicles below 20% SoC ({h.lowBattery} of {h.vehicles}; HUB_LOW_BATTERY_RATIO 50%).</p>
                <div className="actions"><button className="btn secondary sm" onClick={() => go({ nav: "charging", hubId: h.hubId })}><Icon name="plug-zap" />Open charging schedule</button>
                  {a && <button className="btn ghost sm" onClick={() => api("/operator/alerts/ack", { id: a.id })}>Ignore</button>}</div></div>
            );
          })}
        </div>
      )}

      <div className="grid g-12">
        <section className="card span-4 r-stack mon-map" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="card-head"><span className="h4"><Icon name="map" />Hub map</span><span className="small subtle">Schematic · not to scale</span></div>
          <CampusMap pins={pins} style={{ flex: 1, minHeight: 420, margin: "0 16px 16px" }} legend={[["ok", "Normal"], ["info", "Busy"], ["warn", "Risk"], ["danger", "Overloaded"], ["neutral", "Disconnected"]]} />
        </section>
        <section className="card span-8 r-stack" style={{ overflow: "hidden" }}>
          <div className="card-head"><span className="h4"><Icon name="table-2" />Hubs</span><span className="tag"><Icon name="arrow-down-wide-narrow" className="ic-sm" />{f.sort === "usage" ? "Usage, high first" : "Hub code"}</span></div>
          <table className="table">
            <thead><tr><th>Hub</th><th>Dock occupancy (R)</th><th className="r" title="Vehicles with status Available">Ready{f.vehicleType !== "all" ? ` · ${f.vehicleType}` : ""}</th><th>Status · flags</th><th className="r">Last update</th></tr></thead>
            <tbody>
              {hubs.map((h) => (
                <tr key={h.hubId} className={`clickable${h.hubId === pick ? " sel" : ""}${h.stale ? " dim" : ""}`} onClick={() => setSel(h.hubId)}>
                  <td><div className="hubcell"><span className="hub-code" style={h.stale ? { background: "var(--ink-500)", color: "#fff" } : undefined}>{h.hubId}</span><div><b>{h.name}</b><span>{h.category}</span></div></div></td>
                  {h.stale ? <td className="subtle">—</td> : <td style={{ width: 150 }}><div className="row"><div className={`meter ${statusTone(h.status) === "ok" ? "" : statusTone(h.status)} grow`} style={{ ["--v" as string]: `${h.occupancy}%` }}><i /></div><b className="num">{h.occupancy}%</b></div><span className="xs subtle num">{h.occupiedDocks} / {h.docksInService}</span></td>}
                  <td className="r num">{h.stale ? <span className="subtle">—</span> : <b>{h.readyOfType ?? h.available}</b>}</td>
                  <td><div className="flags"><span className={`chip ${statusTone(h.status)}`}>{h.status}</span>
                    {h.stale ? <span className="subtle xs">Flags not evaluated</span> : h.flags.map((x) => <span key={x} className="chip warn nodot flag">{x}</span>)}</div></td>
                  <td className="r">{h.stale ? <span className="chip stale nodot mono">{hms(h.updatedAt)}</span> : <span className="mono small">{hms(h.updatedAt)}</span>}</td>
                </tr>
              ))}
              {hubs.length === 0 && <tr><td colSpan={5} className="subtle">No Hub matches the filters.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      {d && <HubPanel d={d} now={now} go={go} alert={alertFor(d.hubId, /5a|Overload/)} />}
    </div>
  );
}

function Filter({ label, value, options, all, onChange }: { label: string; value: string; options: string[]; all: string; onChange: (v: string) => void }) {
  return (
    <label className="filter"><span>{label}</span>
      <select className="input sm" style={{ width: 140 }} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o === "all" ? all : o}</option>)}
      </select>
    </label>
  );
}

function HubPanel({ d, now, go, alert }: { d: HubDetail; now: number; go: OpGo; alert?: Alert }) {
  const count = (arr: Array<{ status: string }>, s: string) => arr.filter((x) => x.status === s).length;
  const vstat = ["Available", "Reserved", "Waiting for Charge", "Charging", "In Redistribution", "Under Maintenance", "Disconnected"];
  const hot = d.status === "Overloaded" || d.status === "Risk of Overload" || d.flags.length > 0;
  const tone = statusTone(d.status);
  const seed = d.orderSeed ? { fromHub: d.orderSeed.fromHub, toHub: d.orderSeed.toHub, quantity: d.orderSeed.quantity } : d.status === "Overloaded" || d.status === "Risk of Overload"
    ? { fromHub: d.hubId, toHub: d.nearby[0]?.hubId ?? "", quantity: Math.max(1, Math.min(d.nearby[0]?.netFreeDocks ?? 1, Math.ceil(d.occupiedDocks - 0.8 * d.docksInService))) }
    : { fromHub: d.nearby.find((n) => n.hubId !== d.hubId)?.hubId ?? "", toHub: d.hubId, quantity: Math.max(1, Math.ceil(d.docksInService * 0.1) - d.available + 1) };
  return (
    <div className="grid g-12">
      <section className={`card ${hot ? "span-7 r-stack-md" : "span-12"}`}>
        <div className="card-head"><div className="row" style={{ gap: 12 }}><span className="hub-code lg">{d.hubId}</span><div><div className="h3">{d.name}</div><span className="fresh">Updated <span className="mono">{hms(d.updatedAt)}</span> · {ago(now, d.updatedAt)}</span></div></div><span className={`chip ${tone} lg`}>{d.status}</span></div>
        <div className="card-body grid" style={{ gridTemplateColumns: "1fr 1fr 1.2fr", gap: 22 }}>
          <div className="stack tight"><span className="eyebrow">Docks · {d.docksInService} in service</span>
            <dl className="kv"><dt>Occupied</dt><dd className="num">{count(d.docks, "Occupied")}</dd><dt>Vacant</dt><dd className="num">{count(d.docks, "Vacant")}</dd><dt>Allocated</dt><dd className="num">{count(d.docks, "Allocated")}</dd><dt>Out of Service</dt><dd className="num">{count(d.docks, "Out of Service")}</dd></dl></div>
          <div className="stack tight"><span className="eyebrow">Charging points · {d.points.length}</span>
            <dl className="kv"><dt>In Use</dt><dd className="num">{count(d.points, "In Use")}</dd><dt>Available</dt><dd className="num">{count(d.points, "Available")}</dd><dt>Out of Service</dt><dd className="num">{count(d.points, "Out of Service")}</dd><dt>Disconnected</dt><dd className="num">{count(d.points, "Disconnected")}</dd></dl></div>
          <div className="stack tight"><span className="eyebrow">Vehicles · {d.vehicles.length} at the Hub</span>
            {vstat.filter((s) => count(d.vehicles, s) > 0).map((s) => <div key={s} className="row between"><span className={`chip ${s === "Available" ? "ok" : s === "Under Maintenance" ? "danger" : s === "Waiting for Charge" ? "warn" : s === "Disconnected" ? "neutral" : "info"}`}>{s}</span><b className="num">{count(d.vehicles, s)}</b></div>)}</div>
        </div>
        <div className="card-body"><div className="row between" style={{ marginBottom: 8 }}><span className="eyebrow">Dock occupancy · last 2 hours</span><span className="small subtle">{hms(now - 2 * 3_600_000).slice(0, 5)} → {hms(now).slice(0, 5)}</span></div>
          <div className="bars" style={{ height: 90 }}>{d.history.map((v, i) => <i key={i} className={v >= 95 ? "danger" : v >= 85 ? "warn" : v >= 70 ? "info" : ""} style={{ ["--h" as string]: `${Math.max(3, v)}%` }} />)}</div></div>
      </section>
      {hot && (
        <section className="card span-5 r-stack-md" style={{ borderColor: tone === "danger" ? "var(--danger-line)" : "var(--warn-line)" }}>
          <div className="card-head"><span className="h4" style={{ color: `var(--${tone === "danger" ? "danger" : "warn"})` }}><Icon name="octagon-alert" />{d.status === "Overloaded" || d.status === "Risk of Overload" ? "Overload warning (5a)" : "Capacity warning"}</span>{alert && <span className="small subtle">Raised {hms(alert.time).slice(0, 5)}</span>}</div>
          <div className="card-body stack">
            <div className={`banner ${tone === "danger" ? "danger" : "warn"} compact`}><span className="ic"><Icon name="gauge" /></span><b>R = {d.occupancy}% ({d.occupiedDocks} of {d.docksInService} docks){d.flags.length ? ` · ${d.flags.join(" · ")}` : ""}</b>
              <p>{d.flags.includes("Vehicle Shortage") ? `Only ${d.available} vehicle${d.available === 1 ? "" : "s"} Available, below HUB_SHORTAGE_RATIO 10% × ${d.docksInService} docks = ${Math.ceil(d.docksInService * 0.1)}.` : `Thresholds: Busy 70%, Risk 85%, Overloaded 95% (BR-HUB-01).`}</p></div>
            <span className="eyebrow">Nearby Hubs with free capacity</span>
            <div className="card" style={{ boxShadow: "none", overflow: "hidden" }}><div className="list">
              {d.nearby.map((n) => <div key={n.hubId} className="li"><span className="hub-code">{n.hubId}</span><div className="grow"><div className="t">{n.name}</div><div className="s">{n.km} km · {n.netFreeDocks} net free docks</div></div><span className={`chip ${statusTone(n.status)}`}>{n.status}</span></div>)}
            </div></div>
            <button className="btn primary block" onClick={() => go({ nav: "orders", order: { ...seed, model: d.orderSeed?.model ?? "e-bike", from: "O01" } })}><Icon name="truck" />Create Redistribution Order</button>
            <button className="btn secondary block" onClick={() => go({ nav: "sim", hubId: d.hubId })}><Icon name="flask-conical" />Run What-if Simulation</button>
            {d.acknowledged ? <span className="hint"><Icon name="check" />Acknowledged; you will be warned again only if the severity changes.</span>
              : <button className="btn ghost block" onClick={() => api("/operator/alerts/ack", { id: alert?.id ?? d.hubId })}><Icon name="check" />Acknowledge</button>}
          </div>
        </section>
      )}
    </div>
  );
}
