// The operator console's HTTP side (OperatorConsole boundary). One demo operator: Tran Lan · OP-014.
import { Router, type Request } from "express";
import { db } from "../domain/store";
import { bus } from "../platform/events/bus";
import { ctl } from "./controllers";
import { searchOperator } from "./operatorSearch";

export const OPERATOR = "OP-014";

const wrap = (fn: (req: Request) => unknown) => (req: Request, res: { json: (x: unknown) => void }, next: (e: unknown) => void) => {
  try { const out = fn(req); bus.changed("operator"); res.json(out ?? { ok: true }); } catch (e) { next(e); }
};
const num = (x: unknown) => (x === undefined || x === null || x === "" ? NaN : Number(x));

export function operatorRoutes(): Router {
  const r = Router();

  // ---- UC-09 network monitor ----------------------------------------------------------
  r.get("/network", (req, res) => {
    const o = ctl.monitoring.openNetwork();
    const q = req.query as Record<string, string>;
    res.json({ ...o, hubs: ctl.monitoring.filter({ category: q.category as never, status: q.status as never, vehicleType: q.vehicleType, sort: q.sort as never }) });
  });
  r.get("/hub/:id", (req, res, next) => { try { res.json({ ...ctl.monitoring.getHubDetails(req.params.id), orderSeed: ctl.redistribution.orderSeedFor(req.params.id), orderPlan: ctl.redistribution.orderPlanFor(req.params.id) }); } catch (e) { next(e); } });
  r.get("/search", (req, res) => res.json(searchOperator(String(req.query.q ?? ""))));
  r.get("/alerts", (_req, res) => res.json(db.alerts.slice().reverse().slice(0, 40)));
  r.post("/alerts/ack", wrap((req) => ctl.monitoring.acknowledge(String(req.body.id), OPERATOR)));

  // ---- UC-10 redistribution -----------------------------------------------------------
  r.get("/orders", (_req, res) => res.json(ctl.redistribution.listOrders()));
  r.post("/orders/validate", (req, res, next) => { try { res.json(ctl.redistribution.validateOrder(req.body)); } catch (e) { next(e); } });
  r.post("/orders", wrap((req) => ({ id: ctl.redistribution.submitOrder(req.body.draft, req.body.choice === "draft" ? "draft" : "commit", OPERATOR) })));
  r.post("/orders/:id/close", wrap((req) => ctl.redistribution.closeOrder(req.params.id, OPERATOR)));
  r.post("/orders/:id/cancel", wrap((req) => ctl.redistribution.cancelOrder(req.params.id, String(req.body.reason ?? ""), OPERATOR)));

  // ---- UC-11 smart charging -----------------------------------------------------------
  r.get("/charging/:hubId", (req, res) => res.json(ctl.charging.openSchedule(req.params.hubId, Math.min(36, Math.max(1, Number(req.query.hours ?? 4) || 4)), req.query.from ? Number(req.query.from) : undefined)));
  r.post("/charging/:hubId/generate", wrap((req) => ctl.charging.generateSchedule(req.params.hubId, Number(req.body.hours ?? 4))));
  r.post("/charging/:hubId/emergency", wrap((req) => ctl.charging.setEmergency(req.params.hubId, String(req.body.sessionId), String(req.body.reason ?? ""), OPERATOR)));
  r.post("/charging/:hubId/move", wrap((req) => ctl.charging.moveBlock(req.params.hubId, String(req.body.sessionId), String(req.body.pointId), Number(req.body.start))));
  r.post("/charging/:hubId/discard", wrap((req) => ctl.charging.discardProposal(req.params.hubId)));
  r.post("/charging/:hubId/apply", wrap((req) => ctl.charging.applySchedule(req.params.hubId, OPERATOR)));
  r.post("/policy", wrap((req) => { const v = ctl.charging.savePolicy(req.body.values ?? {}, OPERATOR); return { violation: v }; }));

  // ---- UC-12 incidents ----------------------------------------------------------------
  r.get("/incidents", (_req, res) => res.json(ctl.incident.listIncidents()));
  r.get("/incidents/:id", (req, res, next) => { try { res.json(ctl.incident.openIncident(req.params.id)); } catch (e) { next(e); } });
  r.post("/incidents", wrap((req) => ({ id: ctl.incident.createIncident(String(req.body.resourceId), String(req.body.category ?? ""), String(req.body.description ?? ""), OPERATOR) })));
  r.post("/incidents/from-alert", wrap((req) => ctl.incident.openFromAlert(String(req.body.resourceId))));
  r.post("/incidents/:id/start", wrap((req) => ctl.incident.startHandling(req.params.id, String(req.body.note ?? ""), num(req.body.version), OPERATOR)));
  r.post("/incidents/:id/action", wrap((req) => ({ outcomes: ctl.incident.saveAction(req.params.id, String(req.body.note ?? ""), !!req.body.block, num(req.body.version), OPERATOR) })));
  r.post("/incidents/:id/corrective", wrap((req) => ctl.incident.recordCorrective(req.params.id, String(req.body.note ?? ""), { orderId: req.body.orderId, schedule: req.body.schedule }, OPERATOR)));
  r.post("/incidents/:id/verify", wrap((req) => ctl.incident.recordVerification(req.params.id, num(req.body.version), OPERATOR)));
  r.post("/incidents/:id/progress", wrap((req) => ctl.incident.saveProgress(req.params.id, String(req.body.note ?? ""), String(req.body.pending ?? ""), num(req.body.version), OPERATOR)));
  r.post("/incidents/:id/resolve", wrap((req) => ctl.incident.resolve(req.params.id, String(req.body.resolution ?? ""), num(req.body.version), OPERATOR)));
  r.post("/incidents/:id/dismiss", wrap((req) => ctl.incident.dismiss(req.params.id, String(req.body.reason ?? ""), req.body.originalId || null, num(req.body.version), OPERATOR)));
  // ---- UC-13 / UC-14 what-if simulation ----------------------------------------------
  // Simulation routes never emit "changed": only confirm() touches live state (through UC-10/11).
  const plain = (fn: (req: Request) => unknown) => (req: Request, res: { json: (x: unknown) => void }, next: (e: unknown) => void) => { try { res.json(fn(req) ?? { ok: true }); } catch (e) { next(e); } };
  r.get("/sim", plain(() => ctl.simulation.state()));
  r.post("/sim/start", plain((req) => ctl.simulation.startSimulation(req.body.hubId || undefined)));
  r.post("/sim/define", plain((req) => ctl.simulation.defineScenario(req.body.type, req.body.hubs ?? [], { start: num(req.body.start), end: num(req.body.end) }, req.body.inputs ?? [])));
  r.post("/sim/run", plain(() => ctl.simulation.run()));
  r.post("/sim/apply", plain((req) => ctl.simulation.apply(req.body.ids ?? [])));
  r.post("/sim/cancel", plain(() => { ctl.simulation.cancel(); return ctl.simulation.state(); }));
  r.post("/sim/confirm", wrap(() => ctl.simulation.confirm(ctl.redistribution, ctl.charging)));
  r.post("/sim/discard", plain(() => { ctl.simulation.discard(); return ctl.simulation.state(); }));
  return r;
}
