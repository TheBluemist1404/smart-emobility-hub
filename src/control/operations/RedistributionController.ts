// control.operations — RedistributionController (control method descriptions 3.2), UC-10.
// Also a StatusListener for the transfer reports (departed / arrived / breakdown, UC-10 2a, E5).
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock, fmtHM, fmtTime, MINUTE } from "../../platform/clock/DemoClock";
import { Hub } from "../../domain/network/Hub";
import { Vehicle } from "../../domain/network/Vehicle";
import { Dock } from "../../domain/network/Dock";
import { excessOver, planOutflow, safeRoom, type DestinationState } from "../../domain/operations/OutflowPlan";
import { RedistributionOrder } from "../../domain/operations/RedistributionOrder";
import { VehicleTransfer } from "../../domain/operations/VehicleTransfer";
import { Incident } from "../../domain/operations/Incident";
import { ChargingSession } from "../../domain/allocation/ChargingSession";
import { OperatorConsole } from "../../api/push";
import { UserError } from "../../api/errors";
import { bus } from "../../platform/events/bus";
import type { IoTEvent, StatusListener } from "../../gateway/iot/StatusListener";

export interface OrderDraft { fromHub: string; toHub: string; model: string; quantity: number; deadline: number; vehicleIds?: string[]; team?: string; draftId?: string }
export interface Shortfall {
  ok: boolean; eligible: number; netFreeDocks: number; candidates: Array<{ id: string; soc: number; status: string; eligible: boolean; why?: string }>;
  checks: Array<{ label: string; ok: boolean; detail: string }>; alternatives: Array<{ hubId: string; name: string; value: number; role: "source" | "destination" }>; message: string | null;
}
export interface Suggestion {
  fromHub: string; toHub: string; model: string; quantity: number; reason: string; detail: string;
  /** Set for an overload plan: one source split over several destinations (nearest first). */
  plan?: { sourceHub: string; excess: number; leg: number; legs: number; placed: number; left: number; km: number; room: number; shared: number; ceilingPct: number; note: string | null };
}

const OPERATOR = "OP-014";

export class RedistributionController implements StatusListener {
  /** listOrders() : RedistributionOrder[*] — UC-10 step 2 with the rebalancing suggestions. */
  listOrders() {
    this.checkOverdue();
    const orders = [...db.orders.values()].sort((a, b) => b.createdAt - a.createdAt).map((o) => this.view(o));
    return { orders, suggestions: this.suggestions(), refreshedAt: clock().now() };
  }

  view(o: RedistributionOrder) {
    return {
      id: o.id, fromHub: o.fromHub, toHub: o.toHub, model: o.model, quantity: o.quantity, deadline: o.deadline, status: o.status,
      overdue: o.isOpen() && (o.overdue || o.isOverdue()), team: (o as unknown as { team?: string }).team ?? null, source: o.source, createdAt: o.createdAt, cancelReason: o.cancelReason,
      arrived: o.transfers.filter((t) => t.status === "Arrived").length, history: o.history,
      transfers: o.transfers.map((t) => {
        const v = db.vehicles.get(t.vehicleId);
        const d = t.destDockId ? db.docks.get(t.destDockId) : null;
        return { vehicleId: t.vehicleId, status: t.status, destHubId: t.destHubId, destDock: d?.label ?? null, destDockId: t.destDockId, dockStatus: d?.status ?? null, redirectedTo: t.redirectedTo, soc: v ? Math.round(v.soc) : null, vehicleStatus: v?.status ?? null };
      }),
    };
  }

  /** The pre-filled order for UC-09 5a "Create Redistribution Order" on one Hub, from the same rules. */
  orderSeedFor(hubId: string): Suggestion | null {
    return this.orderPlanFor(hubId)[0] ?? null;
  }

  /** Every suggestion that moves vehicles out of or into one Hub (the whole multi-destination plan). */
  orderPlanFor(hubId: string): Suggestion[] {
    return this.suggestions(Infinity).filter((s) => s.fromHub === hubId || s.toHub === hubId);
  }

