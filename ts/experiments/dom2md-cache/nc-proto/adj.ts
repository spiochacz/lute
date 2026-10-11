import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const [file] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8")) as { docs: { mode: string; kids: string[] }[] };
const lute = New();
const trans = new Map<string, { n: number; ex: string; ops: string }>();
for (const mode of ["wysiwyg", "ir"]) {
  const seen = new Set<string>();
  for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) {
    if (seen.has(k)) continue; seen.add(k);
    for (const [lo, pv, nx] of [[10, -1, -1], [120, 16, 1]]) {
      const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, k, { lastOut: lo, prev: pv, next: nx, isFirst: pv < 0, isLast: nx < 0, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
      if (!r.variant) continue;
      const ops = r.variant.ops;
      for (let i = 0; i + 1 < ops.length; i++) {
        const a = ops[i], b = ops[i + 1];
        if (a.kind === "Append" && b.kind === "Append") {
          const key = mode + " " + (a.setsLastOut ? "T" : "F") + (b.setsLastOut ? "T" : "F") + " next=" + (i + 2 < ops.length ? ops[i + 2].kind : "end");
          const e = trans.get(key) ?? { n: 0, ex: k, ops: "" }; e.n++; if (k.length < e.ex.length) { e.ex = k; e.ops = JSON.stringify(ops.map((o) => o.kind === "Append" ? (o.setsLastOut ? "T" : "F") + new TextDecoder().decode(o.bytes) : o.kind)).slice(0, 200); } trans.set(key, e);
        }
      }
    }
  }
}
console.log(trans.size);
for (const [k, v] of trans) console.log(k, v.n, JSON.stringify(v.ex).slice(0, 160), v.ops);
