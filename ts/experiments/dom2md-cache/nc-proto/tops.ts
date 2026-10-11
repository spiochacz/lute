import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const [file, mode] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8")) as { docs: { mode: string; kids: string[] }[] };
const lute = New();
const stat = new Map<string, { n: number; ex: string }>();
const seen = new Set<string>();
for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) {
  if (seen.has(k)) continue; seen.add(k);
  const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, k, { lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
  const key = r.info ? (r.info.alive ? "tops=" + r.info.topTypes.join(",") : "dead") : "refused:" + r.refusal?.reason;
  const e = stat.get(key) ?? { n: 0, ex: k }; e.n++; if (k.length < e.ex.length) e.ex = k; stat.set(key, e);
}
for (const [k, v] of [...stat].sort((a, b) => b[1].n - a[1].n)) console.log(k, v.n, JSON.stringify(v.ex).slice(0, 150));
