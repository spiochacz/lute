// Systematic neighbour search: for each corpus child c (subject) and neighbour set N, convert [c], [c,n], [n,c], [n,c,n] on one warm engine
// with the NC flags on and compare each with the normal engine. usage: node search.ts <corpus.json> <mode> '<nc json>' <maxSubjects> <maxSec>
import { readFileSync } from "node:fs";
import { cached, reference, conv, setNC, attempt } from "./driver.ts";
const [file, mode, ncJson, maxS, maxSec] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8")) as { docs: { mode: string; kids: string[] }[] };
const kind = (h: string): string => { const m = /^<(\w+)([^>]*)>/.exec(h)!; const t = /data-type="([^"]+)"/.exec(m[2]); return m[1] + (t ? ":" + t[1] : ""); };
const uniq = new Map<string, string>();
for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) if (!uniq.has(k)) uniq.set(k, kind(k));
const subjects = [...uniq.keys()];
// neighbours: shortest example of each kind
const byKind = new Map<string, string>();
for (const [h, k] of uniq) { const cur = byKind.get(k); if (cur === undefined || h.length < cur.length) byKind.set(k, h); }
const N = [...byKind.values(), '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>', '<p data-block="0">a<br>b</p>'];
const nc = JSON.parse(ncJson) as Record<string, boolean>;
const limit = Number(maxS), t0 = Date.now();
let docs = 0, mism = 0, subj = 0, thrown = 0, wrong = 0;
const seen = new Map<string, { doc: string[]; want: string; got: string }>();
for (const c of subjects) {
  if (subj >= limit || Date.now() - t0 > Number(maxSec) * 1000) break;
  subj++;
  setNC(nc);
  const eng = cached(true);
  const variants: string[][] = [[c]];
  for (const n of N) { variants.push([c, n], [n, c], [n, c, n]); }
  if (process.env.REV === "1") variants.reverse();
  for (const doc of variants) {
    const html = doc.join("");
    const want = attempt(() => conv(reference, mode as "ir", html));
    const got = attempt(() => conv(eng, mode as "ir", html));
    docs++;
    if (want !== got) {
      mism++; if (got.startsWith("THROW")) thrown++; else wrong++;
      const key = doc.map(kind).join("+");
      if (!seen.has(key)) seen.set(key, { doc, want, got });
    }
  }
}
console.log(JSON.stringify({ nc, mode, subjects: subj, neighbours: N.length, docs, mismatches: mism, strictThrows: thrown, wrongOutput: wrong, distinctKinds: seen.size, ms: Date.now() - t0 }));
let i = 0;
for (const [k, v] of seen) { if (i++ >= 12) break; console.log(k, "\n  doc:", JSON.stringify(v.doc.join("")).slice(0, 400), "\n  want:", JSON.stringify(v.want).slice(0, 200), "\n  got: ", JSON.stringify(v.got).slice(0, 200)); }
