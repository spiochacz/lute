// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The regression list of section 8.6: explicit documents, each compared with the engine without the cache (strict and verify) in both modes,
// and, where the specification names a reason, the reason is asserted. The eight opaque-disagreement documents (coordinator decision,
// deviation 4) must fall back as a whole with cert:opaque-preview, an unsupported reason, and never as an inconsistency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../../src/index.ts";
import { referenceEngine } from "../../incremental/reference_engine.ts";
import type { Lute } from "../../../src/index.ts";
import { auditDocuments, OPAQUE_DISAGREEMENTS_EXPECTED } from "../../incremental/corpus_docs.ts";

const UL3 = 'data-tight="true" data-marker="*" data-block="0"';

interface Case {
  name: string;
  html: string;
  reason: string | null; // the expected first fallback reason in WYSIWYG, or null for a composed document
}

const CASES: Case[] = [
  { name: "U+3000 paragraph before a list", html: `<p data-block="0">　a</p><ul ${UL3}><li data-marker="*">x</li></ul>`, reason: null },
  { name: "VT paragraph before a list", html: `<p data-block="0">\u000ba</p><ul ${UL3}><li data-marker="*">x</li></ul>`, reason: null },
  { name: "FF paragraph before a blockquote", html: `<p data-block="0">\fa</p><blockquote data-block="0"><p data-block="0">x</p></blockquote>`, reason: null },
  { name: "NBSP paragraph before a list", html: `<p data-block="0"> a</p><ul ${UL3}><li data-marker="*">x</li></ul>`, reason: null },
  { name: "U+2028 paragraph before a list", html: `<p data-block="0"> a</p><ul ${UL3}><li data-marker="*">x</li></ul>`, reason: null },
  { name: "whitespace-only paragraph before a list", html: `<p data-block="0">　</p><ul ${UL3}><li data-marker="*">x</li></ul>`, reason: null },
  { name: "empty paragraph before a whitespace paragraph (ZWSP shield)", html: `<p data-block="0"></p><p data-block="0">　</p>`, reason: null },
  { name: "<ul></ul> alone (all children dead)", html: "<ul></ul>", reason: null },
  { name: "<p></p> alone (all children dead)", html: "<p></p>", reason: null },
  { name: "p<br> before a list", html: `<p data-block="0">x<br></p><ul ${UL3}><li data-marker="*">y</li></ul>`, reason: null },
  { name: "p<br> before an ordered list", html: `<p data-block="0">x<br></p><ol ${UL3}><li data-marker="1.">y</li></ol>`, reason: null },
  { name: "p<br> before a blockquote", html: `<p data-block="0">x<br></p><blockquote data-block="0"><p data-block="0">y</p></blockquote>`, reason: null },
  { name: "p<br> before an empty list then a list", html: `<p data-block="0">x<br></p><ul ${UL3}></ul><ul ${UL3}><li data-marker="*">y</li></ul>`, reason: null },
  { name: "p<br> before h2", html: `<p data-block="0">x<br></p><h2 data-block="0">y</h2>`, reason: null },
  { name: "two lists with three attributes each (composed)", html: `<ul ${UL3}><li data-marker="*">a</li></ul><ul ${UL3}><li data-marker="*">b</li></ul>`, reason: null },
  { name: "list followed by a list with one attribute (list coupling)", html: `<ul ${UL3}><li data-marker="*">a</li></ul><ul data-block="0"><li>b</li></ul>`, reason: "list-coupling" },
  { name: "list, empty list, list with one attribute (list coupling)", html: `<ul ${UL3}><li data-marker="*">a</li></ul><ul></ul><ul data-block="0"><li>b</li></ul>`, reason: "list-coupling" },
  { name: "blockquote nested in a blockquote after a paragraph", html: `<p data-block="0">a</p><blockquote data-block="0"><blockquote data-block="0"><p data-block="0">x</p></blockquote></blockquote>`, reason: null },
  // the isLast witness of the context-channel search (test/incremental/context_channels.test.ts): the output of this table depends on isLast
  { name: "table with isLast witness, not last (followed by a paragraph)", html: `<table data-block="0"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><p data-block="0">z</p>`, reason: null },
  { name: "table with isLast witness, last", html: `<p data-block="0">z</p><table data-block="0"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`, reason: null },
  { name: "the same child twice in one document", html: `<p data-block="0">a</p><p data-block="0">a</p>`, reason: null },
  { name: "list item with a fenced code block (last)", html: `<ul ${UL3}><li data-marker="*"><div data-type="code-block" data-block="0"><pre class="vditor-wysiwyg__block-pre"><code>x</code></pre></div></li></ul><p data-block="0">a</p>`, reason: null },
  { name: "list item with a fenced code block (not last)", html: `<p data-block="0">a</p><ul ${UL3}><li data-marker="*"><div data-type="code-block" data-block="0"><pre class="vditor-wysiwyg__block-pre"><code>x</code></pre></div></li></ul>`, reason: null },
  { name: "opaque preview with raw <form (refused)", html: `<div data-type="html-block" data-block="0"><pre class="vditor-wysiwyg__preview" data-render="2"><form></pre></div>`, reason: "cert:opaque-preview" },
  // The specification lists this as refused. It is not: the raw <div> is closed by the </pre> cut (the parser nests it in the pre), the child
  // is a balanced element and the certificate certifies it; the composed output equals the normal path (deviation 9 in tasks/004).
  { name: "opaque preview with raw <div (certified, composed)", html: `<div data-type="html-block" data-block="0"><pre class="vditor-wysiwyg__preview" data-render="2"><div></pre></div>`, reason: null },
  { name: "<li>x</li> at top level", html: "<li>x</li>", reason: "scan:implicit-end-tag" },
  { name: "upper-case tag", html: "<P>a</P>", reason: "scan:upper-case-tag" },
  { name: "top-level text between blocks", html: "<p data-block=\"0\">a</p>text<p data-block=\"0\">b</p>", reason: "scan:top-level-text" },
  { name: "leading U+FEFF", html: "﻿<p data-block=\"0\">a</p>", reason: "scan:top-level-text" },
  { name: "data-formula followed by a script", html: '<p data-block="0"><span data-type="math-inline" data-formula="x">y</span></p><script>z</script>', reason: "scan:tag-not-allowed" },
  { name: "ZWSP inside text and tags", html: "<p data-block=\"0\">a​b</p>", reason: null },
  { name: "empty document", html: "", reason: "empty-document" },
];

