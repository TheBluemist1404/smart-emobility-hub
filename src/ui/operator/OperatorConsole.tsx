// ui.operator — OperatorConsole: the operator console shell, navigation between O01-O06 and
// the pushed warnings (the client half of OperatorConsole.warn).
import { useEffect, useState } from "react";
import { Console, type Nav } from "../shared/Shells";
import { DemoTools } from "../demo/DemoTools";
import { SimWarning } from "../demo/SimWarning";
import { Icon } from "../shared/Icon";
import { getSocket, hms, useClock, useLive } from "../shared/live";
import { O01Monitor } from "./Monitor";
import { O02Orders, type OrderSeed } from "./Orders";
import { O03Charging } from "./Charging";
import { O04Incidents } from "./Incidents";
import { O05Simulation } from "./Simulation";
import { AlertBell, HeaderSearch, type Alert } from "./TopBar";

export interface OpRoute { nav: Nav; hubId?: string; order?: OrderSeed; orderId?: string; incidentId?: string; draftFor?: string }
export type OpGo = (r: OpRoute) => void;
interface Toast { id: number; message: string }

const CRUMB: Record<Nav, string> = { monitor: "Network monitor", orders: "Redistribution orders", charging: "Smart charging", incidents: "Incidents", sim: "What-if simulation" };

export function OperatorConsole() {
  const { now, state: demo } = useClock();
  const [route, setRoute] = useState<OpRoute>({ nav: "monitor" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { data: inc } = useLive<{ counts: { open: number; inProgress: number } }>("/operator/incidents");
  const { data: orders } = useLive<{ orders: Array<{ status: string; overdue: boolean }> }>("/operator/orders");
  const { data: alerts } = useLive<Alert[]>("/operator/alerts");

  useEffect(() => {
    const s = getSocket();
    const onWarn = (e: { message: string }) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, message: e.message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
    };
    s.on("warn", onWarn);
    return () => { s.off("warn", onWarn); };
  }, []);

  const go: OpGo = (r) => { setRoute(r); window.scrollTo(0, 0); };
  const counts = {
    incidents: inc ? inc.counts.open + inc.counts.inProgress : 0,
    orders: orders ? orders.orders.filter((o) => ["Assigned", "In Transit"].includes(o.status)).length : 0,
  };

  let body: JSX.Element;
  switch (route.nav) {
    case "monitor": body = <O01Monitor go={go} now={now} hubId={route.hubId} />; break;
    case "orders": body = <O02Orders go={go} now={now} seed={route.order} orderId={route.orderId} />; break;
    case "charging": body = <O03Charging go={go} now={now} hubId={route.hubId ?? "H01"} />; break;
    case "incidents": body = <O04Incidents go={go} now={now} incidentId={route.incidentId} draftFor={route.draftFor} />; break;
    default: body = <O05Simulation go={go} now={now} hubId={route.hubId} />;
  }

  return (
    <>
      <Console nav={route.nav} crumb={["Operations", CRUMB[route.nav]]} time={hms(now)} counts={counts} search={<HeaderSearch go={go} />} bell={<AlertBell alerts={alerts ?? []} go={go} />} onNav={(n) => go({ nav: n })}>
        <SimWarning state={demo} console />
        {body}
      </Console>
      {toasts.length > 0 && (
        <div style={{ position: "fixed", right: 20, top: 70, zIndex: 60, display: "flex", flexDirection: "column", gap: 8, width: 380 }}>
          {toasts.map((t) => (
            <div key={t.id} className="banner warn compact clickable" style={{ boxShadow: "0 8px 24px rgba(10,20,40,.18)" }} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <span className="ic"><Icon name="bell-ring" /></span><b>Warning</b><p>{t.message}</p>
            </div>
          ))}
        </div>
      )}
      <DemoTools side="operator" />
    </>
  );
}
