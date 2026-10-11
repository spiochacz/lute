import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines, loadMarkdownCorpus, forward } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md, IncrementalDom2MdStats } from "../../../src/incremental/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess } from "../../../src/vditor_ir.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { Cache, compose } from "./fast.ts";
import { refNoPre } from "./ref.ts";
const FIX = process.env.FIX!;
const which = process.argv[2] ?? "spec";
for (const mode of ["wysiwyg", "ir"] as const) {
  const { port, oracle } = engines(CONFIGS[0], mode);
  const mds = loadMarkdownCorpus().filter((d) => d.real);
  let raw: string;
  if (which === "spec") raw = readFileSync(`${FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
  else {
    const prose = mds.filter((d) => (d.name.startsWith("tasks/") && !d.name.includes("002")) || d.name === "ts/PORTING.md").map((d) => d.md).join("\n\n");
    raw = forward(oracle, mode, prose.repeat(Math.ceil(200000 / prose.length))).split(editor.Zwsp).join("");
  }
  const pre = mode === "wysiwyg" ? vditorDOM2MdPreprocess : vditorIRDOM2MdPreprocess;
  const h = pre(raw);
  const sc = scanTopLevel(h); if (!sc.ok) { console.log(mode, "scan refuses", sc.code); continue; }
  const kids = sc.children.map((c) => h.substring(c.start, c.end));
  const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  const fast = new Cache();
  const cur = port; EnableIncrementalDom2Md(cur);
  const call = (s: string) => (mode === "wysiwyg" ? cur.VditorDOM2Md(s) : cur.VditorIRDOM2Md(s));
  const ok0 = compose(port, ad, fast, h);
  call(raw);
  const st = IncrementalDom2MdStats(cur)!;
  console.log(`${mode} ${which}: ${h.length} chars, ${kids.length} children; fast composed=${ok0 !== null} (${fast.stats.reason}); current composed=${st.composed} ${JSON.stringify(st.unsupported)}`);
  if (ok0 === null) continue;
  const paragraphs = kids.map((k, i) => (k.startsWith("<p") ? i : -1)).filter((i) => i >= 0);
  let bf = Infinity, bc = Infinity, bn = Infinity, eq = true;
  for (let r = 0; r < 14; r++) {
    const i = paragraphs[(r * 7919) % paragraphs.length];
    const ed = kids.slice(); ed[i] = ed[i].replace(/<\/p>$/, "é" + String.fromCharCode(0x4e00 + r) + "</p>");
    const doc = ed.join("");           // already preprocessed content; for the current engine pass the same (preprocess is a no-op on this content unless it has 4 spaces + LF)
    let t = performance.now(); const of = compose(port, ad, fast, doc); bf = Math.min(bf, performance.now() - t);
    t = performance.now(); const oc = call(doc); bc = Math.min(bc, performance.now() - t);
    t = performance.now(); const on = refNoPre(port, mode, doc); bn = Math.min(bn, performance.now() - t);
    if (of !== on) eq = false;
    void oc;
  }
  console.log(`  warm one-edit: fast ${bf.toFixed(2)} ms, current cache ${bc.toFixed(2)} ms, normal ${bn.toFixed(2)} ms; fast==normal ${eq}; fast variants/entries ${fast.map.size}`);
}
