// ui.student — MobileApp (phase 0 shell).
import { useEffect, useState } from "react";
import { Phone } from "../shared/Shells";

export function MobileApp() {
  const [hubs, setHubs] = useState<Array<{ id: string; name: string; category: string }>>([]);
  useEffect(() => { fetch("/api/hubs").then((r) => r.json()).then(setHubs); }, []);
  return (
    <Phone tab="hubs" dark time="14:36">
      <div className="m-hero"><div className="greet">Good afternoon, Khoa</div><h1>Find a Hub</h1></div>
      <div className="content">
        {hubs.map((h) => (
          <article className="hub-card" key={h.id}><div className="top"><span className="hub-code lg">{h.id}</span><div className="grow"><div className="name">{h.name}</div><div className="where">{h.category}</div></div></div></article>
        ))}
      </div>
    </Phone>
  );
}
