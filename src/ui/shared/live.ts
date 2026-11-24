// Live data for the views: fetch a view model, refetch whenever the server pushes
// "changed" over the WebSocket. Also the demo clock as seen by the browser.
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ transports: ["websocket", "polling"] });
  return socket;
}

export async function api<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, (data as { code?: string }).code);
  return data as T;
}
export class ApiError extends Error { constructor(m: string, public code?: string) { super(m); } }

/** GET `url` now and after every push. `url === null` pauses. */
export function useLive<T>(url: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const load = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    api<T>(u).then((d) => { if (urlRef.current === u) { setData(d); setError(null); } }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { setData(null); load(); }, [url, load]);
  useEffect(() => {
    const s = getSocket();
    s.on("changed", load);
    return () => { s.off("changed", load); };
  }, [load]);
  return { data, error, reload: load };
}

export interface DemoState {
  now: number; speed: number; paused: boolean;
  timers: Array<{ id: number; label: string; dueAt: number }>;
  bank: { mode: string; nextMode: string | null; outstanding: Array<{ requestId: string; type: string; orderRef: string; amount: number; sentAt: number }>; delayMs: number };
  unlock: { mode: string; nextMode: string | null; pending: number };
  silentHubs: string[]; silentResources: string[]; pluggedIn: string[];
  events: Array<{ time: number; text: string }>;
  hubs: Array<{ id: string; name: string; status: string }>;
}

/** The demo clock, ticking smoothly in the browser between server pushes. */
export function useClock(): { now: number; state: DemoState | null } {
  const { data } = useLive<DemoState>("/demo/state");
  const [base, setBase] = useState<{ server: number; local: number; speed: number; paused: boolean } | null>(null);
  const [, force] = useState(0);
  useEffect(() => { if (data) setBase({ server: data.now, local: Date.now(), speed: data.speed, paused: data.paused }); }, [data]);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 250); return () => clearInterval(t); }, []);
  const now = base ? (base.paused ? base.server : base.server + (Date.now() - base.local) * base.speed) : 0;
  return { now, state: data };
}

const H7 = 7 * 3_600_000;
export const hms = (ms: number) => (ms ? new Date(ms + H7).toISOString().slice(11, 19) : "--:--:--");
export const hm = (ms: number) => (ms ? new Date(ms + H7).toISOString().slice(11, 16) : "--:--");
export const dayLabel = (ms: number) => {
  const d = new Date(ms + H7);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const vnd = (n: number) => `${Math.round(n).toLocaleString("en-US")} VND`;
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const hhmmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const ago = (now: number, t: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};
