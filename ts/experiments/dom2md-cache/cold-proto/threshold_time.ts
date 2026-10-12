// At what document size does the per-child cache pay? One short process per measurement (see proc_time.ts for why).
// Usage: node threshold_time.ts <wysiwyg|ir> <markdown bytes> <warm|normal> [budget ms=600]
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { tryDom2Md } from "../../../src/incremental/assemble.ts";
import { State } from "../../../src/incremental/cache.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
const [mode, bytesArg, what, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg ?? 600);
const spec = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
// a slice of the spec from the middle (prose, lists and code), cut at blank lines
const lf = spec.replace(/\r\n/g, "\n");
const start = lf.indexOf("\n\n", 60000) + 2; const end = lf.indexOf("\n\n", start + Number(bytesArg));
const md = lf.slice(start, end);
const { port } = engines(CONFIGS[0], mode as "wysiwyg" | "ir");
const raw = (mode === "wysiwyg" ? port.Md2VditorDOM(md) : port.Md2VditorIRDOM(md)).split(editor.Zwsp).join("");
const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
const normal = (doc: string): string => (mode === "wysiwyg" ? port.VditorDOM2Md(doc) : port.VditorIRDOM2Md(doc));
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
const edit = (k: number): string => raw.replace(/([A-Za-z])<\/p>/, `$1 q${k}</p>`);
canary(); const c0 = Math.min(canary(), canary());
const st = new State({});
let composed = tryDom2Md(st, port, ad, raw) !== null; normal(raw);
for (let k = 1; k <= 30; k++) { const d = edit(1000 + k); if (what === "warm") { tryDom2Md(st, port, ad, d) ?? normal(d); } else { normal(d); } }
const times: number[] = []; const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < budget) { k++; const doc = edit(k); const t = performance.now(); if (what === "warm") { if (tryDom2Md(st, port, ad, doc) === null) { composed = false; normal(doc); } } else { normal(doc); } times.push(performance.now() - t); }
const c1 = Math.min(canary(), canary()); times.sort((a, b) => a - b);
console.log(JSON.stringify({ mode, md: md.length, html: raw.length, what, composed, n: times.length, min: +(times[0] * 1000).toFixed(1), med: +(times[times.length >> 1] * 1000).toFixed(1), canary: +(c1 / c0).toFixed(2) }));
