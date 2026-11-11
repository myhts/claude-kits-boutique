#!/usr/bin/env node
// Writes the checkbox guides from the explorer data, so the page and the guides never disagree:
//   FLOWS.md: every flow, step by step: what to do, where to break, what to check, a link to that step on the page.
//   LABS.md:  every concept level that has a lab: config, steps, breakpoint, test, a link to that level on the page.
//   node gen-guides.mjs <explorer-data.js> --out <dir, e.g. docs/explorer> [--repo <repo root, default: cwd>]
// Hand-written text survives: anything above the line <!-- generated below: edit the data, not this part --> is kept.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const outDir = resolve(flag("--out", "docs/explorer")), repo = resolve(flag("--repo", "."));
if (!args[0]) { console.error("usage: node gen-guides.mjs <explorer-data.js> --out <dir> [--repo dir]"); process.exit(2); }
const data = (await import(pathToFileURL(resolve(args[0])).href)).default;
const meta = data.meta || {};
const MARK = "<!-- generated below: edit the data, not this part -->";

const rel = p => relative(outDir, resolve(repo, p)).split("\\").join("/");
const code = (p, line) => `[${p.split("/").pop()}${line ? ":" + line : ""}](${encodeURI(rel(p))}${line ? "#L" + line : ""})`;
const page = hash => meta.pagePath ? `[open on the page](${encodeURI(rel(meta.pagePath))}#${hash})` : "";
const md = s => String(s || "").replace(/\n/g, " ");

function write(name, title, intro, body) {
  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, name);
  const old = existsSync(path) ? readFileSync(path, "utf8") : null;
  const head = old?.includes(MARK) ? old.slice(0, old.indexOf(MARK)) : `# ${title}\n\n${intro}\n\n`;
  writeFileSync(path, `${head}${MARK}\n\n${body.trim()}\n`);
  console.log(`wrote ${relative(process.cwd(), path)}`);
}

// ---- FLOWS.md
let flows = "";
for (const f of data.flows || []) {
  flows += `## ${f.title}\n\n${md(f.intro)}${f.intro ? "\n\n" : ""}${page(`flow=${f.id}`)}\n\n`;
  f.steps.forEach((s, i) => {
    flows += `- [ ] **${i + 1}. ${md(s.t)}**: ${md(s.x)}\n`;
    if (s.bp) flows += `  - Breakpoint: ${code(s.bp[0], s.bp[1])}${s.bp[2] ? `. ${md(s.bp[2])}` : ""}\n`;
    for (const [k, where, what] of s.st || []) flows += `  - Check ${k === "add" ? "(new)" : k === "chg" ? "(changed)" : "(gone / not touched)"} **${where}**: ${md(what)}\n`;
    if (s.obs) flows += `  - See it: ${md(s.obs)}\n`;
    if (s.why) flows += `  - Why: concept ${page(`concept=${s.why[0]}&level=${s.why[1]}`).replace("open on the page", `${s.why[0]} ${s.why[1]}`)}\n`;
  });
  flows += "\n";
}
if (data.flows?.length) write("FLOWS.md", "Flows, step by step",
  "Follow each request with the debugger. Tick a box when you've seen it happen, not when you've read it.", flows);

// ---- LABS.md
let labs = "", questions = [];
for (const c of data.concepts || []) {
  const withLab = c.levels.filter(l => l.lab);
  if (!withLab.length) continue;
  labs += `## ${c.title}\n\n${md(c.intro)}\n\n`;
  for (const l of withLab) {
    labs += `### ${l.id} · ${l.name}${l.proposed ? " (proposed: not built)" : ""}\n\n`;
    if (l.q) { labs += `*${md(l.q)}* ${page(`concept=${c.id}&level=${l.id}`)}\n\n`; questions.push(`${c.title} ${l.id}: ${md(l.q)}`); }
    if (l.lab.cfg) labs += `Config: **${l.lab.cfg.replace(/^\((.*)\)$/, "$1")}**\n\n`;
    for (const s of l.lab.steps) labs += `- [ ] ${md(s)}\n`;
    if (l.bp) labs += `- [ ] Breakpoint: ${code(l.bp[0], l.bp[1])}${l.bp[2] ? `. ${md(l.bp[2])}` : ""}\n`;
    for (const t of l.tests || []) labs += `- [ ] The test that proves it: ${code(t[0], t[1])}${t[2] ? ` (${t[2]})` : ""}\n`;
    const measured = (l.g3 || []).filter(g => g.tag === "measured");
    if (measured.length) labs += `\nWhat we measured${meta.measuredOn ? ` (${meta.measuredOn})` : ""}: ${measured.map(g => `${g.k}: **${g.text}**`).join(" · ")}. Yours will differ; the shape shouldn't.\n`;
    labs += "\n";
  }
}
if (questions.length) labs += `## Self-check\n\nAnswer without the page, then check:\n\n${questions.map(q => `- [ ] ${q}`).join("\n")}\n`;
if (labs) write("LABS.md", "Labs", "Each lab makes one level of a concept happen on your machine. Run them in order: each level's problem is the previous level's cost.", labs);
