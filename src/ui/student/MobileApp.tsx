// ui.student — MobileApp: the student app shell, navigation between S01-S12 and the pushed
// notifications (the client half of MobileApp.notify).
import { useEffect, useState } from "react";
import { Phone, type Tab } from "../shared/Shells";
import { DemoTools } from "../demo/DemoTools";
import { Icon } from "../shared/Icon";
import { getSocket, hm, useClock, useLive } from "../shared/live";
import { S01HubSearch, S02HubDetail } from "./Discover";
import { S03Review, VRScreen } from "./Reserve";
import { TripTab } from "./Ride";
import { S05Parking, S06Charging, PRScreen, CSScreen } from "./Book";
import { S07Report } from "./Report";
import { S11Bookings, S12Notifications } from "./Account";
import type { Home, Route } from "./types";

interface Toast { id: string; title: string; body: string; tone: string }

function tabOf(r: Route): Tab {
  switch (r.s) {
    case "S01": case "S02": case "notifications": return "hubs";
    case "S03": case "VR": return "none";
    case "S09": case "S10": case "S08": return "trip";
    case "bookings": case "PR": case "CS": return "bookings";
    case "report": case "S07": return "report";
    default: return "none";
  }
}

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ s: "S01" });
  const { now } = useClock();
  const { data: home } = useLive<Home>("/student/home");
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const s = getSocket();
    const onNotify = async (e: { studentId: string; notificationId: string }) => {
      if (e.studentId !== "2412345") return;
      const list = await fetch("/api/student/notifications").then((r) => r.json()) as Array<Toast & { id: string }>;
      const n = list.find((x) => x.id === e.notificationId);
      if (!n) return;
      setToasts((t) => [...t, n]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
    };
    s.on("notify", onNotify);
    return () => { s.off("notify", onNotify); };
  }, []);

  // A started pickup or trip takes the student to the Trip tab.
  const active = home?.pickup ? "pickup" : home?.trip ? "trip" : null;
  useEffect(() => { if (active) setRoute({ s: "S09" }); }, [active]);

  const go = (r: Route) => { setRoute(r); document.querySelector(".phone.live .screen")?.scrollTo(0, 0); };
  const onTab = (t: Exclude<Tab, "none">) => go(t === "hubs" ? { s: "S01" } : t === "trip" ? { s: "S09" } : t === "bookings" ? { s: "bookings" } : { s: "report" });
  const dark = route.s === "S01" || route.s === "S02";

  let body: JSX.Element;
  switch (route.s) {
    case "S01": body = <S01HubSearch go={go} now={now} home={home} />; break;
    case "S02": body = <S02HubDetail go={go} now={now} hubId={route.hubId} tab={route.tab} home={home} />; break;
    case "S03": body = <S03Review go={go} vehicleId={route.vehicleId} />; break;
    case "VR": body = <VRScreen go={go} id={route.id} now={now} />; break;
    case "S09": case "S10": body = home ? <TripTab go={go} home={home} now={now} /> : <span className="spinner" />; break;
    case "S05": body = home ? <S05Parking go={go} home={home} now={now} hubId={route.hubId} /> : <span className="spinner" />; break;
    case "S06": body = home ? <S06Charging go={go} home={home} now={now} hubId={route.hubId} /> : <span className="spinner" />; break;
    case "PR": body = <PRScreen go={go} id={route.id} now={now} />; break;
    case "CS": body = <CSScreen go={go} id={route.id} now={now} />; break;
    case "report": case "S07": body = home ? <S07Report key={`r-${"resourceId" in route ? route.resourceId ?? "" : ""}`} go={go} home={home} resourceId={"resourceId" in route ? route.resourceId : undefined} /> : <span className="spinner" />; break;
    case "S08": body = home?.trip ? <S07Report key="s08" go={go} home={home} trip /> : home ? <TripTab go={go} home={home} now={now} /> : <span className="spinner" />; break;
    case "bookings": body = <S11Bookings go={go} home={home} now={now} />; break;
    case "notifications": body = <S12Notifications go={go} now={now} />; break;
  }

  const overlay = toasts.length ? (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast clickable" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
          <Icon name={t.tone === "ok" ? "circle-check" : t.tone === "danger" ? "circle-x" : t.tone === "warn" ? "triangle-alert" : "bell"} className="ic" />
          <div className="grow"><b>{t.title}</b><div style={{ fontSize: 12.5, color: "var(--ink-200)" }}>{t.body}</div></div>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <div className="stage-phone">
        <Phone tab={tabOf(route)} dark={dark} time={hm(now)} onTab={onTab} overlay={overlay}>{body}</Phone>
      </div>
      <DemoTools side="student" />
    </>
  );
}
