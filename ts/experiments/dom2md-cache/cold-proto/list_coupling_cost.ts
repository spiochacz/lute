// Scratch (milestone C): cost of a stable list-coupling fallback. The spec document plus a list pair; repeated public calls with the cache on, against the normal path.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md, IncrementalDom2MdStats } from "../../../src/incremental/index.ts";
const FIX = process.env.FIX!;
const raw = readFileSync(`${FIX}/spec.wysiwyg.html`, "utf8").split(editor.Zwsp).join("");
const doc = raw + '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li></ul><ul data-block="0"><li>b</li></ul>';
const { port } = engines(CONFIGS[0], "wysiwyg");
const b: Record<string, number> = {};
const m = (k: string, f: () => unknown) => { const t = performance.now(); f(); b[k] = Math.min(b[k] ?? Infinity, performance.now() - t); };
EnableIncrementalDom2Md(port, { strict: true, verify: false });
port.VditorDOM2Md(doc);
const s0 = IncrementalDom2MdStats(port)!;
for (let i = 0; i < 14; i++) {
  m("normal", () => port.VditorDOM2Md(doc));
  m("cache repeat (list-coupling)", () => port.VditorDOM2Md(doc));
}
const s1 = IncrementalDom2MdStats(port)!;
console.log(Object.entries(b).map(([k, v]) => `${k}=${v.toFixed(1)}ms`).join("  "), `| per-call analyses ${((s1.analyses - s0.analyses) / 14).toFixed(0)}, builds ${((s1.builds - s0.builds) / 14).toFixed(0)}, memoHits ${s1.memoHits - s0.memoHits}`);
