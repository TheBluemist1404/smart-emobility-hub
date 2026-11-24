// A tiny Chrome DevTools Protocol driver for the screenshots and the visual checks.
// No npm dependencies: it starts the installed Chrome headless and talks to it over the
// WebSocket that Node 22+ has built in. Used by tools/screenshots.mjs.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const HELPERS = `
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        // Click the smallest visible clickable element whose text contains t (or matches a RegExp source).
        window.__click = (t, nth = 0) => {
          const re = t.startsWith("/") ? new RegExp(t.slice(1, -1)) : null;
          const ok = (e) => re ? re.test(e.textContent) : e.textContent.includes(t);
          const all = [...document.querySelectorAll("button, a, [role=button], .clickable, .choice, .chip, label, .nav-item, .seg span, .tabbar a, option, tr, .li, .hub-card, .card")]
            .filter((e) => vis(e) && ok(e) && !e.disabled);
          all.sort((a, b) => a.textContent.length - b.textContent.length);
          const e = all[nth];
          if (!e) throw new Error("no clickable: " + t);
          e.scrollIntoView({ block: "center" }); e.click(); return e.textContent.trim().slice(0, 60);
        };
        window.__set = (sel, v) => { const e = typeof sel === "string" ? document.querySelector(sel) : sel; if (!e) throw new Error("no field " + sel);
          const proto = e.tagName === "SELECT" ? HTMLSelectElement.prototype : e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(e, v); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); };
        // Layout problems: page wider than the window, or boxes that clip their content.
        window.__ov = (root = document) => {
          const out = []; const W = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > W + 1) out.push("page scrolls sideways: " + document.documentElement.scrollWidth + " > " + W);
          root.querySelectorAll("body *").forEach((e) => {
            const r = e.getBoundingClientRect(); if (!r.width) return;
            const cs = getComputedStyle(e);
            if (r.right > W + 1 && e.parentElement.getBoundingClientRect().right <= W + 1) out.push("past the right edge: " + e.tagName + "." + e.className);
            if (cs.overflowX !== "visible" && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.textOverflow !== "ellipsis" && !e.closest(".demo-drawer")) out.push("clips: " + e.tagName + "." + e.className + " " + e.scrollWidth + ">" + e.clientWidth + " " + e.textContent.slice(0, 40));
          });
          document.querySelectorAll("body *").forEach((e) => { if (e.children.length === 0 && /--:--/.test(e.textContent) && vis(e)) out.push("placeholder: " + e.textContent.trim()); });
          return [...new Set(out)];
        };
`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333 } = {}) {
  const exe = CHROMES.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome found; set CHROME to its path.");
  const profile = mkdtempSync(join(tmpdir(), "mvp-shots-"));
  const proc = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--lang=en-GB", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!ver) throw new Error("Chrome did not start");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable"); await s("Runtime.enable");
  // 24-hour times in <input type="datetime-local"> and friends, as on a Vietnamese/European machine.
  await s("Emulation.setLocaleOverride", { locale: "en-GB" }).catch(() => {});
  await s("Emulation.setTimezoneOverride", { timezoneId: "Asia/Ho_Chi_Minh" }).catch(() => {});
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });

  const page = {
    errors,
    async size(width, height, scale = 1, mobile = false) {
      await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
    },
    async go(url, wait = 1800) { await s("Page.navigate", { url }); await sleep(wait); await page.helpers(); },
    async eval(expr) {
      const r = await s("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n in: ${expr.slice(0, 120)}`);
      return r.result.value;
    },
    async helpers() { await page.eval(HELPERS + "return true;"); },
    // Run expr inside the i-th iframe (same origin), with the helpers loaded there too.
    frame(i, expr) {
      return page.eval(`const w = document.querySelectorAll("iframe")[${i}].contentWindow; return await w.eval(${JSON.stringify("(async () => { " + HELPERS)} + ${JSON.stringify(expr)} + " })()");`);
    },
    click: (t, nth = 0) => page.eval(`return window.__click(${JSON.stringify(t)}, ${nth});`),
    set: (sel, v) => page.eval(`window.__set(${JSON.stringify(sel)}, ${JSON.stringify(v)}); return true;`),
    ov: () => page.eval("return window.__ov();"),
    async shot(path, { full = false } = {}) {
      const r = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    // Full-page capture for pages that scroll the window (the console).
    async shotFull(path, width, scale = 1) {
      const h = await page.eval("return Math.ceil(document.documentElement.scrollHeight);");
      await page.size(width, h, scale); await sleep(500);
      await page.shot(path);
    },
  };
  return { page, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

export async function post(base, url, body = {}) {
  const r = await fetch(`${base}/api${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json().catch(() => ({}));
}
