// Usage of one interactive Claude Code session up to a cutoff message, per model, priced at list price.
// Same message de-duplication as claude-kits' kit-check/explorer-eval/usage.mjs; adds the cache-write TTL split.
//   node run-cost.mjs <session.jsonl> "<text of the first user message NOT to count>"
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [file, cutoffText] = process.argv.slice(2);
const parse = (t) => t.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const main = parse(readFileSync(file, "utf8"));
const cut = main.find((l) => l.type === "user" && JSON.stringify(l.message?.content ?? "").includes(cutoffText));
const cutTs = cut ? cut.timestamp : null;
const first = main.find((l) => l.timestamp)?.timestamp;
const sub = file.replace(/\.jsonl$/, "/subagents");
const subLines = existsSync(sub)
  ? readdirSync(sub).filter((f) => f.endsWith(".jsonl")).flatMap((f) => parse(readFileSync(join(sub, f), "utf8")).map((l) => ({ ...l, _sub: true })))
  : [];

// $ per million tokens: input, 5-minute cache write, 1-hour cache write, cache read, output.
// From the Claude API skill's model table (cached 2026-11-03); writes are 1.25x / 2x input.
const PRICE = {
  "claude-opus-5-5": [4, 5, 8, 0.2, 20],
  "claude-sonnet-5-5": [2, 2.5, 4, 0.1, 10],
  "claude-haiku-4-5-20251001": [1, 1.25, 2, 0.1, 5],
};

const byId = new Map();
for (const l of [...main, ...subLines]) {
  if (l.type !== "assistant" || !l.message?.usage || l.message.model === "<synthetic>") continue;
  if (cutTs && l.timestamp >= cutTs) continue;
  const id = l.message.id ?? l.requestId, seen = byId.get(id);
  if (!seen || (l.message.usage.output_tokens ?? 0) > (seen.u.output_tokens ?? 0)) byId.set(id, { model: l.message.model, u: l.message.usage, sub: !!l._sub });
}

const rows = new Map();
for (const { model, u, sub: isSub } of byId.values()) {
  const key = model + (isSub ? " (readers)" : "");
  const r = rows.get(key) ?? { model, key, calls: 0, input: 0, w5: 0, w1h: 0, read: 0, output: 0 };
  const w = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5 = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : w;
  r.calls++; r.input += u.input_tokens ?? 0; r.w5 += w5; r.w1h += w1h;
  r.read += u.cache_read_input_tokens ?? 0; r.output += u.output_tokens ?? 0;
  rows.set(key, r);
}

const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
let total = 0;
console.log(`session ${file.split("/").pop()}`);
console.log(`from ${first} to ${cutTs ?? "end"} (cut at the first user message containing "${cutoffText}")\n`);
console.log("model                              calls    input   5m write    1h write     cache read      output   list price");
for (const r of [...rows.values()].sort((a, b) => b.output - a.output)) {
  const p = PRICE[r.model];
  const usd = p ? (r.input * p[0] + r.w5 * p[1] + r.w1h * p[2] + r.read * p[3] + r.output * p[4]) / 1e6 : NaN;
  if (p) total += usd;
  console.log(`${r.key.padEnd(32)} ${String(r.calls).padStart(6)} ${n(r.input).padStart(8)} ${n(r.w5).padStart(10)} ${n(r.w1h).padStart(11)} ${n(r.read).padStart(14)} ${n(r.output).padStart(11)}   ${p ? "$" + usd.toFixed(4) : "no price"}`);
}
console.log(`\ntotal at list price: $${total.toFixed(4)}  (on a Claude Max plan nothing extra is billed)`);
