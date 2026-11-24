// O02 Redistribution orders (UC-10 steps 2, 4-10, 2a, 2b, 2c, 8a, E1-E5).
import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, api, hm, hms, useLive } from "../shared/live";
import type { OpGo } from "./OperatorConsole";

export interface OrderSeed { fromHub: string; toHub: string; quantity: number; model: string; from?: string; draftId?: string; incidentId?: string }
interface Transfer { vehicleId: string; status: string; destHubId: string; destDock: string | null; destDockId: string | null; dockStatus: string | null; redirectedTo: string | null; soc: number | null; vehicleStatus: string | null }
interface Order { id: string; fromHub: string; toHub: string; model: string; quantity: number; deadline: number; status: string; overdue: boolean; team: string | null; source: string; createdAt: number; cancelReason: string | null; arrived: number; transfers: Transfer[]; history: Array<{ time: number; status: string; note?: string }> }
interface Suggestion { fromHub: string; toHub: string; model: string; quantity: number; reason: string; detail: string }
interface Shortfall { ok: boolean; eligible: number; netFreeDocks: number; candidates: Array<{ id: string; soc: number; status: string; eligible: boolean; why?: string }>; checks: Array<{ label: string; ok: boolean; detail: string }>; alternatives: Array<{ hubId: string; name: string; value: number; role: string }>; message: string | null }

const HUBS = ["H01", "H02", "H03", "H04", "H05", "H06", "H07"];
const tone = (s: string) => ({ Draft: "neutral", Assigned: "info", "In Transit": "info", Completed: "ok", "Partially Completed": "warn", Cancelled: "neutral", Arrived: "ok", Removed: "danger", Released: "neutral" } as Record<string, string>)[s] ?? "neutral";
const TABS: Array<[string, string, (o: Order) => boolean]> = [["all", "All", () => true], ["active", "Active", (o) => ["Assigned", "In Transit"].includes(o.status)], ["draft", "Draft", (o) => o.status === "Draft"], ["done", "Done", (o) => ["Completed", "Partially Completed", "Cancelled"].includes(o.status)]];

