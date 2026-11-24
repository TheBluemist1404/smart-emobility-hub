// The schematic campus map of ui-design/assets/ds.js (.map[data-map]) as a React component.
import type { CSSProperties, ReactNode } from "react";

export interface Pin { code: string; x: number; y: number; label?: string; s?: "ok" | "info" | "warn" | "danger" | "stale" | "neutral"; sel?: boolean; onClick?: () => void }
const STATUS_COLOR: Record<string, string> = { ok: "#14A36D", info: "#3B6FF0", warn: "#E2A336", danger: "#E5484D", neutral: "#8A93A8", stale: "#C9932B" };

export function CampusMap({ pins, legend, scale, style, children }: { pins: Pin[]; legend?: Array<[string, string]>; scale?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className="map" style={style}>
      <svg className="base" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="100" fill="#EAF0E8" />
        <path d="M0 0 H38 V22 H0Z" fill="#D7E8D2" /><path d="M62 64 H100 V100 H70Z" fill="#D7E8D2" />
        <path d="M8 60 C18 52 30 58 34 70 C38 82 22 92 10 86 C2 82 0 70 8 60Z" fill="#CFE2F3" />
        <g fill="#DDE3DA"><rect x="44" y="6" width="14" height="10" rx="1.5" /><rect x="70" y="8" width="20" height="12" rx="1.5" />
          <rect x="44" y="40" width="12" height="14" rx="1.5" /><rect x="74" y="38" width="16" height="12" rx="1.5" />
          <rect x="40" y="76" width="18" height="12" rx="1.5" /></g>
        <g stroke="#FFFFFF" strokeWidth="7" vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round">
          <path d="M0 30 C30 28 60 34 100 30" /><path d="M40 0 C42 40 36 70 44 100" /><path d="M62 0 C64 30 70 60 100 70" /><path d="M0 56 C20 50 30 48 40 46" /></g>
        <g stroke="#CDD5DF" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none">
          <path d="M0 30 C30 28 60 34 100 30" /><path d="M40 0 C42 40 36 70 44 100" /><path d="M62 0 C64 30 70 60 100 70" /></g>
        <path d="M0 14 C40 16 70 12 100 18" stroke="#7C5CFF" strokeWidth="3" strokeDasharray="7 5" vectorEffect="non-scaling-stroke" fill="none" opacity=".55" />
      </svg>
      {pins.map((p) => (
        <div key={p.code} className={`pin ${p.s ?? "ok"}${p.sel ? " sel" : ""}${p.onClick ? " clickable" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={p.onClick}>
          <div className="bub"><span className="hub-code">{p.code}</span>{p.label}</div><div className="stem" /><div className="foot" />
        </div>
      ))}
      {legend && <div className="legend">{legend.map(([s, t]) => <span key={t}><i style={{ background: STATUS_COLOR[s] }} />{t}</span>)}</div>}
      {scale && <div className="scale">{scale}</div>}
      {children}
    </div>
  );
}
