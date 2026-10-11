import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess } from "../../../src/vditor_ir.ts";
import { Cache, compose, T } from "./fast.ts";
import { refNoPre } from "./ref.ts";
const FIX = process.env.FIX!;
const reps = Number(process.argv[2] ?? 10);
for (const mode of ["wysiwyg", "ir"] as const) {
  const h0 = readFileSync(`${FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
  const h = (mode === "wysiwyg" ? vditorDOM2MdPreprocess : vditorIRDOM2MdPreprocess)(h0);
  const { port } = engines(CONFIGS[0], mode);
  const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  const normal = () => refNoPre(port, mode, h);
  const ref = refNoPre(port, mode, h);
  let bn = Infinity, bc = Infinity, bw = Infinity, bT: any, ok = true, st: any;
  for (let i = 0; i < reps; i++) {
    let t = performance.now(); normal(); bn = Math.min(bn, performance.now() - t);
    for (const k of Object.keys(T)) delete T[k];
    const c = new Cache();
    t = performance.now(); const o = compose(port, ad, c, h); const d = performance.now() - t;
    if (o !== null && o !== ref) ok = false;
    if (d < bc) { bc = d; bT = { ...T }; st = { ...c.stats }; }
    t = performance.now(); compose(port, ad, c, h); bw = Math.min(bw, performance.now() - t);
  }
  console.log(`${mode}: normal ${bn.toFixed(1)}  fast cold ${bc.toFixed(1)}  fast 2nd (unchanged) ${bw.toFixed(1)}  equal=${ok}`, JSON.stringify(st));
  console.log("  phases(ms):", Object.entries(bT).map(([k, v]) => `${k}=${(v as number).toFixed(1)}`).join(" "));
}
