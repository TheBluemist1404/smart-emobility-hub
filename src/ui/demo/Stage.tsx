// The presentation stage: the student phone and the operator console side by side.
// Both run in iframes with their own Demo tools hidden; the stage shows the one Demo tools
// button. The phone is scaled to fit the height. The console is laid out at the column width,
// but never narrower than CONSOLE_MIN; below that it is laid out at CONSOLE_MIN and scaled down.
import { useEffect, useState } from "react";
import { DemoTools } from "./DemoTools";
import { Icon } from "../shared/Icon";

const BAR = 48;
const PHONE_W = 430;
const PHONE_H = 892; // 844 px device + 24 px padding above and below
const CONSOLE_MIN = 960;

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

export function Stage() {
  const { w, h } = useViewport();
  const bodyH = Math.max(200, h - BAR);
  const ps = Math.min(1, (bodyH - 8) / PHONE_H);
  const leftW = Math.round(PHONE_W * ps) + 8;
  const rightW = Math.max(200, w - leftW - 1);
  const cw = Math.max(rightW, CONSOLE_MIN);
  const cs = rightW / cw;
  return (
    <div className="stage">
      <header className="stage-bar">
        <div className="lbl" style={{ width: leftW, justifyContent: "center", padding: 0 }}><span className="brand-mark"><Icon name="zap" /></span><b>Student app</b>Nguyen Minh Khoa</div>
        <div className="lbl"><b>Operator console</b>Tran Lan · OP-014{cs < 1 && <span style={{ color: "var(--ink-500)" }}>· scaled {Math.round(cs * 100)}%</span>}</div>
        <span className="grow" />
        <DemoTools side="stage" />
      </header>
      <div className="stage-body">
        <div className="left" style={{ width: leftW }}>
          <iframe title="Student app" src="/student?embed=1&tools=0" style={{ width: PHONE_W, height: Math.max(PHONE_H, bodyH / ps), flex: "none", transform: `scale(${ps})`, transformOrigin: "center center" }} />
        </div>
        <div className="right">
          <iframe title="Operator console" src="/operator?embed=1&tools=0" style={{ width: cw, height: bodyH / cs, transform: cs < 1 ? `scale(${cs})` : undefined }} />
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="landing">
      <div className="eyebrow">HCMUT · HK261 · Software Engineering · Group 4 · CC03</div>
      <h1 className="h1" style={{ marginTop: 8 }}>Smart E-Mobility Hub — MVP</h1>
      <p className="muted" style={{ marginTop: 8 }}>One server, two views, a demo clock and a simulator for the IoT / Simulated Data Source and the Bank System.</p>
      <a className="card" href="/stage"><b>Demo stage</b><p className="small muted">Student phone and operator console side by side.</p></a>
      <a className="card" href="/student"><b>Student app</b><p className="small muted">Nguyen Minh Khoa · 2412345 — screens S01–S12, 390 px.</p></a>
      <a className="card" href="/operator"><b>Operator console</b><p className="small muted">Tran Lan · OP-014 — screens O01–O06, 1440 px.</p></a>
    </div>
  );
}
