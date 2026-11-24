// platform.events — tiny in-process event bus. The server turns these into WebSocket
// pushes: "changed" makes every open view refetch, "notify" pops a toast for one student,
// "warn" for the operator console. Stands in for the WSS channel of the deployment view.

export type BusEvent =
  | { kind: "changed"; reason: string }
  | { kind: "notify"; studentId: string; notificationId: string }
  | { kind: "warn"; message: string };

type Listener = (e: BusEvent) => void;
const listeners: Listener[] = [];

export const bus = {
  on(fn: Listener): () => void {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  },
  emit(e: BusEvent): void {
    for (const l of [...listeners]) l(e);
  },
  changed(reason: string): void {
    bus.emit({ kind: "changed", reason });
  },
};
