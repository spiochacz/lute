// One short process, one variant, one method, one input (the measurement rule of tasks/007: this machine slows every process down 2.2 to
// 2.6 times after 2 to 3 seconds of sustained work). Prints one JSON line: fastest and median call, number of calls, the arithmetic
// canary ratio (discard the row above 1.3) and a hash of the output, so that the runner can check that every variant gives the same text.
// Usage: VARIANT=<dir with src/> node time.ts <method> <fixture html file> [budget ms=600]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const variant = process.env.VARIANT;
if (!variant) {
  throw new Error("VARIANT=<dir> is required");
}
const [method, file, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg ?? 600);
const root = variant.replace(/\\/g, "/");
const lute_ = await import(`${pathToFileURL(root).href}/src/index.ts`);
const input = readFileSync(file, "utf8");
const lute = lute_.New();
lute.SetIncrementalDom2Md(false);
const m = (lute as unknown as Record<string, (...a: string[]) => string>)[method].bind(lute);
// MarkdownStr takes a name first; it has no conversions on its path and serves as the negative control
const call: (s: string) => string = method === "MarkdownStr" ? (s) => m("", s) : m;

const canary = (): number => {
  const t = performance.now();
  let x = 1;
  for (let i = 0; i < 6000000; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
  }
  return performance.now() - t + (x & 0);
};
canary();
const c0 = Math.min(canary(), canary());
const hash = createHash("sha256").update(call(input)).digest("hex").slice(0, 16);
// warm-up: a few calls, at most 150 ms
const tw = performance.now();
for (let i = 0; i < 20 && performance.now() - tw < 150; i++) {
  call(input);
}
const times: number[] = [];
const t0 = performance.now();
while (performance.now() - t0 < budget) {
  const t = performance.now();
  call(input);
  times.push(performance.now() - t);
}
const c1 = Math.min(canary(), canary());
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    variant: root.split("/").pop(),
    method,
    file: file.split(/[\\/]/).pop(),
    n: times.length,
    min: +times[0].toFixed(4),
    med: +times[times.length >> 1].toFixed(4),
    canary: +(c1 / c0).toFixed(2),
    canaryMs: +c0.toFixed(1),
    hash,
    up: +(performance.now() / 1000).toFixed(2),
  }),
);
