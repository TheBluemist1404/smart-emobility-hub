// HTTP routes between the two views and the controllers. The UI never reaches an entity:
// every route calls a controller (class-diagram.md section 2), except the read-only
// view-model helpers in views.ts.
import { Router, type Request, type Response, type NextFunction } from "express";
import { demoRoutes } from "./demoRoutes";
import { studentRoutes } from "./studentRoutes";
import { config } from "../platform/config/ConfigurationRegistry";
import { clock } from "../platform/clock/DemoClock";
import { ctl } from "./controllers";
import { Hub } from "../domain/network/Hub";

import { UserError } from "./errors";
export { UserError };

export function apiRouter(): Router {
  const r = Router();
  r.get("/health", (_req, res) => res.json({ ok: true, now: clock().now() }));
  r.get("/config", (_req, res) => res.json(config().list()));
  r.use("/demo", demoRoutes());
  r.use("/student", studentRoutes());

  r.get("/hubs", (_req, res) => res.json(Hub.getLatestStatus().map((h) => ({ id: h.hubId, name: h.name, category: h.category, status: h.status }))));
  r.get("/operator/network", (_req, res) => res.json(ctl.monitoring.openNetwork()));
  r.get("/operator/hub/:id", (req, res) => res.json(ctl.monitoring.getHubDetails(req.params.id)));

  r.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof UserError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message, code: (err as UserError).code });
  });
  return r;
}
