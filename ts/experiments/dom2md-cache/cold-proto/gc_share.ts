// Share of garbage collection inside one normal VditorDOM2Md call, at several document sizes.
// Usage: node --max-old-space-size=8192 gc_share.ts [wysiwyg|ir] [copies...]
import { readFileSync } from "node:fs";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
const base = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const mode = (process.argv[2] ?? "wysiwyg") as "wysiwyg" | "ir";
const copies = process.argv.slice(3).map(Number); if (copies.length === 0) copies.push(1, 5, 24);
const { port } = engines(CONFIGS[0], mode);
const gcs: Array<{ start: number; dur: number; kind: number }> = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) gcs.push({ start: e.startTime, dur: e.duration, kind: (e as any).detail?.kind ?? 0 }); }).observe({ entryTypes: ["gc"] });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
for (const n of copies) {
  let md = ""; for (let i = 0; i < n; i++) md += base.replace(/^(#+ .*)$/gm, `$1 ${i}`) + "\n\n";
  const h = (mode === "wysiwyg" ? port.Md2VditorDOM(md) : port.Md2VditorIRDOM(md)).split(editor.Zwsp).join("");
  md = "";
  const rows: string[] = [];
  for (let i = 0; i < (n > 10 ? 5 : 8); i++) {
    await tick(); gcs.length = 0;
    const t0 = performance.now(); mode === "wysiwyg" ? port.VditorDOM2Md(h) : port.VditorIRDOM2Md(h); const t1 = performance.now();
    await tick();
    const inside = gcs.filter((g) => g.start >= t0 && g.start <= t1);
    const minor = inside.filter((g) => g.kind === 1).reduce((a, g) => a + g.dur, 0);
    const major = inside.filter((g) => g.kind !== 1).reduce((a, g) => a + g.dur, 0);
    rows.push(`${(t1 - t0).toFixed(0)} (gc minor ${minor.toFixed(0)} x${inside.filter((g) => g.kind === 1).length}, other ${major.toFixed(0)})`);
  }
  console.log(mode, `copies=${n} html=${(h.length / 1e6).toFixed(2)}MB ms:`, rows.join(" | "));
}
