// platform.clock — DemoClock. Not one of the 36 design classes: it is the demo tool that
// lets a presenter fast-forward time. Every timer in the system (payment holds,
// INSPECTION_TIMEOUT, reservation expiry, DATA_STALE_AFTER, heartbeats, bank delay)
// is scheduled on this clock, so skipping ahead fires them in the right order.

export interface Timer {
  id: number;
  label: string;
  dueAt: number;
  cancel(): void;
}

interface Entry {
  id: number;
  label: string;
  dueAt: number;
  fn: () => void;
  cancelled: boolean;
  /** Internal timers (heartbeats) are hidden from the "next timer" list. */
  internal: boolean;
}

/** Mon 02/11/2026 14:36:00 in Ho Chi Minh City (UTC+7) — the sample time of every mockup. */
export const DEMO_START = Date.UTC(2026, 10, 2, 7, 36, 0);

export class DemoClock {
  private virtualAtSync: number;
  private realAtSync: number;
  private speed = 1;
  private paused = false;
  private entries: Entry[] = [];
  private seq = 1;
  private loop: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];
  private firing = false;

  constructor(start = DEMO_START, private readonly realNow: () => number = () => Date.now()) {
    this.virtualAtSync = start;
    this.realAtSync = realNow();
  }

  now(): number {
    if (this.paused) return this.virtualAtSync;
    return this.virtualAtSync + (this.realNow() - this.realAtSync) * this.speed;
  }

  private sync(): void {
    this.virtualAtSync = this.now();
    this.realAtSync = this.realNow();
  }

  getSpeed(): number { return this.speed; }
  isPaused(): boolean { return this.paused; }

  setSpeed(speed: number): void {
    this.sync();
    this.speed = Math.max(0.1, Math.min(600, speed));
    this.changed();
  }

  pause(): void { this.sync(); this.paused = true; this.changed(); }
  resume(): void { this.sync(); this.paused = false; this.changed(); }

  /** Schedule fn at an absolute virtual time. */
  at(dueAt: number, label: string, fn: () => void, internal = false): Timer {
    const e: Entry = { id: this.seq++, label, dueAt, fn, cancelled: false, internal };
    this.entries.push(e);
    this.entries.sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
    return { id: e.id, label, dueAt, cancel: () => { e.cancelled = true; this.entries = this.entries.filter((x) => x !== e); } };
  }

  /** Schedule fn after a virtual delay in ms. */
  after(delayMs: number, label: string, fn: () => void, internal = false): Timer {
    return this.at(this.now() + delayMs, label, fn, internal);
  }

  /** Jump forward; timers due on the way fire one by one, in time order, each at its own time. */
  advance(ms: number): void {
    this.sync();
    const target = this.now() + ms;
    this.runUntil(target, true);
    this.sync();
    this.virtualAtSync = Math.max(this.virtualAtSync, target);
    this.changed();
  }

  /** Jump straight to the next visible timer and fire it. */
  skipToNextTimer(): Timer | null {
    const next = this.entries.find((e) => !e.cancelled && !e.internal);
    if (!next) return null;
    this.advance(Math.max(0, next.dueAt - this.now()) + 1);
    return { id: next.id, label: next.label, dueAt: next.dueAt, cancel: () => undefined };
  }

  pendingTimers(): Array<{ id: number; label: string; dueAt: number }> {
    return this.entries.filter((e) => !e.cancelled && !e.internal).map(({ id, label, dueAt }) => ({ id, label, dueAt }));
  }

  /** Fire everything due up to `target`. While a timer runs, now() reads its due time. */
  private runUntil(target: number, stepTime = false): void {
    if (this.firing) return;
    this.firing = true;
    try {
      let guard = 0;
      while (guard++ < 10000) {
        const next = this.entries.find((e) => !e.cancelled);
        if (!next || next.dueAt > target) break;
        this.entries = this.entries.filter((e) => e !== next);
        if (stepTime && next.dueAt > this.virtualAtSync) {
          this.virtualAtSync = next.dueAt;
          this.realAtSync = this.realNow();
        }
        try { next.fn(); } catch (err) { console.error(`[clock] timer "${next.label}" failed`, err); }
      }
    } finally {
      this.firing = false;
    }
  }

  /** Real-time driver: called by the server every 100 ms. Tests call tick() directly. */
  tick(): void {
    const before = this.entries.length;
    this.sync();
    this.runUntil(this.now());
    if (this.entries.length !== before) this.changed();
  }

  start(): void {
    if (!this.loop) this.loop = setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  onChange(fn: () => void): void { this.listeners.push(fn); }
  private changed(): void { for (const l of this.listeners) l(); }
}

let current = new DemoClock();
export const clock = (): DemoClock => current;
/** Tests replace the clock with a paused one so time only moves when they say so. */
export const setClock = (c: DemoClock): void => { current = c; };

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** hh:mm:ss in Ho Chi Minh City time. */
export const fmtTime = (ms: number): string => new Date(ms + 7 * HOUR).toISOString().slice(11, 19);
export const fmtHM = (ms: number): string => fmtTime(ms).slice(0, 5);
