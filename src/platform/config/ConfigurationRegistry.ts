// platform.config — ConfigurationRegistry (method descriptions, section 4.2).
// A singleton over Table 2.3-6 (Appendix B.6). Nothing else in the code hard-codes a
// timeout, a percentage or a weight: callers ask for a parameter by name.

export type Unit = "ms" | "%" | "ratio" | "count" | "weight" | "VND";

export interface Parameter {
  name: string;
  value: number;
  defaultValue: number;
  unit: Unit;
  min: number;
  max: number;
  meaning: string;
  usedIn: string;
  /** true for the rows of Table 2.3-6; false for the MVP tariff values (seed data). */
  table236: boolean;
}

export interface Violation {
  parameter: string;
  message: string;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

type Row = [name: string, value: number, unit: Unit, min: number, max: number, meaning: string, usedIn: string];

// Table 2.3-6 — Configurable operational parameters (default values).
const TABLE_2_3_6: Row[] = [
  ["VEHICLE_RESERVATION_HOLD", 15 * MIN, "ms", 1 * MIN, 60 * MIN, "How long a confirmed vehicle reservation is kept for pickup", "UC-02, NIFR-03, BR-RES-02"],
  ["PAYMENT_HOLD_VEHICLE", 2 * MIN, "ms", 30 * SEC, 10 * MIN, "Max wait for the payment of a vehicle reservation", "UC-02 step 4, E2; BR-PAY-03"],
  ["PAYMENT_HOLD_BOOKING", 10 * MIN, "ms", 1 * MIN, 30 * MIN, "Longest wait for a payment result on a parking reservation or charging session", "UC-04 E8, UC-05 E8; BR-PAY-03"],
  ["PAYMENT_GATEWAY_TIMEOUT", 60 * SEC, "ms", 5 * SEC, 5 * MIN, "Max wait for the Bank System; shorter than both payment holds", "UC-03 E2, BR-PAY-03"],
  ["INSPECTION_TIMEOUT", 3 * MIN, "ms", 30 * SEC, 15 * MIN, "Max time from the start of the pickup (UC-07 step 4) to sending the unlock command", "UC-07 step 4, 4a, 4b"],
  ["DOCK_UNLOCK_TIMEOUT", 15 * SEC, "ms", 5 * SEC, 2 * MIN, "Max wait for the dock release confirmation", "UC-07 E3"],
  ["LOW_BATTERY_SOC", 20, "%", 5, 50, "Below it a shared vehicle is not rented, waits for charge and raises an alert", "UC-02, UC-07 step 4, E2; NIFR-02; BR-RES-01; BR-HUB-01; UC-09 5b; UC-11 2a"],
  ["REDISTRIBUTION_MIN_SOC", 80, "%", 20, 100, "Min SoC for taking a charging vehicle into a redistribution order", "UC-10 step 6"],
  ["HUB_BUSY", 70, "%", 1, 100, "Dock occupancy threshold: Busy", "BR-HUB-01"],
  ["HUB_RISK", 85, "%", 1, 100, "Dock occupancy threshold: Risk of Overload", "BR-HUB-01"],
  ["HUB_OVERLOADED", 95, "%", 1, 100, "Dock occupancy threshold: Overloaded", "BR-HUB-01"],
  ["HUB_SHORTAGE_RATIO", 10, "%", 1, 100, "\"Available\" vehicles below this share of docks in service means \"Vehicle Shortage\"", "BR-HUB-01"],
  ["HUB_LOW_BATTERY_RATIO", 50, "%", 1, 100, "Share of low-battery shared vehicles at a Hub that raises a warning", "BR-HUB-01, UC-09 5b"],
  ["PARKING_MAX_DURATION", 12 * HOUR, "ms", 1 * HOUR, 24 * HOUR, "Longest parking reservation", "UC-04"],
  ["BOOKING_HORIZON", 24 * HOUR, "ms", 1 * HOUR, 72 * HOUR, "How far ahead parking and charging can be booked", "UC-04 E4, 6a; UC-05 E3, 6a"],
  ["CHECKIN_GRACE", 15 * MIN, "ms", 1 * MIN, 60 * MIN, "Grace period after the planned arrival of a parking reservation", "UC-04, NIFR-03, NIFR-04"],
  ["CHARGING_START_GRACE", 15 * MIN, "ms", 1 * MIN, 60 * MIN, "Grace period after the start of a student charging slot", "UC-05, NIFR-03, BR-CHG-02"],
  ["SCHEDULE_TIMESLOT", 15 * MIN, "ms", 5 * MIN, 60 * MIN, "Length of one charging slot", "UC-11 step 2"],
  ["CHARGING_SHIFT_TOLERANCE", 15 * MIN, "ms", 0, 60 * MIN, "Max delay UC-11 may apply to a paid student session (later only)", "UC-11 2a, E2; BR-CHG-02"],
  ["W_SOC", 0.5, "weight", 0, 1, "Weight of the battery term of the charging priority P", "BR-CHG-01, UC-11 2a"],
  ["W_DEMAND", 0.3, "weight", 0, 1, "Weight of the demand term of the charging priority P", "BR-CHG-01, UC-11 2a"],
  ["W_WAIT", 0.2, "weight", 0, 1, "Weight of the waiting term of the charging priority P", "BR-CHG-01, UC-11 2a"],
  ["CHARGING_MAX_WAIT", 120 * MIN, "ms", 10 * MIN, 480 * MIN, "Waiting time at which the waiting term of P reaches its maximum", "BR-CHG-01"],
  ["HIGH_PRIORITY_P", 0.8, "ratio", 0, 1, "Priority that triggers automatic rescheduling", "UC-11 Trigger, 1a"],
  ["DATA_STALE_AFTER", 60 * SEC, "ms", 10 * SEC, 10 * MIN, "Data older than this is marked stale; BR-RES-01 or BR-HUB-01 then sets \"Disconnected\"", "UC-01 E1, UC-04 step 3, UC-05 step 2, UC-07 step 4, UC-09 E1, UC-11 E5"],
  ["MONITOR_REFRESH", 5 * SEC, "ms", 1 * SEC, 60 * SEC, "Max refresh interval of the monitoring screen; matches NFR-PERF-01", "UC-09 step 4"],
  ["DATA_SERVICE_RETRIES", 3, "count", 0, 10, "Retries before the cached snapshot is shown", "UC-09 E2"],
];

// Tariff used by the MVP. Not part of Table 2.3-6 (the UC doc gives no fee values);
// the numbers are the sample data of the Sub2 UI mockups (S02, S03, S10).
const TARIFF: Row[] = [
  ["RESERVATION_FEE", 5000, "VND", 0, 100000, "Vehicle reservation fee (mockup S03)", "UC-02"],
  ["UNLOCK_FEE", 2000, "VND", 0, 100000, "Unlock fee added to a rental fare (mockup S10)", "UC-08"],
  ["RATE_EBIKE_PER_HOUR", 6000, "VND", 0, 100000, "Hourly rate, electric bicycle (mockup S02)", "UC-01, UC-08"],
  ["RATE_EMOTO_PER_HOUR", 12000, "VND", 0, 100000, "Hourly rate, electric motorcycle (mockup S02)", "UC-01, UC-08"],
  ["PARKING_RATE_PER_HOUR", 3000, "VND", 0, 100000, "Parking fee per started hour (mockup S05)", "UC-04"],
  ["CHARGING_RATE_PER_KWH", 3500, "VND", 0, 100000, "Charging energy price (mockup S06)", "UC-05"],
];

export class ConfigurationRegistry {
  private static instance: ConfigurationRegistry | null = null;
  private readonly params = new Map<string, Parameter>();

