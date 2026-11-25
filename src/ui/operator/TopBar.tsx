// The console top bar's search ("Search Hub, vehicle, order, incident") and alert bell.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { api, hm } from "../shared/live";
import type { OpGo, OpRoute } from "./OperatorConsole";

interface Hit { kind: string; id: string; title: string; sub: string; go: OpRoute }
export interface Alert { id: string; time: number; hubId?: string; kind: string; message: string; acknowledgedBy?: string }

const KIND_ICON: Record<string, string> = { Hub: "map-pin", Vehicle: "bike", Order: "truck", Incident: "siren", "Charging point": "plug-zap", Dock: "layout-grid", "Parking space": "square-parking" };

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

export function HeaderSearch({ go }: { go: OpGo }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const ref = useDismiss(open, () => setOpen(false));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => { api<Hit[]>(`/operator/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r); setI(0); }).catch(() => setHits([])); }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const choose = (h: Hit) => { go(h.go); setQ(""); setHits(null); setOpen(false); input.current?.blur(); };
  return (
    <div className="search-wrap" ref={ref}>
      <label className="search">
        <Icon name="search" className="ic-sm" />
        <input ref={input} value={q} placeholder="Search Hub, vehicle, order, incident" aria-label="Search Hub, vehicle, order, incident"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (!hits?.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setI((i + 1) % hits.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((i - 1 + hits.length) % hits.length); }
            else if (e.key === "Enter") { e.preventDefault(); choose(hits[i]); }
          }} />
        <kbd>/</kbd>
      </label>
      {open && hits && (
        <div className="pop search-pop"><div className="list" role="listbox">
          {hits.map((h, k) => (
            <div key={`${h.kind}${h.id}`} role="option" aria-selected={k === i} className={`li clickable${k === i ? " sel" : ""}`} onMouseEnter={() => setI(k)} onMouseDown={(e) => { e.preventDefault(); choose(h); }}>
              <Icon name={KIND_ICON[h.kind] ?? "search"} className="ic-sm" />
              <div className="grow"><div className="t">{h.title}</div><div className="s">{h.sub}</div></div>
              <span className="chip neutral nodot">{h.kind}</span>
            </div>
          ))}
          {hits.length === 0 && <div className="li small subtle">Nothing matches “{q.trim()}”. Try a Hub (H02), vehicle (EB-0217), order (RO-0312) or incident (INC-0190).</div>}
        </div></div>
      )}
    </div>
  );
}

export function AlertBell({ alerts, go }: { alerts: Alert[]; go: OpGo }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const unacked = alerts.filter((a) => !a.acknowledgedBy);
  const ack = (id: string) => api("/operator/alerts/ack", { id }).catch(() => {});
  return (
    <div className="bell-wrap" ref={ref}>
      <button className="icon-btn" aria-label={`Alerts${unacked.length ? ` (${unacked.length} new)` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />{unacked.length ? <span className="dot" style={{ boxShadow: "0 0 0 2px #fff", background: "#E5484D" }} /> : null}
      </button>
      {open && (
        <div className="pop bell-pop">
          <div className="card-head"><span className="h4"><Icon name="bell" />Alerts</span>
            <span className="row" style={{ gap: 8 }}><span className="small subtle">{unacked.length} new</span>
              {unacked.length > 1 && <button className="btn ghost sm" onClick={() => unacked.forEach((a) => ack(a.id))}>Acknowledge all</button>}</span></div>
          <div className="list">
            {alerts.slice(0, 15).map((a) => (
              <div key={a.id} className={`li${a.hubId ? " clickable" : ""}`} style={{ alignItems: "flex-start", opacity: a.acknowledgedBy ? 0.6 : 1 }}
                onClick={() => { if (a.hubId) { go({ nav: "monitor", hubId: a.hubId }); setOpen(false); } }}>
                <span className="mono small" style={{ paddingTop: 1 }}>{hm(a.time)}</span>
                <div className="grow"><div className="t">{a.kind}</div><div className="s">{a.message}</div></div>
                {a.acknowledgedBy ? <span className="xs subtle">Acknowledged</span>
                  : <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); ack(a.id); }}>Acknowledge</button>}
              </div>
            ))}
            {alerts.length === 0 && <div className="li small subtle">No alerts.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
