import { performance } from "node:perf_hooks";
import { lute, loadRaw, freshDom } from "./common.ts";
import type { html } from "./common.ts";
const secs = Number(process.argv[2]); const which = process.argv[3] ?? "real";
let f: (r: html.Node) => void = (r) => lute.removeEmptyNodes(r);
if (which !== "real") { const m = await import(`./${which}`); const s = m.search; f = (r) => { const out: html.Node[] = []; s(lute, r, out); for (const e of out) e.Unlink(); }; }
const pre = loadRaw(); let acc = 0; const end = performance.now() + secs * 1000; let n = 0;
while (performance.now() < end) { const r = freshDom(pre); f(r); acc += r.DataAtom; n++; }
console.log("iterations", n, acc);
