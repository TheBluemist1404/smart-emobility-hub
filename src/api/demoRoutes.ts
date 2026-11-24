// Demo tools: the demo clock and the simulator panel (IoT / Simulated Data Source and
// the Bank System). Not part of the product; the presenter drives them.
import { Router } from "express";
import { clock, MINUTE, SECOND } from "../platform/clock/DemoClock";
import { bank, type BankMode } from "../gateway/bank/BankGateway";
import { iot } from "../gateway/iot/IoTDataGateway";
import { dataSource, type UnlockMode } from "../gateway/iot/SimulatedDataSource";
import { db } from "../domain/store";
import { Trip } from "../domain/allocation/Trip";
import { ChargingSession } from "../domain/allocation/ChargingSession";
import { boot } from "./boot";
import { bus } from "../platform/events/bus";

export function demoRoutes(): Router {
  const r = Router();
  const done = (res: { json: (x: unknown) => void }, reason = "demo") => { bus.changed(reason); res.json(state()); };

  r.get("/state", (_req, res) => res.json(state()));
  r.get("/context", (_req, res) => res.json(simContext()));

  r.post("/clock", (req, res) => {
    const { action, ms, speed } = req.body as { action: string; ms?: number; speed?: number };
    const c = clock();
    if (action === "advance") c.advance(Number(ms ?? MINUTE));
    else if (action === "next") c.skipToNextTimer();
    else if (action === "speed") c.setSpeed(Number(speed ?? 1));
    else if (action === "pause") c.pause();
    else if (action === "resume") c.resume();
    done(res, "clock");
  });

  r.post("/reset", (_req, res) => { boot({ realtime: true }); done(res, "reset"); });

  r.post("/bank", (req, res) => {
    const { mode, once } = req.body as { mode: BankMode; once?: boolean };
    if (once) bank().nextMode = mode; else { bank().mode = mode; bank().nextMode = null; }
    done(res, "bank");
  });
  r.post("/bank/respond", (req, res) => {
    const { requestId, result } = req.body as { requestId?: string; result: "Success" | "Failed" };
    const id = requestId ?? bank().listOutstanding()[0]?.requestId;
    if (id) bank().respond(id, result);
    done(res, "bank");
  });

  r.post("/unlock", (req, res) => {
    const { mode, once } = req.body as { mode: UnlockMode; once?: boolean };
    if (once) dataSource().nextUnlockMode = mode; else { dataSource().unlockMode = mode; dataSource().nextUnlockMode = null; }
    done(res, "unlock");
  });
  r.post("/unlock/late", (_req, res) => { dataSource().sendLateUnlock(); done(res, "unlock"); });

  r.post("/hub", (req, res) => {
    const { hubId, connected } = req.body as { hubId: string; connected: boolean };
    if (connected) dataSource().reconnectHub(hubId); else dataSource().disconnectHub(hubId);
    done(res, "hub");
  });
  r.post("/resource", (req, res) => {
    const { id, connected } = req.body as { id: string; connected: boolean };
    if (connected) dataSource().reconnectResource(id); else dataSource().disconnectResource(id);
    done(res, "resource");
  });
  r.post("/battery", (req, res) => {
    const { vehicleId, soc } = req.body as { vehicleId: string; soc: number };
    dataSource().setBattery(vehicleId, Number(soc));
    done(res, "battery");
  });
  r.post("/point-fault", (req, res) => { dataSource().pointFault(String(req.body.pointId)); done(res, "pointFault"); });
  r.post("/latch", (req, res) => {
    const { dockId, vehicleId, engaged } = req.body as { dockId: string; vehicleId: string; engaged: boolean };
    if (engaged) dataSource().latch(dockId, vehicleId); else dataSource().latchNotEngaged(dockId, vehicleId);
    done(res, "latch");
  });
  r.post("/transfer", (req, res) => {
    const { vehicleId, event, dockId } = req.body as { vehicleId: string; event: "departed" | "arrived" | "breakdown"; dockId?: string };
    if (event === "departed") dataSource().departed(vehicleId);
    else if (event === "arrived") dataSource().arrived(vehicleId, dockId ?? "");
    else dataSource().breakdown(vehicleId);
    done(res, "transfer");
  });
  r.post("/plug-in", (req, res) => { dataSource().plugIn(String(req.body.sessionId)); done(res, "plugin"); });
  r.post("/parking-sensor", (req, res) => { dataSource().parkingSensor(String(req.body.spaceId), !!req.body.occupied); done(res, "parking"); });

  return r;
}

/** What the simulator panel needs to offer sensible choices. */
function simContext() {
  const trips = [...db.allocations.values()].filter((a) => a instanceof Trip && a.isActive()) as Trip[];
  const sessions = [...db.allocations.values()].filter((a) => a instanceof ChargingSession && a.isCommittedReservation() && a.isActive()) as ChargingSession[];
  return {
    vehicles: [...db.vehicles.values()].filter((v) => ["H01", "H02", "H05", "H07"].includes(v.hubId) || v.usage === "In Use")
      .sort((a, b) => (a.usage === "In Use" ? -1 : 0) - (b.usage === "In Use" ? -1 : 0) || a.hubId.localeCompare(b.hubId) || a.id.localeCompare(b.id))
      .slice(0, 60).map((v) => ({ id: v.id, hubId: v.hubId, soc: v.soc, status: v.status })),
    points: [...db.points.values()].map((p) => ({ id: p.id, hubId: p.hubId, status: p.status })),
    trips: trips.sort((a, b) => (a.studentId === "2412345" ? -1 : 1) - (b.studentId === "2412345" ? -1 : 1)).map((t) => ({ id: t.id, vehicleId: t.vehicleId, studentId: t.studentId })),
    vacantDocks: [...db.docks.values()].filter((d) => d.status === "Vacant" && ["H01", "H02", "H05", "H07"].includes(d.hubId)).slice(0, 40).map((d) => ({ id: d.id, label: d.label, hubId: d.hubId })),
    sessions: sessions.map((s) => ({ id: s.id, pointId: s.pointId, status: s.status, start: s.slot?.start ?? null })),
    transfers: [...db.orders.values()].filter((o) => o.isOpen()).flatMap((o) => o.transfers.filter((t) => ["Assigned", "In Transit"].includes(t.status)).map((t) => ({ orderId: o.id, vehicleId: t.vehicleId, status: t.status, destDockId: t.destDockId }))),
  };
}

function state() {
  const c = clock();
  return {
    now: c.now(), speed: c.getSpeed(), paused: c.isPaused(),
    timers: c.pendingTimers().slice(0, 12),
    bank: { mode: bank().mode, nextMode: bank().nextMode, outstanding: bank().listOutstanding(), delayMs: bank().responseDelayMs },
    unlock: { mode: dataSource().unlockMode, nextMode: dataSource().nextUnlockMode, pending: dataSource().pendingUnlocks() },
    silentHubs: [...dataSource().silentHubs], silentResources: [...dataSource().silentResources],
    pluggedIn: [...dataSource().pluggedIn],
    events: iot().eventLog.slice(-8).reverse(),
    hubs: [...db.hubs.values()].map((h) => ({ id: h.id, name: h.name, status: h.status })),
    steps: { SECOND, MINUTE },
  };
}
