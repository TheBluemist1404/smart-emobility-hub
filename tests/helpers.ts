// Every test starts from the seed at Mon 02/11/2026 14:36:00 with the demo clock paused, so
// time only moves when the test says so (the "stated system state" of test-cases.md).
import { boot } from "../src/api/boot";
import { clock, MINUTE, SECOND } from "../src/platform/clock/DemoClock";
import { db } from "../src/domain/store";
import { ctl } from "../src/api/controllers";

export const KHOA = "2412345";
export const OPERATOR = "OP-014";

export function fresh(): void {
  boot({ realtime: false });
}

export const advance = (ms: number) => clock().advance(ms);
export const sec = (n: number) => n * SECOND;
export const min = (n: number) => n * MINUTE;
export const now = () => clock().now();
export { db, ctl };