  /**
   * BR-HUB-01 driven suggestions. An overloaded (or at-risk) Hub sends its excess over the safe
   * ceiling (HUB_BUSY) to several nearby Hubs, nearest first, each filled up to that ceiling
   * (planOutflow). A Hub short of vehicles pulls from the Hub with the most eligible vehicles.
   */
  private suggestions(limit = 8): Suggestion[] {
    const live = Hub.getLatestStatus().filter((h) => !h.stale);
    const out: Suggestion[] = [];
    const busy = (id: string) => [...db.orders.values()].some((o) => o.isOpen() && (o.fromHub === id || o.toHub === id) && o.status !== "Draft");
    const ceilingPct = config().value("HUB_BUSY");
    const dests: DestinationState[] = live.map((x) => ({ hubId: x.hubId, x: x.x, y: x.y, docksInService: x.docksInService, occupiedDocks: x.occupiedDocks, vacantDocks: x.vacantDocks, allocatedDocks: x.allocatedDocks }));
    const used = new Map<string, number>();
    // The fullest Hub plans first.
    for (const h of live.filter((x) => x.status === "Overloaded" || x.status === "Risk of Overload").sort((a, b) => (b.occupancy ?? 0) - (a.occupancy ?? 0))) {
      const hub = db.hubs.get(h.hubId)!;
      // Vehicles already assigned to leave (not departed yet) still sit in their docks.
      const leaving = [...db.orders.values()].filter((o) => o.isOpen() && o.fromHub === h.hubId).reduce((n, o) => n + o.transfers.filter((t) => t.status === "Assigned").length, 0);
      const excess = Math.max(0, excessOver(h, ceilingPct) - leaving);
      if (excess <= 0) continue;
      const byModel = (["e-bike", "e-motorbike"] as const).map((m) => ({ m, n: Vehicle.countEligible(hub, m) }));
      const eligible = byModel.reduce((a, b) => a + b.n, 0);
      // Room is shared between plans: what one overloaded Hub's plan takes, the next one can't use.
      const usedBefore = new Map(used);
      const plan = planOutflow(h, Math.min(excess, eligible), dests.filter((d) => d.hubId !== h.hubId), ceilingPct, (d) => Math.max(0, safeRoom(d, ceilingPct) - (used.get(d.hubId) ?? 0)));
      for (const l of plan.legs) used.set(l.toHub, (used.get(l.toHub) ?? 0) + l.quantity);
      const left = excess - plan.placed;
      const why = left <= 0 ? null : eligible < excess
        ? `${left} more can't move now: only ${eligible} eligible vehicle${eligible === 1 ? "" : "s"} at ${h.hubId} (the rest are reserved, charging below REDISTRIBUTION_MIN_SOC or waiting for charge).`
        : `${left} more can't move now: no other Hub has room below ${ceilingPct}%.`;
      // Split each leg by model, e-bikes first.
      const stock = byModel.map((x) => ({ ...x }));
      const legs: Array<{ toHub: string; model: string; quantity: number; km: number; room: number; shared: number }> = [];
      for (const l of plan.legs) {
        let q = l.quantity;
        for (const st of stock) { const take = Math.min(q, st.n); if (take > 0) { legs.push({ toHub: l.toHub, model: st.m, quantity: take, km: l.km, room: l.room, shared: usedBefore.get(l.toHub) ?? 0 }); st.n -= take; q -= take; } }
      }
      legs.forEach((l, i) => out.push({
        fromHub: h.hubId, toHub: l.toHub, model: l.model, quantity: l.quantity, reason: h.status,
        detail: `${h.hubId} at ${h.occupancy}% · ${excess} over the ${ceilingPct}% ceiling · leg ${i + 1} of ${legs.length}: ${l.toHub} (${l.km} km) can take ${l.room} before reaching ${ceilingPct}%${l.shared ? ` (${l.shared} more of its room is planned for a fuller Hub)` : ""}`,
        plan: { sourceHub: h.hubId, excess, leg: i + 1, legs: legs.length, placed: plan.placed, left, km: l.km, room: l.room, shared: l.shared, ceilingPct, note: why },
      }));
    }
    for (const h of live.filter((x) => x.flags.includes("Vehicle Shortage") && x.status !== "Overloaded" && x.status !== "Risk of Overload")) {
      if (busy(h.hubId)) continue;
      const src = live.filter((x) => x.hubId !== h.hubId && !x.flags.includes("Vehicle Shortage")).map((x) => ({ x, n: Vehicle.countEligible(db.hubs.get(x.hubId)!, "e-bike") })).sort((a, b) => b.n - a.n)[0];
      if (!src || src.n < 2) continue;
      const need = Math.max(1, Math.ceil(config().value("HUB_SHORTAGE_RATIO") / 100 * h.docksInService) - h.available + 1);
      const room = Math.max(0, safeRoom(h, ceilingPct) - (used.get(h.hubId) ?? 0));
      out.push({ fromHub: src.x.hubId, toHub: h.hubId, model: "e-bike", quantity: Math.min(need, src.n, room), reason: "Vehicle Shortage", detail: `${h.hubId} has ${h.available} Available, below ${config().value("HUB_SHORTAGE_RATIO")}% of ${h.docksInService} docks` });
    }
    return out.filter((s) => s.quantity > 0).slice(0, limit);
  }