  private constructor() {
    for (const [name, value, unit, min, max, meaning, usedIn] of TABLE_2_3_6)
      this.params.set(name, { name, value, defaultValue: value, unit, min, max, meaning, usedIn, table236: true });
    for (const [name, value, unit, min, max, meaning, usedIn] of TARIFF)
      this.params.set(name, { name, value, defaultValue: value, unit, min, max, meaning, usedIn, table236: false });
  }

  static getInstance(): ConfigurationRegistry {
    if (!ConfigurationRegistry.instance) ConfigurationRegistry.instance = new ConfigurationRegistry();
    return ConfigurationRegistry.instance;
  }

  /** Test helper: back to the Table 2.3-6 defaults. */
  static reset(): void {
    ConfigurationRegistry.instance = new ConfigurationRegistry();
  }

  /** get(name : String) : Parameter */
  get(name: string): Parameter {
    const p = this.params.get(name);
    if (!p) throw new Error(`Unknown parameter ${name}`);
    return p;
  }

  /** Shorthand for get(name).value. */
  value(name: string): number {
    return this.get(name).value;
  }

  /** validateRange(name : String, value : Object) : boolean */
  validateRange(name: string, value: number): boolean {
    const p = this.get(name);
    return typeof value === "number" && Number.isFinite(value) && value >= p.min && value <= p.max;
  }

  /** set(name : String, value : Object) : Violation */
  set(name: string, value: number): Violation | null {
    if (!this.params.has(name)) return { parameter: name, message: `Unknown parameter ${name}` };
    if (!this.validateRange(name, value)) {
      const p = this.get(name);
      return { parameter: name, message: `${name} must be between ${p.min} and ${p.max}` };
    }
    this.get(name).value = value;
    return null;
  }

  list(): Parameter[] {
    return [...this.params.values()];
  }
}

export const config = (): ConfigurationRegistry => ConfigurationRegistry.getInstance();
