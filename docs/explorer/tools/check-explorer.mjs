#!/usr/bin/env node
// Opens the explorer in headless Chrome and visits every view: the map, every box, every flow step, every concept
// level and frame, every recap, in light and dark. On each it checks what a reader would notice:
//   JS errors · labels hidden behind or touching boxes · labels on top of each other · labels that found no free spot
//   · boxes overlapping · text running out of its box · map arrows passing through a box · horizontal page scroll.
//   node check-explorer.mjs <page.html | http://localhost:5173/dev/explorer> [--width 1440] [--shots <dir>] [--only flows|concepts|map]
// Needs Node 22+ (built-in WebSocket) and Chrome or Chromium (or set CHROME=/path/to/chrome). Exit code 1 if anything failed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const width = Number(flag("--width", 1440)), shots = flag("--shots", null), only = flag("--only", null);
const target = args[0];
if (!target) { console.error("usage: node check-explorer.mjs <page.html | url> [--width 1440] [--shots dir] [--only flows|concepts|map]"); process.exit(2); }
if (typeof WebSocket === "undefined") { console.error("Node 22+ is needed (built-in WebSocket)."); process.exit(2); }
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;

const chromePath = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(p => existsSync(p));
if (!chromePath) { console.error("Chrome not found: set CHROME=/path/to/chrome"); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "xp-check-"));
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

