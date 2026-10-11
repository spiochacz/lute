import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor, util } from "../../../src/index.ts";
import { vditorDOM2MdPreprocess, vditorDOM2MdBuildTree, vditorDOM2MdRender } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess, vditorIRDOM2MdBuildTree, vditorIRDOM2MdRender } from "../../../src/vditor_ir.ts";
import * as conv from "../../../src/runtime/conv.ts";
const FIX = process.env.FIX!;
for (const mode of ["wysiwyg", "ir"] as const) {
  const h = readFileSync(`${FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
  const { port } = engines(CONFIGS[0], mode);
  const pre = mode === "wysiwyg" ? vditorDOM2MdPreprocess : vditorIRDOM2MdPreprocess;
  const bt = mode === "wysiwyg" ? vditorDOM2MdBuildTree : vditorIRDOM2MdBuildTree;
  const rd = mode === "wysiwyg" ? vditorDOM2MdRender : vditorIRDOM2MdRender;
  const adj = (mode === "wysiwyg" ? "adjustVditorDOM" : "adjustVditorIRDOM");
  const best: Record<string, number> = {};
  const m = (k: string, v: number) => { best[k] = Math.min(best[k] ?? Infinity, v); };
  for (let i = 0; i < 15; i++) {
    let t = performance.now();
    const p = pre(h); m("preprocess", performance.now() - t);
    t = performance.now(); const root = util.ParseHTML(p)!; m("parse", performance.now() - t);
    t = performance.now(); (port as any)[adj] ? (port as any)[adj](root) : (port as any).adjustVditorDOM(root); m("adjustDOM", performance.now() - t);
    t = performance.now(); const tree = bt(port, root); m("genAST+adjustTree", performance.now() - t);
    t = performance.now(); const out = rd(port, tree); m("render", performance.now() - t);
    t = performance.now(); conv.StringFromBytes(out); m("toString", performance.now() - t);
    t = performance.now(); mode === "wysiwyg" ? port.VditorDOM2Md(h) : port.VditorIRDOM2Md(h); m("TOTAL VditorDOMtoMd", performance.now() - t);
  }
  console.log(mode, Object.entries(best).map(([k, v]) => `${k}=${v.toFixed(1)}`).join("  "));
}