function run(lute: Lute, mode: "wysiwyg" | "ir", html: string): string {
  return mode === "wysiwyg" ? lute.VditorDOM2Md(html) : lute.VditorIRDOM2Md(html);
}

function outcome(fn: () => string): string {
  try {
    return "value:" + fn();
  } catch (e) {
    return "throw:" + String(e);
  }
}

for (const c of CASES) {
  test(`regression: ${c.name}`, () => {
    for (const mode of ["wysiwyg", "ir"] as const) {
      const a = New();
      const b = referenceEngine();
      EnableIncrementalDom2Md(a, { strict: true, verify: true });
      const want = outcome(() => run(b, mode, c.html));
      const got = outcome(() => run(a, mode, c.html));
      assert.equal(got, want, `${mode}: ${JSON.stringify(c.html)}`);
      const s = IncrementalDom2MdStats(a)!;
      assert.deepEqual(s.inconsistencies, {}, `${mode}: no inconsistency`);
      if (mode === "wysiwyg" && c.reason !== null) {
        assert.ok((s.unsupported[c.reason] ?? 0) >= 1, `${mode}: expected the reason ${c.reason}, got ${JSON.stringify(s.unsupported)}`);
      }
      DisableIncrementalDom2Md(a);
    }
  });
}

// The eight opaque-disagreement documents (deviation 4): a whole-document fallback as an unsupported reason, output equal to the normal path.
const DOCS = auditDocuments();
for (const id of OPAQUE_DISAGREEMENTS_EXPECTED) {
  test(`opaque disagreement falls back as a whole: ${id}`, () => {
    const d = DOCS.find((x) => x.name === id)!;
    const a = New();
    const b = referenceEngine();
    EnableIncrementalDom2Md(a, { strict: true, verify: true });
    const want = outcome(() => run(b, d.mode, d.html));
    const got = outcome(() => run(a, d.mode, d.html));
    assert.equal(got, want);
    const s = IncrementalDom2MdStats(a)!;
    assert.equal(s.composed, 0, "no composed call");
    assert.equal(s.unsupported["cert:opaque-preview"], 1, JSON.stringify(s.unsupported));
    assert.deepEqual(s.inconsistencies, {});
    DisableIncrementalDom2Md(a);
  });
}

