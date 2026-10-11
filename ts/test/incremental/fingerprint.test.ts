// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Tests of the options fingerprint (section 5.5, step 5).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { fingerprint } from "../../src/incremental/options_fingerprint.ts";

test("the fingerprint is stable across calls and across engines with the same options", () => {
  const a = New();
  const b = New();
  const fa = fingerprint(a);
  assert.notEqual(fa, null);
  assert.equal(fingerprint(a), fa);
  assert.equal(fingerprint(b), fa);
});

test("every primitive option changes the fingerprint when it is assigned in place", () => {
  const base = New();
  const f0 = fingerprint(base)!;
  const changed = new Set<string>();
  for (const obj of ["ParseOptions", "RenderOptions"] as const) {
    const fields = Object.keys(base[obj]);
    for (const k of fields) {
      const lute = New();
      const o = lute[obj] as unknown as Record<string, unknown>;
      const v = o[k];
      if (typeof v === "boolean") {
        o[k] = !v;
      } else if (typeof v === "number") {
        o[k] = v + 7;
      } else if (typeof v === "string") {
        o[k] = v + "x";
      } else {
        continue; // null, array and Map fields are covered by their own tests
      }
      const f1 = fingerprint(lute)!;
      assert.notEqual(f1, f0, `${obj}.${k} must change the fingerprint`);
      changed.add(`${obj}.${k}`);
    }
  }
  assert.ok(changed.size >= 80, `expected at least 80 primitive options, got ${changed.size}`);
});

test("PutTerms that keeps the size changes the fingerprint (in-place map change)", () => {
  const lute = New();
  const terms = lute.RenderOptions.Terms;
  const size = terms.size;
  const [key] = terms.keys();
  const f0 = fingerprint(lute);
  terms.set(key, terms.get(key) + "x");
  assert.equal(terms.size, size);
  assert.notEqual(fingerprint(lute), f0);
});

test("an object-valued own field makes the fingerprint null", () => {
  const lute = New();
  (lute.ParseOptions as unknown as Record<string, unknown>)["Unforeseen"] = { a: 1 };
  assert.equal(fingerprint(lute), null);
});
