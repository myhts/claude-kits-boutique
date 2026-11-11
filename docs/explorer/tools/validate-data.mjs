#!/usr/bin/env node
// Checks the explorer data against the repository before anyone looks at the page:
//   ids unique and resolvable · every file path exists · every line number is inside its file and not blank
//   · flows/concepts/levels reference things that exist · number tags are valid · proposed levels claim no measurements.
//   node validate-data.mjs <explorer-data.js> [--repo <repo root, default: cwd>] [--no-files]
// Exit code 1 on errors. Warnings are printed but don't fail.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const noFiles = args.includes("--no-files") && (args.splice(args.indexOf("--no-files"), 1), true);
const repo = resolve(flag("--repo", "."));
if (!args[0]) { console.error("usage: node validate-data.mjs <explorer-data.js> [--repo dir] [--no-files]"); process.exit(2); }
const data = (await import(pathToFileURL(resolve(args[0])).href)).default;

const errors = [], warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const lines = new Map();
function checkFile(where, path, line) {
  if (noFiles || !path) return;
  if (/^[a-z]+:\/\//i.test(path) || path.startsWith("/")) { err(where, `path must be relative to the repo root: ${path}`); return; }
  const abs = resolve(repo, path);
  if (!existsSync(abs)) { err(where, `missing file ${path}`); return; }
  if (!line || statSync(abs).isDirectory()) return;
  if (!lines.has(abs)) lines.set(abs, readFileSync(abs, "utf8").split("\n"));
  const ls = lines.get(abs);
  if (line > ls.length) err(where, `${path}:${line} is past the end (${ls.length} lines)`);
  else if (!ls[line - 1].trim()) warn(where, `${path}:${line} is a blank line (a breakpoint there never hits)`);
  else if (/^\s*(\/\/|#|\/\*|\*|--)/.test(ls[line - 1]) && where.includes("breakpoint")) warn(where, `${path}:${line} is a comment line`);
}
const TAGS = new Set(["measured", "calculated", "rule", "model"]);
const FLOWS_KINDS = new Set(["ok", "heavy", "reject", "slow", null, undefined, ""]);

// ---- meta, modules, map
const meta = data.meta || {};
if (!meta.title) warn("meta", "no title");
if (!meta.pagePath) warn("meta", "no pagePath: code links won't open the editor from file://");
for (const [, p] of meta.guides || []) checkFile("meta.guides", p);
if (meta.labsDoc) checkFile("meta.labsDoc", meta.labsDoc);
const modules = data.modules || {};
const map = data.map || { lanes: [], nodes: [], edges: [] };
const laneIds = new Set((map.lanes || []).map(l => l.id));
const nodeIds = new Set();
for (const n of map.nodes || []) {
  const w = `node ${n.id}`;
  if (nodeIds.has(n.id)) err(w, "duplicate id");
  nodeIds.add(n.id);
  if (!n.label) err(w, "no label");
  if (n.lane && !laneIds.has(n.lane)) err(w, `unknown lane ${n.lane}`);
  if (!n.lane && (n.x === undefined || n.y === undefined)) err(w, "needs a lane (and col/row) or x and y");
  if (n.mod && !modules[n.mod]) err(w, `unknown module ${n.mod}`);
  if (!n.what) warn(w, "no `what`: the panel will be empty");
  for (const [p, l] of n.files || []) checkFile(w, p, l);
  for (const [, p, l] of n.docs || []) checkFile(w, p, l);
}
{   // two nodes in the same lane cell
  const cells = new Map();
  for (const n of map.nodes || []) if (n.lane && n.x === undefined) {
    const k = `${n.lane}/${n.col || 0}/${n.row || 0}`;
    if (cells.has(k)) err(`node ${n.id}`, `same lane/col/row as ${cells.get(k)}`);
    cells.set(k, n.id);
  }
}
const edgeIds = new Set();
for (const e of map.edges || []) {
  const id = `${e.from}>${e.to}`;
  if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) err(`edge ${id}`, "names a missing node");
  if (edgeIds.has(id)) warn(`edge ${id}`, "duplicate edge");
  edgeIds.add(id);
  if (e.around && !["left", "right"].includes(e.around)) err(`edge ${id}`, "around must be left or right");
}

// ---- concepts first (flows link to them)
const concepts = data.concepts || [];
const widgets = new Set(["token-bucket", "circuit-breaker", "partitions", ...Object.keys(data.widgets || {})]);
const levelIds = new Map();
const gauges = (where, list, proposed) => {
  for (const g of list || []) {
    if (!g.k) err(where, "gauge without a label (k)");
    if (g.tag && !TAGS.has(g.tag)) err(where, `gauge "${g.k}": unknown tag ${g.tag}`);
    if (!g.tag) warn(where, `gauge "${g.k}": no tag (measured / calculated / rule / model)`);
    if (g.tag === "measured" && proposed) err(where, `gauge "${g.k}": a proposed level can't have measured results`);
    if (g.v !== null && g.v !== undefined && !(g.max > 0)) err(where, `gauge "${g.k}": has a value but no max`);
    if (g.tag === "measured" && !meta.measuredOn) warn(where, "measured numbers but no meta.measuredOn");
  }
};
for (const c of concepts) {
  const cw = `concept ${c.id}`;
  if (!c.title) err(cw, "no title");
  for (const [, p, l] of c.docs || []) checkFile(cw, p, l);
  const ids = new Set();
  levelIds.set(c.id, ids);
  for (const l of c.levels || []) {
    const w = `${cw} ${l.id}`;
    if (ids.has(l.id)) err(w, "duplicate level id");
    ids.add(l.id);
    for (const part of ["before", "after"]) {
      const sc = l[part];
      if (!sc?.b || !sc?.e) { err(w, `${part} needs b (boxes) and e (edges)`); continue; }
      const here = new Set();
      for (const entry of sc.b) {
        const id = Array.isArray(entry) ? entry[0] : entry;
        if (!c.boxes?.[id]) err(w, `${part}: box ${id} is not in the concept's boxes`);
        const b = { ...c.boxes?.[id], ...(Array.isArray(entry) ? entry[1] : {}) };
        if (b.x === undefined && !b.at) err(w, `${part}: box ${id} needs x/y or at: [col, row]`);
        here.add(id);
      }
      for (const e of sc.e) {
        if (!here.has(e[0]) || !here.has(e[1])) err(w, `${part}: edge ${e[0]}>${e[1]} names a box not in this scene`);
        if (!FLOWS_KINDS.has(e[3])) err(w, `${part}: edge ${e[0]}>${e[1]} flow must be ok/heavy/reject/slow`);
      }
      for (const id of [...(sc.hurt || []), ...(sc.changed || [])]) if (!here.has(id)) err(w, `${part}: hurt/changed ${id} is not in this scene`);
    }
    if (!Array.isArray(l.cap) || l.cap.length !== 3) err(w, "cap needs 3 captions (one per frame)");
    if (!l.next) warn(w, "no `next`: what does this level cost, which forces the next one?");
    if (!l.proposed && !l.diff?.length) warn(w, "no diff: what changed, with code links?");
    for (const [k, , link] of l.diff || []) {
      if (!["add", "chg", "del"].includes(k)) err(w, `diff kind ${k} (add / chg / del)`);
      if (link) checkFile(`${w} diff`, link[0], link[1]);
    }
    if (l.proposed && (l.diff || []).some(d => d[2])) warn(w, "proposed level links to code: is it really not built?");
    gauges(`${w} g1`, l.g1, false);
    gauges(`${w} g3`, l.g3, l.proposed);
    if (l.bp) checkFile(`${w} breakpoint`, l.bp[0], l.bp[1]);
    else if (!l.proposed) warn(w, "no breakpoint");
    for (const [p, ln] of l.tests || []) checkFile(`${w} test`, p, ln);
    if (l.widget) { const name = typeof l.widget === "string" ? l.widget : l.widget.name; if (!widgets.has(name)) err(w, `unknown widget ${name}`); }
    if (l.lab && !Array.isArray(l.lab.steps)) err(w, "lab.steps must be a list");
    for (const o of l.options || []) if (!["yes", "no", "alt"].includes(o[0])) err(w, `option kind ${o[0]} (yes / no / alt)`);
  }
}

// ---- flows
const flowIds = new Set(["map"]);
for (const f of data.flows || []) {
  const fw = `flow ${f.id}`;
  if (flowIds.has(f.id)) err(fw, "duplicate id (or 'map', which is reserved)");
  flowIds.add(f.id);
  if (!f.steps?.length) err(fw, "no steps");
  (f.steps || []).forEach((s, i) => {
    const w = `${fw} step ${i + 1}`;
    if (!s.t || !s.x) err(w, "needs t (title) and x (explanation)");
    for (const n of s.n || []) if (!nodeIds.has(n)) err(w, `unknown node ${n}`);
    for (const e of s.e || []) if (!edgeIds.has(e)) err(w, `unknown edge ${e} (write it as from>to, as in map.edges)`);
    if (s.bp) checkFile(`${w} breakpoint`, s.bp[0], s.bp[1]);
    for (const st of s.st || []) if (!["add", "chg", "del"].includes(st[0])) err(w, `st kind ${st[0]} (add / chg / del)`);
    if (s.why) {
      if (!levelIds.has(s.why[0])) err(w, `why: unknown concept ${s.why[0]}`);
      else if (s.why[1] && !levelIds.get(s.why[0]).has(s.why[1])) err(w, `why: unknown level ${s.why[1]} in ${s.why[0]}`);
    }
  });
}

for (const w of warnings) console.log("warning  " + w);
for (const e of errors) console.log("ERROR    " + e);
const steps = (data.flows || []).reduce((a, f) => a + (f.steps?.length || 0), 0);
const levels = concepts.reduce((a, c) => a + (c.levels?.length || 0), 0);
console.log(`\n${nodeIds.size} boxes, ${edgeIds.size} arrows, ${(data.flows || []).length} flows (${steps} steps), ${concepts.length} concepts (${levels} levels): ` +
  `${errors.length} errors, ${warnings.length} warnings${noFiles ? " (file paths not checked)" : ""}.`);
process.exit(errors.length ? 1 : 0);
