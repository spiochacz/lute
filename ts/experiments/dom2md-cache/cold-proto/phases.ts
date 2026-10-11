import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { State } from "../../../src/incremental/cache.ts";
import { tryDom2Md, A } from "./assemble_timed.ts";
import { T, WYSIWYG_ADAPTER, IR_ADAPTER } from "./sandbox_timed.ts";
const FIX = process.env.FIX!;
const reps = Number(process.argv[2] ?? 10);
for (const mode of ["wysiwyg", "ir"] as const) {
  const h0 = readFileSync(`${FIX}/spec.${mode}.html`, "utf8");
  const h = h0.split(editor.Zwsp).join("");
  const { port } = engines(CONFIGS[0], mode);
  const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  let best = Infinity, bA: any, bT: any, bst: any;
  for (let i = 0; i < reps; i++) {
    for (const k of Object.keys(A)) delete A[k];
    for (const k of Object.keys(T)) delete T[k];
    const st = new State({});
    const t = performance.now();
    const r = tryDom2Md(st, port, ad, h);
    const d = performance.now() - t;
    if (d < best) { best = d; bA = { ...A }; bT = { ...T }; bst = { ...st.stats, out: r === null ? "null" : r.length }; }
  }
  console.log(`\n== ${mode}: cold tryDom2Md best ${best.toFixed(1)} ms`);
  const sum = (o: any) => Object.values(o).reduce((a: number, b: any) => a + b, 0) as number;
  console.log("assemble phases (ms, % of total):");
  for (const [k, v] of Object.entries(bA)) console.log(`  ${k.padEnd(22)} ${(v as number).toFixed(1).padStart(7)} ${((100 * (v as number)) / best).toFixed(1).padStart(5)}%`);
  console.log(`sandbox inner phases, summed over ${bst.sandboxRuns} runs (ms; total ${sum(bT).toFixed(1)}):`);
  for (const [k, v] of Object.entries(bT)) console.log(`  ${k.padEnd(22)} ${(v as number).toFixed(1).padStart(7)} ${((100 * (v as number)) / best).toFixed(1).padStart(5)}%`);
  console.log(JSON.stringify({ children: bst.children, sandboxRuns: bst.sandboxRuns, hits: bst.hits, misses: bst.misses, out: bst.out, uns: bst.unsupported }));
}
