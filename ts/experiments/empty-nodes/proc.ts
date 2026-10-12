// One short process: interleaved variants on fresh DOMs; prints JSON line with medians/mins and canary ratio.
// Usage: node proc.ts <budget ms> <variant>[,<variant>...]   variant = real | walk | <module file>#<tag> (module exporting search and optional prep)
import { performance } from "node:perf_hooks";
import { lute, loadRaw, freshDom } from "./common.ts";
import type { html } from "./common.ts";
const budget = Number(process.argv[2]); const names = process.argv[3].split(",");
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
canary(); const c0 = Math.min(canary(), canary());
type V = { prep: ((r: html.Node) => void) | undefined; run: (root: html.Node) => void };
const vs: V[] = [];
for (const nm of names) {
  if (nm === "real") vs.push({ prep: undefined, run: (r) => lute.removeEmptyNodes(r) });
  else if (nm === "walk") { const w = (n: html.Node): number => { let k = n.DataAtom; for (let c = n.FirstChild; c !== null; c = c.NextSibling) k += w(c); return k; }; vs.push({ prep: undefined, run: (r) => { w(r); } }); }
  else { const [file, tag] = nm.split("#"); const m = await import(`./${file}?${tag}`); const s = m.search;
    vs.push({ prep: m.prep, run: (r) => { const out: html.Node[] = []; for (let c: html.Node | null = r; c !== null; c = c.NextSibling) s(lute, c, out); for (const e of out) e.Unlink(); } }); }
}
const pre = loadRaw();
const times: number[][] = names.map(() => []);
const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < budget) {
  const order = names.map((_, i) => i); if (k % 2) order.reverse(); k++;
  for (const i of order) { const r = freshDom(pre); vs[i].prep?.(r); if (process.env.MINORGC) (globalThis as any).gc({ type: "minor" }); const t = performance.now(); vs[i].run(r); times[i].push(performance.now() - t); }
}
const c1 = Math.min(canary(), canary());
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
const mn = (a: number[]) => +Math.min(...a).toFixed(3);
if (process.env.SERIES) names.forEach((nm, i) => console.log(nm, times[i].map((x) => x.toFixed(2)).join(" ")));
console.log(JSON.stringify({ n: k, canary: +(c1 / c0).toFixed(2), res: Object.fromEntries(names.map((nm, i) => [nm, { med: med(times[i]), min: mn(times[i]) }])) }));