export function O02Orders({ go, now, seed }: { go: OpGo; now: number; seed?: OrderSeed }) {
  const { data } = useLive<{ orders: Order[]; suggestions: Suggestion[]; refreshedAt: number }>("/operator/orders");
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderSeed | null>(seed ?? null);
  useEffect(() => { if (seed) setDraft(seed); }, [seed]);
  const orders = (data?.orders ?? []).filter(TABS.find((t) => t[0] === tab)![2]).filter((o) => !q || `${o.id} ${o.fromHub} ${o.toHub} ${o.transfers.map((t) => t.vehicleId).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const all = data?.orders ?? [];
  const pick = all.find((o) => o.id === sel) ?? all.find((o) => o.status === "In Transit") ?? all[0];
  const today = all.length;

  return (
    <div className="c-body">
      <div className="page-head">
        <div><h1>Redistribution orders</h1><p className="small subtle">{today} orders today · {all.filter((o) => o.overdue).length} overdue · suggestions refreshed {hms(data?.refreshedAt ?? 0)}</p></div>
        <div className="row" style={{ gap: 10 }}><button className="btn primary" onClick={() => setDraft({ fromHub: "", toHub: "", quantity: 1, model: "e-bike" })}><Icon name="plus" />New order</button></div>
      </div>

      {(data?.suggestions.length ?? 0) > 0 && (
        <section className="card">
          <div className="card-head"><span className="h4"><Icon name="lightbulb" />Rebalancing suggestions (2a)</span><span className="small subtle">From BR-HUB-01 · live state {hm(data!.refreshedAt)}</span></div>
          <div className="list">
            {data!.suggestions.map((s, i) => (
              <div key={i} className="li"><span className="hub-code">{s.fromHub}</span><Icon name="arrow-right" className="ic-sm" /><span className="hub-code">{s.toHub}</span>
                <span className={`chip ${s.reason === "Overloaded" ? "danger" : "warn"}`}>{s.reason}</span>
                <div className="grow"><div className="t">Move {s.quantity} {s.model}s</div><div className="s">{s.detail}</div></div>
                <button className="btn secondary sm" onClick={() => setDraft({ fromHub: s.fromHub, toHub: s.toHub, quantity: s.quantity, model: s.model, from: "suggestion" })}>Use suggestion</button></div>
            ))}
          </div>
        </section>
      )}

      <div className="grid g-12">
        <div className={draft ? "span-7 stack" : "span-12 stack"}>
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head">
              <div className="seg">{TABS.map(([id, l, fn]) => <span key={id} className={`clickable${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{l} {all.filter(fn).length}</span>)}</div>
              <input className="input sm" style={{ width: 200 }} placeholder="Order, Hub or vehicle" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <table className="table">
              <thead><tr><th>Order</th><th>Route</th><th>Vehicles</th><th>Status</th><th>Deadline</th><th>Team</th></tr></thead>
              <tbody>{orders.map((o) => (
                <tr key={o.id} className={`clickable${pick?.id === o.id ? " sel" : ""}`} onClick={() => { setSel(o.id); if (o.status === "Draft") setDraft({ fromHub: o.fromHub, toHub: o.toHub, quantity: o.quantity, model: o.model, draftId: o.id }); }}>
                  <td className="mono strong">{o.id}</td>
                  <td><span className="row" style={{ gap: 6 }}><span className="hub-code">{o.fromHub}</span><Icon name="arrow-right" className="ic-sm" /><span className="hub-code">{o.toHub}</span></span></td>
                  <td className="num">{o.status === "Partially Completed" && o.transfers.length ? `${o.arrived} / ${o.quantity}` : o.quantity}</td>
                  <td><span className={`chip ${tone(o.status)}`}>{o.status}</span>{o.overdue && <span className="chip danger nodot" style={{ marginLeft: 6 }}>Overdue</span>}</td>
                  <td className="mono small">{o.status === "Draft" ? "—" : hm(o.deadline)}</td><td className="small">{o.team ?? "—"}</td>
                </tr>))}
                {orders.length === 0 && <tr><td colSpan={6} className="subtle">No orders.</td></tr>}</tbody>
            </table>
          </section>
          {pick && pick.status !== "Draft" && <Transfers o={pick} now={now} />}
        </div>
        {draft && <NewOrder seed={draft} now={now} go={go} onClose={() => setDraft(null)} onDone={(id) => { setDraft(null); setSel(id); }} />}
      </div>
    </div>
  );
}

