// Retakes every screenshot in screenshots/ from a running dev server.
//   npm run dev            (in another terminal)
//   node tools/screenshots.mjs [http://localhost:5173]
// It resets the demo first and walks DEMO-SCRIPT.md. Student shots: /student at 430 px,
// device scale 2. Operator shots: /operator at 1440 px, full page. Stage: 1920 × 1080.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launch, post, sleep } from "./cdp.mjs";

const base = process.argv[2] ?? "http://localhost:5173";
const out = fileURLToPath(new URL("../screenshots/", import.meta.url));
mkdirSync(out, { recursive: true });
const { page, close } = await launch({ port: 9336 });
const done = [];
const shot = async (name, full = false, width = 1440) => {
  if (full) { await page.shotFull(`${out}${name}.png`, width); await page.size(width, 900); } else await page.shot(`${out}${name}.png`);
  done.push(name);
};
const phone = (y) => page.eval(`document.querySelector(".phone .screen").scrollTo(0, ${y}); return true;`);
const back = async () => { await page.eval(`const b = document.querySelector(".m-appbar .icon-btn"); if (b) b.click(); return true;`); await sleep(800); };
const tab = async (t) => { await page.eval(`[...document.querySelectorAll(".tabbar a")].find((a) => a.textContent.includes(${JSON.stringify(t)})).click(); return true;`); await sleep(900); };
const vehicles = async (hub) => { await tab("Hubs"); await page.click(hub); await sleep(1000); };

