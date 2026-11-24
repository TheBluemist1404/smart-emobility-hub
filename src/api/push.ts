// The server half of the two boundary classes: MobileApp.notify(message) and
// OperatorConsole.warn(message) (control method descriptions 1.1, 1.2). Controllers call
// these; the WebSocket layer pushes them to the open views (cross-actor push).
import { db, nextId } from "../domain/store";
import { clock } from "../platform/clock/DemoClock";
import { bus } from "../platform/events/bus";
import type { Notification } from "../domain/store";

export const MobileApp = {
  /** notify(message : String) : void */
  notify(studentId: string, title: string, body: string, tone: Notification["tone"] = "info", ref?: string): void {
    const n: Notification = { id: nextId("NT", "num"), studentId, time: clock().now(), title, body, tone, ref, read: false };
    db.notifications.push(n);
    bus.emit({ kind: "notify", studentId, notificationId: n.id });
    bus.changed("notification");
  },
};

export const OperatorConsole = {
  /** warn(message : String) : void */
  warn(message: string, hubId?: string, kind = "Warning"): void {
    db.alerts.push({ id: nextId("AL", "num", 40), time: clock().now(), hubId, kind, message });
    bus.emit({ kind: "warn", message });
    bus.changed("alert");
  },
};
