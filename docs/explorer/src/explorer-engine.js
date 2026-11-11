// ---------------------------------------------------------------------------------------------------------------
// Project explorer engine. Framework-agnostic: mountExplorer(rootElement, data, options) renders the whole page
// (architecture map, step-by-step flows, concept ladders) inside rootElement and returns { destroy }.
//   - Standalone HTML: tools/bundle-html.mjs inlines this file, explorer.css and the data into one page.
//   - React / Next / Vue / Svelte: import { mountExplorer } and call it once the element is in the DOM.
// The data format is documented in reference/data-schema.md. Nothing project-specific belongs in this file.
// ---------------------------------------------------------------------------------------------------------------

export const G = (k, v, max, o = {}) => ({ k, v, max, ...o });

const NS = "http://www.w3.org/2000/svg";
const FRAMES = ["1 · What's happening", "2 · What we changed", "3 · The result"];
const TAGS = { measured: "measured", calculated: "calculated", rule: "rule of thumb", model: "model" };
let uidSeq = 0;

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmt = s => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>")
  .replace(/\[([^\]]+)\]\((#[^)\s]+)\)/g, '<a href="$2">$1</a>')
  .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

export function mountExplorer(root, data, opts = {}) {
  const meta = data.meta || {};
  const MODULES = data.modules || {};
  const MAP = data.map || { lanes: [], nodes: [], edges: [] };
  const FLOWS = [{ id: "map", title: "Just the map (click any box)" }, ...(data.flows || [])];
  const CONCEPTS = data.concepts || [];
  const WIDGETS = { ...BUILTIN_WIDGETS, ...(data.widgets || {}) };
  const hashRouting = opts.hashRouting ?? true;
  const uid = "xp" + (++uidSeq);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cleanups = [];
  let timers = [];

  // ---- links: code opens in the editor (local file or configured repo root), otherwise the repo host, otherwise plain text
  const repoRoot = opts.repoRoot ?? meta.repoRoot ?? (() => {
    if (location.protocol !== "file:" || !meta.pagePath) return null;
    const p = decodeURIComponent(location.pathname), suffix = "/" + meta.pagePath.replace(/^\/+/, "");
    return p.endsWith(suffix) ? p.slice(0, -suffix.length) : null;
  })();
  const editor = opts.editor ?? meta.editor ?? "vscode";
  const codeHref = (path, line) => {
    if (repoRoot) {
      const abs = `${repoRoot.replace(/\/+$/, "")}/${path}`;
      if (editor === "idea") return `idea://open?file=${encodeURIComponent(abs)}${line ? "&line=" + line : ""}`;
      return `${editor}://file${abs.startsWith("/") ? "" : "/"}${abs}${line ? ":" + line : ""}`;
    }
    if (meta.repoUrl) return `${meta.repoUrl.replace(/\/+$/, "")}/${path}${line ? "#L" + line : ""}`;
    return null;
  };
  const fileLink = (path, line, label) => {
    const href = codeHref(path, line);
    const shown = path.split("/").pop() + (line ? ":" + line : "");
    const a = href ? `<a href="${esc(href)}" title="Open ${esc(path)}">${esc(shown)}</a>` : `<code>${esc(path)}${line ? ":" + line : ""}</code>`;
    return `${a}${label ? ` <span class="muted">· ${fmt(label)}</span>` : ""}`;
  };
  const docLinks = docs => (docs || []).map(([label, path, line]) => {
    const href = codeHref(path, line);
    return `<li>${href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<strong>${esc(label)}</strong>`} <span class="muted">· <code>${esc(path)}</code></span></li>`;
  }).join("");
  const TAG_HELP = { measured: `we ran it${meta.measuredOn ? ` (${meta.measuredOn})` : ""}`, calculated: "arithmetic from config or a capacity model",
                     rule: "an industry ballpark: verify on your hardware", model: "a design we didn't build: the page simulates it" };
  const tag = t => t ? `<span class="tag ${t}" title="${esc(TAG_HELP[t])}">${esc(TAGS[t])}</span>` : "";

  // ---- DOM
  root.classList.add("xp");
  root.dataset.xp = uid;
  if (opts.height) root.style.setProperty("--xp-height", opts.height);
  root.innerHTML = `
    <style>${moduleColors(uid, MODULES)}</style>
    <header class="xp-header">
      <div><h1>${esc(meta.title || "Project explorer")}</h1>
        <div class="sub">${fmt(meta.subtitle || "Click any box to see what it is. Or pick a flow and press **Next** to follow one request through the system.")}</div></div>
      <div class="controls">
        <div class="tabs" role="tablist" aria-label="View">
          <button role="tab" data-tab="flows" aria-selected="true">Architecture &amp; flows</button>
          ${CONCEPTS.length ? `<button role="tab" data-tab="concepts" aria-selected="false">Concepts</button>` : ""}
        </div>
        <span data-ctl="flows"><select aria-label="Choose a flow" data-sel="flow"></select></span>
        <span data-ctl="concepts" hidden><select aria-label="Choose a concept" data-sel="concept"></select></span>
        <button data-act="theme" title="Toggle light/dark">◐</button>
      </div>
    </header>
    <div class="xp-layout" data-view="concepts" hidden>
      <div class="xp-stage">
        <nav class="ladder" aria-label="Levels"></nav>
        <div class="frametabs"></div>
        <div class="scene-wrap"><div class="scene-scroll"><svg class="xp-scene" viewBox="0 0 1000 340" role="img" aria-label="Level diagram"></svg></div>
          <div class="clegend"></div></div>
        <div class="gauges"></div>
        <div class="xp-widget"></div>
      </div>
      <aside class="xp-aside" data-panel="concept" aria-live="polite"></aside>
    </div>
    <div class="xp-layout" data-view="flows">
      <div class="xp-stage">
        <svg class="xp-diagram" role="img" aria-label="Architecture diagram"></svg>
        <div class="legend"></div>
      </div>
      <aside class="xp-aside" data-panel="flow" aria-live="polite"></aside>
    </div>`;
  const $ = sel => root.querySelector(sel);
  const svg = $(".xp-diagram"), panel = $('[data-panel="flow"]');
  const scene = $(".xp-scene"), cpanel = $('[data-panel="concept"]');
  const el = (name, attrs = {}, parent = svg) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  };
  const on = (target, ev, fn) => { target.addEventListener(ev, fn); cleanups.push(() => target.removeEventListener(ev, fn)); };
  const every = (ms, fn) => { timers.push(setInterval(fn, ms)); };
  const stopTimers = () => { timers.forEach(clearInterval); timers = []; };

  // ---- map layout: nodes sit in lanes (top to bottom) and columns, unless they give x/y themselves
  const W = MAP.nodeWidth || 190, H = MAP.nodeHeight || 50, GX = MAP.gapX ?? 50, GY = MAP.gapY ?? 26, X0 = 30;
  const lanes = [];
  {
    let y = 12;
    for (const lane of MAP.lanes || []) {
      const ns = MAP.nodes.filter(n => n.lane === lane.id);
      const rows = Math.max(1, ...ns.map(n => (n.row || 0) + 1));
      const h = lane.h ?? 30 + rows * (H + GY) - GY + 14;
      lanes.push({ ...lane, y: lane.y ?? y, h });
      y = (lane.y ?? y) + h + 8;
    }
  }
  const laneOf = id => lanes.find(l => l.id === id);
  const byId = Object.fromEntries(MAP.nodes.map(n => {
    const lane = laneOf(n.lane), w = n.w ?? (n.span ? n.span * W + (n.span - 1) * GX : W), h = n.h ?? H;
    const x = n.x ?? X0 + (n.col || 0) * (W + GX);
    const y = n.y ?? (lane ? lane.y + 30 + (n.row || 0) * (H + GY) : 20);
    return [n.id, { ...n, w, h, x, y }];
  }));
  const box = id => byId[id];
  const mapW = MAP.width ?? Math.max(600, ...Object.values(byId).map(n => n.x + n.w + X0));
  const mapH = MAP.height ?? Math.max(200, ...lanes.map(l => l.y + l.h + 12), ...Object.values(byId).map(n => n.y + n.h + 20));
  svg.setAttribute("viewBox", `0 0 ${mapW} ${mapH}`);
  svg.style.minWidth = Math.min(mapW, 1050) + "px";
  svg.style.maxWidth = mapW + "px";   // never zoom a small map up

  function route(e) {
    if (e.pts) return e.pts;
    const s = box(e.from), t = box(e.to);
    if (e.around) {   // leave and enter on the same side, through the channel beside the boxes: no coordinates needed
      const ys = s.y + s.h / 2 + (e.dy || 0), yt = t.y + t.h / 2 + (e.dy || 0), off = e.offset || 0;
      if (e.around === "left") { const x = Math.min(s.x, t.x) - 12 - off; return [[s.x, ys], [x, ys], [x, yt], [t.x, yt]]; }
      const x = Math.max(s.x + s.w, t.x + t.w) + GX / 2 + off;
      return [[s.x + s.w, ys], [x, ys], [x, yt], [t.x + t.w, yt]];
    }
    const scx = e.fromX ?? s.x + s.w / 2, tcx = e.toX ?? t.x + t.w / 2;
    if (t.y >= s.y + s.h) {
      const a = [scx, s.y + s.h], b = [tcx, t.y];
      if (a[0] === b[0]) return [a, b];
      const my = a[1] + (b[1] - a[1]) / 2;
      return [a, [a[0], my], [b[0], my], b];
    }
    if (t.y + t.h <= s.y) {
      const a = [scx, s.y], b = [tcx, t.y + t.h], my = a[1] + (b[1] - a[1]) / 2;
      return a[0] === b[0] ? [a, b] : [a, [a[0], my], [b[0], my], b];
    }
    const y = Math.max(s.y, t.y) + Math.min(s.h, t.h) / 2;
    return t.x > s.x ? [[s.x + s.w, y], [t.x, y]] : [[s.x, y], [t.x + t.w, y]];
  }

  let mapDrawn = false;
  function drawMap() {
    mapDrawn = true;
    svg.innerHTML = "";
    const defs = el("defs");
    for (const [id, color] of [["arrow", "var(--line)"], ["arrow-hl", "var(--hl)"]]) {
      const m = el("marker", { id: `${uid}-${id}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      el("path", { d: "M0,0 L10,5 L0,10 z", fill: color }, m);
    }
    for (const lane of lanes) el("rect", { class: "lane-bg", x: 4, y: lane.y, width: mapW - 8, height: lane.h, rx: 8 });
    const edgeLayer = el("g"), nodeLayer = el("g"), laneLayer = el("g"), labelLayer = el("g");
    const laneLabels = lanes.map(lane => {   // on top of the arrows (with a halo), and kept clear of arrow labels
      const t = el("text", { class: "lane-label", x: 14, y: lane.y + 18 }, laneLayer);
      t.textContent = lane.label;
      return t;
    });
    const labels = [];
    for (const e of MAP.edges) {
      if (!box(e.from) || !box(e.to)) { console.error(`explorer: edge ${e.from}>${e.to} names a missing node`); continue; }
      const pts = route(e), id = `${e.from}>${e.to}`;
      const g = el("g", { class: "edge" + (e.dashed ? " dashed" : ""), "data-id": id }, edgeLayer);
      el("path", { d: "M" + pts.map(p => p.join(",")).join(" L"), "marker-end": `url(#${uid}-arrow)` }, g);
      if (e.label) labels.push({ label: e.label, pts, la: e.labelAt, cls: "elbl", id });
    }
    for (const n of Object.values(byId)) {
      const g = el("g", { class: "node", "data-id": n.id, tabindex: 0, role: "button", "aria-label": n.label }, nodeLayer);
      el("rect", { class: "box", x: n.x, y: n.y, width: n.w, height: n.h, rx: 7 }, g);
      el("rect", { x: n.x, y: n.y, width: 5, height: n.h, rx: 2, style: `fill: var(--m-${n.mod})` }, g);
      const tl = el("text", { x: n.x + 13, y: n.y + (n.h > 45 ? 21 : 17) }, g);
      tl.textContent = n.label; fitText(tl, n.w - 20, 13);
      const ts = el("text", { class: "s", x: n.x + 13, y: n.y + (n.h > 45 ? 38 : 32) }, g);
      ts.textContent = n.sub || ""; fitText(ts, n.w - 20, 11, 9);
      el("title", {}, g).textContent = `${n.label}${n.sub ? ": " + n.sub : ""}`;
      g.addEventListener("click", () => selectNode(n.id));
      g.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectNode(n.id); } });
    }
    placeLabels(labelLayer, labels, Object.values(byId), mapW, { pad: 2, tagSpace: 0, fontGap: [5, 13], extra: laneLabels.map(t => t.getBBox()) });
  }

  function highlight(nodes = [], edges = []) {
    svg.classList.toggle("dim", nodes.length + edges.length > 0);
    svg.querySelectorAll(".node").forEach(g => g.classList.toggle("hl", nodes.includes(g.dataset.id)));
    svg.querySelectorAll(".elbl").forEach(t => t.classList.toggle("hl", edges.includes(t.dataset.id)));
    svg.querySelectorAll(".edge").forEach(g => {
      const hl = edges.includes(g.dataset.id);
      g.classList.toggle("hl", hl);
      g.querySelector("path").setAttribute("marker-end", `url(#${uid}-${hl ? "arrow-hl" : "arrow"})`);
    });
  }

  // ---- flows
  const state = { flow: "map", step: 0, selected: null };
  const flowOf = id => FLOWS.find(x => x.id === id);

  function nodeDetails(n) {
    const mod = MODULES[n.mod] || { label: n.mod || "" };
    return `
      ${mod.label ? `<p><span class="badge" style="background: var(--m-${n.mod})">${esc(mod.label)}</span></p>` : ""}
      <h2>${esc(n.label)}</h2>
      ${n.sub ? `<p class="muted">${esc(n.sub)}</p>` : ""}
      ${n.what ? `<p>${fmt(n.what)}</p>` : ""}
      ${n.files?.length ? `<h3>Code</h3><ul>${n.files.map(f => `<li>${fileLink(f[0], f[1], f[2])}</li>`).join("")}</ul>` : ""}
      ${n.docs?.length ? `<h3>Read more</h3><ul>${docLinks(n.docs)}</ul>` : ""}
      ${n.observe ? `<h3>See it live</h3><p>${fmt(n.observe)}</p>` : ""}`;
  }

  function selectNode(id) {
    state.selected = id;
    svg.querySelectorAll(".node").forEach(g => g.classList.toggle("sel", g.dataset.id === id));
    if (state.flow === "map") {
      highlight([id], MAP.edges.filter(e => e.from === id || e.to === id).map(e => `${e.from}>${e.to}`));
      panel.innerHTML = nodeDetails(box(id)) + `<p class="hint" style="margin-top:18px">Highlighted: this box and its direct connections. Pick a flow at the top to follow a request.</p>`;
      setHash(`node=${id}`);
    } else {
      panel.innerHTML = renderStep() + `<h3>About this box</h3>` + nodeDetails(box(id)).replace(/<h2>/, "<h2 style='font-size:15px'>");
      wireStepButtons();
    }
  }

  function renderStep() {
    const f = flowOf(state.flow), s = f.steps[state.step];
    return `
      <p class="muted" style="margin:0">${esc(f.title)}</p>
      ${state.step === 0 && f.intro ? `<p>${fmt(f.intro)}</p>` : ""}
      <div class="stepbar">
        <span class="count">Step ${state.step + 1} of ${f.steps.length}</span>
        <button data-act="prev" ${state.step === 0 ? "disabled" : ""}>← Back</button>
        <button data-act="next" class="primary" ${state.step === f.steps.length - 1 ? "disabled" : ""}>Next →</button>
      </div>
      <h2>${esc(s.t)}</h2>
      <p>${fmt(s.x)}</p>
      ${s.st ? `<h3>What changed at this step</h3><ul class="diff">${s.st.map(([k, where, what]) => `<li class="${k}"><strong>${esc(where)}</strong>: ${fmt(what)}</li>`).join("")}</ul>` : ""}
      ${s.why ? `<p>Why is it built this way? → <a href="#concept=${esc(s.why[0])}&level=${esc(s.why[1])}" data-why="${esc(s.why[0])}|${esc(s.why[1])}">${esc(conceptName(s.why[0], s.why[1]))}</a></p>` : ""}
      ${s.d ? `<h3>Real data at this point</h3><pre>${esc(s.d)}</pre>` : ""}
      ${s.bp ? `<h3>Breakpoint</h3><div class="bp">${fileLink(s.bp[0], s.bp[1])}<br>${fmt(s.bp[2] || "")}</div>` : ""}
      ${s.obs ? `<h3>See it live</h3><p>${fmt(s.obs)}</p>` : ""}
      <p class="hint">Keyboard: ← / → to move. Click a highlighted box for its details.</p>`;
  }

  function wireStepButtons() {
    panel.querySelector('[data-act="prev"]')?.addEventListener("click", () => go(-1));
    panel.querySelector('[data-act="next"]')?.addEventListener("click", () => go(1));
    panel.querySelector("[data-why]")?.addEventListener("click", ev => {
      ev.preventDefault();
      const [c, l] = ev.currentTarget.dataset.why.split("|");
      showConcept(c, l, 0);
    });
  }

  function showStep() {
    const f = flowOf(state.flow), s = f.steps[state.step];
    state.selected = null;
    svg.querySelectorAll(".node").forEach(g => g.classList.remove("sel"));
    highlight(s.n || [], s.e || []);
    panel.innerHTML = renderStep();
    wireStepButtons();
    setHash(`flow=${f.id}&step=${state.step + 1}`);
    const first = svg.querySelector(`.node[data-id="${(s.n || [])[0]}"]`);
    if (first && opts.scrollIntoView !== false) first.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  function go(delta) {
    const f = flowOf(state.flow);
    if (!f.steps) return;
    state.step = Math.min(f.steps.length - 1, Math.max(0, state.step + delta));
    showStep();
  }

  function showMap() {
    highlight();
    panel.innerHTML = meta.howto ? fmt(meta.howto) : `
      <h2>How to use this page</h2>
      <p><strong>Map:</strong> click any box to see what it does, its code (links open your editor at the line) and how to watch it live.</p>
      <p><strong>Flows:</strong> pick one at the top and press <strong>Next</strong>. The boxes and arrows involved light up, and the panel shows the <strong>real data</strong> at that point (captured from a run) plus where to put a <strong>breakpoint</strong>.</p>
      ${CONCEPTS.length ? `<h3>Concepts</h3><p>The <strong>Concepts</strong> tab explains <em>why</em> a part is built the way it is: a ladder of levels, each one a problem with numbers, the change that fixed it, and the result, with a lab to try it live.</p>` : ""}
      ${meta.startHere ? `<h3>Start here</h3><p>${fmt(meta.startHere)}</p>` : ""}
      ${meta.guides?.length ? `<h3>Step-by-step guides</h3><ul>${docLinks(meta.guides)}</ul>` : ""}
      ${codeHref("x", 1) ? "" : `<p class="hint">Code links are plain text: open this page from disk (file://), or set <code>repoRoot</code>, to make them open your editor.</p>`}`;
  }

  function setFlow(id) {
    state.flow = id; state.step = 0;
    if (id === "map") { showMap(); setHash(""); } else showStep();
  }

  // ---- concepts
  const cstate = { concept: CONCEPTS[0]?.id, level: 0, frame: 0 };
  const concept = () => CONCEPTS.find(c => c.id === cstate.concept);
  const levelsOf = c => [...c.levels, { id: "recap", name: "The whole ladder", recap: true }];
  const framesOf = l => l.proposed ? [FRAMES[0], "2 · What we'd change (proposed, not built)", "3 · Expected result"] : FRAMES;
  function conceptName(cid, lid) {
    const c = CONCEPTS.find(x => x.id === cid), l = c?.levels.find(x => x.id === lid);
    return c ? `${c.title}${l ? ` · ${l.id} ${l.name}` : ""}` : cid;
  }
  const CW = 210, CH = 115;   // concept-scene grid: at: [col, row] → x = 16 + col × 210, y = 24 + row × 115
  function sceneBoxes(c, spec) {
    return spec.b.map(entry => {
      const [id, over] = Array.isArray(entry) ? entry : [entry, {}];
      const b = { id, w: 180, h: 62, ...c.boxes[id], ...over };
      if (b.at && b.x === undefined) { b.x = 16 + b.at[0] * CW; b.y = 24 + b.at[1] * CH; }
      return b;
    });
  }
  const side = (b, s) => ({ l: [b.x, b.y + b.h / 2], r: [b.x + b.w, b.y + b.h / 2], t: [b.x + b.w / 2, b.y], b: [b.x + b.w / 2, b.y + b.h] }[s]);
  function sroute(s, t, o = {}) {
    let ss = o.ss, ts = o.ts;
    if (!ss) ss = t.x >= s.x + s.w ? "r" : t.x + t.w <= s.x ? "l" : t.y > s.y ? "b" : "t";
    if (!ts) ts = { r: "l", l: "r", b: "t", t: "b" }[ss];
    if (ts === "t" || ts === "b") ss = ss === "t" || ss === "b" ? ss : (t.x >= s.x + s.w ? "r" : "l");
    const off = o.off || 0;
    let a = side(s, ss), z = side(t, ts);
    const horiz = p => p === "l" || p === "r";
    if (horiz(ss) && horiz(ts)) {
      a = [a[0], a[1] + off]; z = [z[0], z[1] + off];
      if (a[1] === z[1]) return [a, z];
      const mx = (a[0] + z[0]) / 2 + off;
      return [a, [mx, a[1]], [mx, z[1]], z];
    }
    if (horiz(ss)) return [a, [z[0], a[1]], z];
    if (horiz(ts)) return [a, [a[0], z[1]], z];
    const my = (a[1] + z[1]) / 2;
    return a[0] === z[0] ? [a, z] : [a, [a[0], my], [z[0], my], z];
  }

  function drawScene(svgEl, c, spec, o = {}) {
    svgEl.innerHTML = "";
    const mk = (n, a, p = svgEl) => el(n, a, p);
    const boxes = sceneBoxes(c, spec), by = Object.fromEntries(boxes.map(b => [b.id, b]));
    if (o.mini) {
      for (const b of boxes) mk("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, class: o.added?.includes(b.id) ? "new" : "" });
      return;
    }
    const defs = mk("defs");
    for (const [id, v] of [["sa", "--line"], ["sa-bad", "--bad"], ["sa-good", "--good"]]) {
      const m = mk("marker", { id: `${uid}-${id}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      mk("path", { d: "M0,0 L10,5 L0,10 z", style: `fill: var(${v})` }, m);
    }
    // "gone" boxes, unless a box in this scene now stands in the same place (it replaced it: the diff list says so)
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const ghosts = (o.ghostsOf ? sceneBoxes(c, o.ghostsOf) : []).filter(g => !by[g.id] && !boxes.some(b => overlaps(g, b)));
    const eLayer = mk("g"), nLayer = mk("g"), dLayer = mk("g"), lLayer = mk("g");
    const labels = [];
    const keys = new Set(spec.e.map(e => `${e[0]}>${e[1]}`));
    const beforeKeys = new Set((o.ghostsOf?.e || []).map(e => `${e[0]}>${e[1]}`));
    const drawEdge = (e, ghost) => {
      const [f, t, label, flow, eo = {}] = e;
      const s = by[f] || ghosts.find(g => g.id === f), d = by[t] || ghosts.find(g => g.id === t);
      if (!s || !d) return;
      const both = keys.has(`${t}>${f}`);
      const off = eo.off ?? (both ? (s.x < d.x ? -9 : 9) : 0);
      const pts = sroute(s, d, { ...eo, off });
      const added = o.diff && !ghost && o.ghostsOf && !beforeKeys.has(`${f}>${t}`);
      const kind = [flow === "reject" ? "reject" : "", eo.cls || "", ghost ? "ghost" : "", added ? "added" : ""].join(" ");
      const g = mk("g", { class: "se " + kind + (eo.dashed ? " dashed" : "") }, eLayer);
      const dpath = "M" + pts.map(p => p.join(",")).join(" L");
      const marker = flow === "reject" || eo.cls === "hurt" ? "sa-bad" : added ? "sa-good" : "sa";   // rejections stay red even when new
      mk("path", { d: dpath, "marker-end": `url(#${uid}-${marker})` }, g);
      if (label) labels.push({ label, pts, la: eo.la, below: off > 0, cls: "lbl " + kind });
      if (!ghost && flow && !reduceMotion) {
        const n = { ok: 2, heavy: 6, reject: 2, slow: 1 }[flow] || 0, dur = { ok: 2.4, heavy: 1.5, reject: 1.8, slow: 5 }[flow];
        const color = { ok: "--focus", heavy: "--hl", reject: "--bad", slow: "--chg" }[flow];
        for (let i = 0; i < n; i++) {
          const dot = mk("circle", { r: flow === "heavy" ? 4 : 4.5, style: `fill: var(${color})` }, dLayer);
          mk("animateMotion", { dur: dur + "s", repeatCount: "indefinite", begin: `-${(i * dur / n).toFixed(2)}s`, path: dpath }, dot);
        }
      }
    };
    // "gone" arrows: only where a box disappeared. An arrow between two boxes that are both still there was rerouted.
    if (o.ghostsOf) for (const e of o.ghostsOf.e) if (!keys.has(`${e[0]}>${e[1]}`) && !(by[e[0]] && by[e[1]])) drawEdge(e, true);
    for (const e of spec.e) drawEdge(e, false);
    const drawBox = (b, cls) => {
      const g = mk("g", { class: "sn " + cls, "data-id": b.id }, nLayer);
      mk("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 9, style: "fill: var(--surface)" }, g);   // solid base
      mk("rect", { class: "box", x: b.x, y: b.y, width: b.w, height: b.h, rx: 9 }, g);
      const title = mk("text", { x: b.x + 12, y: b.y + 22 }, g);
      title.textContent = b.label; fitText(title, b.w - 20, 14);
      String(b.sub || "").split("\n").forEach((line, i) => {
        const t = mk("text", { class: "s", x: b.x + 12, y: b.y + 39 + i * 14 }, g);
        t.textContent = line; fitText(t, b.w - 20, 11.5);
      });
      const word = cls.includes("hurt") ? ["hurts", "--bad"] : cls.includes("added") ? ["new", "--good"] : cls.includes("changed") ? ["changed", "--chg"] : cls.includes("ghost") ? ["gone", "--muted"] : null;
      if (word) { const t = mk("text", { class: "tagtxt", x: b.x + b.w - 8, y: b.y - 5, "text-anchor": "end", style: `fill: var(${word[1]})` }, g); t.textContent = word[0].toUpperCase(); }
    };
    for (const g of ghosts) drawBox(g, "ghost");
    const before = o.ghostsOf ? new Set(sceneBoxes(c, o.ghostsOf).map(x => x.id)) : null;
    for (const b of boxes) {
      let cls = "";
      if (o.hurt?.includes(b.id)) cls = "hurt";
      else if (o.diff && before && !before.has(b.id)) cls = "added";
      else if (o.diff && o.changed?.includes(b.id)) cls = "changed";
      drawBox(b, cls);
    }
    placeLabels(lLayer, labels, [...boxes, ...ghosts], 1000, { pad: 3, tagSpace: 16, fontGap: [7, 16] });
  }

  function gaugeHtml(g) {
    let bar = "";
    if (g.v !== null && g.v !== undefined) {
      const frac = v => g.log ? Math.max(0, Math.min(1, Math.log10(Math.max(v, g.log) / g.log) / Math.log10(g.max / g.log))) : Math.max(0, Math.min(1, v / g.max));
      bar = `<div class="gbar"><div class="fill" style="width:${(frac(g.v) * 100).toFixed(1)}%"></div>${g.thr ? `<div class="thr" style="left:${(frac(g.thr) * 100).toFixed(1)}%" title="threshold"></div>` : ""}</div>`;
    }
    return `<div class="gauge ${g.st || ""}"><div class="gk"><span>${esc(g.k)}</span>${tag(g.tag)}</div><div class="gv">${esc(g.text ?? g.v)}</div>${bar}${g.note ? `<div class="gn">${fmt(g.note)}</div>` : ""}</div>`;
  }

  function renderLadder() {
    const c = concept(), lv = levelsOf(c), nav = $(".ladder");
    nav.innerHTML = lv.map((l, i) => `<button data-i="${i}" ${i === cstate.level ? 'aria-current="step"' : ""} title="${esc(l.q || l.name)}">
        <span class="lv">${l.recap ? "★ Recap" : esc(l.id)}${l.proposed ? ' <span class="tag model">proposed</span>' : ""}</span><span class="ln">${esc(l.name)}</span>${l.recap ? "" : `<svg viewBox="0 0 1000 340" aria-hidden="true"></svg>`}</button>`).join("");
    nav.querySelectorAll("button").forEach(btn => {
      const l = lv[btn.dataset.i];
      if (!l.recap) {
        const before = new Set(sceneBoxes(c, l.before).map(b => b.id));
        drawScene(btn.querySelector("svg"), c, l.after, { mini: true, added: sceneBoxes(c, l.after).map(b => b.id).filter(id => !before.has(id)) });
      }
      btn.addEventListener("click", () => { cstate.level = Number(btn.dataset.i); cstate.frame = 0; renderConcept(); });
    });
    nav.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderConcept() {
    const c = concept(), lv = levelsOf(c), l = lv[cstate.level];
    setHash(`concept=${c.id}&level=${l.id}${l.recap ? "" : `&frame=${cstate.frame + 1}`}`);
    renderLadder();
    stopTimers();
    const widget = $(".xp-widget");
    widget.innerHTML = "";
    const ft = $(".frametabs");
    if (l.recap) {
      ft.innerHTML = "";
      $(".scene-wrap").hidden = true;
      $(".gauges").innerHTML = "";
      renderRecap(c);
      return;
    }
    $(".scene-wrap").hidden = false;
    ft.innerHTML = framesOf(l).map((f, i) => `<button data-f="${i}" aria-pressed="${i === cstate.frame}">${f}</button>`).join("");
    ft.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { cstate.frame = Number(b.dataset.f); renderConcept(); }));
    const f = cstate.frame;
    if (f === 0) drawScene(scene, c, l.before, { hurt: l.before.hurt });
    else if (f === 1) drawScene(scene, c, l.after, { diff: true, ghostsOf: l.before, changed: l.after.changed });
    else drawScene(scene, c, l.after, {});
    $(".clegend").innerHTML =
      (f === 0 ? `<span><span class="sw" style="border-color:var(--bad);background:var(--bad-soft)"></span>where it hurts</span>`
        : f === 1 ? `<span><span class="sw" style="border-color:var(--good);background:var(--good-soft)"></span>added</span><span><span class="sw" style="border-color:var(--chg);background:var(--chg-soft)"></span>changed</span><span><span class="sw" style="border-color:var(--line);border-style:dashed"></span>gone</span>` : "") +
      `<span>dots = requests (<span style="color:var(--bad)">red</span> = rejected, <span style="color:var(--chg)">amber</span> = slow)</span>` +
      (reduceMotion ? "" : `<button data-act="pause" style="font-size:12px;padding:2px 8px">⏸ pause dots</button>`);
    $('[data-act="pause"]')?.addEventListener("click", ev => {
      const paused = scene.animationsPaused();
      paused ? scene.unpauseAnimations() : scene.pauseAnimations();
      ev.target.textContent = paused ? "⏸ pause dots" : "▶ play dots";
    });
    const gs = (f === 0 ? l.g1 : f === 2 ? l.g3 : []) || [];
    $(".gauges").innerHTML = gs.map(gaugeHtml).join("");
    if (l.widget) {
      const [name, args] = typeof l.widget === "string" ? [l.widget, {}] : [l.widget.name, l.widget.args || {}];
      if (WIDGETS[name]) WIDGETS[name](widget, { args, G, gaugeHtml, esc, fmt, tag, every, reduceMotion });
      else console.error(`explorer: no widget named ${name}`);
    }
    renderCPanel(c, l, lv);
  }

  function renderCPanel(c, l, lv) {
    const f = cstate.frame, isLast = cstate.level === lv.length - 1;
    const lab = l.lab ? `<details ${f === 2 ? "open" : ""}><summary>Try it live</summary>
        <p class="muted">${!l.lab.cfg ? "No special setup." : l.lab.cfg.startsWith("(") ? `No special config: <strong>${esc(l.lab.cfg.slice(1, -1))}</strong>.` : `Run and Debug config: <strong>${esc(l.lab.cfg)}</strong>.`}
          ${meta.labsDoc ? ` Full checklist: ${fileLink(meta.labsDoc)}.` : ""}</p>
        <ol>${l.lab.steps.map(s => `<li>${fmt(s)}</li>`).join("")}</ol></details>` : "";
    const more = l.options || l.senior || l.staff || l.lesson ? `<details><summary>The full reasoning (options${l.senior || l.staff ? ", how to explain it" : ""})</summary>
        ${l.cause ? `<h3>Root cause</h3><p>${fmt(l.cause)}</p>` : ""}
        ${l.options ? `<h3>Options weighed</h3><ul class="opts">${l.options.map(([k, t, why]) => `<li class="${k === "yes" ? "yes" : k === "no" ? "no" : ""}"><strong>${fmt(t)}</strong>${k === "alt" ? " <span class='muted'>(also reasonable)</span>" : ""}: ${fmt(why)}</li>`).join("")}</ul>` : ""}
        ${l.lesson ? `<h3>What building it taught us</h3><p>${fmt(l.lesson)}</p>` : ""}
        ${l.senior ? `<h3>Say it like a Senior engineer</h3><div class="say">${fmt(l.senior)}</div>` : ""}
        ${l.staff ? `<h3>…and like a Staff engineer</h3><div class="say">${fmt(l.staff)}</div>` : ""}</details>` : "";
    cpanel.innerHTML = `
      <p class="muted" style="margin:0">${esc(c.title)} · level ${cstate.level} of ${c.levels.length - 1}${l.proposed ? ' · <span class="tag model">proposed: not built yet</span>' : ""}</p>
      <h2>${esc(l.id)} · ${esc(l.name)}</h2>
      ${l.q ? `<p class="muted"><em>${esc(l.q)}</em></p>` : ""}
      ${cstate.level === 0 && f === 0 && c.intro ? `<p>${fmt(c.intro)}</p>` : ""}
      <div class="stepbar"><span class="count">${framesOf(l)[f]}</span>
        <button data-act="cprev" ${cstate.level === 0 && f === 0 ? "disabled" : ""}>← Back</button>
        <button data-act="cnext" class="primary" ${isLast ? "disabled" : ""}>${f === 2 ? "Next level →" : "Next →"}</button></div>
      <p>${fmt(l.cap?.[f] || "")}</p>
      ${f === 0 && l.cause ? `<p><strong>Root cause:</strong> ${fmt(l.cause)}</p>` : ""}
      ${f === 1 && l.diff ? `<h3>What changed</h3><ul class="diff">${l.diff.map(([k, t, link]) => `<li class="${k}">${k === "add" ? "+ " : k === "chg" ? "~ " : "− "}${fmt(t)}${link ? `<br>${fileLink(link[0], link[1])}` : ""}</li>`).join("")}</ul>` : ""}
      ${f === 2 && l.next ? `<h3>The new problem</h3><div class="next">${fmt(l.next)}</div>` : ""}
      ${lab}
      ${l.bp ? `<h3>Breakpoint</h3><div class="bp">${fileLink(l.bp[0], l.bp[1])}<br>${fmt(l.bp[2] || "")}</div>` : ""}
      ${l.tests?.length ? `<h3>The test that proves it</h3><ul>${l.tests.map(t => `<li>${fileLink(t[0], t[1], t[2])}</li>`).join("")}</ul>` : ""}
      ${more}
      ${c.docs?.length ? `<h3>Read more</h3><ul>${docLinks(c.docs)}</ul>` : ""}
      <p class="hint">Keyboard: ← / → move through frames and levels. Numbers: ${Object.keys(TAGS).map(t => `${tag(t)} ${esc(TAG_HELP[t])}`).join(" · ")}</p>`;
    cpanel.querySelector('[data-act="cprev"]')?.addEventListener("click", () => cgo(-1));
    cpanel.querySelector('[data-act="cnext"]')?.addEventListener("click", () => cgo(1));
  }

  function renderRecap(c) {
    $(".xp-widget").innerHTML = `<div class="widget"><h4>The ladder in one table</h4>
      <table>${c.levels.map(l => `<tr>
        <td style="white-space:nowrap"><a href="#concept=${esc(c.id)}&level=${esc(l.id)}" data-lv="${esc(l.id)}"><strong>${esc(l.id)}</strong></a></td>
        <td><strong>${esc(l.name)}</strong><br><span class="muted">${esc(l.q || "")}</span></td>
        <td>${fmt(l.next || "")}</td></tr>`).join("")}</table>
      <p class="hint">Right column: what each decision cost, which is what forced the next level.</p></div>`;
    $(".xp-widget").querySelectorAll("[data-lv]").forEach(a => a.addEventListener("click", ev => { ev.preventDefault(); showConcept(c.id, a.dataset.lv, 0); }));
    const r = c.recap || {};
    cpanel.innerHTML = `
      <p class="muted" style="margin:0">${esc(c.title)} · recap</p>
      <h2>The whole ladder</h2>
      <div class="stepbar"><span class="count">★ Recap</span><button data-act="cprev">← Back</button></div>
      ${r.pattern ? `<h3>The pattern, without this project in it</h3><p>${fmt(r.pattern)}</p>` : ""}
      ${r.elsewhere?.length ? `<h3>The same ladder elsewhere</h3><ul>${r.elsewhere.map(([d, h]) => `<li><strong>${esc(d)}</strong>: ${fmt(h)}</li>`).join("")}</ul>` : ""}
      ${r.say ? `<h3>The 45-second answer</h3><div class="say">${fmt(r.say)}</div>` : ""}
      ${r.undo?.length ? `<h3>What would make me change this design</h3><ul>${r.undo.map(u => `<li>${fmt(u)}</li>`).join("")}</ul>` : ""}
      ${c.docs?.length ? `<h3>Read more</h3><ul>${docLinks(c.docs)}</ul>` : ""}`;
    cpanel.querySelector('[data-act="cprev"]').addEventListener("click", () => cgo(-1));
  }

  function cgo(delta) {
    const lv = levelsOf(concept());
    if (lv[cstate.level].recap) { if (delta < 0) { cstate.level--; cstate.frame = 2; renderConcept(); } return; }
    let f = cstate.frame + delta, l = cstate.level;
    if (f > 2) { if (l + 1 < lv.length) { l++; f = 0; } else f = 2; }
    if (f < 0) { if (l > 0) { l--; f = 2; } else f = 0; }
    cstate.level = l; cstate.frame = f;
    renderConcept();
  }

  // ---- views, controls, routing
  let view = "flows";
  function showView(v) {
    view = v;
    root.querySelectorAll("[data-view]").forEach(x => { x.hidden = x.dataset.view !== v; });
    root.querySelectorAll("[data-ctl]").forEach(x => { x.hidden = x.dataset.ctl !== v; });
    root.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === v));
    if (v !== "concepts") stopTimers();
    if (v === "flows" && !mapDrawn) drawMap();   // drawn while visible: label placement measures text
  }
  function showConcept(id, levelId, frame = 0) {
    if (!CONCEPTS.length) return;
    showView("concepts");
    cstate.concept = CONCEPTS.some(c => c.id === id) ? id : CONCEPTS[0].id;
    cselect.value = cstate.concept;
    const lv = levelsOf(concept()), i = lv.findIndex(l => l.id === levelId);
    cstate.level = i >= 0 ? i : 0;
    cstate.frame = Math.max(0, Math.min(2, frame || 0));
    renderConcept();
  }
  let applyingHash = false;
  function setHash(h) {
    if (!hashRouting || applyingHash) return;
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  const select = $('[data-sel="flow"]'), cselect = $('[data-sel="concept"]');
  for (const f of FLOWS) select.add(new Option(f.title, f.id));
  for (const c of CONCEPTS) cselect.add(new Option(c.title, c.id));
  select.addEventListener("change", () => setFlow(select.value));
  cselect.addEventListener("change", () => showConcept(cselect.value));
  root.querySelector('[data-tab="concepts"]')?.addEventListener("click", () => showConcept(cstate.concept, levelsOf(concept())[cstate.level].id, cstate.frame));
  root.querySelector('[data-tab="flows"]').addEventListener("click", () => { showView("flows"); if (state.flow === "map") { showMap(); setHash(""); } else showStep(); });
  $('[data-act="theme"]').addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  });
  $(".legend").innerHTML = Object.entries(MODULES).map(([k, m]) => `<span style="--c: var(--m-${k})">${esc(m.label)}</span>`).join("");
  on(document, "keydown", ev => {
    if (!root.isConnected || ["SELECT", "INPUT", "TEXTAREA"].includes(ev.target.tagName)) return;
    const step = view === "concepts" ? cgo : go;
    if (ev.key === "ArrowRight") step(1);
    if (ev.key === "ArrowLeft") step(-1);
  });

  // #flow=id&step=N · #node=id · #concept=id&level=L2&frame=2 · #theme=dark
  function routeFromHash() {
    applyingHash = true;
    try {
      const h = new URLSearchParams(hashRouting ? location.hash.slice(1) : opts.initial || "");
      if (["light", "dark"].includes(h.get("theme"))) root.dataset.theme = h.get("theme");
      if (h.get("concept") && CONCEPTS.some(c => c.id === h.get("concept"))) {
        showConcept(h.get("concept"), h.get("level"), Number(h.get("frame") || 1) - 1);
        return;
      }
      showView("flows");
      if (h.get("flow") && flowOf(h.get("flow"))?.steps) {
        select.value = h.get("flow");
        setFlow(select.value);
        const step = Number(h.get("step") || 1) - 1;
        if (step > 0) { state.step = Math.min(step, flowOf(select.value).steps.length - 1); showStep(); }
      } else {
        select.value = "map";
        setFlow("map");
        if (h.get("node") && byId[h.get("node")]) selectNode(h.get("node"));
      }
    } finally { applyingHash = false; }
  }
  if (hashRouting) on(window, "hashchange", routeFromHash);
  routeFromHash();

  const api = {
    data,
    destroy() { stopTimers(); cleanups.forEach(f => f()); root.innerHTML = ""; root.classList.remove("xp"); if (window.__explorer === api) delete window.__explorer; },
    showMap: () => { showView("flows"); select.value = "map"; setFlow("map"); },
    showNode: id => { api.showMap(); selectNode(id); },
    showFlow: (id, step = 1) => { showView("flows"); select.value = id; setFlow(id); if (step > 1) { state.step = step - 1; showStep(); } },
    showConcept,
    setTheme: t => { if (t) root.dataset.theme = t; else delete root.dataset.theme; },
  };
  window.__explorer = api;   // handle for tools/check-explorer.mjs and the browser console
  return api;
}

// ---- helpers shared by the map and the scenes ------------------------------------------------------------------
function moduleColors(uid, modules) {
  const light = [], dark = [];
  for (const [k, m] of Object.entries(modules)) {
    light.push(`--m-${k}: ${m.color || "#868e96"};`);
    if (m.dark) dark.push(`--m-${k}: ${m.dark};`);
  }
  const s = `.xp[data-xp="${uid}"] { ${light.join(" ")} }`;
  return dark.length ? `${s} @media (prefers-color-scheme: dark) { .xp[data-xp="${uid}"]:not([data-theme="light"]) { ${dark.join(" ")} } } .xp[data-xp="${uid}"][data-theme="dark"] { ${dark.join(" ")} }` : s;
}

function fitText(t, width, size, min = 8.5) {   // shrink a line that doesn't fit inside its box
  for (let fs = size; fs >= min && t.getComputedTextLength() > width; fs -= 0.5) t.style.fontSize = fs + "px";
}

// An arrow's label goes where it touches no box, box tag or other label: the middle of each segment first (above, then
// below a horizontal one; right, then left of a vertical one), then along it, then above/below the row of boxes.
// A halo (paint-order: stroke) keeps it readable over lines.
function placeLabels(layer, labels, boxes, width, { pad, tagSpace, fontGap: [up, down], extra = [] }) {
  const taken = boxes.map(b => ({ x: b.x - pad, y: b.y - tagSpace - pad, width: b.w + 2 * pad, height: b.h + tagSpace + 2 * pad }));
  for (const r of extra) taken.push({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
  const hits = r => taken.some(t => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
  for (const l of labels) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", l.cls);
    if (l.id) t.dataset.id = l.id;
    t.textContent = l.label;
    layer.appendChild(t);
    const tries = [];
    if (l.la) tries.push([l.la[0], l.la[1], "start"]);
    const segs = [];
    for (let i = 1; i < l.pts.length; i++) segs.push([l.pts[i - 1], l.pts[i]]);
    segs.sort((a, b) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) - Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]));
    for (const [p, q] of segs) {
      for (const f of [0.5, 0.3, 0.7]) {
        const x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f;
        if (p[1] === q[1]) tries.push(...(l.below ? [[x, y + down, "middle"], [x, y - up, "middle"]] : [[x, y - up, "middle"], [x, y + down, "middle"]]));
        else tries.push([x + 7, y + 4, "start"], [x - 7, y + 4, "end"]);
      }
      if (p[1] === q[1]) {   // a short arrow between two boxes in a row: just above (or below) the row, over the gap
        const x = (p[0] + q[0]) / 2, row = boxes.filter(b => b.y <= p[1] && p[1] <= b.y + b.h && Math.abs(b.x + b.w / 2 - x) < 260);
        if (row.length) {
          const top = Math.min(...row.map(b => b.y)) - tagSpace, bottom = Math.max(...row.map(b => b.y + b.h));
          tries.push(...(l.below ? [[x, bottom + 15, "middle"], [x, top - 9, "middle"]] : [[x, top - 9, "middle"], [x, bottom + 15, "middle"]]));
        }
      }
    }
    let placed = false;
    for (const [x, y, anchor] of tries) {
      t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", anchor);
      const r = t.getBBox();
      if (!hits(r) && r.x >= 0 && r.x + r.width <= width) { taken.push(r); placed = true; break; }
    }
    if (!placed && tries.length) {   // nowhere free: the first choice, readable thanks to the halo
      const [x, y, anchor] = tries[0];
      t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", anchor);
      t.dataset.unplaced = "1";   // tools/check-explorer.mjs reports these
    }
  }
}

// ---- built-in widgets (a level picks one with widget: "name" or { name, args }) -----------------------------------
// Each gets (host, api): api.args, api.G, api.gaugeHtml, api.esc, api.every(ms, fn) for timers that stop on navigation.
const BUILTIN_WIDGETS = {
  // Fixed window vs token bucket, scaled down. args: { capacity = 5, refill = 5 }
  "token-bucket"(host, { args, every }) {
    const CAP = args.capacity ?? 5, RATE = args.refill ?? 5;
    let t0 = performance.now(), tokens = CAP, ts = 0, win = -1, used = 0, log = [];
    const now = () => (performance.now() - t0) / 1000;
    const take = t => {
      tokens = Math.min(CAP, tokens + (t - ts) * RATE); ts = t;
      const b = tokens >= 1 ? (tokens -= 1, true) : false;
      const w = Math.floor(t); if (w !== win) { win = w; used = 0; }
      const fw = used < CAP ? (used++, true) : false;
      return [fw, b];
    };
    const line = (t, fw, b) => `t=${t.toFixed(2)} s   window: ${fw ? "ok " : "429"}   bucket: ${b ? "ok " : "429"}`;
    host.innerHTML = `<div class="widget"><h4>Simulator: fixed window vs token bucket <span class="tag model">model</span></h4>
      <p class="hint" style="margin:0">Window: ${CAP} per clock second, reset at every whole second. Bucket: holds ${CAP}, refills ${RATE} a second.</p>
      <div class="row"><button data-w="1">Send 1</button><button data-w="burst">Burst of ${CAP + 3}</button><button data-w="straddle" class="primary">Straddle the boundary</button><button data-w="reset">Reset</button></div>
      <div class="row"><span>Bucket now: <strong data-w="tok"></strong> tokens</span></div>
      <div class="log" data-w="log">Click a button. "Straddle" sends ${CAP} at t = 0.90 s and ${CAP} at t = 1.10 s.</div></div>`;
    const q = s => host.querySelector(`[data-w="${s}"]`);
    const paint = () => { q("tok").textContent = Math.min(CAP, tokens + (now() - ts) * RATE).toFixed(2); };
    const show = () => { q("log").textContent = log.slice(-12).join("\n"); paint(); };
    q("1").onclick = () => { const t = now(); const [fw, b] = take(t); log.push(line(t, fw, b)); show(); };
    q("burst").onclick = () => { const t = now(); for (let i = 0; i < CAP + 3; i++) { const [fw, b] = take(t); log.push(line(t, fw, b)); } show(); };
    q("reset").onclick = () => { t0 = performance.now(); tokens = CAP; ts = 0; win = -1; used = 0; log = []; show(); };
    q("straddle").onclick = () => {
      t0 = performance.now() - 3000; tokens = CAP; ts = 0; win = -1; used = 0; log = [];
      let fwOk = 0, bOk = 0;
      for (const t of [...Array(CAP).fill(0.9), ...Array(CAP).fill(1.1)]) { const [fw, b] = take(t); fwOk += fw; bOk += b; log.push(line(t, fw, b)); }
      log.push("", `In 0.2 s: the window let ${fwOk} through (2× the limit). The bucket let ${bOk} through (burst + what refilled in 0.2 s).`);
      show();
    };
    paint();
    every(150, paint);
  },

  // A count-based circuit breaker, call by call. args: { window = 20, minCalls = 10, failureRate = 0.5, openSeconds = 5, trials = 3, failMs, rejectMs }
  "circuit-breaker"(host, { args }) {
    const WIN = args.window ?? 20, MIN = args.minCalls ?? 10, RATE = args.failureRate ?? 0.5, OPEN_S = args.openSeconds ?? 5, TRIALS = args.trials ?? 3;
    let state = "CLOSED", calls = [], trial = [], openedAt = 0, now = 0, log = [];
    host.innerHTML = `<div class="widget"><h4>Simulator: the circuit breaker, call by call <span class="tag calculated">from its settings</span></h4>
      <p class="hint" style="margin:0">Window ${WIN} calls · opens at ${Math.round(RATE * 100)}% failed once ${MIN} calls are in · stays open ${OPEN_S} s · then ${TRIALS} trial calls.</p>
      <div class="row"><button data-w="ok">✓ call succeeds</button><button data-w="fail">✗ call fails</button><button data-w="wait" class="primary">wait ${OPEN_S} s</button><button data-w="reset">reset</button></div>
      <div class="row"><span>State: <strong data-w="state"></strong></span><span data-w="win" class="muted"></span></div>
      <svg data-w="vis" width="${WIN * 21}" height="22" style="max-width:100%" aria-hidden="true"></svg>
      <div class="log" data-w="log"></div></div>`;
    const q = s => host.querySelector(`[data-w="${s}"]`);
    const draw = () => {
      q("state").textContent = state;
      q("state").style.color = state === "OPEN" ? "var(--bad)" : state === "HALF_OPEN" ? "var(--chg)" : "var(--good)";
      const failed = calls.filter(c => !c).length;
      q("win").textContent = state === "HALF_OPEN" ? `trial calls: ${trial.length} of ${TRIALS}` : `window: ${calls.length} calls, ${failed} failed (${calls.length ? Math.round(failed / calls.length * 100) : 0}%)`;
      q("vis").innerHTML = Array.from({ length: WIN }, (_, i) => {
        const c = calls[i], fill = c === undefined ? "var(--surface-2)" : c ? "var(--good)" : "var(--bad)";
        return `<rect x="${i * 21}" y="2" width="18" height="18" rx="3" style="fill:${fill};stroke:var(--line)"></rect>`;
      }).join("");
      q("log").textContent = log.slice(-10).join("\n");
    };
    const call = ok => {
      if (state === "OPEN") {
        if (now - openedAt >= OPEN_S) { state = "HALF_OPEN"; trial = []; log.push(`t=${now}s first call after the wait → HALF_OPEN`); }
        else { log.push(`t=${now}s rejected at once${args.rejectMs ? ` (~${args.rejectMs} ms)` : ""}: breaker OPEN, the dependency is not called`); draw(); return; }
      }
      if (state === "HALF_OPEN") {
        trial.push(ok); log.push(`t=${now}s trial call ${trial.length}: ${ok ? "ok" : "failed"}`);
        if (!ok) { state = "OPEN"; openedAt = now; calls = []; log.push(`  a trial failed → OPEN again for ${OPEN_S} s`); }
        else if (trial.length === TRIALS) { state = "CLOSED"; calls = []; log.push(`  ${TRIALS} trials ok → CLOSED`); }
        draw(); return;
      }
      calls.push(ok); if (calls.length > WIN) calls.shift();
      const failed = calls.filter(c => !c).length;
      log.push(`t=${now}s ${ok ? "ok" : `failed${args.failMs ? ` (~${args.failMs} ms)` : ""}`}`);
      if (calls.length >= MIN && failed / calls.length >= RATE) { state = "OPEN"; openedAt = now; log.push(`  ${failed} of ${calls.length} failed → OPEN`); }
      draw();
    };
    q("ok").onclick = () => call(true);
    q("fail").onclick = () => call(false);
    q("wait").onclick = () => { now += OPEN_S; log.push(`… ${now}s (no calls: the breaker only moves when a call arrives)`); draw(); };
    q("reset").onclick = () => { state = "CLOSED"; calls = []; trial = []; now = 0; log = []; draw(); };
    draw();
  },

  // Partitions shared by a consumer group. args: { partitions = 12 }
  partitions(host, { args }) {
    const P = args.partitions ?? 12;
    host.innerHTML = `<div class="widget"><h4>Simulator: ${P} partitions shared by a consumer group <span class="tag calculated">the broker's rule</span></h4>
      <div class="row"><label>Consumers in the group <input type="range" data-w="n" min="1" max="${P + Math.ceil(P / 4)}" value="${Math.min(3, P)}"></label><strong data-w="v"></strong></div>
      <svg data-w="vis" width="100%" height="40" viewBox="0 0 ${P * 20} 40" aria-hidden="true"></svg>
      <p data-w="note" class="hint"></p></div>`;
    const q = s => host.querySelector(`[data-w="${s}"]`);
    const colors = ["--focus", "--hl", "--good", "--chg", "--t-rule", "--t-calculated", "--bad", "--t-model"];
    const draw = () => {
      const n = Number(q("n").value);
      q("v").textContent = n;
      q("vis").innerHTML = Array.from({ length: P }, (_, i) => `<rect x="${i * 20}" y="4" width="17" height="30" rx="3" style="fill:var(${colors[(i % n) % colors.length]})"><title>partition ${i} → consumer ${(i % n) + 1}</title></rect>`).join("");
      const idle = Math.max(0, n - P), per = Math.floor(P / Math.min(n, P));
      q("note").innerHTML = idle ? `<strong>${idle} consumer${idle > 1 ? "s" : ""} idle</strong>: a partition is read by one consumer at a time, so more than ${P} adds nothing.`
        : `${per}${P % n ? "–" + (per + 1) : ""} partitions each. Order is kept per partition, so per key.`;
    };
    q("n").oninput = draw;
    draw();
  },
};
