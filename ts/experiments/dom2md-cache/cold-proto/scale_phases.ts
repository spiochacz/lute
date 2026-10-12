// Phase times of the normal VditorDOM2Md / VditorIRDOM2Md path at 1, 5 and 24 copies of the CommonMark spec (0.2, 1 and 5 MB of Markdown).
// Usage: node --max-old-space-size=8192 scale_phases.ts [wysiwyg|ir] [copies...]
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor, util } from "../../../src/index.ts";
import { vditorDOM2MdPreprocess, vditorDOM2MdBuildTree, vditorDOM2MdRender } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess, vditorIRDOM2MdBuildTree, vditorIRDOM2MdRender } from "../../../src/vditor_ir.ts";
import * as conv from "../../../src/runtime/conv.ts";
const base = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const mode = (process.argv[2] ?? "wysiwyg") as "wysiwyg" | "ir";
const copies = process.argv.slice(3).map(Number); if (copies.length === 0) copies.push(1, 5, 24);
const { port } = engines(CONFIGS[0], mode);
const pre = mode === "wysiwyg" ? vditorDOM2MdPreprocess : vditorIRDOM2MdPreprocess;
const bt = mode === "wysiwyg" ? vditorDOM2MdBuildTree : vditorIRDOM2MdBuildTree;
const rd = mode === "wysiwyg" ? vditorDOM2MdRender : vditorIRDOM2MdRender;
const adj = mode === "wysiwyg" ? "adjustVditorDOM" : "adjustVditorIRDOM";
for (const n of copies) {
  let md = ""; for (let i = 0; i < n; i++) md += base.replace(/^(#+ .*)$/gm, `$1 ${i}`) + "\n\n";
  const h = (mode === "wysiwyg" ? port.Md2VditorDOM(md) : port.Md2VditorIRDOM(md)).split(editor.Zwsp).join("");
  const best: Record<string, number> = {};
  const m = (k: string, v: number) => { best[k] = Math.min(best[k] ?? Infinity, v); };
  for (let i = 0; i < (n > 10 ? 3 : 6); i++) {
    let t = performance.now();
    const p = pre(h); m("preprocess", performance.now() - t);
    t = performance.now(); const root = util.ParseHTML(p)!; m("parse", performance.now() - t);
    t = performance.now(); (port as any)[adj] ? (port as any)[adj](root) : (port as any).adjustVditorDOM(root); m("adjustDOM", performance.now() - t);
    t = performance.now(); const tree = bt(port, root); m("genAST+adjustTree", performance.now() - t);
    t = performance.now(); const out = rd(port, tree); m("render", performance.now() - t);
    t = performance.now(); conv.StringFromBytes(out); m("toString", performance.now() - t);
    t = performance.now(); mode === "wysiwyg" ? port.VditorDOM2Md(h) : port.VditorIRDOM2Md(h); m("TOTAL", performance.now() - t);
  }
  console.log(mode, `copies=${n} html=${(h.length / 1e6).toFixed(2)}MB`, Object.entries(best).map(([k, v]) => `${k}=${v.toFixed(1)}`).join("  "));
}