  /** validateOrder(draft : OrderDraft) : Shortfall — UC-10 step 6, E1, E2. */
  validateOrder(d: OrderDraft): Shortfall {
    const src = db.hubs.get(d.fromHub), dst = db.hubs.get(d.toHub);
    if (!src || !dst) throw new UserError("Choose the source and destination Hubs.", 422);
    const checks: Shortfall["checks"] = [];
    const all = [...db.vehicles.values()].filter((v) => v.hubId === src.id && v.usage !== "In Use" && (d.model === "any" || v.model === d.model))
      .sort((a, b) => b.soc - a.soc);
    const minSoc = config().value("REDISTRIBUTION_MIN_SOC");
    const candidates = all.map((v) => ({
      id: v.id, soc: Math.round(v.soc), status: v.status, eligible: v.isEligibleForOrder(),
      why: v.isEligibleForOrder() ? undefined : v.energy === "Charging" ? `below ${minSoc}%` : v.usage !== "Idle" ? v.usage : v.status,
    })).filter((c) => c.eligible || ["Charging", "Waiting for Charge"].includes(c.status)).slice(0, 8);
    const eligible = Vehicle.countEligible(src, d.model);
    const netFree = dst.netFreeDocks();
    const q = Math.max(0, Math.floor(d.quantity || 0));
    checks.push({ label: "Source and destination differ", ok: src.id !== dst.id, detail: src.id === dst.id ? "Same Hub" : "OK" });
    checks.push({ label: "Eligible vehicles at source", ok: eligible >= q, detail: `${eligible} eligible · ${q} needed` });
    checks.push({ label: "Destination net free docks", ok: netFree >= q, detail: `${netFree} free · ${q} needed` });
    const picked = d.vehicleIds ?? [];
    const bad = picked.filter((id) => !db.vehicles.get(id)?.isEligibleForOrder());
    checks.push({ label: "No vehicle reserved or in a trip", ok: bad.length === 0, detail: bad.length ? bad.join(", ") : "OK" });
    checks.push({ label: "Both Hubs reporting", ok: !src.isStale() && !dst.isStale(), detail: `${fmtTime(src.lastUpdateTime)} · ${fmtTime(dst.lastUpdateTime)}` });
    checks.push({ label: "Deadline in the future", ok: d.deadline > clock().now(), detail: fmtHM(d.deadline) });
    const alternatives: Shortfall["alternatives"] = [];
    if (eligible < q && src.id !== dst.id) for (const h of db.hubs.values()) if (h.id !== src.id && h.id !== dst.id && !h.isStale()) { const n = Vehicle.countEligible(h, d.model); if (n >= q) alternatives.push({ hubId: h.id, name: h.name, value: n, role: "source" }); }
    if (netFree < q && src.id !== dst.id) for (const h of db.hubs.values()) if (h.id !== src.id && h.id !== dst.id && !h.isStale()) { const n = h.netFreeDocks(); if (n >= q) alternatives.push({ hubId: h.id, name: h.name, value: n, role: "destination" }); }
    const failed = checks.find((c) => !c.ok);
    let message: string | null = null;
    if (src.id === dst.id) message = "The source and destination must be different Hubs.";
    else if (q < 1) message = "Quantity must be at least 1.";
    else if (src.isStale() || dst.isStale()) message = `${src.isStale() ? src.id : dst.id} is Disconnected and can't be a source or destination (E1).`;
    else if (eligible < q) message = `Only ${eligible} eligible ${d.model} at ${src.id}; ${q} requested (E1).`;
    else if (netFree < q) message = `${dst.id} has only ${netFree} net free docks; ${q} requested (E2).`;
    else if (failed) message = `${failed.label}: ${failed.detail}`;
    return { ok: !message, eligible, netFreeDocks: netFree, candidates, checks, alternatives: alternatives.sort((a, b) => b.value - a.value).slice(0, 3), message };
  }

