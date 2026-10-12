// Does the first full pass over a fresh DOM pay the cost? order A: removeEmptyNodes then removeHighlightJSSpans; order B: removeHighlightJSSpans then removeEmptyNodes.
import { performance } from "node:perf_hooks";
import { lute, loadRaw, freshDom } from "./common.ts";
const canary = (): number => { const t = performance.now(); let x = 1; for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; } return performance.now() - t + (x & 0); };
canary(); const c0 = Math.min(canary(), canary());
const pre = loadRaw(); const T: Record<string, number[]> = { "A.empty": [], "A.hljs": [], "B.hljs": [], "B.empty": [] };
const t0 = performance.now(); let k = 0; const time = (n: string, f: () => void) => { const t = performance.now(); f(); T[n].push(performance.now() - t); };
while (performance.now() - t0 < 1300) {
  k++; let r = freshDom(pre);
  if (k % 2) { time("A.empty", () => lute.removeEmptyNodes(r)); time("A.hljs", () => lute.removeHighlightJSSpans(r)); r = freshDom(pre); time("B.hljs", () => lute.removeHighlightJSSpans(r)); time("B.empty", () => lute.removeEmptyNodes(r)); }
  else { time("B.hljs", () => lute.removeHighlightJSSpans(r)); time("B.empty", () => lute.removeEmptyNodes(r)); r = freshDom(pre); time("A.empty", () => lute.removeEmptyNodes(r)); time("A.hljs", () => lute.removeHighlightJSSpans(r)); }
}
const c1 = Math.min(canary(), canary());
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
console.log(JSON.stringify({ n: k, canary: +(c1 / c0).toFixed(2), res: Object.fromEntries(Object.entries(T).map(([n, a]) => [n, med(a)])) }));
