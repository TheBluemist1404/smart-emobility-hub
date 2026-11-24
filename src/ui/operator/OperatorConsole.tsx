// ui.operator — OperatorConsole (phase 0 shell).
import { useEffect, useState } from "react";
import { Console } from "../shared/Shells";

export function OperatorConsole() {
  const [hubs, setHubs] = useState<Array<{ id: string; name: string; category: string }>>([]);
  useEffect(() => { fetch("/api/hubs").then((r) => r.json()).then(setHubs); }, []);
  return (
    <Console nav="monitor" crumb={["Operations", "Network monitor"]} time="14:36:00">
      <div className="c-body"><div className="page-head"><h1 className="h2">Network monitor</h1></div>
        <div className="card"><table className="table"><thead><tr><th>Hub</th><th>Category</th></tr></thead>
          <tbody>{hubs.map((h) => <tr key={h.id}><td><span className="hub-code">{h.id}</span> {h.name}</td><td>{h.category}</td></tr>)}</tbody></table></div>
      </div>
    </Console>
  );
}
