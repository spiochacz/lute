import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md } from "../../../src/incremental/index.ts";
import { WYSIWYG_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { Cache, compose } from "./fast.ts";
const which = process.argv[2];
const raw = readFileSync(`${process.env.FIX}/spec.wysiwyg.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], "wysiwyg");
const normal = () => port.vditorDOM2Md(raw);
const bestN = () => { let b = Infinity; for (let i = 0; i < 30; i++) { const t = performance.now(); normal(); b = Math.min(b, performance.now() - t); } return b; };
const before = bestN();
const h = vditorDOM2MdPreprocess(raw);
let cold = Infinity;
for (let i = 0; i < 10; i++) {
  if (which === "src") { const { port: p } = engines(CONFIGS[0], "wysiwyg"); EnableIncrementalDom2Md(p); const t = performance.now(); p.VditorDOM2Md(raw); cold = Math.min(cold, performance.now() - t); }
  else if (which === "fast") { const t = performance.now(); compose(port, WYSIWYG_ADAPTER, new Cache(), h); cold = Math.min(cold, performance.now() - t); }
  else { const t = performance.now(); port.vditorDOM2Md(raw); cold = Math.min(cold, performance.now() - t); }
}
const after = bestN();
console.log(which.padEnd(5), "normal before", before.toFixed(1), "cold", cold.toFixed(1), "normal after", after.toFixed(1), "ratio after/before", (after / before).toFixed(2));
