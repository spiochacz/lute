// Rough cost of a warm one-edit call: cached vs uncached, interleaved, fastest of N runs.
// NOT RUN YET (the machine was reserved for other work); expected duration about 1 to 2 minutes.
//
//   node bench.ts [--runs=9] [--doc=spec|article] [--mode=wysiwyg|ir]
//
// Every timed iteration edits one child with a character that was never used before, so the cache never
// holds the edited text (a toggle between two versions would turn into 100% hits after two iterations).
// Both calls are timed on the identical string and their outputs are compared once per iteration.

import { performance } from "node:perf_hooks";
import { New } from "../../src/index.ts";
import { util } from "../../src/index.ts";
import { CachedDom2Md } from "./cached.ts";
import type { Mode } from "./cached.ts";
import { splitTopLevel } from "./scan.ts";
import { CONFIGS, engines, loadMarkdownCorpus, forward } from "./corpus.ts";

void New;
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? "1");
}
const runs = Number(args.get("runs") ?? 9);
const modes: Mode[] = args.get("mode") ? [args.get("mode") as Mode] : ["wysiwyg", "ir"];
const which = args.get("doc") ?? "spec";

for (const mode of modes) {
  const { port, oracle } = engines(CONFIGS[0], mode);
  const mds = loadMarkdownCorpus().filter((d) => d.real);
  let md: string;
  if (which === "spec") {
    md = mds.find((d) => d.name === "benchmark/commonmark-spec.md")!.md;
  } else {
    // "article": the repository's prose documents repeated to about 200 KB (no indented code, no raw HTML)
    const prose = mds.filter((d) => (d.name.startsWith("tasks/") && !d.name.includes("002")) || d.name === "ts/PORTING.md").map((d) => d.md).join("\n\n");
    md = prose.repeat(Math.ceil(200000 / prose.length));
  }
  const html = forward(oracle, mode, md);
  const sp = splitTopLevel(html);
  if (!sp.ok) {
    console.log(`${mode}: splitter refuses the document (${sp.reason}); the cache cannot be timed on it`);
    continue;
  }
  const kids = sp.children.map((c) => html.substring(c.start, c.end));
  const cached = new CachedDom2Md(port, mode, { timing: true });
  const t0 = performance.now();
  const cold = cached.convert(html);
  const coldMs = performance.now() - t0;
  if (cached.stats.fallbackCalls > 0) {
    console.log(`${mode}: falls back on this document (${cached.lastFallbackReason}); nothing to time`);
    continue;
  }
  console.log(`${mode}: ${html.length} bytes of HTML, ${kids.length} children, cold cached call ${coldMs.toFixed(1)} ms`);
  const paragraphs = kids.map((k, i) => (k.startsWith("<p") ? i : -1)).filter((i) => i >= 0);
  let bestC = Infinity;
  let bestU = Infinity;
  let bestParse = Infinity;
  const tm = { prep: 0, split: 0, classify: 0, keys: 0, miss: 0, assemble: 0 };
  let ok = true;
  const heap0 = process.memoryUsage().heapUsed;
  for (let r = 0; r < runs; r++) {
    const i = paragraphs[(r * 7919) % paragraphs.length];
    const edited = kids.slice();
    edited[i] = edited[i].replace(/<\/p>$/, "é" + String.fromCharCode(0x4e00 + r) + "</p>");
    const doc = edited.join("");
    for (const k of Object.keys(tm) as Array<keyof typeof tm>) tm[k] = cached.timing[k];
    let a = performance.now();
    const outC = cached.convert(doc);
    const dC = performance.now() - a;
    a = performance.now();
    const outU = cached.uncached(doc);
    const dU = performance.now() - a;
    if (outC !== outU) ok = false;
    if (dC < bestC) {
      bestC = dC;
      for (const k of Object.keys(tm) as Array<keyof typeof tm>) tm[k] = cached.timing[k] - tm[k];
      // keep the breakdown of the fastest run
      (globalThis as unknown as { __bd?: typeof tm }).__bd = { ...tm };
    }
    bestU = Math.min(bestU, dU);
    a = performance.now();
    util.ParseHTML(doc);
    bestParse = Math.min(bestParse, performance.now() - a);
  }
  const bd = (globalThis as unknown as { __bd: typeof tm }).__bd;
  console.log(`  outputs equal: ${ok}; warm one-edit cached ${bestC.toFixed(2)} ms, uncached ${bestU.toFixed(2)} ms, util.ParseHTML of the whole document alone ${bestParse.toFixed(2)} ms (fastest of ${runs}, busy machine?)`);
  console.log("  breakdown of the fastest cached run (ms):", Object.entries(bd).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" "));
  const heap1 = process.memoryUsage().heapUsed;
  console.log(`  cache entries ${cached.size()}, heapUsed delta ${((heap1 - heap0) / 1e6).toFixed(1)} MB after ${runs} unique edits (run with --expose-gc and compare if this looks high)`);
  void cold;
}
