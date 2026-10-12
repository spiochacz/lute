// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The policy of the cache per engine (src/incremental/policy.ts): the default "auto", the automatic start (rules (a) and (b)), the back-off, "on"
// and "off", and the engine methods of the bundle. Every output is compared with a reference engine whose policy is "off" (the normal path).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  New,
  AUTO_MIN_HTML_LENGTH,
  AUTO_COOLDOWN_CALLS,
  GetIncrementalDom2MdPolicy,
  IncrementalDom2MdStats,
  SetIncrementalDom2MdPolicy,
} from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import type { IncrementalStats } from "../../src/index.ts";

// A document of about 6000 characters. The word is in every paragraph, at its start and at its end, so that two documents with different words
// differ in their first and in their last 64 characters (rule (b) of the policy compares those) and share no child.
function doc(word: string, paragraphs = 60): string {
  let s = "";
  for (let i = 0; i < paragraphs; i++) {
    s += `<p data-block="0">${word} paragraph number ${i} with some plain text to make it long enough, ${word} ${i}</p>`;
  }
  return s;
}

// The same document with one character changed in the middle (the length is the same, the first and last 64 characters are the same).
function edited(html: string): string {
  return html.replace("paragraph number 5 ", "paragraph number 6 ");
}

// The reference: an engine with the policy "off", which runs the normal path.
function reference(): Lute {
  const ref = New();
  SetIncrementalDom2MdPolicy(ref, "off");
  return ref;
}

// check calls the engine and the reference on one document and asserts that the outputs are equal.
function check(lute: Lute, ref: Lute, html: string): void {
  assert.equal(lute.VditorDOM2Md(html), ref.VditorDOM2Md(html));
}

// stats returns the statistics or null; a missing record reads as zero for the counters the tests look at.
function auto(lute: Lute): { starts: number; backoffs: number; calls: number; composed: number } {
  const s: IncrementalStats | null = IncrementalDom2MdStats(lute);
  return { starts: s?.autoStarts ?? 0, backoffs: s?.autoBackoffs ?? 0, calls: s?.calls ?? 0, composed: s?.composed ?? 0 };
}

test("1: the default policy is auto; one call on a large document has no cache state and no automatic start", () => {
  const lute = New();
  const ref = reference();
  assert.equal(GetIncrementalDom2MdPolicy(lute), "auto");
  const html = doc("alpha");
  assert.ok(html.length >= AUTO_MIN_HTML_LENGTH);
  check(lute, ref, html);
  const s = auto(lute);
  assert.equal(s.starts, 0);
  assert.equal(s.calls, 0, "no cache call was made");
});

test("2: a second call with one character edited starts the cache; the call after that is composed", () => {
  const lute = New();
  const ref = reference();
  const a = doc("alpha");
  check(lute, ref, a);
  const b = edited(a);
  check(lute, ref, b);
  assert.equal(auto(lute).starts, 1, "started by the second call");
  const before = IncrementalDom2MdStats(lute)!;
  const c = b.replace("paragraph number 6 ", "paragraph number 7 ");
  check(lute, ref, c);
  const after = IncrementalDom2MdStats(lute)!;
  assert.equal(auto(lute).starts, 1);
  assert.equal(after.composed - before.composed, 1, "the call after the start was composed");
  assert.ok(after.hits - before.hits > 0, "and it reused the children of the starting call");
});

test("3: a second call with an unrelated document of similar length does not start the cache", () => {
  const lute = New();
  const ref = reference();
  check(lute, ref, doc("alpha"));
  check(lute, ref, doc("zulu"));
  assert.equal(auto(lute).starts, 0);
  assert.equal(auto(lute).calls, 0);
});

test("4: documents below AUTO_MIN_HTML_LENGTH never start the cache", () => {
  const lute = New();
  const ref = reference();
  const small = doc("alpha", 30);
  assert.ok(small.length < AUTO_MIN_HTML_LENGTH, `the fixture is ${small.length} characters`);
  check(lute, ref, small);
  check(lute, ref, edited(small));
  check(lute, ref, edited(edited(small)));
  assert.equal(auto(lute).starts, 0);
  assert.equal(auto(lute).calls, 0);
});

