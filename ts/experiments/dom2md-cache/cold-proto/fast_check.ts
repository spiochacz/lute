import { newEngines } from "../../../test/e2e/helpers.ts";
import { WYSIWYG } from "../../../test/e2e/dom_corpus.ts";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { Cache, compose } from "./fast.ts";
import { refNoPre } from "./ref.ts";
const docs = auditDocuments();
const w = newEngines([WYSIWYG]).port, ir = newEngines([]).port;
console.log("documents", docs.length);
const caches = { wysiwyg: new Cache(), ir: new Cache() };
const refs = new Map<string, string | null>();
for (const d of docs) { try { refs.set(d.name, refNoPre(d.mode === "wysiwyg" ? w : ir, d.mode, d.html)); } catch { refs.set(d.name, null); } }
for (let sweep = 0; sweep < 3; sweep++) {
  let composed = 0, mism = 0, fb = 0; const reasons: Record<string, number> = {}; const bad: string[] = [];
  for (const d of docs) {
    const lute = d.mode === "wysiwyg" ? w : ir;
    const ad = d.mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
    const out = compose(lute, ad, caches[d.mode], d.html);
    if (out === null) { fb++; const r = caches[d.mode].stats.reason.slice(0, 40); reasons[r] = (reasons[r] ?? 0) + 1; continue; }
    composed++;
    if (out !== refs.get(d.name)) { mism++; if (bad.length < 5) bad.push(d.name); }
  }
  console.log(`sweep ${sweep}: composed ${composed} fallbacks ${fb} MISMATCHES ${mism}`, JSON.stringify(reasons), bad.join(","));
}
console.log(JSON.stringify(caches.wysiwyg.stats), JSON.stringify(caches.ir.stats));
for (const m of ["wysiwyg", "ir"] as const) {
  const es = [...caches[m].map.values()].filter((e) => e.info && !e.refusal && e.info.alive);
  const nv = es.reduce((a, e) => a + e.vars.size, 0);
  const multi = es.filter((e) => e.vars.size > 1).length;
  const dist: Record<number, number> = {}; for (const e of es) dist[e.vars.size] = (dist[e.vars.size] ?? 0) + 1;
  console.log(m, "entries", es.length, "variants", nv, "entries with >1 variant", multi, "distribution", JSON.stringify(dist));
}