  /** submitOrder(draft : OrderDraft, choice : SubmitChoice) : String — UC-10 step 9, 8a. */
  submitOrder(d: OrderDraft, choice: "draft" | "commit", operatorId = OPERATOR): string {
    if (choice === "draft") {
      const existing = d.draftId ? db.orders.get(d.draftId) : null;
      if (existing && existing.status === "Draft") db.orders.delete(existing.id);
      const o = new RedistributionOrder(existing?.id ?? this.nextOrderId(), d.fromHub, d.toHub, d.model, d.quantity, d.deadline, operatorId, "manual");
      (o as unknown as { team?: string; picked?: string[] }).team = d.team;
      (o as unknown as { picked?: string[] }).picked = d.vehicleIds;
      db.orders.set(o.id, o);
      audit(operatorId, "UC-10 order saved as Draft", o.id);
      bus.changed("order");
      return o.id;
    }
    const o = this.commitOrder(d, operatorId, "manual");
    return o.id;
  }

  /** createAssignedOrder(src, dest, vehicles) : String — UC-14 step 7; same validation as a manual order. */
  createAssignedOrder(src: string, dest: string, vehicleIds: string[], operatorId = OPERATOR, model = "e-bike", quantity?: number, deadline?: number): string {
    return this.commitOrder({ fromHub: src, toHub: dest, model, quantity: quantity ?? vehicleIds.length, deadline: deadline ?? clock().now() + 60 * MINUTE, vehicleIds }, operatorId, "simulation").id;
  }

  /**
   * - commitOrder(draft : OrderDraft) : RedistributionOrder — the indivisible step 10. Every check
   * runs first; only when all pass is anything changed (E3: all or nothing).
   */
  private commitOrder(d: OrderDraft, operatorId: string, source: RedistributionOrder["source"]): RedistributionOrder {
    const v = this.validateOrder(d);
    if (!v.ok) throw new UserError(v.message ?? "The order failed its checks.", 409, "E3");
    const src = db.hubs.get(d.fromHub)!, dst = db.hubs.get(d.toHub)!;
    let picked = (d.vehicleIds ?? []).filter((id) => db.vehicles.get(id)?.revalidate());
    if (d.vehicleIds?.length && picked.length < d.vehicleIds.length) throw new UserError(`${d.vehicleIds.filter((x) => !picked.includes(x)).join(", ")} is no longer eligible. Review the vehicles (E3).`, 409, "E3");
    if (picked.length < d.quantity) picked = [...picked, ...Vehicle.recommendCandidates(src, d.model).map((x) => x.id).filter((id) => !picked.includes(id))].slice(0, d.quantity);
    picked = picked.slice(0, d.quantity);
    if (picked.length < d.quantity || dst.netFreeDocks() < d.quantity) throw new UserError("Vehicles or docks changed while you were confirming (E3). Nothing was saved.", 409, "E3");
    // From here on nothing can fail.
    const old = d.draftId ? db.orders.get(d.draftId) : null;
    if (old && old.status === "Draft") db.orders.delete(old.id);
    const o = new RedistributionOrder(old?.id ?? this.nextOrderId(), src.id, dst.id, d.model, d.quantity, d.deadline, operatorId, source);
    (o as unknown as { team?: string }).team = d.team ?? "Team A";
    const docks = dst.allocateDocks(d.quantity, o.id);
    picked.forEach((id, i) => {
      const veh = db.vehicles.get(id)!;
      const dock = docks[i];
      o.transfers.push(new VehicleTransfer(o.id, id, dst.id, dock.id));
      const cs = [...db.allocations.values()].find((a): a is ChargingSession => a instanceof ChargingSession && a.vehicleRef === id && a.status === "Charging");
      if (cs) cs.complete();
      veh.dispatchTransfer(o.id);
    });
    o.setStatus("Assigned");
    db.orders.set(o.id, o);
    audit(operatorId, "UC-10 order committed", o.id, "", `${src.id}→${dst.id} ${picked.join(",")}`);
    this.armDeadline(o);
    bus.changed("order");
    return o;
  }

