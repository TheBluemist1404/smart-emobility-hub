// A warning shown in both views while a shared simulator (bank, dock unlock) is not at
// Success. Everyone on the public URL shares these settings, so a visitor who set
// "Bank → Failed" would otherwise make every other visitor's payments fail silently.
import { useState } from "react";
import { api, type DemoState } from "../shared/live";
import { Icon } from "../shared/Icon";
import { simulatorWarnings } from "../shared/simStatus";

export function SimWarning({ state, compact, console: inConsole }: { state: DemoState | null; compact?: boolean; console?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const w = simulatorWarnings(state);
  if (!w.length) return null;
  return (
    <div className={`banner warn compact sim-warning${compact ? " on-phone" : ""}${inConsole ? " in-console" : ""}`} role="alert">
      <span className="ic"><Icon name="flask-round" /></span>
      <b>Demo simulator changed: {w.join(" · ")}.</b>
      <p>It applies to everyone on this URL: payments or unlocks will fail or wait.</p>
      <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); api("/demo/normal", {}).finally(() => setBusy(false)); }}>
        <Icon name="rotate-ccw" className="ic-sm" />Back to normal
      </button>
    </div>
  );
}
