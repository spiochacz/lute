// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The in-test edit generator (section 8.4, replaced by section 6 step 2 of the 2026-10-11 negative-control analysis; the generator is in
// edit_generator.ts, shared with the fuzzer). Three passes per mode: warm (one engine per sequence of 8-28 edits), cold (a new engine per
// comparison) and shared (one engine for all comparisons). The outcome of the cache engine (strict, verify) must equal the outcome of the
// engine without the cache, exceptions included. 300 comparisons per mode and pass in this default run. The channel children of the
// generator must be hit: the count of documents that contain each channel next to a neighbour that reads it is asserted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats, editor } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { Lcg, pool, start, step } from "./edit_generator.ts";

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

// A channel is hit when the document holds it next to a neighbour that reads it (isLast: a block after the paragraph is not what
// reads it, so the paragraph itself is counted when it is the last child of a document that continues; prev: the block after the
// link-ref-defs; domNext: the list, blockquote or table after the br paragraph).
const CHANNEL_HITS: Array<{ name: string; re: RegExp }> = [
  { name: "isLast", re: /indented code<\/p><(h\d|ul|ol|blockquote|table|p)/ },
  { name: "prev", re: /\[r\]: http:\/\/x<\/div><(h\d|ul|ol|blockquote|table)/ },
  { name: "domNext", re: /a<br>b<\/p><(ul|ol|blockquote)/ },
];

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
      const hits = new Map<string, number>(CHANNEL_HITS.map((h) => [h.name, 0]));
      while (left > 0) {
        if (warmLeft <= 0) {
          doc.length = 0;
          doc.push(...start(rng, pl));
          warmLeft = 8 + rng.int(21);
          if (pass === "warm") {
            warm = New();
            EnableIncrementalDom2Md(warm, { strict: true, verify: true });
          }
        }
        step(rng, doc, pl);
        const html = doc.join("");
        for (const h of CHANNEL_HITS) {
          if (pass === "shared" && h.re.test(html)) {
            hits.set(h.name, hits.get(h.name)! + 1);
          }
        }
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
      if (pass === "shared") {
        for (const h of CHANNEL_HITS) {
          assert.ok(hits.get(h.name)! >= 5, `${mode}: channel ${h.name} hit ${hits.get(h.name)} times, at least 5 expected`);
        }
      }
      process.stdout.write(`edit simulation ${mode} ${pass}: ${COMPARISONS} comparisons, shared engine: composed ${s.composed} of ${s.calls}; channel hits ${JSON.stringify(Object.fromEntries(hits))}\n`);
      DisableIncrementalDom2Md(shared);
    });
  }
}
