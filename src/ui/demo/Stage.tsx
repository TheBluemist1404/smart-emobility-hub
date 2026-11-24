// The presentation stage: the student phone and the operator console side by side.
export function Stage() {
  return (
    <div className="stage">
      <div className="left"><iframe title="Student app" src="/student?embed=1" style={{ width: 430, height: 900 }} /></div>
      <div className="right"><iframe title="Operator console" src="/operator?embed=1" /></div>
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
