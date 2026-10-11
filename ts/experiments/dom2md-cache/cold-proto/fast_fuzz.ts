import { newEngines } from "../../../test/e2e/helpers.ts";
import { WYSIWYG } from "../../../test/e2e/dom_corpus.ts";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { Cache, compose } from "./fast.ts";
import { refNoPre } from "./ref.ts";
let seed = Number(process.argv[2] ?? 1);
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const docs = auditDocuments();
const w = newEngines([WYSIWYG]).port, ir = newEngines([]).port;
const caches = { wysiwyg: new Cache(), ir: new Cache() };
let n = 0, composed = 0, mism = 0, freshMism = 0; const reasons: Record<string, number> = {};
const kidsOf = new Map<string, string[]>();
for (const d of docs) { const sc = scanTopLevel(d.html); if (sc.ok) kidsOf.set(d.name, sc.children.map((c) => d.html.substring(c.start, c.end))); }
const names = [...kidsOf.keys()];
const N = Number(process.argv[3] ?? 4000);
for (let it = 0; it < N; it++) {
  const nm = pick(names); const d = docs.find((x) => x.name === nm)!;
  let kids = kidsOf.get(d.name)!.slice();
  const ops = 1 + Math.floor(rnd() * 3);
  for (let o = 0; o < ops && kids.length > 0; o++) {
    const i = Math.floor(rnd() * kids.length);
    const r = rnd();
    if (r < 0.2) kids.splice(i, 1);
    else if (r < 0.4) kids.splice(i, 0, kids[i]);
    else if (r < 0.55) { const j = Math.floor(rnd() * kids.length); [kids[i], kids[j]] = [kids[j], kids[i]]; }
    else if (r < 0.75) kids[i] = kids[i].replace(/(<\/[a-z0-9]+>)$/, "x" + String.fromCharCode(97 + Math.floor(rnd() * 26)) + "$1");
    else if (r < 0.9) kids.splice(Math.floor(rnd() * (kids.length + 1)), 0, pick(kidsOf.get(pick(names))!));
    else kids[i] = kids[i].replace(/<\/p>$/, "<br>y</p>");
  }
  const doc = kids.join("");
  const lute = d.mode === "wysiwyg" ? w : ir;
  const ad = d.mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  let ref: string | null; try { ref = refNoPre(lute, d.mode, doc); } catch { ref = null; }
  n++;
  const out = compose(lute, ad, caches[d.mode], doc);
  const fresh = compose(lute, ad, new Cache(), doc);
  if (out === null) { const r = caches[d.mode].stats.reason.slice(0, 30); reasons[r] = (reasons[r] ?? 0) + 1; } else { composed++; if (out !== ref) mism++; }
  if (fresh !== null && fresh !== ref) freshMism++;
}
console.log(`seed ${process.argv[2] ?? 1}: ${n} edited documents, composed ${composed}, MISMATCH shared-cache ${mism}, MISMATCH fresh-cache ${freshMism}`, JSON.stringify(reasons));
console.log(JSON.stringify(caches.wysiwyg.stats), JSON.stringify(caches.ir.stats));
