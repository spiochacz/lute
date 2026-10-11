// Interleaved cold-call comparison in one process: normal, current src cache (fresh engine state), fast prototype, fast + reused renderer (upper bound of the renderer-setup saving).
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md } from "../../../src/incremental/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess } from "../../../src/vditor_ir.ts";
import { Cache, compose } from "./fast.ts";
const reps = Number(process.argv[2] ?? 12);
for (const mode of ["wysiwyg", "ir"] as const) {
  const raw = readFileSync(`${process.env.FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
  const h = (mode === "wysiwyg" ? vditorDOM2MdPreprocess : vditorIRDOM2MdPreprocess)(raw);
  const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  const { port } = engines(CONFIGS[0], mode);
  const call = (e: any) => (mode === "wysiwyg" ? e.VditorDOM2Md(raw) : e.VditorIRDOM2Md(raw));
  const best: Record<string, number> = {};
  const m = (k: string, f: () => void) => { const t = performance.now(); f(); best[k] = Math.min(best[k] ?? Infinity, performance.now() - t); };
  for (let i = 0; i < reps; i++) {
    m("normal", () => call(port));
    { const { port: p } = engines(CONFIGS[0], mode); EnableIncrementalDom2Md(p); m("src cold", () => call(p)); }
    (globalThis as any).__reuseR = false;
    m("fast cold", () => { compose(port, ad, new Cache(), h); });
    (globalThis as any).__reuseR = true;
    m("fast cold, renderer reused (bound)", () => { compose(port, ad, new Cache(), h); });
    (globalThis as any).__reuseR = false;
  }
  console.log(mode.padEnd(8), Object.entries(best).map(([k, v]) => `${k}=${v.toFixed(1)}`).join("  "));
}
