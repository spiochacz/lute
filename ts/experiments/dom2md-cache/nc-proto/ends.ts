import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as { docs: { mode: string; kids: string[] }[] };
const lute = New();
for (const mode of ["wysiwyg", "ir"]) {
  const seen = new Set<string>(); const cnt = new Map<string, number>(); const ex = new Map<string, string>();
  for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) {
    if (seen.has(k)) continue; seen.add(k);
    for (const lo of [10, 120]) {
      const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, k, { lastOut: lo, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
      if (!r.variant) continue;
      const key = "start=" + lo + " end=" + r.variant.endLastOut + " tops=" + r.info!.topTypes.join(",");
      cnt.set(key, (cnt.get(key) ?? 0) + 1); if (!ex.has(key) || k.length < ex.get(key)!.length) ex.set(key, k);
    }
  }
  console.log("==", mode);
  for (const [k, v] of [...cnt].sort((a, b) => b[1] - a[1])) if (!/end=10 /.test(k) || /start=120 end=10/.test(k) === false) console.log(v, k, JSON.stringify(ex.get(k)).slice(0, 100));
  const ten = [...cnt].filter(([k]) => /end=10 /.test(k)).reduce((a, [, v]) => a + v, 0);
  console.log("runs ending in LF:", ten, "total", [...cnt.values()].reduce((a, b) => a + b, 0));
}
