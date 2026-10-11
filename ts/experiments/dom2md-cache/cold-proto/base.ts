import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { EnableIncrementalDom2Md, IncrementalDom2MdStats } from "../../../src/incremental/index.ts";
const FIX = process.env.FIX!;
const reps = Number(process.argv[2] ?? 8);
for (const mode of ["wysiwyg", "ir"] as const) {
  const h = readFileSync(`${FIX}/spec.${mode}.html`, "utf8");
  const call = (e: any, s: string) => (mode === "wysiwyg" ? e.VditorDOM2Md(s) : e.VditorIRDOM2Md(s));
  const { port } = engines(CONFIGS[0], mode);
  let first = performance.now(); call(port, h); first = performance.now() - first;
  let bn = Infinity, bc = Infinity, bw = Infinity;
  for (let i = 0; i < reps; i++) {
    let t = performance.now(); call(port, h); bn = Math.min(bn, performance.now() - t);
    const { port: p2 } = engines(CONFIGS[0], mode);
    EnableIncrementalDom2Md(p2);
    t = performance.now(); call(p2, h); bc = Math.min(bc, performance.now() - t);
    t = performance.now(); call(p2, h); bw = Math.min(bw, performance.now() - t);
    if (i === 0) console.log(mode, JSON.stringify(IncrementalDom2MdStats(p2)));
  }
  console.log(`${mode}: very first normal call ${first.toFixed(1)}  normal ${bn.toFixed(1)}  cold incr ${bc.toFixed(1)}  second(unchanged) incr ${bw.toFixed(1)}`);
}
