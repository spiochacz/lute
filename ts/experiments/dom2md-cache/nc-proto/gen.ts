// Edit generators for the hit-rate measurement. old = the generator of test/incremental/edits.test.ts (7 ops, pool = first 400 children);
// new = proposed (all unique children, channel children, neighbour-directed edits).
// usage: node gen.ts <old|new> <wysiwyg|ir> '<nc json>' <N> <seed>
import { cached, reference, conv, setNC, attempt } from "./driver.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";

class Lcg { s: number; constructor(seed: number) { this.s = seed >>> 0; } next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; } int(n: number): number { return Math.floor(this.next() * n); } }
const [genName, mode, ncJson, nArg, seedArg] = process.argv.slice(2);
const N = Number(nArg), rng = new Lcg(Number(seedArg ?? 1));
const kids: string[] = []; const uniq = new Set<string>();
for (const d of auditDocuments()) { if (d.mode !== mode) continue; const sc = scanTopLevel(d.html); if (!sc.ok) continue; for (const c of sc.children) if (!c.opaque) { const h = d.html.substring(c.start, c.end); kids.push(h); uniq.add(h); } }
const poolOld = kids.slice(0, 400);
const poolAll = [...uniq];
// channel children: one per context channel (see section "Negative controls and context witnesses")
const CH = [
  '<p data-block="0">    indented code</p>', // isLast: a paragraph that renders a nested code block
  '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>', // prev: top-level text without a trailing LF
  '<p data-block="0">a<br>b</p>', // domNext: the br rule
];
const tagOf = (h: string): string => /^<(\w+)/.exec(h)![1];
const isContainer = (h: string): boolean => /^<(ul|ol|blockquote|table)\b/.test(h) || /data-type="code-block"/.test(h);

function oldStep(doc: string[], pl: string[]): void {
  const op = rng.int(7); const pick = (): number => rng.int(Math.max(1, doc.length));
  if (op === 0 && doc.length > 0) doc[pick()] = pl[rng.int(pl.length)];
  else if (op === 1) doc.splice(pick(), 0, pl[rng.int(pl.length)]);
  else if (op === 2 && doc.length > 0) doc.splice(pick(), 1);
  else if (op === 3 && doc.length > 0) { const i = pick(); doc.splice(i, 0, doc[i]); }
  else if (op === 4 && doc.length > 1) { const i = rng.int(doc.length - 1); [doc[i], doc[i + 1]] = [doc[i + 1], doc[i]]; }
  else if (op === 5 && doc.length > 0) { const i = pick(); const inserts = [" ", "　", "\u000b", "x"]; const s = doc[i]; const gt: number[] = []; for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 62) gt.push(k); if (gt.length > 0) { const at = gt[rng.int(gt.length)] + 1; doc[i] = s.slice(0, at) + inserts[rng.int(inserts.length)] + s.slice(at); } }
  else if (doc.length > 1) { const i = rng.int(doc.length - 1); doc.splice(i, 2, doc[i] + doc[i + 1]); }
}
const mixed = (): string => (rng.next() < Number(process.env.CHW ?? 0.35) ? CH[rng.int(CH.length)] : poolAll[rng.int(poolAll.length)]);
function newStep(doc: string[]): void {
  const op = rng.int(16);
  const pick = (): number => rng.int(Math.max(1, doc.length));
  switch (op) {
    case 0: if (doc.length > 0) doc[pick()] = mixed(); break; // replace
    case 1: doc.splice(pick(), 0, mixed()); break; // insert anywhere
    case 2: if (doc.length > 1) doc.splice(pick(), 1); break; // delete (never empties the document)
    case 3: if (doc.length > 0) { const i = pick(); doc.splice(i, 0, doc[i]); } break; // duplicate
    case 4: if (doc.length > 1) { const i = rng.int(doc.length - 1); [doc[i], doc[i + 1]] = [doc[i + 1], doc[i]]; } break; // swap neighbours
    case 5: if (doc.length > 0) { const i = pick(); const inserts = [" ", "　", "\u000b", "x"]; const s = doc[i]; const gt: number[] = []; for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 62) gt.push(k); if (gt.length > 0) { const at = gt[rng.int(gt.length)] + 1; doc[i] = s.slice(0, at) + inserts[rng.int(inserts.length)] + s.slice(at); } } break; // text edit
    case 6: if (doc.length > 1) { const i = rng.int(doc.length - 1); doc.splice(i, 2, doc[i] + doc[i + 1]); } break; // merge two children
    case 7: if (doc.length > 1) doc.pop(); break; // delete the last block
    case 8: if (doc.length > 1) doc.shift(); break; // delete the first block
    case 9: doc.unshift(mixed()); break; // insert at the start
    case 10: doc.push(mixed()); break; // append at the end
    case 11: { const idx = doc.map((h, i) => (isContainer(h) ? i : -1)).filter((i) => i >= 0); if (idx.length > 0) { const i = idx[rng.int(idx.length)]; doc.splice(i + 1, 0, mixed()); } else doc.push(mixed()); break; } // append after a list/blockquote/table/code block
    case 12: if (doc.length > 0) { const i = pick(); doc.splice(Math.max(0, i - 1), 1, mixed()); } break; // change the block before a given one
    case 13: if (doc.length > 0) { const i = pick(); if (i + 1 < doc.length) doc[i + 1] = mixed(); else doc.push(mixed()); } break; // change the block after a given one
    case 14: if (doc.length > 1) { const t = doc[0]; doc[0] = doc[doc.length - 1]; doc[doc.length - 1] = t; } break; // swap first and last
    default: { const c = CH[rng.int(CH.length)]; doc.splice(pick(), 0, c); if (rng.next() < 0.5) doc.splice(rng.int(doc.length + 1), 0, mixed()); } // insert a channel child with a random neighbour
  }
}
const nc = JSON.parse(ncJson) as Record<string, boolean>;
const doc: string[] = []; let warmLeft = 0; let eng = cached(true, !!process.env.REAL); let kills = 0, first = -1, thrown = 0, composed = 0;
const classes = new Set<string>();
for (let i = 0; i < N; i++) {
  if (warmLeft <= 0) {
    doc.length = 0; const k = 1 + rng.int(genName === "new" ? 5 : 4);
    for (let j = 0; j < k; j++) doc.push(genName === "new" ? mixed() : poolOld[rng.int(poolOld.length)]);
    warmLeft = 8 + rng.int(21); setNC(nc); eng = cached(true, !!process.env.REAL);
  }
  if (genName === "new") newStep(doc); else oldStep(doc, poolOld);
  const html = doc.join("");
  setNC({}); const want = attempt(() => conv(reference, mode as "ir", html)); setNC(nc);
  const got = attempt(() => conv(eng, mode as "ir", html));
  if (got !== want) { kills++; if (first < 0) first = i; if (got.startsWith("THROW")) thrown++; if (classes.size < 3) classes.add(JSON.stringify(html).slice(0, 160)); }
  warmLeft--;
}
console.log(JSON.stringify({ gen: genName, mode, nc, N, kills, rate: +(kills / N * 100).toFixed(2) + 0, firstKillAt: first, strictThrows: thrown }));
