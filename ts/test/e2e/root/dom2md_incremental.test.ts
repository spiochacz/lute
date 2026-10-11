// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The differential test (section 8.1): engine A has the cache enabled (strict, verify) and must return what engine B (the same setters,
// feature off) returns, exceptions included. Afterwards the statistics must have no inconsistency, only reasons of the closed list, and a
// second pass over the same documents must have no misses. The default run samples the documents (every second under the default set,
// every tenth under the others); the sampling is deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, IncrementalDom2MdStats, DisableIncrementalDom2Md, editor } from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";
import { REASONS } from "../../../src/incremental/piece.ts";
import type { SetterCall } from "../helpers.ts";
import { SETS } from "../dom_corpus.ts";
import { auditDocuments } from "../../incremental/corpus_docs.ts";

const CLOSED = new Set<string>([
  ...REASONS,
  "empty-document",
  "options-not-fingerprintable",
  "too-large",
]);

function apply(lute: Lute, setters: readonly SetterCall[]): void {
  const proto = lute as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, ...args] of setters) {
    proto[name].apply(lute, args);
  }
}

function attempt(fn: () => string): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

const DOCS = auditDocuments();

for (const set of SETS) {
  test(`dom2md incremental equals the normal path: ${set.name}`, () => {
    const a = New();
    const b = New();
    apply(a, set.setters);
    apply(b, set.setters);
    EnableIncrementalDom2Md(a, { strict: true, verify: true });
    // sampling (the budget of 12 s for the new tests, tasks/004 8.1): every 2nd document under the default set, every 10th under the others
    const docs = set.setters.length === 0 ? DOCS.filter((_, i) => i % 2 === 0) : DOCS.filter((_, i) => i % 10 === 0);
    try {
      for (const d of docs) {
        const call = (lute: Lute): string => (d.mode === "wysiwyg" ? lute.VditorDOM2Md(d.html) : lute.VditorIRDOM2Md(d.html));
        const want = attempt(() => call(b));
        const got = attempt(() => call(a));
        assert.equal(got.ok, want.ok, `${d.name}: one side throws (A ${JSON.stringify(got)} B ${JSON.stringify(want)})`);
        if (want.ok && got.ok) {
          assert.equal(got.value, want.value, `${d.name}: output differs`);
        }
      }
      const s1 = IncrementalDom2MdStats(a)!;
      assert.deepEqual(s1.inconsistencies, {}, "no inconsistency");
      for (const k of Object.keys(s1.unsupported)) {
        assert.ok(CLOSED.has(k), `unsupported reason ${k} is not in the closed list`);
      }
      assert.equal(s1.composed + s1.fallbacks, s1.calls, "composed + fallbacks == calls");
      // a second pass over the same documents: warm, no misses
      const before = IncrementalDom2MdStats(a)!.misses;
      for (const d of docs) {
        try {
          d.mode === "wysiwyg" ? a.VditorDOM2Md(d.html) : a.VditorIRDOM2Md(d.html);
        } catch {
          // the same throw as the first pass
        }
      }
      const s2 = IncrementalDom2MdStats(a)!;
      assert.equal(s2.misses - before, 0, "a warm pass has no misses");
      assert.deepEqual(s2.inconsistencies, {}, "no inconsistency in the warm pass");
      process.stdout.write(
        `dom2md incremental [${set.name}]: ${docs.length} documents, calls ${s2.calls}, composed ${s2.composed}, fallbacks ${s2.fallbacks} ${JSON.stringify(s2.unsupported)}, hits ${s2.hits}, misses ${s2.misses}\n`,
      );
    } finally {
      DisableIncrementalDom2Md(a);
    }
  });
}

test("dom2md incremental: the feature is off by default and the bundle surface is unchanged in the engine", () => {
  const lute = New();
  assert.equal(IncrementalDom2MdStats(lute), null);
  assert.equal(typeof editor.Zwsp, "string");
});