function Transfers({ o, now }: { o: Order; now: number }) {
  const [reason, setReason] = useState("");
  const [askCancel, setAskCancel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = ["Assigned", "In Transit"].includes(o.status);
  const run = (url: string, body: unknown = {}) => api(url, body).then(() => { setErr(null); setAskCancel(false); }).catch((e: Error) => setErr(e.message));
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head"><span className="h4"><Icon name="route" />{o.id} · vehicle transfers (2a)</span>
        <span className="row" style={{ gap: 6 }}><span className="hub-code">{o.fromHub}</span><Icon name="arrow-right" className="ic-sm" /><span className="hub-code">{o.toHub}</span><span className={`chip ${tone(o.status)}`}>{o.status}</span></span></div>
      <table className="table">
        <thead><tr><th>Vehicle</th><th>Transfer</th><th>Dock at {o.toHub}</th><th>SoC</th></tr></thead>
        <tbody>{o.transfers.map((t) => (
          <tr key={t.vehicleId}><td className="mono strong">{t.vehicleId}</td><td><span className={`chip ${tone(t.status)}`}>{t.status}</span>{t.redirectedTo && <span className="small subtle"> → {t.redirectedTo}</span>}</td>
            <td className="small">{t.destDock ? <><span className="mono">{t.destDock}</span> · {t.dockStatus}</> : <span className="subtle">released</span>}</td><td className="num small">{t.soc ?? "—"}%</td></tr>))}
          {o.transfers.length === 0 && <tr><td colSpan={4} className="subtle">No transfers recorded.</td></tr>}</tbody>
      </table>
      <div className="card-body stack tight">
        <span className="hint"><Icon name="info" />When no transfer is still "Assigned" or "In Transit", the order becomes "Completed" if every transfer "Arrived", otherwise "Partially Completed" (BR-RED-01).</span>
        {o.overdue && open && <div className="banner danger compact"><span className="ic"><Icon name="alarm-clock" /></span><b>Past its deadline {hm(o.deadline)} (E4).</b><p>Close it to release what never left, or cancel it.</p></div>}
        {o.cancelReason && <div className="banner neutral compact"><span className="ic"><Icon name="ban" /></span><b>Cancelled</b><p>{o.cancelReason}</p></div>}
        {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b></div>}
        {open && !askCancel && <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary sm" onClick={() => run(`/operator/orders/${o.id}/close`)}><Icon name="square-check" />Close order (2b)</button>
          <button className="btn ghost sm" onClick={() => setAskCancel(true)}><Icon name="ban" />Cancel order…</button></div>}
        {askCancel && <div className="row" style={{ gap: 8 }}><input className="input sm grow" placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn danger sm" onClick={() => run(`/operator/orders/${o.id}/cancel`, { reason })}>Cancel order (2c)</button><button className="btn ghost sm" onClick={() => setAskCancel(false)}>Back</button></div>}
        <span className="xs subtle">Created {hms(o.createdAt)} · {o.source}{now > o.deadline && open ? " · overdue" : ""}</span>
      </div>
    </section>
  );
}

function NewOrder({ seed, now, go, onClose, onDone }: { seed: OrderSeed; now: number; go: OpGo; onClose: () => void; onDone: (id: string) => void }) {
  const [d, setD] = useState({ fromHub: seed.fromHub, toHub: seed.toHub, model: seed.model || "e-bike", quantity: seed.quantity || 1, deadlineMin: 60, team: "Team A" });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [v, setV] = useState<Shortfall | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD((x) => ({ ...x, fromHub: seed.fromHub, toHub: seed.toHub, quantity: seed.quantity || 1, model: seed.model || "e-bike" })); setPicked(null); }, [seed]);
  const deadline = Math.ceil((now + d.deadlineMin * 60_000) / 300_000) * 300_000;
  const body = { fromHub: d.fromHub, toHub: d.toHub, model: d.model, quantity: d.quantity, deadline, team: d.team, vehicleIds: picked ?? undefined, draftId: seed.draftId };
  const key = JSON.stringify({ ...body, deadline: 0 });
  useEffect(() => {
    if (!d.fromHub || !d.toHub) { setV(null); return; }
    api<Shortfall>("/operator/orders/validate", body).then((r) => { setV(r); if (!picked) setPicked(null); }).catch((e: Error) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const chosen = picked ?? (v?.candidates.filter((c) => c.eligible).slice(0, d.quantity).map((c) => c.id) ?? []);
  const submit = (choice: "draft" | "commit") => api<{ id: string }>("/operator/orders", { draft: { ...body, vehicleIds: chosen }, choice })
    .then((r) => { if (seed.incidentId) api(`/operator/incidents/${seed.incidentId}/corrective`, { note: `Redistribution order ${r.id} ${d.fromHub} → ${d.toHub}`, orderId: r.id }); onDone(r.id); })
    .catch((e: ApiError) => setErr(e.message));
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <section className="card span-5" style={{ alignSelf: "start" }}>
      <div className="card-head"><span className="h4"><Icon name="truck" />New order{seed.from === "suggestion" ? " · from suggestion" : seed.from === "O01" ? " · from the network monitor" : seed.draftId ? ` · ${seed.draftId}` : ""}</span><span className="chip neutral">Draft</span></div>
      <div className="card-body stack">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="field"><span className="label">Source</span><select className="input" value={d.fromHub} onChange={(e) => { setD({ ...d, fromHub: e.target.value }); setPicked(null); }}><option value="">Choose…</option>{HUBS.map((h) => <option key={h}>{h}</option>)}</select></label>
          <label className="field"><span className="label">Destination</span><select className="input" value={d.toHub} onChange={(e) => setD({ ...d, toHub: e.target.value })}><option value="">Choose…</option>{HUBS.map((h) => <option key={h}>{h}</option>)}</select></label>
          <label className="field"><span className="label">Model</span><select className="input" value={d.model} onChange={(e) => { setD({ ...d, model: e.target.value }); setPicked(null); }}><option>e-bike</option><option>e-motorbike</option></select></label>
          <label className="field"><span className="label">Quantity</span><input className="input" type="number" min={1} value={d.quantity} onChange={(e) => { setD({ ...d, quantity: Number(e.target.value) }); setPicked(null); }} /></label>
          <label className="field"><span className="label">Deadline</span><select className="input" value={d.deadlineMin} onChange={(e) => setD({ ...d, deadlineMin: Number(e.target.value) })}>{[30, 60, 90, 120].map((m) => <option key={m} value={m}>{hm(Math.ceil((now + m * 60_000) / 300_000) * 300_000)} (+{m} min)</option>)}</select></label>
          <label className="field"><span className="label">Team</span><select className="input" value={d.team} onChange={(e) => setD({ ...d, team: e.target.value })}><option>Team A</option><option>Team B</option></select></label>
        </div>
        {v && (
          <>
            <div className="row between"><span className="eyebrow">Vehicles · highest SoC first</span><span className="small subtle">{chosen.length} of {v.eligible} eligible</span></div>
            <div className="card" style={{ boxShadow: "none", overflow: "hidden" }}><div className="list">
              {v.candidates.map((c) => (
                <div key={c.id} className={`li${c.eligible ? " clickable" : ""}`} style={c.eligible ? undefined : { opacity: 0.55 }} onClick={() => c.eligible && toggle(c.id)}>
                  <span className={`check${chosen.includes(c.id) ? " on" : ""}`} style={{ width: 18, height: 18, borderRadius: 5, border: "1.5px solid var(--ink-300)", background: chosen.includes(c.id) ? "var(--brand-600)" : undefined }} />
                  <div className="grow"><div className="t mono">{c.id}</div></div><b className="num small">{c.soc}%</b><span className={`chip ${c.status === "Available" ? "ok" : c.eligible ? "info" : "warn"}`}>{c.eligible ? c.status : c.why ?? c.status}</span></div>))}
              {v.candidates.length === 0 && <div className="li subtle small">No candidate vehicles at {d.fromHub}.</div>}
            </div></div>
            <span className="hint"><Icon name="info" />Charging vehicles qualify only at SoC ≥ 80% (REDISTRIBUTION_MIN_SOC).</span>
            <span className="eyebrow">Checks before confirming</span>
            <div className="stack tight">{v.checks.map((c) => <div key={c.label} className="row between small"><span className="row" style={{ gap: 6 }}><Icon name={c.ok ? "circle-check" : "circle-x"} className="ic-sm" style={{ color: c.ok ? "var(--ok)" : "var(--danger)" }} />{c.label}</span><span className="mono">{c.detail}</span></div>)}</div>
            {v.message && <div className="banner danger compact"><span className="ic"><Icon name="circle-alert" /></span><b>{v.message}</b>
              {v.alternatives.length > 0 && <p>Try {v.alternatives.map((a) => `${a.hubId} (${a.value} ${a.role === "source" ? "eligible" : "free docks"})`).join(", ")}.</p>}
              {v.alternatives.length > 0 && <div className="actions">{v.alternatives.map((a) => <button key={a.hubId} className="btn secondary sm" onClick={() => setD({ ...d, [a.role === "source" ? "fromHub" : "toHub"]: a.hubId })}>Use {a.hubId} as {a.role}</button>)}</div>}</div>}
          </>
        )}
        {err && <div className="banner danger compact"><span className="ic"><Icon name="circle-x" /></span><b>{err}</b></div>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn secondary" disabled={!d.fromHub || !d.toHub} onClick={() => submit("draft")}>Save as Draft</button>
          <button className="btn primary" disabled={!v?.ok || chosen.length !== d.quantity} onClick={() => submit("commit")}><Icon name="check" />Confirm Order</button>
        </div>
        {seed.incidentId && <span className="hint"><Icon name="siren" />The order is recorded under {seed.incidentId} (UC-12 8a). <a className="clickable" onClick={() => go({ nav: "incidents", incidentId: seed.incidentId })}>Back to the incident</a></span>}
      </div>
    </section>
  );
}
