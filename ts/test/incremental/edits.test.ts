// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The in-test edit generator (section 8.4): a seeded LCG builds documents from the children of the oracle DOMs of the corpus by replace,
// insert, delete, duplicate, swap, a text edit and a merge of two children. Three passes per mode: warm (one engine per sequence of 8-28
// edits), cold (a new engine per comparison) and shared (one engine for all comparisons). The outcome of the cache engine (strict, verify)
// must equal the outcome of the engine without the cache, exceptions included. 300 comparisons per mode and pass in this default run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats, editor } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { auditDocuments } from "./corpus_docs.ts";

class Lcg {
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

// pool returns the non-opaque children of the accepted documents of one mode.
function pool(mode: "wysiwyg" | "ir"): string[] {
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
      if (!c.opaque && out.length < 400) {
        out.push(d.html.substring(c.start, c.end));
      }
    }
  }
  return out;
}

// step applies one random edit to the list of children (section 8.4).
function step(rng: Lcg, doc: string[], pl: string[]): void {
  const op = rng.int(7);
  const pick = (): number => rng.int(Math.max(1, doc.length));
  if (op === 0 && doc.length > 0) {
    doc[pick()] = pl[rng.int(pl.length)];
  } else if (op === 1) {
    doc.splice(pick(), 0, pl[rng.int(pl.length)]);
  } else if (op === 2 && doc.length > 0) {
    doc.splice(pick(), 1);
  } else if (op === 3 && doc.length > 0) {
    const i = pick();
    doc.splice(i, 0, doc[i]);
  } else if (op === 4 && doc.length > 1) {
    const i = rng.int(doc.length - 1);
    [doc[i], doc[i + 1]] = [doc[i + 1], doc[i]];
  } else if (op === 5 && doc.length > 0) {
    // a text edit after a random '>' of a child (the text inserted is one of the spec's characters)
    const i = pick();
    const inserts = [" ", "　", "\u000b", "x"];
    const s = doc[i];
    const gt: number[] = [];
    for (let k = 0; k < s.length; k++) {
      if (s.charCodeAt(k) === 62) {
        gt.push(k);
      }
    }
    if (gt.length > 0) {
      const at = gt[rng.int(gt.length)] + 1;
      doc[i] = s.slice(0, at) + inserts[rng.int(inserts.length)] + s.slice(at);
    }
  } else if (doc.length > 1) {
    // merge two adjacent children into one string
    const i = rng.int(doc.length - 1);
    doc.splice(i, 2, doc[i] + doc[i + 1]);
  }
}

function attempt(fn: () => string): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function call(lute: Lute, mode: "wysiwyg" | "ir", html: string): string {
  return mode === "wysiwyg" ? lute.VditorDOM2Md(html) : lute.VditorIRDOM2Md(html);
}

const COMPARISONS = 300;

for (const mode of ["wysiwyg", "ir"] as const) {
  const pl = pool(mode);
  for (const pass of ["warm", "cold", "shared"] as const) {
    test(`edit simulation, ${mode}, ${pass}: ${COMPARISONS} comparisons equal the normal path`, () => {
      const rng = new Lcg(mode === "wysiwyg" ? 1 : 2);
      const shared = New();
      EnableIncrementalDom2Md(shared, { strict: true, verify: true });
      const reference = New();
      let left = COMPARISONS;
      let warm: Lute | null = null;
      let warmLeft = 0;
      const doc: string[] = [];
      while (left > 0) {
        if (warmLeft <= 0) {
          doc.length = 0;
          for (let k = 0; k < 1 + rng.int(4); k++) {
            doc.push(pl[rng.int(pl.length)]);
          }
          warmLeft = 8 + rng.int(21);
          if (pass === "warm") {
            warm = New();
            EnableIncrementalDom2Md(warm, { strict: true, verify: true });
          }
        }
        step(rng, doc, pl);
        const html = doc.join("");
        const want = attempt(() => call(reference, mode, html));
        let engine: Lute;
        if (pass === "warm") {
          engine = warm!;
        } else if (pass === "cold") {
          engine = New();
          EnableIncrementalDom2Md(engine, { strict: true, verify: true });
        } else {
          engine = shared;
        }
        const got = attempt(() => call(engine, mode, html.split(editor.Zwsp).join("")));
        assert.deepEqual(got, want, `${mode} ${pass}: ${JSON.stringify(html).slice(0, 200)}`);
        left--;
        warmLeft--;
      }
      const s = IncrementalDom2MdStats(shared)!;
      assert.deepEqual(s.inconsistencies, {});
      process.stdout.write(`edit simulation ${mode} ${pass}: ${COMPARISONS} comparisons, shared engine: composed ${s.composed} of ${s.calls}\n`);
      DisableIncrementalDom2Md(shared);
    });
  }
}
