// Same DOM, repeated: run k of removeEmptyNodes (run 1 = cold DOM; runs 3-5 = warm caches). Variants given as modules; real = lute.removeEmptyNodes.
import { performance } from "node:perf_hooks";
import { lute, loadRaw, freshDom } from "./common.ts";
import type { html } from "./common.ts";
const names = process.argv[2].split(","); const budget = Number(process.argv[3] ?? 1200);
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
canary(); const c0 = Math.min(canary(), canary());
const runs: Array<(r: html.Node) => void> = [];
for (const nm of names) {
  if (nm === "real") runs.push((r) => lute.removeEmptyNodes(r));
  else { const [f, t] = nm.split("#"); const m = await import(`./${f}?${t}`); const s = m.search; runs.push((r) => { const out: html.Node[] = []; for (let c: html.Node | null = r; c !== null; c = c.NextSibling) s(lute, c, out); for (const e of out) e.Unlink(); }); }
}
const pre = loadRaw(); const R = 6; const T = names.map(() => Array.from({ length: R }, () => [] as number[]));
const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < budget) {
  const order = names.map((_, i) => i); if (k++ % 2) order.reverse();
  for (const i of order) { if (process.env.STATE === "U") (globalThis as any).gc({ type: "minor" }); const r = freshDom(pre); if (process.env.STATE === "C") (globalThis as any).gc({ type: "minor" }); for (let j = 0; j < R; j++) { const t = performance.now(); runs[i](r); T[i][j].push(performance.now() - t); } }
}
const c1 = Math.min(canary(), canary());
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
console.log(JSON.stringify({ n: k, canary: +(c1 / c0).toFixed(2), res: Object.fromEntries(names.map((nm, i) => [nm, T[i].map(med)])) }));
