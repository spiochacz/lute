// Is the cost a first-touch (memory layout) cost? On each fresh DOM: time walk twice, then removeEmptyNodes; and on another fresh DOM: removeEmptyNodes after one walk.
import { performance } from "node:perf_hooks";
import { lute, loadRaw, freshDom } from "./common.ts";
import type { html } from "./common.ts";
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
canary(); const c0 = Math.min(canary(), canary());
const w = (n: html.Node): number => { let k = n.DataAtom; for (let c = n.FirstChild; c !== null; c = c.NextSibling) k += w(c); return k; };
const pre = loadRaw(); const T: Record<string, number[]> = { walk1: [], walk2: [], walk3: [], realCold: [], realAfterWalk: [] };
const t0 = performance.now(); let k = 0; const time = (name: string, f: () => void) => { const t = performance.now(); f(); T[name].push(performance.now() - t); };
while (performance.now() - t0 < 1200) {
  k++;
  let r = freshDom(pre); time("walk1", () => w(r)); time("walk2", () => w(r)); time("walk3", () => w(r));
  r = freshDom(pre); time("realCold", () => lute.removeEmptyNodes(r));
  r = freshDom(pre); w(r); time("realAfterWalk", () => lute.removeEmptyNodes(r));
}
const c1 = Math.min(canary(), canary());
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
console.log(JSON.stringify({ n: k, canary: +(c1 / c0).toFixed(2), res: Object.fromEntries(Object.entries(T).map(([n, a]) => [n, med(a)])) }));
