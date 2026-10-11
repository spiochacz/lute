import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const [file] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8")) as { docs: { mode: string; kids: string[] }[] };
const lute = New();
for (const mode of ["wysiwyg", "ir"]) {
  const seen = new Set<string>(); const cnt = new Map<string, { n: number; ex: string }>();
  for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) {
    if (seen.has(k)) continue; seen.add(k);
    for (const [lo, pv, nx, dp, dn] of [[10, -1, -1, -1, -1], [120, 16, 1, 5, 42754]]) {
      const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, k, { lastOut: lo, prev: pv, next: nx, isFirst: pv < 0, isLast: nx < 0, domPrev: dp, domNext: dn, domNextAttrs: 0 }, { certify: true, opaque: false });
      const key = r.variant ? [...r.variant.readKeys].sort().join(",") || "(none)" : "no variant";
      const e = cnt.get(key) ?? { n: 0, ex: k }; e.n++; if (k.length < e.ex.length) e.ex = k; cnt.set(key, e);
    }
  }
  console.log("==", mode, seen.size, "children x 2 contexts");
  for (const [k, v] of [...cnt].sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(5), k, JSON.stringify(v.ex).slice(0, 90));
}
