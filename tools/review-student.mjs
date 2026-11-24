// Visual check of the student app S01–S12 along DEMO-SCRIPT.md at one width.
// node tools/review-student.mjs <base> <width> <outDir>
// The phone screen scrolls inside the device, so each shot is the viewport.
import { mkdirSync } from "node:fs";
import { launch, post, sleep } from "./cdp.mjs";

const [base = "http://localhost:5173", width = "390", out = "review"] = process.argv.slice(2);
const W = Number(width);
const H = W <= 420 ? 844 : 914;
mkdirSync(out, { recursive: true });
const { page, close } = await launch({ port: 9334 });
const report = {};
const snap = async (name) => { report[name] = await page.ov().catch((e) => [String(e)]); await page.shot(`${out}/${W}-${name}.png`); };
const step = async (label, fn) => { try { await fn(); } catch (e) { (report.failed ??= []).push(`${label}: ${e.message.split("\n")[0]}`); } };
const scrollPhone = (y) => page.eval(`document.querySelector(".phone .screen").scrollTo(0, ${y}); return true;`);
const back = async () => { await page.eval(`const b = document.querySelector(".m-appbar .icon-btn"); if (b) b.click(); return true;`); await sleep(800); };
const tab = (t) => page.eval(`[...document.querySelectorAll(".tabbar a")].find((a) => a.textContent.includes(${JSON.stringify(t)})).click(); return true;`);
try {
  await post(base, "/demo/reset");
  await page.size(W, H, 2, W <= 420);
  await page.go(`${base}/student?tools=0`);
  await snap("S01");
  await step("map", async () => { await page.click("Map"); await sleep(700); await snap("S01-map"); await page.click("List"); await sleep(400); });
  await step("H06 stale", async () => { await scrollPhone(2000); await sleep(300); await snap("S01-bottom"); await scrollPhone(0); });
  await step("S02", async () => { await page.click("KTX Khu A"); await sleep(1000); await snap("S02"); });
  await step("S02 parking", async () => { await page.click("/^Parking/"); await sleep(600); await snap("S02-parking"); });
  await step("S02 charging", async () => { await page.click("/^Charging/"); await sleep(600); await snap("S02-charging"); await page.click("/^Vehicles/"); await sleep(500); });
  await step("S03", async () => {
    await page.eval(`const row = [...document.querySelectorAll(".li, .veh, .card, div")].filter((e) => e.textContent.includes("EB-0217") && e.querySelector("button")).sort((a, b) => a.textContent.length - b.textContent.length)[0]; row.querySelector("button").click(); return true;`);
    await sleep(1200); await snap("S03");
  });
  await step("S04 pay", async () => { await page.click("Confirm & Pay"); await sleep(1500); await snap("S04-processing"); await sleep(5000); await snap("S04-ticket"); await scrollPhone(2000); await sleep(300); await snap("S04-ticket-bottom"); await scrollPhone(0); });
  await step("S09 pickup", async () => {
    await page.click("scan to pick up"); await sleep(1000); await snap("S09-scan");
    await page.click("Tap to scan"); await sleep(1200); await snap("S09-inspect");
    await page.eval(`document.querySelectorAll(".phone .choice").forEach((c) => { if (c.querySelector(".check") && !c.classList.contains("on")) c.click(); }); return true;`); await sleep(300);
    await sleep(300); await snap("S09-inspect-checked"); await page.click("Unlock"); await sleep(2500); await snap("S09-trip");
  });
  await step("trip +15", async () => { await post(base, "/demo/clock", { action: "advance", ms: 15 * 60_000 }); await sleep(1500); await snap("S09-trip-15min"); });
  await step("S08", async () => { await page.click("The vehicle broke down"); await sleep(1000); await snap("S08"); await tab("Trip"); await sleep(800); });
  await step("S10 end", async () => {
    await page.click("End Trip"); await sleep(1000); await snap("S10-return");
    const ctx = await fetch(`${base}/api/demo/context`).then((r) => r.json());
    const trip = ctx.trips.find((t) => t.studentId === "2412345");
    const dock = ctx.vacantDocks.find((d) => d.hubId === "H01") ?? ctx.vacantDocks[0];
    await post(base, "/demo/latch", { dockId: dock.id, vehicleId: trip.vehicleId, engaged: true }); await sleep(1500); await snap("S10-paying");
    await sleep(6000); await snap("S10-receipt");
    await scrollPhone(2000); await sleep(300); await snap("S10-receipt-bottom"); await scrollPhone(0); await page.click("Done").catch(() => {}); await sleep(800);
  });
  await step("S05", async () => {
    await back(); await tab("Hubs"); await sleep(800); await page.click("KTX Khu A"); await sleep(1000); await page.click("/^Parking/"); await sleep(600);
    await page.click("Reserve parking"); await sleep(1000); await snap("S05");
    await page.click("Find a space"); await sleep(1200); await snap("S05-offer");
    await page.click("Confirm & Pay"); await sleep(6000); await snap("S05-confirmed"); await back();
  });
  await step("S06", async () => {
    await tab("Hubs"); await sleep(800); await page.click("KTX Khu A"); await sleep(1000); await page.click("/^Charging/"); await sleep(600);
    await page.click("Schedule charging"); await sleep(1000); await snap("S06");
    await post(base, "/student/vehicle", { type: "electric bicycle", id: "59-H1 678.90" }).catch(() => {}); await sleep(800);
    await page.eval(`const sel = document.querySelector(".phone select"); const o = [...sel.options].find((x) => x.value.includes("678.90")); window.__set(sel, o.value); return o.textContent;`); await sleep(800);
    await page.click("Find a slot"); await sleep(1500); await snap("S06-offer");
    await page.click("Confirm & Pay"); await sleep(6000); await snap("S06-confirmed"); await back();
  });
  await step("S07", async () => {
    await back(); await tab("Report"); await sleep(1000); await snap("S07");
    await page.click("Send report"); await sleep(800); await snap("S07-errors");
  });
  await step("S11 after", async () => { await tab("Bookings"); await sleep(1000); await snap("S11-after"); });
  await step("S12", async () => { await tab("Hubs"); await sleep(800); await page.eval(`document.querySelector(".m-hero .icon-btn, [aria-label*=otif]").click(); return true;`); await sleep(1000); await snap("S12"); });
  await step("S04 failed", async () => {
    await post(base, "/demo/bank", { mode: "Failed", once: true });
    await tab("Hubs"); await sleep(800); await page.click("Ga Metro"); await sleep(1000);
    await page.eval(`const b = [...document.querySelectorAll(".phone button")].find((x) => /Reserve/.test(x.textContent) && !x.disabled); b.click(); return true;`);
    await sleep(1200); await page.click("Confirm & Pay"); await sleep(6000); await snap("S04-failed");
  });
  report.consoleErrors = page.errors;
} finally { close(); }
console.log(JSON.stringify(report, null, 1));
