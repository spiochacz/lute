// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Tests of the cache's state (section 8.1, cache.test.ts): the flat key, eviction order, the byte accounting, the clear at maxBytes, the variant
// cap of 8, and the statistics arithmetic of the engine. The heap check of the flat key (2,000 entries cut from a 600 KB string retain less
// than 5 MB) is NOT here: node --test does not expose gc, and a heap estimate without a forced collection is noise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import { MAX_VARIANTS, State, addVariant, evict, flat, newEntry, removeEntry } from "../../src/incremental/cache.ts";
import type { Entry, Variant } from "../../src/incremental/piece.ts";

// variant returns a variant of the given size; endLastOut carries an identity for the assertions, and the key is distinct per id.
function variant(id: number, bytes: number): Variant {
  return { key: "key" + String(id), ops: [], endLastOut: id, bytes };
}

// put adds an entry to the WYSIWYG map and its bytes to the accounting, as the engine does after a run.
function put(st: State, key: string, bytes: number, lastCall: number): Entry {
  const e = newEntry(key, false);
  e.bytes = bytes;
  e.lastCall = lastCall;
  st.maps.wysiwyg.set(e.html, e);
  st.bytes += bytes;
  return e;
}

test("flat returns a string equal to its input (the copy owns its characters)", () => {
  const big = "x".repeat(600_000) + "<p>end</p>";
  const part = big.substring(600_000);
  const copy = flat(part);
  assert.equal(copy, "<p>end</p>");
  assert.equal(flat(""), "");
  const u = "　中文\u000b\u{1F600}";
  assert.equal(flat(u), u);
});

test("eviction order: untouched entries go first, in insertion order, until 75% of maxBytes; touched entries stay", () => {
  const st = new State({ maxBytes: 1000 });
  put(st, "<p>a</p>", 400, 1);
  put(st, "<p>b</p>", 400, 2);
  const kept = put(st, "<p>c</p>", 400, 3);
  evict(st, 3);
  assert.deepEqual(Array.from(st.maps.wysiwyg.keys()), ["<p>c</p>"]);
  assert.equal(st.maps.wysiwyg.get("<p>c</p>"), kept);
  assert.equal(st.bytes, 400);
  assert.equal(st.stats.evictions, 2);
});

test("eviction stops as soon as the total is at or below 75% of maxBytes", () => {
  const st = new State({ maxBytes: 1000 });
  put(st, "<p>a</p>", 300, 1);
  put(st, "<p>b</p>", 300, 1);
  put(st, "<p>c</p>", 300, 1);
  put(st, "<p>d</p>", 300, 3);
  evict(st, 3);
  // 1200 > 1000: remove a (900), then b (600 <= 750, so the loop stops before c)
  assert.deepEqual(Array.from(st.maps.wysiwyg.keys()), ["<p>c</p>", "<p>d</p>"]);
  assert.equal(st.bytes, 600);
  assert.equal(st.stats.evictions, 2);
});

test("nothing is evicted while the total is within maxBytes", () => {
  const st = new State({ maxBytes: 1000 });
  put(st, "<p>a</p>", 500, 1);
  put(st, "<p>b</p>", 500, 1);
  evict(st, 2);
  assert.equal(st.maps.wysiwyg.size, 2);
  assert.equal(st.bytes, 1000);
  assert.equal(st.stats.evictions, 0);
});

test("maxBytes clear: when the entries of this call alone exceed maxBytes, both maps are cleared and the bytes are zero", () => {
  const st = new State({ maxBytes: 1000 });
  put(st, "<p>a</p>", 600, 5);
  put(st, "<p>b</p>", 600, 5);
  st.maps.ir.set("<p>c</p>", newEntry("<p>c</p>", false));
  st.maps.ir.get("<p>c</p>")!.bytes = 100;
  st.bytes += 100;
  evict(st, 5);
  assert.equal(st.maps.wysiwyg.size, 0);
  assert.equal(st.maps.ir.size, 0);
  assert.equal(st.bytes, 0);
  assert.equal(st.stats.evictions, 3);
});

test("byte accounting: addVariant adds the variant's bytes to the entry and the state; removeEntry subtracts the entry's bytes", () => {
  const st = new State({});
  const e = put(st, "<p>x</p>", 0, 1);
  const base = e.bytes;
  const before = st.bytes;
  addVariant(st, e, variant(1, 10));
  addVariant(st, e, variant(2, 20));
  assert.equal(e.bytes, base + 30);
  assert.equal(st.bytes, before + 30);
  removeEntry(st, st.maps.wysiwyg, e);
  assert.equal(st.maps.wysiwyg.size, 0);
  assert.equal(st.bytes, before + 30 - e.bytes);
  // removing an entry that is not in the map changes nothing
  const bytesNow = st.bytes;
  removeEntry(st, st.maps.wysiwyg, e);
  assert.equal(st.bytes, bytesNow);
});

test(`variant cap: an entry keeps at most ${MAX_VARIANTS} variants and drops the oldest`, () => {
  assert.equal(MAX_VARIANTS, 16, "milestone C: 16 (cache.ts; 8 in milestone B)");
  const st = new State({});
  const e = put(st, "<p>x</p>", 0, 1);
  const base = e.bytes;
  for (let i = 1; i <= MAX_VARIANTS + 1; i++) {
    addVariant(st, e, variant(i, 10));
  }
  assert.equal(e.variants.length, MAX_VARIANTS);
  assert.deepEqual(
    e.variants.map((v) => v.endLastOut),
    Array.from({ length: MAX_VARIANTS }, (_, i) => i + 2),
    "variant 1 (the oldest) is dropped",
  );
  assert.equal(e.bytes, base + 10 * MAX_VARIANTS);
  assert.equal(st.bytes, 10 * MAX_VARIANTS);
});

test("statistics arithmetic: composed + fallbacks == calls, and the fallbacks are counted by reason", () => {
  const lute = New();
  lute.SetVditorWYSIWYG(true);
  EnableIncrementalDom2Md(lute, { strict: true, verify: true });
  try {
    const docs = [
      '<p data-block="0">a</p>',
      '<p data-block="0">a</p><h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>',
      "<li>x</li>", // scan:implicit-end-tag: a fallback
      "", // empty-document: a fallback
      '<p data-block="0">a</p>',
    ];
    for (const d of docs) {
      lute.VditorDOM2Md(d);
    }
    const s = IncrementalDom2MdStats(lute)!;
    assert.equal(s.calls, docs.length);
    assert.equal(s.composed + s.fallbacks, s.calls);
    const byReason = Object.values(s.unsupported).reduce((a, b) => a + b, 0);
    assert.equal(byReason, s.fallbacks, "every fallback has one reason");
    assert.ok(s.fallbacks >= 2, `expected at least the two refused documents as fallbacks, got ${s.fallbacks}`);
    assert.deepEqual(s.inconsistencies, {});
    assert.equal(s.entries, IncrementalDom2MdStats(lute)!.entries);
  } finally {
    DisableIncrementalDom2Md(lute);
  }
});