test("5: \"off\" after an automatic start drops the state; later similar calls never start it", () => {
  const lute = New();
  const ref = reference();
  const a = doc("alpha");
  check(lute, ref, a);
  check(lute, ref, edited(a));
  assert.equal(auto(lute).starts, 1);
  SetIncrementalDom2MdPolicy(lute, "off");
  assert.equal(GetIncrementalDom2MdPolicy(lute), "off");
  assert.equal(IncrementalDom2MdStats(lute), null, "the state and its statistics are dropped");
  check(lute, ref, edited(edited(a)));
  check(lute, ref, edited(edited(edited(a))));
  assert.equal(IncrementalDom2MdStats(lute), null, "off: the cache is never used again");
});

test("6: back-off: after an automatic start, three consecutive unrelated large documents drop the cache, and autoBackoffs is 1", () => {
  const lute = New();
  const ref = reference();
  const a = doc("alpha");
  check(lute, ref, a);
  check(lute, ref, edited(a));
  assert.equal(auto(lute).starts, 1);
  // the starting call is not counted; three bad calls in a row are
  check(lute, ref, doc("bravo"));
  assert.equal(auto(lute).backoffs, 0, "one bad call");
  check(lute, ref, doc("charlie"));
  assert.equal(auto(lute).backoffs, 0, "two bad calls");
  check(lute, ref, doc("delta"));
  const s = auto(lute);
  assert.equal(s.backoffs, 1, "three bad calls: back-off");
  assert.equal(s.starts, 1, "the start count is kept");
  assert.equal(IncrementalDom2MdStats(lute)!.calls, 0, "the state is dropped: no running cache");
  assert.equal(GetIncrementalDom2MdPolicy(lute), "auto", "back to auto");
});

test("7: a cache started by \"on\" never backs off", () => {
  const lute = New();
  const ref = reference();
  SetIncrementalDom2MdPolicy(lute, "on");
  check(lute, ref, doc("alpha"));
  for (const w of ["bravo", "charlie", "delta", "echo", "foxtrot"]) {
    check(lute, ref, doc(w));
  }
  const s = IncrementalDom2MdStats(lute)!;
  assert.equal(s.autoBackoffs, 0);
  assert.equal(s.calls, 6, "the cache kept running for every call");
});

test("8: the engine methods behave as the functions: SetIncrementalDom2Md(false) and (true), and IncrementalDom2MdStats", () => {
  const lute = New();
  const ref = reference();
  const a = doc("alpha");
  check(lute, ref, a);
  check(lute, ref, edited(a));
  assert.equal(lute.IncrementalDom2MdStats()!.autoStarts, 1);
  assert.equal(lute.IncrementalDom2MdStats()!.calls, IncrementalDom2MdStats(lute)!.calls);

  lute.SetIncrementalDom2Md(false);
  assert.equal(GetIncrementalDom2MdPolicy(lute), "off");
  assert.equal(lute.IncrementalDom2MdStats(), null);
  assert.equal(IncrementalDom2MdStats(lute), null);

  lute.SetIncrementalDom2Md(true);
  assert.equal(GetIncrementalDom2MdPolicy(lute), "on");
  check(lute, ref, a);
  assert.ok(lute.IncrementalDom2MdStats() !== null);
  assert.equal(lute.IncrementalDom2MdStats()!.calls, 1, "the cache is running after true");
  assert.equal(lute.IncrementalDom2MdStats()!.autoBackoffs, 0);
});

test("6b: after a back-off the cache does not start again for AUTO_COOLDOWN_CALLS qualifying calls", () => {
  const lute = New();
  const ref = reference();
  const a = doc("alpha");
  check(lute, ref, a);
  check(lute, ref, edited(a));
  check(lute, ref, doc("bravo"));
  check(lute, ref, doc("charlie"));
  check(lute, ref, doc("delta"));
  assert.equal(auto(lute).backoffs, 1);
  // similar calls during the cool-down: none starts the cache
  let d = doc("echo");
  for (let i = 0; i < AUTO_COOLDOWN_CALLS; i++) {
    d = edited(d);
    check(lute, ref, d);
    assert.equal(auto(lute).starts, 1, `call ${i + 1} of the cool-down`);
  }
  // the cool-down is over: the next similar call starts it again
  check(lute, ref, edited(d));
  assert.equal(auto(lute).starts, 2);
});
