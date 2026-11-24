// The shared chrome of ui-design/assets/ds.js, as React: phone status bar + tab bar,
// console sidebar + top bar.
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type Tab = "hubs" | "bookings" | "trip" | "report" | "none";
const TABS: Array<[Exclude<Tab, "none">, string, string]> = [
  ["hubs", "map-pin", "Hubs"], ["bookings", "ticket", "Bookings"], ["trip", "bike", "Trip"], ["report", "triangle-alert", "Report"],
];

export function Phone({ tab, dark, time, onTab, children, overlay }: {
  tab: Tab; dark?: boolean; time: string; onTab?: (t: Exclude<Tab, "none">) => void; children: ReactNode; overlay?: ReactNode;
}) {
  return (
    <div className="phone live">
      <div className={`statusbar${dark ? " on-dark" : ""}`}>
        <span className="num">{time}</span><span className="island" />
        <span className="sys"><Icon name="signal" /><Icon name="wifi" /><Icon name="battery-full" /></span>
      </div>
      {overlay}
      <div className="screen">{children}</div>
      {tab !== "none" && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map(([id, ic, label]) => (
            <a key={id} aria-current={id === tab ? "page" : undefined} onClick={() => onTab?.(id)}>
              <span className="pill"><Icon name={ic} /></span>{label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

export type Nav = "monitor" | "orders" | "charging" | "incidents" | "sim";
const NAV: Array<[Nav, string, string]> = [
  ["monitor", "radar", "Network monitor"], ["orders", "truck", "Redistribution orders"], ["charging", "plug-zap", "Smart charging"],
  ["incidents", "siren", "Incidents"], ["sim", "flask-conical", "What-if simulation"],
];

export function Console({ nav, crumb, time, counts, onNav, alerts, children }: {
  nav: Nav; crumb: string[]; time: string; counts?: Partial<Record<Nav, number>>; onNav?: (n: Nav) => void; alerts?: number; children: ReactNode;
}) {
  return (
    <div className="console live">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Icon name="zap" /></div><div><b>Smart E-Mobility Hub</b><span>Operator console</span></div></div>
        <nav className="nav-group" aria-label="Console"><div className="eyebrow">Operations</div>
          {NAV.map(([id, ic, label]) => (
            <a key={id} className="nav-item" title={label} aria-current={id === nav ? "page" : undefined} onClick={() => onNav?.(id)}>
              <Icon name={ic} /><span className="lbl">{label}</span>
              {counts?.[id] ? <span className={`count${id === "incidents" ? " hot" : ""}`}>{counts[id]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="side-foot"><div className="avatar">TL</div><div><b>Tran Lan</b><span>Operator OP-014</span></div></div>
      </aside>
      <div className="c-main">
        <header className="topbar">
          <div className="crumbs"><Icon name="layout-grid" className="ic-sm" />
            {crumb.map((s, i) => i === crumb.length - 1
              ? <b key={i}>{s}</b>
              : <span key={i} className="row" style={{ gap: 6 }}><span>{s}</span><Icon name="chevron-right" className="ic-sm" /></span>)}
          </div>
          <div className="grow" />
          <div className="search"><Icon name="search" className="ic-sm" />Search Hub, vehicle, order, incident<kbd>/</kbd></div>
          <span className="fresh"><span>Live · <span className="mono">{time}</span></span></span>
          <button className="icon-btn" aria-label="Alerts"><Icon name="bell" />{alerts ? <span className="dot" style={{ boxShadow: "0 0 0 2px #fff", background: "#E5484D" }} /> : null}</button>
        </header>
        {children}
      </div>
    </div>
  );
}
