// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// Milestone C, step C3 (tasks/004, "Milestone C analysis", section 6.4): the negative memo. A repeated fallback whose offending child is still in
// the document is answered without the scan, the lookup or any run. Every output is equal to the normal path's output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { Lute as LuteClass } from "../../src/types.ts";
import type * as html from "../../src/html/index.ts";

const UL3 = 'data-tight="true" data-marker="*" data-block="0"';
// An IR code block without an open marker: the IR builder leaves the tip open (tip-open, upstream item 64).
const TIP_OPEN = '<div data-type="code-block" data-block="0"><span data-type="text">indented</span></div>';
const TIP_OPEN_EDITED = '<div data-type="code-block" data-block="0"><span data-type="text">indented!</span></div>';
const LIST_PAIR = `<ul ${UL3}><li data-marker="*">a</li></ul><ul data-block="0"><li>b</li></ul>`;
const OPAQUE = '<div data-type="html-block" data-block="0"><pre class="vditor-wysiwyg__preview" data-render="2"><form></pre></div>';

function clean(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `<p data-block="0">clean ${from + i}</p>`);
}

function engine(options: { strict?: boolean; maxBytes?: number } = {}): Lute {
  const lute = New();
  EnableIncrementalDom2Md(lute, { strict: options.strict ?? true, verify: true, maxBytes: options.maxBytes });
  return lute;
}

// (i) an IR document with an open tip: call 1 falls back (tip-open) and sets the memo; call 2, an edit elsewhere, answers from the memo with no
// analysis at all.
test("C3 (i): a repeated tip-open fallback is a memo hit: no scan-based run, no analysis", () => {
  const a = engine();
  const b = New();
  const doc1 = [...clean(0, 3), TIP_OPEN, ...clean(3, 3)].join("");
  assert.equal(a.VditorIRDOM2Md(doc1), b.VditorIRDOM2Md(doc1));
  const s1 = IncrementalDom2MdStats(a)!;
  assert.equal(s1.unsupported["tip-open"], 1);
  assert.equal(s1.memoHits, 0);
  const doc2 = [...clean(100, 3), TIP_OPEN, ...clean(3, 3)].join("");
  assert.equal(a.VditorIRDOM2Md(doc2), b.VditorIRDOM2Md(doc2));
  const s2 = IncrementalDom2MdStats(a)!;
  assert.equal(s2.memoHits - s1.memoHits, 1, "one memo hit");
  assert.equal(s2.unsupported["tip-open"] - s1.unsupported["tip-open"], 1, "the call counts under the same reason");
  assert.equal(s2.sandboxRuns, s1.sandboxRuns, "no sandbox run");
  assert.equal(s2.analyses, s1.analyses, "no analysis");
  DisableIncrementalDom2Md(a);
});

// (ii) the offending child removed: the call composes, and the memo is cleared (the next call with the offender is not a memo hit).
test("C3 (ii): removing the offender composes and clears the memo", () => {
  const a = engine();
  const b = New();
  const withOffender = [...clean(0, 2), TIP_OPEN, ...clean(2, 2)].join("");
  assert.equal(a.VditorIRDOM2Md(withOffender), b.VditorIRDOM2Md(withOffender));
  const without = clean(0, 4).join("");
  assert.equal(a.VditorIRDOM2Md(without), b.VditorIRDOM2Md(without));
  assert.equal(IncrementalDom2MdStats(a)!.composed, 1);
  const before = IncrementalDom2MdStats(a)!.memoHits;
  assert.equal(a.VditorIRDOM2Md(withOffender), b.VditorIRDOM2Md(withOffender));
  assert.equal(IncrementalDom2MdStats(a)!.memoHits - before, 0, "the memo was cleared by the composed call");
  DisableIncrementalDom2Md(a);
});

// (iii) an edit inside the offending child: the memo string is gone, the full path runs (one analysis of the edited child), and the memo is set
// to the new entry.
test("C3 (iii): an edit inside the offender is not a memo hit; the memo follows the new entry", () => {
  const a = engine();
  const b = New();
  const doc1 = [...clean(0, 2), TIP_OPEN].join("");
  assert.equal(a.VditorIRDOM2Md(doc1), b.VditorIRDOM2Md(doc1));
  const s1 = IncrementalDom2MdStats(a)!;
  const doc2 = [...clean(0, 2), TIP_OPEN_EDITED].join("");
  assert.equal(a.VditorIRDOM2Md(doc2), b.VditorIRDOM2Md(doc2));
  const s2 = IncrementalDom2MdStats(a)!;
  assert.equal(s2.memoHits - s1.memoHits, 0, "no memo hit for the edited offender");
  assert.equal(s2.unsupported["tip-open"] - s1.unsupported["tip-open"], 1);
  assert.equal(s2.analyses - s1.analyses, 1, "the edited child is analysed once");
  assert.equal(a.VditorIRDOM2Md(doc2), b.VditorIRDOM2Md(doc2));
  assert.equal(IncrementalDom2MdStats(a)!.memoHits - s2.memoHits, 1, "the memo now holds the new entry");
  DisableIncrementalDom2Md(a);
});

