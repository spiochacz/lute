// One short process per measurement (this machine slows every process down 2.2 to 2.6 times after 2 to 3 seconds of sustained work, so
// a measurement must finish inside the fast window): one engine variant, one mode, cold or warm one-edit calls for a fixed time budget.
// Prints one JSON line: fastest and median call, the number of calls, and an arithmetic canary before and after (a canary ratio above
// 1.3 means the process left the fast window and the row must be discarded).
// Usage: FIX=<dir with spec.<mode>.html> node proc_time.ts <variant directory> <wysiwyg|ir> <cold|warm|normal> [budget ms=700]
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
const [dir, mode, what, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg ?? 700);
const { tryDom2Md } = await import(`./${dir}/assemble.ts`);
const { State } = await import(`./${dir}/cache.ts`);
const sb = await import(`./${dir}/sandbox.ts`);
const ad = mode === "wysiwyg" ? sb.WYSIWYG_ADAPTER : sb.IR_ADAPTER;
const raw = readFileSync(`${process.env.FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], mode as "wysiwyg" | "ir");
const normal = (doc: string): string => (mode === "wysiwyg" ? port.VditorDOM2Md(doc) : port.VditorIRDOM2Md(doc));
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
const edit = (k: number): string => raw.replace(/([A-Za-z])<\/p>/, `$1 q${k}</p>`);
canary(); const c0 = Math.min(canary(), canary());
const warm = new State({});
if (what === "warm") { tryDom2Md(warm, port, ad, raw); } else { normal(raw); tryDom2Md(new State({}), port, ad, raw); }
const times: number[] = []; const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < budget) {
  k++;
  const doc = what === "warm" ? edit(k) : raw;
  const t = performance.now();
  if (what === "cold") { tryDom2Md(new State({}), port, ad, doc) ?? normal(doc); } else if (what === "warm") { tryDom2Md(warm, port, ad, doc) ?? normal(doc); } else { normal(doc); }
  times.push(performance.now() - t);
}
const c1 = Math.min(canary(), canary());
times.sort((a, b) => a - b);
console.log(JSON.stringify({ dir, mode, what, n: times.length, min: +times[0].toFixed(3), med: +times[times.length >> 1].toFixed(3), canary: +(c1 / c0).toFixed(2), up: +(performance.now() / 1000).toFixed(2) }));