try {
  // ── Student app ──
  await post(base, "/demo/reset");
  await page.size(430, 914, 2);
  await page.go(`${base}/student?tools=0`);
  await shot("S01-find-hub");
  await page.click("Map"); await sleep(700); await shot("S01-map"); await page.click("List"); await sleep(400);
  await page.click("KTX Khu A"); await sleep(1000); await shot("S02-hub-detail");
  await page.eval(`const row = [...document.querySelectorAll(".phone div")].filter((e) => e.textContent.includes("EB-0217") && e.querySelector("button")).sort((a, b) => a.textContent.length - b.textContent.length)[0]; row.querySelector("button").click(); return true;`);
  await sleep(1200); await shot("S03-reserve-vehicle");
  await page.click("Confirm & Pay"); await sleep(1500); await shot("S04-payment-processing");
  await sleep(5000); await shot("S04-reservation-ticket");
  await page.click("scan to pick up"); await sleep(1000); await shot("S09-scan");
  await page.click("Tap to scan"); await sleep(1200);
  await page.eval(`document.querySelectorAll(".phone .choice").forEach((c) => { if (c.querySelector(".check") && !c.classList.contains("on")) c.click(); }); return true;`);
  await sleep(400); await shot("S09-inspect");
  await page.click("Unlock"); await sleep(2500);
  await post(base, "/demo/clock", { action: "advance", ms: 15 * 60_000 }); await sleep(1500); await shot("S09-trip");
  await page.click("The vehicle broke down"); await sleep(1000); await shot("S08-report-during-trip"); await tab("Trip");
  await page.click("End Trip"); await sleep(1000); await shot("S10-return");
  {
    const ctx = await fetch(`${base}/api/demo/context`).then((r) => r.json());
    const trip = ctx.trips.find((t) => t.studentId === "2412345");
    const dock = ctx.vacantDocks.find((d) => d.hubId === "H01") ?? ctx.vacantDocks[0];
    await post(base, "/demo/latch", { dockId: dock.id, vehicleId: trip.vehicleId, engaged: true });
  }
  await sleep(14000); await shot("S10-receipt"); // after the "Trip ended" toast has gone
  await page.click("Done"); await sleep(800);
  await vehicles("KTX Khu A"); await page.click("/^Parking/"); await sleep(600); await page.click("Reserve parking"); await sleep(1000);
  await page.click("Find a space"); await sleep(1200); await shot("S05-reserve-parking");
  await page.click("Confirm & Pay"); await sleep(6000); await back();
  await post(base, "/student/vehicle", { type: "electric bicycle", id: "59-H1 678.90" }).catch(() => {});
  await vehicles("KTX Khu A"); await page.click("/^Charging/"); await sleep(600); await page.click("Schedule charging"); await sleep(1000);
  await page.eval(`const sel = document.querySelector(".phone select"); const o = [...sel.options].find((x) => x.value.includes("678.90")); window.__set(sel, o.value); return true;`); await sleep(800);
  await page.click("Find a slot"); await sleep(1500); await shot("S06-schedule-charging");
  await page.click("Confirm & Pay"); await sleep(6000); await back();
  await tab("Report"); await page.click("/^Vehicle failure/"); await sleep(500);
  await page.set(".phone textarea", "The rear brake does not grip."); await sleep(400); await shot("S07-report-issue");
  await tab("Bookings"); await sleep(400); await shot("S11-bookings");
  await tab("Hubs"); await page.eval(`document.querySelector(".m-hero .icon-btn").click(); return true;`); await sleep(1000); await shot("S12-notifications");

  // ── Operator console ──
  await post(base, "/demo/reset");
  await page.size(1440, 900, 1);
  await page.go(`${base}/operator?tools=0`);
  await shot("O01-network-monitor");
  await page.eval(`scrollTo(0, document.documentElement.scrollHeight); return true;`); await sleep(500); await shot("O01-hub-panel-H02");
  await page.eval(`scrollTo(0, 0); return true;`);
  await page.click("/^Redistribution orders/"); await sleep(1000); await shot("O02-redistribution-orders", true);
  await page.click("Use suggestion"); await sleep(800); await shot("O02-new-order", true);
  await page.click("/^Smart charging/"); await sleep(1000); await page.click("Generate Schedule"); await sleep(1500); await shot("O03-smart-charging", true);
  await page.click("/^Incidents/"); await sleep(1000); await shot("O04-incidents", true);
  await page.click("/^What-if simulation/"); await sleep(1000);
  for (const h of ["H03", "H05"]) await page.eval(`[...document.querySelectorAll(".chip")].find((c) => c.textContent.trim() === ${JSON.stringify(h)}).click(); return true;`);
  await sleep(300); await page.click("Run simulation"); await sleep(2000); await shot("O05-what-if-simulation", true);
  await page.click("/Apply \\d+ selected/"); await sleep(1500); await shot("O06-apply-review", true);
  await page.click("Confirm and apply"); await sleep(1500); await shot("O06-apply-result", true);
  await page.size(1280, 900); await page.click("/^Network monitor/"); await sleep(1200); await shot("O01-network-monitor-1280", true, 1280);

  // ── Stage: the cross-actor push (DEMO-SCRIPT part 2) ──
  await post(base, "/demo/reset");
  await page.size(1920, 1080, 1);
  await page.go(`${base}/stage`, 4000);
  await page.frame(0, `window.__click("KTX Khu A"); await new Promise((r) => setTimeout(r, 1200));
    const row = [...document.querySelectorAll(".phone div")].filter((e) => e.textContent.includes("EB-0217") && e.querySelector("button")).sort((a, b) => a.textContent.length - b.textContent.length)[0]; row.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 1500)); window.__click("Confirm & Pay"); return true;`);
  await sleep(6500);
  await page.frame(1, `window.__click("/^Incidents/"); await new Promise((r) => setTimeout(r, 1000)); window.__click("New incident"); await new Promise((r) => setTimeout(r, 800));
    window.__set(document.querySelector(".field input"), "EB-0217"); window.__set(document.querySelector("textarea"), "Brake cable snapped at the dock.");
    await new Promise((r) => setTimeout(r, 300)); window.__click("Create incident"); await new Promise((r) => setTimeout(r, 1500));
    window.__click("Start handling"); await new Promise((r) => setTimeout(r, 1200));
    window.__set(document.querySelector("textarea"), "Taken out of service; reservation moved."); await new Promise((r) => setTimeout(r, 300));
    window.__click("Block resource"); return true;`);
  await sleep(1800); await shot("STAGE-cross-actor-push");
  console.log("errors:", page.errors);
} finally { close(); }
console.log(`${done.length} screenshots:`, done.join(", "));
