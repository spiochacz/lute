// Scratch measurement (milestone C, C1 cap decision): the variants per cache entry after one cold pass and one warm pass of the default
// option set of dom2md_incremental.test.ts (every 2nd audit document, strict and verify on). Prints the histogram of variants per entry, the
// distinct values of each key field per entry, and the warm misses. NOT part of the product. Usage (from ts/):
//   node experiments/dom2md-cache/cold-proto/variant_hist.ts [--cap-note=text]

import { New, EnableIncrementalDom2Md, IncrementalDom2MdStats } from "../../../src/index.ts";
import { getState } from "../../../src/incremental/dispatch.ts";
import type { State } from "../../../src/incremental/cache.ts";
import { MAX_VARIANTS } from "../../../src/incremental/cache.ts";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
import { sample } from "../../../test/e2e/full.ts";

const docs = sample(auditDocuments(), 0, 2);
const lute = New();
EnableIncrementalDom2Md(lute, { strict: true, verify: true });

function pass(): void {
  for (const d of docs) {
    try {
      if (d.mode === "wysiwyg") {
        lute.VditorDOM2Md(d.html);
      } else {
        lute.VditorIRDOM2Md(d.html);
      }
    } catch {
      // the same throw as the normal path
    }
  }
}

pass();
const cold = IncrementalDom2MdStats(lute)!;
const before = cold.misses;
pass();
const warm = IncrementalDom2MdStats(lute)!;

const st = getState<State>(lute)!;
const fields = ["lastOut", "prev", "next", "domPrev", "domNext", "domNextAttrs"];
for (const [mode, map] of [
  ["wysiwyg", st.maps.wysiwyg],
  ["ir", st.maps.ir],
] as const) {
  const hist = new Map<number, number>();
  let entries = 0;
  let max = 0;
  let maxKey = "";
  const perField = new Map<string, number[]>(); // distinct values per entry, per field, for entries with more than one variant
  for (const e of map.values()) {
    entries++;
    const n = e.variants.length;
    hist.set(n, (hist.get(n) ?? 0) + 1);
    if (n > max) {
      max = n;
      maxKey = e.html.slice(0, 70);
    }
    if (n > 1) {
      const parts = e.variants.map((v) => v.key.split(","));
      fields.forEach((f, i) => {
        const distinct = new Set(parts.map((p) => p[i])).size;
        const arr = perField.get(f) ?? [];
        arr.push(distinct);
        perField.set(f, arr);
      });
    }
  }
  const h = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${mode}: entries ${entries}, variants per entry (count:entries) ${h}, max ${max} (${JSON.stringify(maxKey)})`);
  for (const f of fields) {
    const arr = perField.get(f) ?? [];
    const mean = arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  ${mode} ${f}: distinct values per multi-variant entry, mean ${mean.toFixed(2)}, max ${arr.length === 0 ? 0 : Math.max(...arr)} over ${arr.length} entries`);
  }
}
console.log(
  `cold: calls ${cold.calls}, composed ${cold.composed}, misses ${cold.misses}; warm pass misses ${warm.misses - before}; cap MAX_VARIANTS = ${MAX_VARIANTS}`,
);