  /** closeOrder(orderId : String) : void — UC-10 2b: release what never departed; Partially Completed. */
  closeOrder(orderId: string, operatorId = OPERATOR): void {
    const o = this.mustGet(orderId);
    if (!o.isOpen()) throw new UserError(`${o.id} is ${o.status}.`, 409);
    if (o.transfers.some((t) => t.status === "In Transit")) throw new UserError(`${o.id} still has vehicles in transit. Wait for them, or cancel the order to redirect them (2c).`, 409);
    for (const t of o.transfers.filter((x) => x.status === "Assigned")) this.releaseTransfer(t);
    o.setStatus(o.aggregate(), "closed by the operator");
    audit(operatorId, "UC-10 order closed", o.id, "", o.status);
    bus.changed("order");
  }

  /** cancelOrder(orderId : String, reason : String) : void — UC-10 2c. No vehicle is stranded. */
  cancelOrder(orderId: string, reason: string, operatorId = OPERATOR): void {
    const o = this.mustGet(orderId);
    if (!reason.trim()) throw new UserError("Give a reason for the cancellation.", 422);
    if (o.status === "Draft") { db.orders.delete(o.id); bus.changed("order"); return; }
    if (!o.isOpen()) throw new UserError(`${o.id} is ${o.status}.`, 409);
    for (const t of o.transfers) {
      if (t.status === "Assigned") this.releaseTransfer(t);
      else if (t.status === "In Transit") {
        const dest = db.hubs.get(t.destHubId)!;
        if (dest.isStale() || !t.destDockId) {
          const alt = [...db.hubs.values()].filter((h) => !h.isStale() && h.netFreeDocks() > 0).sort((a, b) => b.netFreeDocks() - a.netFreeDocks())[0];
          const dock = alt ? Dock.findVacant(alt).find((x) => !x.allocatedTo) : null;
          if (alt && dock) { if (t.destDockId) this.freeDock(t.destDockId); dock.allocatedTo = o.id; dock.reevaluate(); t.redirect(alt, dock.id); }
        }
      }
    }
    o.cancelReason = reason;
    o.setStatus("Cancelled", reason);
    audit(operatorId, "UC-10 order cancelled", o.id, "", reason);
    bus.changed("order");
  }

  /** departed(vehicleId : String) : void — UC-10 2a. */
  departed(vehicleId: string): void {
    const { o, t } = this.findTransfer(vehicleId);
    if (!o || !t || t.status !== "Assigned") return;
    const v = db.vehicles.get(vehicleId)!;
    if (v.dockId) { const d = db.docks.get(v.dockId); if (d) { d.latched = false; d.vehicleId = null; d.reevaluate(); } v.dockId = null; }
    t.setStatus("In Transit");
    if (o.status === "Assigned") o.setStatus("In Transit", `${vehicleId} left ${o.fromHub}`);
    bus.changed("order");
  }

  /** arrived(vehicleId : String, dockId : String) : void — UC-10 2a. */
  arrived(vehicleId: string, dockId?: string): void {
    const { o, t } = this.findTransfer(vehicleId);
    if (!o || !t || !["In Transit", "Assigned"].includes(t.status)) return;
    if (t.status === "Assigned") this.departed(vehicleId);
    const v = db.vehicles.get(vehicleId)!;
    const d = db.docks.get(dockId ?? t.destDockId ?? "") ?? (t.destDockId ? db.docks.get(t.destDockId) : undefined);
    if (d) {
      d.allocatedTo = null; d.latched = true; d.vehicleId = v.id; d.reevaluate();
      v.dockId = d.id; v.hubId = d.hubId;
    }
    t.setStatus("Arrived");
    v.lastUpdateTime = clock().now();
    v.releaseFromOrder();
    this.aggregate(o);
    bus.changed("order");
  }

