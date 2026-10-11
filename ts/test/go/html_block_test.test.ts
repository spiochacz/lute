// Port of test/html_block_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("html_block_test");

test("TestHTMLBlockDataContentRoundTrip", () => {
  const luteEngine = New();
  const content = rows(cases, "content", 1)[0]![0]!;
  assert.equal(content, '<div title="&quot;">&lt;test&gt; &amp; &#x3C;</div>');
  // The block DOM literal of the Go test is read from the Go source by the extractor.
  let blockDOM = rows(cases, "blockDOM", 1)[0]![0]!;
  for (let i = 0; i < 3; i++) {
    const tree = luteEngine.BlockDOM2Tree(blockDOM);
    const node = tree!.Root!.FirstChild;
    assert.ok(node !== null, `round trip [${i}] failed: HTML block node is missing`);
    const got = node.TokensStr();
    assert.equal(got, content, `round trip [${i}] failed`);
    blockDOM = luteEngine.RenderNodeBlockDOM(node);
  }
});

test("TestHTMLBlockOpenTagConsumesWholeLine", () => {
  const luteEngine = New();
  luteEngine.SetSoftBreak2HardBreak(false);
  for (const [name, markdown, html] of rows(cases, "openTag", 3)) {
    assert.equal(luteEngine.MarkdownStr(name!, markdown!), html, name);
  }
});
