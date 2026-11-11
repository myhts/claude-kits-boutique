#!/usr/bin/env node
// Proves Java breakpoints hit during a real request, with jdb attached over JDWP.
//   node docs/explorer/tools/verify-bp-jdb.mjs --port 5005 \
//     --bp 'hipstershop.AdService$AdServiceImpl:99:req.getContextKeysList()' \
//     -- docs/explorer/run-services.sh drive ads-ctx
// Each --bp is  Class:line[:expression]  (nested classes with $). The expression is printed with jdb `print` while
// paused. After the trigger exits, prints one JSON line per breakpoint: hit or not. Needs a JDK (jdb) on PATH.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
if (sep < 0) { console.error("usage: --port N --bp 'Class:line[:expr]' … -- <trigger command…>"); process.exit(2); }
const opts = args.slice(0, sep), trigger = args.slice(sep + 1);
let port = 5005; const bps = [];
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === "--port") port = Number(opts[++i]);
  else if (opts[i] === "--bp") {
    const [cls, line, ...expr] = opts[++i].split(":");
    bps.push({ cls, line: Number(line), expr: expr.join(":") || null, hits: 0, values: [], set: false });
  }
}

const jdb = spawn("jdb", ["-attach", `127.0.0.1:${port}`], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const write = (s) => jdb.stdin.write(s + "\n");
const waitFor = (re, ms = 20000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => {
    const m = buf.match(re);
    if (m) { buf = buf.slice(m.index + m[0].length); return resolve(m); }
    if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${re}`));
    setTimeout(tick, 50);
  };
  tick();
});
jdb.stdout.on("data", (d) => { buf += d; });
jdb.stderr.on("data", (d) => { buf += d; });

await waitFor(/Initializing jdb|>\s*$/m);
for (const bp of bps) {
  write(`stop at ${bp.cls}:${bp.line}`);
  const m = await waitFor(/(Set breakpoint|Deferring breakpoint|Unable to set)[^\n]*\n/);
  bp.set = m[1] !== "Unable to set";
}

// Fire the trigger; while it runs, answer each breakpoint hit: record it, print the expression, continue.
let done = false;
const trig = spawn(trigger[0], trigger.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
trig.stdout.on("data", (d) => process.stderr.write(`[trigger] ${d}`));
trig.stderr.on("data", (d) => { if (!/WARNING: The requested image/.test(d)) process.stderr.write(`[trigger] ${d}`); });
trig.on("exit", () => { done = true; });

while (!done || /Breakpoint hit/.test(buf)) {
  let m;
  try { m = await waitFor(/Breakpoint hit: "thread=[^"]*", ([\w.$]+)\.\w+\(\), line=(\d+)/, 1000); }
  catch { continue; }
  const [cls, line] = [m[1], Number(m[2])];
  const bp = bps.find((b) => b.cls === cls && b.line === line);
  if (bp) {
    bp.hits++;
    if (bp.expr) {
      write(`print ${bp.expr}`);
      try { const v = await waitFor(/ = ([^\n]*)\n/, 5000); bp.values.push(v[1]); } catch { bp.values.push("(no value)"); }
    }
  }
  write("cont");
}
for (const bp of bps) write(`clear ${bp.cls}:${bp.line}`);
write("exit");
for (const bp of bps) {
  console.log(JSON.stringify({ bp: `${bp.cls}:${bp.line}`, set: bp.set, hit: bp.hits > 0, hits: bp.hits, values: bp.values }));
}
process.exit(0);
