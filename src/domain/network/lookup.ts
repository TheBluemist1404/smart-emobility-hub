// Find any Resource by ID across the four subclasses (UC-12 works on the superclass).
import { db } from "../store";
import type { Resource } from "./Resource";

export function findResource(id: string): Resource | null {
  return db.vehicles.get(id) ?? db.docks.get(id) ?? db.points.get(id) ?? db.spaces.get(id) ?? null;
}

export function resourceLabel(r: Resource): string {
  if (r.kind === "Dock") return `Dock ${(r as unknown as { label: string }).label} · ${r.hubId}`;
  if (r.kind === "ParkingSpace") return `Parking space ${(r as unknown as { label: string }).label} · ${r.hubId}`;
  if (r.kind === "ChargingPoint") return `Charging point ${r.id}`;
  return `Vehicle ${r.id} · ${r.hubId}`;
}
