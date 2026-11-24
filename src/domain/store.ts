// In-memory state of the whole system. The deployment view has a database server and a
// state cache; the MVP keeps everything here, loaded from seed/seed.json at start-up.
import { clock } from "../platform/clock/DemoClock";
import type { Hub } from "./network/Hub";
import type { Vehicle } from "./network/Vehicle";
import type { Dock } from "./network/Dock";
import type { ChargingPoint } from "./network/ChargingPoint";
import type { ParkingSpace } from "./network/ParkingSpace";
import type { StudentAccount } from "./allocation/StudentAccount";
import type { Allocation } from "./allocation/Allocation";
import type { Payment } from "./allocation/Payment";
import type { IssueReport } from "./operations/IssueReport";
import type { Incident } from "./operations/Incident";
import type { RedistributionOrder } from "./operations/RedistributionOrder";
import type { SimulationScenario } from "./operations/SimulationScenario";

export interface Notification {
  id: string;
  studentId: string;
  time: number;
  title: string;
  body: string;
  tone: "ok" | "info" | "warn" | "danger" | "neutral";
  ref?: string;
  read: boolean;
}

export interface AuditEntry {
  time: number;
  actor: string;
  action: string;
  target: string;
  before?: string;
  after?: string;
}

export interface OperatorAlert {
  id: string;
  time: number;
  hubId?: string;
  kind: string;
  message: string;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

export const db = {
  hubs: new Map<string, Hub>(),
  vehicles: new Map<string, Vehicle>(),
  docks: new Map<string, Dock>(),
  points: new Map<string, ChargingPoint>(),
  spaces: new Map<string, ParkingSpace>(),
  students: new Map<string, StudentAccount>(),
  allocations: new Map<string, Allocation>(),
  payments: new Map<string, Payment>(),
  reports: new Map<string, IssueReport>(),
  incidents: new Map<string, Incident>(),
  orders: new Map<string, RedistributionOrder>(),
  scenarios: new Map<string, SimulationScenario>(),
  notifications: [] as Notification[],
  audit: [] as AuditEntry[],
  alerts: [] as OperatorAlert[],
};

export function clearStore(): void {
  for (const v of Object.values(db)) {
    if (v instanceof Map) v.clear();
    else if (Array.isArray(v)) v.length = 0;
  }
  counters.clear();
}

const counters = new Map<string, number>();
const ALPH = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Short readable IDs in the style of the mockups: VR-7Q4K, PR-3MZ8, INC-0193 ... */
export function nextId(prefix: string, style: "code" | "num" = "code", start = 1): string {
  const n = (counters.get(prefix) ?? start - 1) + 1;
  counters.set(prefix, n);
  if (style === "num") return `${prefix}-${String(n).padStart(4, "0")}`;
  let x = (n * 7919 + 104729) % (ALPH.length ** 4);
  let s = "";
  for (let i = 0; i < 4; i++) { s = ALPH[x % ALPH.length] + s; x = Math.floor(x / ALPH.length); }
  return `${prefix}-${s}`;
}

export function setCounter(prefix: string, value: number): void {
  counters.set(prefix, value);
}

export function audit(actor: string, action: string, target: string, before?: string, after?: string, time = clock().now()): void {
  db.audit.push({ time, actor, action, target, before, after });
}