let list;
for (let i = 0; i < 75 && !list; i++) { await sleep(200); list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null); }
const page = list?.find(t => t.type === "page");
if (!page) { console.error("could not talk to Chrome"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const pending = new Map(), errors = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map(a => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise(r => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
await send("Page.navigate", { url });
let ready = false;
for (let i = 0; i < 100 && !ready; i++) { await sleep(150); ready = await evaluate("!!window.__explorer").catch(() => false); }
if (!ready) { console.error(`the page never mounted the explorer (window.__explorer missing): ${url}\n${errors.join("\n")}`); process.exit(1); }

// Every view the reader can reach.
const views = await evaluate(`(() => {
  const d = window.__explorer.data, v = [["map", "showMap()"]];
  for (const n of d.map?.nodes || []) v.push(["map", "node " + n.id, "showNode(" + JSON.stringify(n.id) + ")"]);
  for (const f of d.flows || []) (f.steps || []).forEach((s, i) => v.push(["flows", f.id + " step " + (i + 1), "showFlow(" + JSON.stringify(f.id) + "," + (i + 1) + ")"]));
  for (const c of d.concepts || []) {
    for (const l of c.levels) for (const fr of [0, 1, 2]) v.push(["concepts", c.id + " " + l.id + " frame " + (fr + 1), "showConcept(" + JSON.stringify(c.id) + "," + JSON.stringify(l.id) + "," + fr + ")"]);
    v.push(["concepts", c.id + " recap", "showConcept(" + JSON.stringify(c.id) + ",'recap',0)"]);
  }
  return v.map(x => x.length === 2 ? [x[0], "map", x[1]] : x);
})()`);

// Runs inside the page: geometry checks on whatever is showing.
const PROBE = `(() => {
  const P = [], root = document.querySelector(".xp");
  const vis = e => e && e.getClientRects().length > 0;
  const svg = [root.querySelector(".xp-scene"), root.querySelector(".xp-diagram")].find(vis);
  const hit = (a, b, m = 0) => a.x < b.x + b.width - m && a.x + a.width > b.x + m && a.y < b.y + b.height - m && a.y + a.height > b.y + m;
  const txt = e => (e.textContent || "").slice(0, 40);
  if (svg) {
    const scene = svg.classList.contains("xp-scene");
    const boxes = [...svg.querySelectorAll(scene ? ".sn:not(.ghost)" : ".node")].map(g => {
      const r = g.querySelector("rect.box"); return { g, id: g.dataset.id, r: { x: +r.getAttribute("x"), y: +r.getAttribute("y"), width: +r.getAttribute("width"), height: +r.getAttribute("height") } };
    });
    const vb = svg.viewBox.baseVal;
    const labels = [...svg.querySelectorAll(scene ? ".lbl" : ".elbl")].map(t => ({ t, r: t.getBBox() }));
    for (const l of labels) {
      if (l.t.dataset.unplaced) P.push("label found no free spot: " + txt(l.t));
      for (const b of boxes) if (hit(l.r, b.r, 1)) P.push("label over box " + b.id + ": " + txt(l.t));
      if (l.r.x < 0 || l.r.x + l.r.width > vb.width) P.push("label outside the drawing: " + txt(l.t));
      for (const ln of svg.querySelectorAll(".lane-label")) if (hit(l.r, ln.getBBox(), 1)) P.push("label over lane title " + txt(ln) + ": " + txt(l.t));
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++)
      if (hit(labels[i].r, labels[j].r, 1)) P.push("labels overlap: " + txt(labels[i].t) + " / " + txt(labels[j].t));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
      if (hit(boxes[i].r, boxes[j].r)) P.push("boxes overlap: " + boxes[i].id + " / " + boxes[j].id);
    for (const b of boxes) for (const t of b.g.querySelectorAll("text:not(.tagtxt)")) {
      const r = t.getBBox(); if (r.width && r.x + r.width > b.r.x + b.r.width - 3) P.push("text runs out of box " + b.id + ": " + txt(t));
    }
    if (scene) for (const t of svg.querySelectorAll(".tagtxt")) {
      const r = t.getBBox(); for (const b of boxes) if (!b.g.contains(t) && hit(r, b.r, 1)) P.push("box tag over box " + b.id + ": " + txt(t));
    }
    if (!scene) {   // arrows through boxes
      const segs = p => { const a = p.split(/[ML]/).filter(Boolean).map(s => s.trim().split(",").map(Number)); return a.slice(1).map((q, i) => [a[i], q]); };
      for (const e of svg.querySelectorAll(".edge")) {
        const [from, to] = e.dataset.id.split(">");
        for (const [[x1, y1], [x2, y2]] of segs(e.querySelector("path").getAttribute("d"))) {
          const sr = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1) || 0.1, height: Math.abs(y2 - y1) || 0.1 };
          for (const b of boxes) if (b.id !== from && b.id !== to && hit(sr, b.r, 2)) P.push("arrow " + e.dataset.id + " passes through box " + b.id);
        }
      }
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) P.push("the page scrolls sideways");
  return [...new Set(P)];
})()`;

let failed = 0, shown = 0;
const themes = ["light", "dark"];
for (const theme of themes) {
  await evaluate(`window.__explorer.setTheme(${JSON.stringify(theme)})`);
  for (const [kind, name, call] of views) {
    if (only && kind !== only) continue;
    if (theme === "dark" && name.startsWith("node ")) continue;   // boxes look the same in both themes
    const before = errors.length;
    await evaluate(`window.__explorer.${call}`).catch(e => errors.push(`${name}: ${e.message}`));
    await sleep(60);
    const problems = await evaluate(PROBE).catch(e => [`probe failed: ${e.message}`]);
    const newErrors = errors.slice(before);
    if (problems.length || newErrors.length) {
      failed++;
      console.log(`✗ [${theme}] ${name}`);
      for (const p of [...newErrors.map(e => "JS error: " + e), ...problems]) console.log("    " + p);
    }
    if (shots && (theme === "light" || !name.startsWith("node "))) {
      mkdirSync(shots, { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `${theme}-${name.replace(/[^a-z0-9]+/gi, "_")}.png`), Buffer.from(shot.result.data, "base64"));
    }
    shown++;
  }
}
console.log(failed ? `\n${failed} of ${shown} views have problems.` : `\nAll ${shown} views clean (${themes.join(" + ")}, ${width}px).`);
ws.close();
process.exit(failed ? 1 : 0);
