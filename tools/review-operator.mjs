// Visual check of O01–O06 at one width: full-page shots + layout problems found in the DOM.
// node tools/review-operator.mjs <base> <width> <outDir>
import { mkdirSync } from "node:fs";
import { launch, post, sleep } from "./cdp.mjs";

const [base = "http://localhost:5173", width = "1440", out = "review"] = process.argv.slice(2);
const W = Number(width);
mkdirSync(out, { recursive: true });
const { page, close } = await launch();
const report = {};
const snap = async (name) => {
  report[name] = await page.ov();
  await page.shotFull(`${out}/${W}-${name}.png`, W);
  await page.size(W, 900);
};
try {
  await post(base, "/demo/reset");
  await page.size(W, 900);
  await page.go(`${base}/operator?tools=0`);
  await snap("O01");
  await page.click("/^Redistribution orders/"); await sleep(800); await snap("O02");
  await page.click("New order"); await sleep(800); await snap("O02-new");
  await page.click("/^Smart charging/"); await sleep(1000); await snap("O03");
  await page.click("Generate Schedule"); await sleep(1500); await snap("O03-proposal");
  await page.click("Policy"); await sleep(600); await snap("O03-policy");
  await page.click("/^Incidents/"); await sleep(1000); await snap("O04");
  await page.click("New incident"); await sleep(800); await snap("O04-new");
  await page.click("/^What-if simulation/"); await sleep(1000); await snap("O05");
  await page.click("Run simulation"); await sleep(2000); await snap("O05-result");
  await page.click("/Apply \\d+ selected/"); await sleep(1500); await snap("O06-review");
  await page.click("Confirm and apply"); await sleep(1500); await snap("O06-result");
  report.consoleErrors = page.errors;
} finally { close(); }
console.log(JSON.stringify(report, null, 1));
