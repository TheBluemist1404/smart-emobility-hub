// Phase 1 — core: entities and their states, ConfigurationRegistry, demo clock, gateways.
import { beforeEach, describe, expect, it } from "vitest";
import { fresh, advance, sec, min, db } from "./helpers";
import { config } from "../src/platform/config/ConfigurationRegistry";
import { DemoClock } from "../src/platform/clock/DemoClock";
import { bank } from "../src/gateway/bank/BankGateway";
import { dataSource } from "../src/gateway/iot/SimulatedDataSource";

beforeEach(fresh);

describe("ConfigurationRegistry (Table 2.3-6)", () => {
  it("holds every parameter of Table 2.3-6 with its default", () => {
    const want: Record<string, number> = {
      VEHICLE_RESERVATION_HOLD: min(15), PAYMENT_HOLD_VEHICLE: min(2), PAYMENT_HOLD_BOOKING: min(10), PAYMENT_GATEWAY_TIMEOUT: sec(60),
      INSPECTION_TIMEOUT: min(3), DOCK_UNLOCK_TIMEOUT: sec(15), LOW_BATTERY_SOC: 20, REDISTRIBUTION_MIN_SOC: 80,
      HUB_BUSY: 70, HUB_RISK: 85, HUB_OVERLOADED: 95, HUB_SHORTAGE_RATIO: 10, HUB_LOW_BATTERY_RATIO: 50,
      PARKING_MAX_DURATION: min(720), BOOKING_HORIZON: min(1440), CHECKIN_GRACE: min(15), CHARGING_START_GRACE: min(15),
      SCHEDULE_TIMESLOT: min(15), CHARGING_SHIFT_TOLERANCE: min(15), W_SOC: 0.5, W_DEMAND: 0.3, W_WAIT: 0.2,
      CHARGING_MAX_WAIT: min(120), HIGH_PRIORITY_P: 0.8, DATA_STALE_AFTER: sec(60), MONITOR_REFRESH: sec(5), DATA_SERVICE_RETRIES: 3,
    };
    for (const [k, v] of Object.entries(want)) expect(config().value(k), k).toBe(v);
    expect(config().list().filter((p) => p.table236)).toHaveLength(Object.keys(want).length);
  });

  it("refuses an out-of-range value and keeps the old one", () => {
    expect(config().set("W_SOC", 1.5)).toMatchObject({ parameter: "W_SOC" });
    expect(config().value("W_SOC")).toBe(0.5);
    expect(config().set("W_SOC", 0.6)).toBeNull();
    expect(config().value("W_SOC")).toBe(0.6);
  });
});

describe("DemoClock", () => {
  it("fires timers in time order, each at its own time, when skipping ahead", () => {
    const c = new DemoClock(0, () => 0);
    const seen: Array<[string, number]> = [];
    c.after(3000, "b", () => seen.push(["b", c.now()]));
    c.after(1000, "a", () => { seen.push(["a", c.now()]); c.after(500, "a2", () => seen.push(["a2", c.now()])); });
    c.advance(5000);
    expect(seen).toEqual([["a", 1000], ["a2", 1500], ["b", 3000]]);
    expect(c.now()).toBe(5000);
  });
});

describe("Seed state and the state charts", () => {
  it("derives the Table 2.3-1 vehicle status in BR-RES-01 order (mockup S02)", () => {
    const s = (id: string) => db.vehicles.get(id)!.status;
    expect(s("EB-0217")).toBe("Available");
    expect(s("EB-0226")).toBe("Reserved");
    expect(s("EB-0230")).toBe("Waiting for Charge");
    expect(s("EM-0031")).toBe("Under Maintenance");
    expect(s("EM-0042")).toBe("In Use");
    expect(s("EB-0215")).toBe("In Redistribution");
  });

  it("classifies the Hubs by BR-HUB-01 (mockup O01)", () => {
    const h = (id: string) => db.hubs.get(id)!;
    expect(h("H02").status).toBe("Overloaded");
    expect(h("H02").getFlags()).toContain("Vehicle Shortage");
    expect(h("H03").status).toBe("Risk of Overload");
    expect(h("H07").status).toBe("Busy");
    expect(h("H04").getFlags()).toContain("Insufficient Fully Charged Vehicles");
    expect(h("H01").status).toBe("Normal");
    expect(h("H01").getFlags()).toEqual(["Vehicle Shortage"]);
    expect(h("H06").status).toBe("Disconnected");
  });

  it("keeps dock, point and space states apart from their windows (Table 2.3-5)", () => {
    expect(db.docks.get("H01-D07")!.status).toBe("Occupied");
    expect(db.docks.get("H01-D04")!.status).toBe("Allocated");
    expect(db.points.get("CP-H01-04")!.status).toBe("Out of Service");
    expect(db.points.get("CP-H01-01")!.status).toBe("In Use");
    expect(db.spaces.get("H01-P-B12")!.status).toBe("Out of Service");
  });
});

describe("IoT / Simulated Data Source", () => {
  it("keeps reporting Hubs fresh and turns a silent Hub Disconnected after DATA_STALE_AFTER", () => {
    advance(min(2));
    expect(db.hubs.get("H01")!.isStale()).toBe(false);
    dataSource().disconnectHub("H03");
    advance(sec(30));
    expect(db.hubs.get("H03")!.status).not.toBe("Disconnected");
    advance(sec(40));
    expect(db.hubs.get("H03")!.status).toBe("Disconnected");
    expect(db.vehicles.get([...db.vehicles.values()].find((v) => v.hubId === "H03" && v.usage === "Idle" && v.soc > 40)!.id)!.status).toBe("Disconnected");
    dataSource().reconnectHub("H03");
    expect(db.hubs.get("H03")!.status).toBe("Risk of Overload");
  });
});

describe("BankGateway mock", () => {
  it("answers Success after its delay, and never answers in Timeout mode", () => {
    const got: string[] = [];
    bank().submit("Charge", "X1", 5000, (a) => got.push(a.result));
    advance(sec(5));
    expect(got).toEqual(["Success"]);
    bank().mode = "Timeout";
    bank().submit("Charge", "X2", 5000, (a) => got.push(a.result));
    advance(min(5));
    expect(got).toEqual(["Success"]);
    expect(bank().listOutstanding()).toHaveLength(1);
  });
});
