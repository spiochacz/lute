// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The edit generator shared by the in-test simulation (edits.test.ts) and the fuzzer (experiments/dom2md-cache/fuzz.ts), section 6 step 1
// of tasks/004 (Negative controls and context witnesses, 2026-10-11). A seeded LCG builds documents from the non-opaque children of the
// accepted audit documents; in a "mixed" pick, a fraction of the picks (CHANNEL_WEIGHT) is one of three channel children, each of which
// is the only child that reads one context field (isLast, prev, domNext), so that a neighbour-directed edit can reach it.

import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { auditDocuments } from "./corpus_docs.ts";

export class Lcg {
  s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

// The probability that a mixed pick is a channel child (section 5 of the analysis: every real channel is hit at 2-26% per comparison).
export const CHANNEL_WEIGHT = 0.2;

// isLast: a paragraph whose text starts with four spaces renders a nested code block, which reads Root.LastChild.
// prev: top-level text without a trailing LF (link-ref-defs-block) followed by a block that calls newlineBeforeBlock.
// domNext: a paragraph with a br, followed by a list (the br rule reads the next sibling).
export const CHANNEL: readonly string[] = [
  '<p data-block="0">    indented code</p>',
  '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>',
  '<p data-block="0">a<br>b</p>',
];

// pool returns every unique non-opaque child of the accepted audit documents of one mode, in document order.
export function pool(mode: "wysiwyg" | "ir"): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of auditDocuments()) {
    if (d.mode !== mode) {
      continue;
    }
    const sc = scanTopLevel(d.html);
    if (!sc.ok) {
      continue;
    }
    for (const c of sc.children) {
      if (c.opaque) {
        continue;
      }
      const h = d.html.substring(c.start, c.end);
      if (!seen.has(h)) {
        seen.add(h);
        out.push(h);
      }
    }
  }
  return out;
}

// mixed picks a channel child with probability CHANNEL_WEIGHT, otherwise a child of the pool.
export function mixed(rng: Lcg, pl: readonly string[]): string {
  return rng.next() < CHANNEL_WEIGHT ? CHANNEL[rng.int(CHANNEL.length)] : pl[rng.int(pl.length)];
}

const isContainer = (h: string): boolean => /^<(ul|ol|blockquote|table)\b/.test(h) || /data-type="code-block"/.test(h);

// EDIT_NAMES names the 16 edits of step, by index.
export const EDIT_NAMES: readonly string[] = ["replace", "insert", "delete", "duplicate", "swap", "text", "merge", "delete-last", "delete-first", "insert-start", "append", "append-after-container", "replace-before", "replace-after", "swap-first-last", "insert-channel"];

// step applies one random edit (of 16) to the list of children and returns its index in EDIT_NAMES. The document never becomes empty by an edit.
export function step(rng: Lcg, doc: string[], pl: readonly string[]): number {
  const op = rng.int(16);
  const pick = (): number => rng.int(Math.max(1, doc.length));
  switch (op) {
    case 0: // replace
      if (doc.length > 0) doc[pick()] = mixed(rng, pl);
      break;
    case 1: // insert anywhere
      doc.splice(pick(), 0, mixed(rng, pl));
      break;
    case 2: // delete (never empties the document)
      if (doc.length > 1) doc.splice(pick(), 1);
      break;
    case 3: // duplicate
      if (doc.length > 0) {
        const i = pick();
        doc.splice(i, 0, doc[i]);
      }
      break;
    case 4: // swap two neighbours
      if (doc.length > 1) {
        const i = rng.int(doc.length - 1);
        [doc[i], doc[i + 1]] = [doc[i + 1], doc[i]];
      }
      break;
    case 5: // text edit after a random '>' of a child
      if (doc.length > 0) {
        const i = pick();
        const inserts = [" ", "　", "\u000b", "x"];
        const s = doc[i];
        const gt: number[] = [];
        for (let k = 0; k < s.length; k++) {
          if (s.charCodeAt(k) === 62) gt.push(k);
        }
        if (gt.length > 0) {
          const at = gt[rng.int(gt.length)] + 1;
          doc[i] = s.slice(0, at) + inserts[rng.int(inserts.length)] + s.slice(at);
        }
      }
      break;
    case 6: // merge two adjacent children into one string
      if (doc.length > 1) {
        const i = rng.int(doc.length - 1);
        doc.splice(i, 2, doc[i] + doc[i + 1]);
      }
      break;
    case 7: // delete the last block
      if (doc.length > 1) doc.pop();
      break;
    case 8: // delete the first block
      if (doc.length > 1) doc.shift();
      break;
    case 9: // insert at the start
      doc.unshift(mixed(rng, pl));
      break;
    case 10: // append at the end
      doc.push(mixed(rng, pl));
      break;
    case 11: {
      // append after a random list, blockquote, table or code block
      const idx = doc.map((h, i) => (isContainer(h) ? i : -1)).filter((i) => i >= 0);
      if (idx.length > 0) {
        doc.splice(idx[rng.int(idx.length)] + 1, 0, mixed(rng, pl));
      } else {
        doc.push(mixed(rng, pl));
      }
      break;
    }
    case 12: // change the block before a random index
      if (doc.length > 0) doc.splice(Math.max(0, pick() - 1), 1, mixed(rng, pl));
      break;
    case 13: {
      // change the block after a random index
      if (doc.length > 0) {
        const i = pick();
        if (i + 1 < doc.length) doc[i + 1] = mixed(rng, pl);
        else doc.push(mixed(rng, pl));
      }
      break;
    }
    case 14: // swap first and last
      if (doc.length > 1) {
        const t = doc[0];
        doc[0] = doc[doc.length - 1];
        doc[doc.length - 1] = t;
      }
      break;
    default: {
      // insert a channel child with a random neighbour
      const c = CHANNEL[rng.int(CHANNEL.length)];
      doc.splice(pick(), 0, c);
      if (rng.next() < 0.5) doc.splice(rng.int(doc.length + 1), 0, mixed(rng, pl));
    }
  }
  return op;
}

// start returns a new document of 1 to 5 mixed children.
export function start(rng: Lcg, pl: readonly string[]): string[] {
  const doc: string[] = [];
  for (let k = 1 + rng.int(5); k > 0; k--) {
    doc.push(mixed(rng, pl));
  }
  return doc;
}
