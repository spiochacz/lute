// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// Milestone C, step C2 (tasks/004, "Milestone C analysis", section 7, C2): the order of one call. The counters analyses, builds and renders
// are read from IncrementalDom2MdStats; a refusal found in an early phase must leave the later phases unrun.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

const UL3 = 'data-tight="true" data-marker="*" data-block="0"';
const OPAQUE = '<div data-type="html-block" data-block="0"><pre class="vditor-wysiwyg__preview" data-render="2"><form></pre></div>';
const LIST_PAIR = `<ul ${UL3}><li data-marker="*">a</li></ul><ul data-block="0"><li>b</li></ul>`;
// An IR math block with an open marker and no close marker: the builder leaves the tip inside the math block.
const TIP_OPEN = '<div data-type="math-block" data-block="0"><span data-type="math-block-open-marker">$$</span></div>';

function clean(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `<p data-block="0">clean ${from + i}</p>`);
}

function engine(strict: boolean): Lute {
  const lute = New();
  EnableIncrementalDom2Md(lute, { strict, verify: true });
  return lute;
}

// (i) an opaque child that the certificate refuses, in the middle of 100 clean children: the clean children are neither built nor rendered,
// and only the opaque child is analysed (it comes first in the order of analysis).
test("C2 (i): a refused opaque child ends the call after its analysis: no build or render of the clean children", () => {
  const doc = [...clean(0, 50), OPAQUE, ...clean(50, 50)].join("");
  const a = engine(true);
  const b = New();
  const got = a.VditorDOM2Md(doc);
  assert.equal(got, b.VditorDOM2Md(doc));
  const s = IncrementalDom2MdStats(a)!;
  assert.equal(s.unsupported["cert:opaque-preview"], 1, JSON.stringify(s.unsupported));
  assert.equal(s.analyses, 1, "only the opaque child is analysed");
  assert.equal(s.builds, 0);
  assert.equal(s.renders, 0);
  DisableIncrementalDom2Md(a);
});

// (ii) a list-coupling pair: the coupling is decided after the analyses and before any build.
test("C2 (ii): list coupling is decided before any build", () => {
  const doc = [...clean(0, 50), LIST_PAIR, ...clean(50, 10)].join("");
  const a = engine(true);
  const b = New();
  assert.equal(a.VditorDOM2Md(doc), b.VditorDOM2Md(doc));
  const s = IncrementalDom2MdStats(a)!;
  assert.equal(s.unsupported["list-coupling"], 1, JSON.stringify(s.unsupported));
  assert.equal(s.builds, 0, "no build before the coupling decision");
  assert.equal(s.renders, 0);
  DisableIncrementalDom2Md(a);
});

// (iii) an IR child with an open tip at position 3 of 50 children: the build stops at it (at most 3 builds of the children before it plus
// the offender), and nothing is rendered.
test("C2 (iii): an open tip stops the builds at the first offender; no child is rendered", () => {
  const doc = [...clean(0, 3), TIP_OPEN, ...clean(3, 50)].join("");
  const a = engine(true);
  const b = New();
  assert.equal(a.VditorIRDOM2Md(doc), b.VditorIRDOM2Md(doc));
  const s = IncrementalDom2MdStats(a)!;
  assert.equal(s.unsupported["tip-open"], 1, JSON.stringify(s.unsupported));
  assert.ok(s.builds <= 4, `builds ${s.builds} must be at most 4`);
  assert.equal(s.renders, 0);
  DisableIncrementalDom2Md(a);
});

// (iv) a warm document with an unchanged tail: the children that are unchanged are not analysed again; one edited child costs one analysis.
test("C2 (iv): a warm call with one edited child analyses and builds only that child", () => {
  const head = clean(0, 60);
  const a = engine(true);
  const b = New();
  assert.equal(a.VditorDOM2Md(head.join("")), b.VditorDOM2Md(head.join("")));
  const first = IncrementalDom2MdStats(a)!;
  assert.equal(first.analyses, 60);
  const again = IncrementalDom2MdStats(a)!;
  assert.equal(a.VditorDOM2Md(head.join("")), b.VditorDOM2Md(head.join("")));
  assert.equal(IncrementalDom2MdStats(a)!.analyses - again.analyses, 0, "an unchanged document analyses nothing");
  const edited = ['<p data-block="0">changed</p>', ...head.slice(1)].join("");
  const before = IncrementalDom2MdStats(a)!;
  assert.equal(a.VditorDOM2Md(edited), b.VditorDOM2Md(edited));
  const after = IncrementalDom2MdStats(a)!;
  assert.equal(after.analyses - before.analyses, 1, "one new child, one analysis");
  assert.equal(after.builds - before.builds, 1, "one new child, one build");
  assert.equal(after.misses - before.misses, 1, "one new child, one miss");
  DisableIncrementalDom2Md(a);
});

// (v) no child is analysed or built twice in one call: 40 distinct new children give 40 analyses, 40 builds and 40 renders.
test("C2 (v): each distinct new child is analysed once, built once and rendered once in one call", () => {
  const doc = clean(1000, 40).join("");
  const a = engine(true);
  const b = New();
  assert.equal(a.VditorDOM2Md(doc), b.VditorDOM2Md(doc));
  const s = IncrementalDom2MdStats(a)!;
  assert.equal(s.composed, 1, JSON.stringify(s));
  assert.equal(s.analyses, 40);
  assert.equal(s.builds, 40);
  assert.equal(s.renders, 40);
  assert.equal(s.sandboxRuns, 40, "no full run for a child built in this call");
  DisableIncrementalDom2Md(a);
});
