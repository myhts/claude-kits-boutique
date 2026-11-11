#!/usr/bin/env node
// Proves Node breakpoints hit during a real request, over the Chrome DevTools Protocol.
//   node docs/explorer/tools/verify-bp-node.mjs --port 9229 \
//     --bp 'server\.js$:141:JSON.stringify(call.request)' --bp 'server\.js$:158:JSON.stringify(result)' \
//     -- docs/explorer/run-services.sh drive convert
// Each --bp is  urlRegex:line[:expression]  (line is 1-based, as in the editor). The expression is evaluated in the
// paused frame and printed. After the trigger command exits, prints one JSON line per breakpoint: hit or not.
// Needs Node 22+ (global WebSocket). Localhost only.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
if (sep < 0) { console.error("usage: --port N --bp 'regex:line[:expr]' … -- <trigger command…>"); process.exit(2); }
const opts = args.slice(0, sep), trigger = args.slice(sep + 1);
let port = 9229; const bps = [];
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === "--port") port = Number(opts[++i]);
  else if (opts[i] === "--bp") {
    const [re, line, ...expr] = opts[++i].split(":");
    bps.push({ re, line: Number(line), expr: expr.join(":") || null, hits: 0, values: [] });
  }
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const wsUrl = targets[0].webSocketDebuggerUrl.replace(/\/\/[^/]+\//, `//127.0.0.1:${port}/`);
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const byId = new Map();

ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); return; }
  if (m.method === "Debugger.paused") {
    const frame = m.params.callFrames[0];
    for (const hb of m.params.hitBreakpoints || []) {
      const bp = byId.get(hb); if (!bp) continue;
      bp.hits++;
      if (bp.expr) {
        const r = await send("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: bp.expr, returnByValue: true });
        bp.values.push(r.result?.value ?? r.result?.description ?? r.exceptionDetails?.text ?? r.error);
      }
      bp.where = `${frame.functionName || "(anonymous)"} @ line ${frame.location.lineNumber + 1}`;
    }
    await send("Debugger.resume");
  }
};

await send("Debugger.enable");
for (const bp of bps) {
  const r = await send("Debugger.setBreakpointByUrl", { urlRegex: bp.re, lineNumber: bp.line - 1 });
  bp.resolved = (r.locations || []).map((l) => l.lineNumber + 1);
  byId.set(r.breakpointId, bp);
}

const code = await new Promise((resolve) => {
  const p = spawn(trigger[0], trigger.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.stderr.write(`[trigger] ${d}`));
  p.stderr.on("data", (d) => { if (!/WARNING: The requested image/.test(d)) process.stderr.write(`[trigger] ${d}`); });
  p.on("exit", resolve);
});
await new Promise((r) => setTimeout(r, 300));
for (const bp of bps) {
  console.log(JSON.stringify({ bp: `${bp.re}:${bp.line}`, resolvedTo: bp.resolved, hit: bp.hits > 0, hits: bp.hits, where: bp.where, values: bp.values }));
}
await send("Debugger.disable");
ws.close();
process.exit(code ?? 0);
