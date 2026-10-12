// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Generated node IDs (section 3.6): a phase that creates a node ID (ast.NewNodeIDCalls moved) refuses its child as generated-id. The refusal does
// not look at the output, and the global testing flag of the node IDs is never touched by the cache. The NC14 unit test (a renderer that writes a
// new ID) is in context_channels.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "../../src/ast/index.ts";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { WYSIWYG_ADAPTER, runChild } from "../../src/incremental/sandbox.ts";
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

test("a child whose DOM pass creates a node ID is refused as generated-id, even when the output has no ID", () => {
  const lute: Lute = New();
  // two list items with the same data-node-id: adjustVditorDOMListItemInP regenerates the second ID (NewNodeID), the output has no ID
  const html = '<ul data-block="0"><li data-node-id="20200101010101-aaaaaaa">a</li><li data-node-id="20200101010101-aaaaaaa">b</li></ul>';
  const r = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
  assert.equal(r.refusal?.reason, "generated-id", JSON.stringify(r.refusal));
  assert.equal(r.variant, null);
});
