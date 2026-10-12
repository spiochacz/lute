// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Generated node IDs (section 3.6): the IDs that a child's phases generate are collected (ast.InstallNodeIDCollector), and the child is refused
// as generated-id only when one of them is observable in its log (its full ID or its first 14 characters, generatedIDLeaks). An ID that the
// output does not show composes. The NC14 unit test (a renderer that writes a new ID) is in context_channels.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "../../src/ast/index.ts";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { FormatRenderer } from "../../src/render/types.ts";
import { WYSIWYG_ADAPTER, analyse, build, collectingIDs, runChild } from "../../src/incremental/sandbox.ts";
import { BASE_CONTEXT } from "./witness.ts";

// The fixed ID of the test environment (ast.SetTesting): in a document it is ordinary text, and the cache must not refuse it.
const FIXED_ID_TEXT = "20060102150405-1a2b3c4";

test("a document that contains the fixed test ID as text composes, with the same output as the normal path", () => {
  const lute: Lute = New();
  EnableIncrementalDom2Md(lute);
  try {
    const html = `<p data-block="0">see ${FIXED_ID_TEXT} here</p><p data-block="0">second</p>`;
    const composed = lute.VditorDOM2Md(html);
    const normal = lute.vditorDOM2Md(html);
    assert.equal(composed, normal);
    const s = IncrementalDom2MdStats(lute)!;
    assert.equal(s.composed, 1, "the call composed");
    assert.equal(s.fallbacks, 0, "no fallback: the text is not a generated ID");
  } finally {
    DisableIncrementalDom2Md(lute);
  }
});

test("the testing flag of the node IDs is not switched on by the cache", () => {
  assert.equal(ast.GetTesting(), false);
  const lute: Lute = New();
  runChild(lute, WYSIWYG_ADAPTER, '<p data-block="0">x</p>', BASE_CONTEXT, { certify: true, opaque: false });
  assert.equal(ast.GetTesting(), false);
});

// (i) An ID that the output shows refuses the child. The renderer of a paragraph writes a node ID; the testing flag makes it the fixed ID, so
// the output of the cache equals the normal path (both contain the same text) and the call is a counted fallback, not a composed call.
test("(i) a child whose render generates an ID that the output shows is refused, and the output equals the normal path", () => {
  const html = '<p data-block="0">x</p>';
  const proto = FormatRenderer.prototype as unknown as { renderParagraph: (n: ast.Node, e: boolean) => ast.WalkStatus };
  const original = proto.renderParagraph;
  ast.SetTesting(true);
  try {
    proto.renderParagraph = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
      if (entering) {
        this.WriteString(ast.NewNodeID());
      }
      return original.call(this, node, entering);
    };
    const lute: Lute = New();
    const r = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
    assert.equal(r.refusal?.reason, "generated-id", JSON.stringify(r.refusal));
    assert.equal(r.variant, null);

    const engine: Lute = New();
    EnableIncrementalDom2Md(engine);
    try {
      const doc = html + '<p data-block="0">second</p>';
      assert.equal(engine.VditorDOM2Md(doc), New().vditorDOM2Md(doc), "the output equals the normal path");
      const s = IncrementalDom2MdStats(engine)!;
      assert.equal(s.composed, 0, "not composed");
      assert.equal(s.unsupported["generated-id"], 1, "counted as generated-id");
    } finally {
      DisableIncrementalDom2Md(engine);
    }
  } finally {
    proto.renderParagraph = original;
    ast.SetTesting(false);
  }
  assert.equal(ast.GetTesting(), false);
});

// (ii) A child whose conversion generates IDs composes when its output does not show them. The list items without a data-node-id get one
// each from adjustVditorDOMListItemInP (the empty attribute of the previous item equals the empty attribute of this one), and the output
// has no ID. Pinned on the audit corpus (markdown#17, WYSIWYG): the list of two items below.
test("(ii) a child that generates node IDs composes when the IDs are not in its output", () => {
  const html = '<ul data-tight="true" data-marker="+" data-block="0"><li data-marker="+">x</li><li data-marker="+">y</li></ul>';
  const lute: Lute = New();
  // the IDs of the child are in its handle (analyse and build collect them there)
  const a = analyse(lute, html, true, false);
  if (a.kind !== "alive") {
    assert.fail("the child is alive");
  }
  build(lute, WYSIWYG_ADAPTER, a.handle, { domPrev: -1, domNext: -1, domNextAttrs: 0 });
  const generated = a.handle.ids;
  assert.ok(generated.length > 0, "the child generated node IDs");
  const r = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
  assert.equal(r.refusal, null, JSON.stringify(r.refusal));
  const out = r.variant!.ops.map((op) => (op.kind === "Append" ? new TextDecoder().decode(op.bytes) : "")).join("");
  for (const id of generated) {
    assert.equal(out.includes(id) || out.includes(id.slice(0, 14)), false, "no ID of the child in the output");
  }

  const engine: Lute = New();
  EnableIncrementalDom2Md(engine, { strict: true, verify: true });
  try {
    assert.equal(engine.VditorDOM2Md(html), New().vditorDOM2Md(html));
    const s = IncrementalDom2MdStats(engine)!;
    assert.equal(s.composed, 1, "the call composed");
    assert.deepEqual(s.inconsistencies, {});
  } finally {
    DisableIncrementalDom2Md(engine);
  }
});

// (iv) The collector is restored when a phase throws, so that nesting keeps working: the outer collector gets only the IDs of its own scope.
test("(iv) the node ID collector is restored after a phase throws", () => {
  const outer: string[] = [];
  const inner: string[] = [];
  const previous = ast.InstallNodeIDCollector(outer);
  try {
    assert.throws(() => collectingIDs(inner, () => {
      ast.NewNodeID();
      throw new Error("a phase that fails");
    }), /a phase that fails/);
    ast.NewNodeID();
  } finally {
    ast.RemoveNodeIDCollector(previous);
  }
  assert.equal(inner.length, 1, "the inner collector got its ID");
  assert.equal(outer.length, 1, "the outer collector got the ID after the throw, and nothing of the inner scope");
  ast.NewNodeID();
  assert.equal(outer.length, 1, "after the removal nothing is collected");
});