// (iv) no memo for list-coupling, a scan refusal, too-large or an inconsistency: repeated calls with these never hit the memo.
test("C3 (iv): list-coupling, scan refusals and too-large are not memoised", () => {
  const cases: Array<{ name: string; html: string; options?: { maxBytes?: number }; reason: string }> = [
    { name: "list-coupling", html: [...clean(0, 3), LIST_PAIR].join(""), reason: "list-coupling" },
    { name: "scan", html: '<li data-marker="*">x</li>' + clean(0, 2).join(""), reason: "scan:implicit-end-tag" },
    { name: "too-large", html: clean(0, 200).join(""), options: { maxBytes: 4096 }, reason: "too-large" },
  ];
  for (const c of cases) {
    const a = engine(c.options);
    const b = New();
    assert.equal(a.VditorDOM2Md(c.html), b.VditorDOM2Md(c.html), c.name);
    assert.equal(a.VditorDOM2Md(c.html), b.VditorDOM2Md(c.html), c.name);
    const s = IncrementalDom2MdStats(a)!;
    assert.equal(s.unsupported[c.reason], 2, `${c.name}: ${JSON.stringify(s.unsupported)}`);
    assert.equal(s.memoHits, 0, `${c.name} is not memoised`);
    DisableIncrementalDom2Md(a);
  }
});

// (iv, continued) an inconsistency (a barrier violation injected by patching adjustTag, the hook of barrier.test.ts) is not memoised either.
test("C3 (iv): an inconsistency is not memoised", () => {
  const proto = LuteClass.prototype as unknown as Record<string, (n: html.Node) => void>;
  const orig = proto.adjustTag;
  proto.adjustTag = function (this: Lute, n: html.Node): void {
    orig.call(this, n);
    n.Unlink();
  };
  try {
    const a = engine({ strict: false });
    const b = New();
    const doc = [...clean(0, 2)].join("");
    const want = b.VditorDOM2Md(doc);
    assert.equal(a.VditorDOM2Md(doc), want);
    assert.equal(a.VditorDOM2Md(doc), want);
    const s = IncrementalDom2MdStats(a)!;
    assert.ok(Object.keys(s.inconsistencies).length > 0, "the injected violation is an inconsistency");
    assert.equal(s.memoHits, 0);
    DisableIncrementalDom2Md(a);
  } finally {
    proto.adjustTag = orig;
  }
});

// (v) a fingerprint change clears the memo: the first call after the change runs the full path.
test("C3 (v): an option change clears the memo", () => {
  const a = engine();
  const b = New();
  assert.equal(a.VditorIRDOM2Md(TIP_OPEN), b.VditorIRDOM2Md(TIP_OPEN));
  assert.equal(a.VditorIRDOM2Md(TIP_OPEN), b.VditorIRDOM2Md(TIP_OPEN));
  const s1 = IncrementalDom2MdStats(a)!;
  assert.equal(s1.memoHits, 1);
  a.SetProtyleWYSIWYG(true);
  b.SetProtyleWYSIWYG(true);
  assert.equal(a.VditorIRDOM2Md(TIP_OPEN), b.VditorIRDOM2Md(TIP_OPEN));
  const s2 = IncrementalDom2MdStats(a)!;
  assert.equal(s2.optionClears - s1.optionClears, 1);
  assert.equal(s2.memoHits - s1.memoHits, 0, "the memo was cleared with the maps");
  DisableIncrementalDom2Md(a);
});

// (vi) the 32nd hit re-probes: 31 hits are memo hits, the 32nd call takes the full path (it is not counted as a memo hit).
test("C3 (vi): every 32nd memo hit re-probes", () => {
  const a = engine();
  const b = New();
  const doc = TIP_OPEN;
  const want = b.VditorIRDOM2Md(doc);
  assert.equal(a.VditorIRDOM2Md(doc), want);
  const base = IncrementalDom2MdStats(a)!.memoHits;
  for (let i = 1; i <= 32; i++) {
    assert.equal(a.VditorIRDOM2Md(doc), want, `call ${i}`);
  }
  const s = IncrementalDom2MdStats(a)!;
  assert.equal(s.memoHits - base, 31, "the 32nd call re-probes instead of hitting the memo");
  assert.equal(s.unsupported["tip-open"], 33, "every call counts as a tip-open fallback");
  DisableIncrementalDom2Md(a);
});

// (vii) the output of every call equals the normal path's, memo or not, in both modes, for the offender and an edited offender.
test("C3 (vii): every output equals the normal path's, memo or not", () => {
  const a = engine();
  const b = New();
  const docs = [
    [...clean(0, 2), TIP_OPEN].join(""),
    [...clean(0, 2), TIP_OPEN].join(""),
    [...clean(5, 2), TIP_OPEN, ...clean(9, 2)].join(""),
    [...clean(0, 2), TIP_OPEN_EDITED].join(""),
    [...clean(0, 2), OPAQUE].join(""),
    [...clean(0, 2), OPAQUE].join(""),
    clean(0, 3).join(""),
  ];
  for (const d of docs) {
    assert.equal(a.VditorIRDOM2Md(d), b.VditorIRDOM2Md(d));
    assert.equal(a.VditorDOM2Md(d), b.VditorDOM2Md(d));
  }
  const s = IncrementalDom2MdStats(a)!;
  assert.deepEqual(s.inconsistencies, {});
  assert.equal(s.composed + s.fallbacks, s.calls);
  assert.ok(s.memoHits >= 1);
  DisableIncrementalDom2Md(a);
});
