import { Router } from "express";
import { seed } from "./boot";

export function apiRouter(): Router {
  const r = Router();
  r.get("/health", (_req, res) => res.json({ ok: true }));
  r.get("/seed-summary", (_req, res) => res.json(Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]))));
  r.get("/hubs", (_req, res) => res.json(seed.hubs));
  return r;
}
