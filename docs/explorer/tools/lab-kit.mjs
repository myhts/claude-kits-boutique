#!/usr/bin/env node
// Small HTTP lab driver: enough load to make a threshold cross on your own machine, and the numbers to prove it.
// Copy it into the project and add project-specific commands next to these (a lag check, a reconcile query…).
//   burst  N requests at once                  lab-kit.mjs burst --url http://localhost:3000/orders --method POST --body '{"qty":1}' --n 30
//   flood  as fast as possible for S seconds   lab-kit.mjs flood --url … --seconds 5 --concurrency 64
//   probe  one request every X ms              lab-kit.mjs probe --url … --every 250 --seconds 20     (watch a breaker open and close)
//   poll   until a JSON field has a value      lab-kit.mjs poll --url http://localhost:3000/orders/o-1 --json status=PAID --timeout 30
// Options: --method GET · --header "K: V" (repeat) · --body '…' · --key-header Idempotency-Key (a unique key per request)
//   Placeholders in url/body/headers: {n} request number · {run} id of this run · {uuid}
// Safety: only talks to localhost unless --allow-remote is given. Never point it at shared or production systems.
import { randomUUID } from "node:crypto";

const [cmd, ...rest] = process.argv.slice(2);
const opt = {}, headers = [];
for (let i = 0; i < rest.length; i++) {
  const k = rest[i].replace(/^--/, "");
  if (k === "allow-remote") { opt[k] = true; continue; }
  const v = rest[++i];
  if (k === "header") headers.push(v); else opt[k] = v;
}
if (!cmd || !opt.url) { console.error("usage: lab-kit.mjs burst|flood|probe|poll --url <url> [options] (see the header of this file)"); process.exit(2); }
const host = new URL(opt.url.replace(/\{[^}]+\}/g, "x")).hostname;
if (!opt["allow-remote"] && !["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"].includes(host) && !host.endsWith(".localhost")) {
  console.error(`refusing to send load to ${host}: labs run against your own machine. Pass --allow-remote only for a system you own and may load.`);
  process.exit(2);
}
const run = Math.random().toString(36).slice(2, 8);
const fill = (s, n) => s?.replaceAll("{n}", n).replaceAll("{run}", run).replaceAll("{uuid}", randomUUID());
const WATCH = ["retry-after", "ratelimit-remaining", "ratelimit-policy", "x-ratelimit-remaining", "location"];

async function one(n) {
  const h = { ...(opt.body ? { "content-type": "application/json" } : {}) };
  for (const line of headers) { const i = line.indexOf(":"); h[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), n); }
  if (opt["key-header"]) h[opt["key-header"]] = `lab-${run}-${n}`;
  const t = performance.now();
  try {
    const r = await fetch(fill(opt.url, n), { method: opt.method || (opt.body ? "POST" : "GET"), headers: h, body: fill(opt.body, n),
      signal: AbortSignal.timeout(Number(opt.timeout || 30) * 1000) });
    const body = await r.text();
    return { status: r.status, ms: performance.now() - t, headers: Object.fromEntries(WATCH.filter(k => r.headers.has(k)).map(k => [k, r.headers.get(k)])), body };
  } catch (e) {
    return { status: e.name === "TimeoutError" ? "timeout" : "error", ms: performance.now() - t, headers: {}, body: String(e.cause?.code || e.message) };
  }
}
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
function summary(results, seconds) {
  const by = {};
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
  const ms = results.map(r => r.ms);
  console.log(`requests: ${results.length}${seconds ? ` in ${seconds.toFixed(2)} s = ${(results.length / seconds).toFixed(0)} req/s` : ""}`);
  console.log(`status:   ${Object.entries(by).map(([k, v]) => `${k} × ${v}`).join(" · ")}`);
  console.log(`latency:  p50 ${pct(ms, 50).toFixed(1)} ms · p95 ${pct(ms, 95).toFixed(1)} ms · p99 ${pct(ms, 99).toFixed(1)} ms · max ${Math.max(...ms).toFixed(1)} ms`);
  const firstOf = {};
  for (const r of results) if (!firstOf[r.status]) firstOf[r.status] = r;
  for (const [s, r] of Object.entries(firstOf)) console.log(`first ${s}: ${JSON.stringify(r.headers)} ${r.body.slice(0, 160).replace(/\s+/g, " ")}`);
  if (opt["key-header"]) console.log(`${opt["key-header"]} values: lab-${run}-<n>  (to find these requests afterwards)`);
}

if (cmd === "burst") {
  const n = Number(opt.n || 20), c = Number(opt.concurrency || n);
  const results = []; let next = 0;
  const t = performance.now();
  await Promise.all(Array.from({ length: Math.min(c, n) }, async () => { while (next < n) results.push(await one(next++)); }));
  summary(results, (performance.now() - t) / 1000);
} else if (cmd === "flood") {
  const until = performance.now() + Number(opt.seconds || 5) * 1000, c = Number(opt.concurrency || 32);
  const results = []; let next = 0;
  const t = performance.now();
  await Promise.all(Array.from({ length: c }, async () => { while (performance.now() < until) results.push(await one(next++)); }));
  summary(results, (performance.now() - t) / 1000);
} else if (cmd === "probe") {
  const every = Number(opt.every || 500), until = performance.now() + Number(opt.seconds || 10) * 1000, t0 = performance.now();
  for (let n = 0; performance.now() < until; n++) {
    const start = performance.now(), r = await one(n);
    console.log(`t=${((start - t0) / 1000).toFixed(2).padStart(6)} s  ${String(r.status).padEnd(7)} ${r.ms.toFixed(0).padStart(6)} ms  ${Object.keys(r.headers).length ? JSON.stringify(r.headers) : ""}`);
    await new Promise(res => setTimeout(res, Math.max(0, every - (performance.now() - start))));
  }
} else if (cmd === "poll") {
  const [path, want] = (opt.json || "status=DONE").split("="), until = performance.now() + Number(opt.timeout || 30) * 1000, t0 = performance.now();
  for (let n = 0; ; n++) {
    const r = await one(n);
    let got;
    try { got = path.split(".").reduce((o, k) => o?.[k], JSON.parse(r.body)); } catch { got = undefined; }
    if (String(got) === want) { console.log(`${path} = ${want} after ${((performance.now() - t0) / 1000).toFixed(2)} s (${n + 1} polls)`); break; }
    if (performance.now() > until) { console.log(`gave up after ${opt.timeout || 30} s: last ${r.status} ${path} = ${got}`); process.exit(1); }
    await new Promise(res => setTimeout(res, Number(r.headers["retry-after"] || 0) * 1000 || Number(opt.every || 200)));
  }
} else {
  console.error(`unknown command ${cmd}`); process.exit(2);
}
