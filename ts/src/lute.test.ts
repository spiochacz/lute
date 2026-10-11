import { test } from "node:test";
import assert from "node:assert/strict";
import * as conv from "./runtime/conv.ts";
import * as ast from "./ast/index.ts";
import * as parse from "./parse/index.ts";
import { FormatNodeSync, New, ProtyleExportMdNodeSync } from "./index.ts";

// The engine methods of lute.go that the reference bundle does not export (FormatNodeSync, ProtyleExportMdNodeSync) and the shapes of the others.
// The comparisons with the reference bundle are in test/e2e/renderers/.

test("Format and FormatStr agree", () => {
  const lute = New();
  const markdown = "# t\n\n*  a\n*  b\n";
  const bytes = lute.Format("", conv.BytesFromString(markdown));
  assert.equal(conv.StringFromBytes(bytes), lute.FormatStr("", markdown));
  assert.equal(lute.FormatStr("", markdown), "# t\n\n* a\n* b\n");
});

test("TextBundleStr returns [text, originalLinks]; originalLinks is null when nothing was replaced", () => {
  const lute = New();
  const [text, links] = lute.TextBundleStr("", "[a](http://x/y)\n", ["http://x"]);
  assert.equal(text, "[a](assets/y)\n");
  assert.deepEqual(links, ["http://x/y"]);
  const [text2, links2] = lute.TextBundleStr("", "a\n", ["http://x"]);
  assert.equal(text2, "a\n");
  assert.equal(links2, null);
  const [bytes, links3] = lute.TextBundle("", conv.BytesFromString("[a](http://x/y)\n"), ["http://x"]);
  assert.equal(conv.StringFromBytes(bytes), "[a](assets/y)\n");
  assert.deepEqual(links3, ["http://x/y"]);
});

test("RenderJSON and ProtylePreviewStr render something", () => {
  const lute = New();
  assert.ok(lute.RenderJSON("# t\n").startsWith("{"));
  assert.ok(lute.ProtylePreviewStr("", "# t\n").includes("<h1"));
});

test("FormatNodeSync and ProtyleExportMdNodeSync reuse one renderer and leave it clean", () => {
  const lute = New();
  const tree = parse.Parse("", conv.BytesFromString("# t\n\n* a\n* b\n"), lute.ParseOptions);
  const heading = tree.Root!.FirstChild!;
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(FormatNodeSync(heading, lute.ParseOptions, lute.RenderOptions), ["# t", null]);
    assert.deepEqual(ProtyleExportMdNodeSync(heading, lute.ParseOptions, lute.RenderOptions), ["# t", null]);
  }
  const list = heading.Next!;
  assert.deepEqual(FormatNodeSync(list, lute.ParseOptions, lute.RenderOptions), ["* a\n* b", null]);
});

test("FormatNodeSync reports a node type without a renderer", () => {
  const lute = New();
  const [, err] = FormatNodeSync(new ast.Node(ast.NodeTypeMaxVal), lute.ParseOptions, lute.RenderOptions);
  assert.ok(err instanceof Error);
  assert.match(err.message, /^not found renderer for node \[type=/);
});
