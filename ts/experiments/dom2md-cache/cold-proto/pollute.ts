import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { EnableIncrementalDom2Md } from "../../../src/incremental/index.ts";
const FIX = process.env.FIX!;
for (const mode of ["wysiwyg", "ir"] as const) {
  const h = readFileSync(`${FIX}/spec.${mode}.html`, "utf8");
  const call = (e: any, s: string) => (mode === "wysiwyg" ? e.VditorDOM2Md(s) : e.VditorIRDOM2Md(s));
  const { port } = engines(CONFIGS[0], mode);
  const bestN = () => { let b = Infinity; for (let i = 0; i < 12; i++) { const t = performance.now(); call(port, h); b = Math.min(b, performance.now() - t); } return b; };
  const before = bestN();
  const { port: p2 } = engines(CONFIGS[0], mode); EnableIncrementalDom2Md(p2);
  for (let i = 0; i < 10; i++) { const { port: p3 } = engines(CONFIGS[0], mode); EnableIncrementalDom2Md(p3); call(p3, h); }
  const after = bestN();
  console.log(mode, "normal path before sandbox use", before.toFixed(1), "after 10 cold sandboxed calls", after.toFixed(1));
}
