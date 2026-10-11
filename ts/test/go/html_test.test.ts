// Port of test/html_test.go. Go's strings.NewReader becomes the UTF-8 bytes; ParseFragment returns the nodes and the error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../../src/index.ts";
import * as atom from "../../src/html/atom/index.ts";

test("TestHTMLParse", () => {
  const htmlRoot = new html.Node();
  htmlRoot.Type = html.ElementNode;
  const [htmlNodes, err] = html.ParseFragment(new TextEncoder().encode("<p>foo</p>"), htmlRoot);
  assert.ok(null === err && 1 === htmlNodes.length, "test HTML parse failed");
  assert.equal(htmlNodes[0]!.DataAtom, atom.P, "test HTML parse failed");
});

test("TestHTMLParse0", () => {
  const htmlRoot = new html.Node();
  htmlRoot.Type = html.ElementNode;
  const [htmlNodes, err] = html.ParseFragment(new TextEncoder().encode("<p>&& &nbsp;</p>"), htmlRoot);
  assert.ok(null === err && 1 === htmlNodes.length, "test HTML parse failed");
  assert.equal(htmlNodes[0]!.DataAtom, atom.P, "test HTML parse failed");
});