test("disable then call: the normal path, identical output, no stats", () => {
  const a = New();
  const b = referenceEngine();
  EnableIncrementalDom2Md(a, { strict: true });
  EnableIncrementalDom2Md(a, { strict: true });
  DisableIncrementalDom2Md(a);
  assert.equal(IncrementalDom2MdStats(a), null);
  assert.equal(a.VditorDOM2Md("<p data-block=\"0\">a</p>"), b.VditorDOM2Md("<p data-block=\"0\">a</p>"));
});

test("two engines with different options keep separate states", () => {
  const a = New();
  const b = referenceEngine();
  const html = '<p data-block="0">a</p><ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>';
  b.SetProtyleWYSIWYG(true);
  EnableIncrementalDom2Md(a, { strict: true, verify: true });
  EnableIncrementalDom2Md(b, { strict: true, verify: true });
  a.VditorDOM2Md(html);
  b.VditorDOM2Md(html);
  assert.equal(IncrementalDom2MdStats(a)!.calls, 1);
  assert.equal(IncrementalDom2MdStats(b)!.calls, 1);
  DisableIncrementalDom2Md(a);
  DisableIncrementalDom2Md(b);
});

test("the option toggle between two calls clears the cache (optionClears) and keeps the output equal", () => {
  const a = New();
  const b = referenceEngine();
  const html = '<p data-block="0">a</p><ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>';
  EnableIncrementalDom2Md(a, { strict: true, verify: true });
  assert.equal(a.VditorDOM2Md(html), b.VditorDOM2Md(html));
  a.SetProtyleWYSIWYG(true);
  b.SetProtyleWYSIWYG(true);
  assert.equal(a.VditorDOM2Md(html), b.VditorDOM2Md(html));
  assert.equal(IncrementalDom2MdStats(a)!.optionClears, 1);
  DisableIncrementalDom2Md(a);
});

test("a Terms change in place changes the fingerprint (the cache is cleared)", () => {
  const a = New();
  const b = referenceEngine();
  const html = '<p data-block="0">a :smile: b</p>';
  EnableIncrementalDom2Md(a, { strict: true, verify: true });
  assert.equal(a.VditorDOM2Md(html), b.VditorDOM2Md(html));
  const key = [...a.RenderOptions.Terms.keys()][0];
  a.RenderOptions.Terms.set(key, "changed");
  b.RenderOptions.Terms.set(key, "changed");
  assert.equal(a.VditorDOM2Md(html), b.VditorDOM2Md(html));
  assert.equal(IncrementalDom2MdStats(a)!.optionClears, 1);
  DisableIncrementalDom2Md(a);
});

test("a document larger than maxBytes falls back as too-large", () => {
  const a = New();
  const b = referenceEngine();
  const big = "<p data-block=\"0\">" + "word ".repeat(2000) + "</p>";
  EnableIncrementalDom2Md(a, { strict: true, maxBytes: 1000 });
  assert.equal(a.VditorDOM2Md(big), b.VditorDOM2Md(big));
  assert.equal(IncrementalDom2MdStats(a)!.unsupported["too-large"], 1);
  DisableIncrementalDom2Md(a);
});
