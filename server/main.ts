// One Node process plays the whole deployment view: web server, application server,
// ingestion server (IoT gateway + simulated data source), scheduler (the demo clock) and
// the in-memory state. Vite serves the two front-ends from the same port.
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createServer as createVite } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { boot } from "../src/api/boot";
import { apiRouter } from "../src/api/routes";
import { bus } from "../src/platform/events/bus";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5173);

async function main() {
  boot();
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter());

  const http = createServer(app);
  const io = new Server(http, { cors: { origin: "*" } });

  // WebSocket push (the WSS channel of the deployment view). "changed" is debounced so a
  // burst of updates produces one refetch per view.
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  bus.on((e) => {
    if (e.kind === "changed") {
      pending.push(e.reason);
      if (!timer) timer = setTimeout(() => { io.emit("changed", { reasons: [...new Set(pending)] }); pending = []; timer = null; }, 120);
    } else if (e.kind === "notify") {
      io.emit("notify", e);
    } else if (e.kind === "warn") {
      io.emit("warn", e);
    }
  });

  const vite = await createVite({ root, configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: { server: http } }, appType: "spa" });
  app.use(vite.middlewares);

  http.listen(PORT, () => {
    console.log(`Smart E-Mobility Hub MVP running at http://localhost:${PORT}`);
    console.log(`  student app      http://localhost:${PORT}/student`);
    console.log(`  operator console http://localhost:${PORT}/operator`);
    console.log(`  demo stage       http://localhost:${PORT}/stage`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
