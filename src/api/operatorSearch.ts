// The operator console's header search: "Search Hub, vehicle, order, incident". Not a design
// class; a read-only lookup over the in-memory store that tells the console which screen to open.
import { db } from "../domain/store";

export type SearchKind = "Hub" | "Vehicle" | "Order" | "Incident" | "Charging point" | "Dock" | "Parking space";
export interface SearchHit {
  kind: SearchKind; id: string; title: string; sub: string;
  /** Where the console goes: the screen and the Hub, order or incident to open there. */
  go: { nav: "monitor" | "orders" | "charging" | "incidents"; hubId?: string; orderId?: string; incidentId?: string };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

/** Exact ID first, then IDs that start with the query, then any other match; at most `limit`. */
export function searchOperator(q: string, limit = 8): SearchHit[] {
  const query = norm(q.trim());
  if (query.length < 2) return [];
  const hits: Array<SearchHit & { rank: number }> = [];
  const add = (hit: SearchHit, ...texts: string[]) => {
    const id = norm(hit.id);
    let rank = id === query ? 0 : id.startsWith(query) || id.endsWith(query) ? 1 : texts.some((t) => norm(t).includes(query)) || id.includes(query) ? 2 : -1;
    // Docks and parking spaces carry their Hub's code; keep them below orders and incidents for "H03".
    if (rank > 0 && (hit.kind === "Dock" || hit.kind === "Parking space")) rank += 2;
    if (rank >= 0) hits.push({ ...hit, rank });
  };
  for (const h of db.hubs.values())
    add({ kind: "Hub", id: h.id, title: `${h.id} · ${h.name}`, sub: `${h.category} · ${h.status}`, go: { nav: "monitor", hubId: h.id } }, h.name, h.category);
  for (const v of db.vehicles.values())
    add({ kind: "Vehicle", id: v.id, title: v.id, sub: `${v.model} · ${v.hubId} · ${v.status} · ${Math.round(v.soc)}%`, go: { nav: "monitor", hubId: v.hubId } });
  for (const o of db.orders.values())
    add({ kind: "Order", id: o.id, title: `${o.id} · ${o.fromHub} → ${o.toHub}`, sub: `${o.quantity} ${o.model} · ${o.status}`, go: { nav: "orders", orderId: o.id } }, o.fromHub, o.toHub, ...o.transfers.map((t) => t.vehicleId));
  for (const i of db.incidents.values())
    add({ kind: "Incident", id: i.id, title: `${i.id} · ${i.resourceId}`, sub: `${cap(i.category)} · ${i.status}`, go: { nav: "incidents", incidentId: i.id } }, i.resourceId, i.description);
  for (const p of db.points.values())
    add({ kind: "Charging point", id: p.id, title: p.id, sub: `${p.power} · ${p.status}`, go: { nav: "charging", hubId: p.hubId } });
  for (const d of db.docks.values())
    add({ kind: "Dock", id: d.id, title: `${d.hubId} · ${d.label}`, sub: d.status, go: { nav: "monitor", hubId: d.hubId } }, `${d.hubId} ${d.label}`);
  for (const s of db.spaces.values())
    add({ kind: "Parking space", id: s.id, title: `${s.hubId} · ${s.label}`, sub: s.status, go: { nav: "monitor", hubId: s.hubId } });
  const kindOrder: SearchKind[] = ["Hub", "Incident", "Order", "Vehicle", "Charging point", "Dock", "Parking space"];
  return hits
    .sort((a, b) => a.rank - b.rank || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map(({ rank: _r, ...h }) => h);
}