  /** breakdown(vehicleId : String) : void — UC-10 E5: transfer Removed, dock released, vehicle to UC-12. */
  breakdown(vehicleId: string): void {
    const { o, t } = this.findTransfer(vehicleId);
    if (!o || !t || !["In Transit", "Assigned"].includes(t.status)) return;
    const v = db.vehicles.get(vehicleId)!;
    t.setStatus("Removed");
    if (t.destDockId) this.freeDock(t.destDockId);
    v.orderId = null; v.usage = "Idle"; v.dockId = null;
    const inc = Incident.findOrOpen(v, "vehicle failure", `Broke down in transit on ${o.id}.`, "system");
    v.reevaluate();
    OperatorConsole.warn(`${vehicleId} broke down in transit on ${o.id} (E5). Transfer removed; ${inc.id} opened.`, o.toHub, "Transfer breakdown (E5)");
    this.aggregate(o);
    bus.changed("order");
  }

  /** - checkOverdue() : void — UC-10 E4: a prompt, never an automatic close. */
  checkOverdue(): void {
    for (const o of db.orders.values()) if (o.isOverdue() && !o.overdue) {
      o.flagOverdue();
      OperatorConsole.warn(`${o.id} ${o.fromHub} → ${o.toHub} passed its deadline ${fmtHM(o.deadline)} (E4). Close or cancel it.`, o.toHub, "Order overdue (E4)");
    }
  }

  private armDeadline(o: RedistributionOrder): void {
    clock().at(o.deadline + 1000, `order deadline ${o.id}`, () => this.checkOverdue());
  }

  armSeeded(): void {
    for (const o of db.orders.values()) if (o.isOpen() && !o.overdue) this.armDeadline(o);
  }

  onIoTEvent(e: IoTEvent): void {
    if (e.type === "departed") this.departed(e.vehicleId);
    else if (e.type === "arrived") this.arrived(e.vehicleId, e.dockId);
    else if (e.type === "breakdown") this.breakdown(e.vehicleId);
  }

  // ---- helpers ------------------------------------------------------------------------

  /** BR-RED-01: once nothing is Assigned or In Transit, Completed if all Arrived, else Partially Completed. */
  private aggregate(o: RedistributionOrder): void {
    if (o.status === "Cancelled") { if (o.transfers.every((t) => !["Assigned", "In Transit"].includes(t.status))) o.history.push({ time: clock().now(), status: "Cancelled", note: "redirected transfers done" }); return; }
    if (o.transfers.some((t) => ["Assigned", "In Transit"].includes(t.status))) return;
    o.setStatus(o.aggregate());
    for (const inc of db.incidents.values()) if (inc.orders.some((x) => x.orderId === o.id)) inc.recordOrder(o.id, o.status);
  }

  private releaseTransfer(t: VehicleTransfer): void {
    t.setStatus("Released");
    if (t.destDockId) this.freeDock(t.destDockId);
    db.vehicles.get(t.vehicleId)?.releaseFromOrder();
  }

  private freeDock(dockId: string): void {
    const d = db.docks.get(dockId);
    if (d) { d.allocatedTo = null; d.reevaluate(); }
  }

  private findTransfer(vehicleId: string): { o: RedistributionOrder | null; t: VehicleTransfer | null } {
    for (const o of db.orders.values()) {
      if (o.status === "Draft") continue;
      const t = o.transfers.find((x) => x.vehicleId === vehicleId && ["Assigned", "In Transit"].includes(x.status));
      if (t) return { o, t };
    }
    return { o: null, t: null };
  }

  private mustGet(id: string): RedistributionOrder {
    const o = db.orders.get(id);
    if (!o) throw new UserError(`Unknown order ${id}`, 404);
    return o;
  }

  private nextOrderId(): string {
    const max = [...db.orders.keys()].map((k) => Number(k.slice(3))).reduce((m, n) => Math.max(m, n), 314);
    return `RO-${String(max + 1).padStart(4, "0")}`;
  }
}
