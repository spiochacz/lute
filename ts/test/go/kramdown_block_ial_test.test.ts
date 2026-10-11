// Port of test/kramdown_block_ial_test.go (TestKramdownBlockIALs, TestKramdownBlockIALIDName); the tables are read from the Go source.

import { test } from "node:test";
import { New } from "../../src/index.ts";
import type { JsBuildDifference } from "./wave3_support.ts";
import { assertRows, table, withTesting } from "./wave3_support.ts";

// Row 4 of kramdownBlockIALIDNAmeTests: Go renders the fenced code block through the Chroma highlighter (class="highlight-chroma", with the
// block ID as data-block-id); the JavaScript build has no syntax highlighter, and the reference bundle and the port render a plain code block.
const JS_BUILD_DIFFERENCES: Record<string, JsBuildDifference> = {
  "4": { reference: "<pre><code>foo\n</code></pre>\n", reason: "javascript build variant has no syntax highlighting (Go: <pre data-block-id=...><code class=\"highlight-chroma\">...)" },
};

test("TestKramdownBlockIALs", () => {
  const luteEngine = New();
  luteEngine.SetKramdownBlockIAL(true);
  withTesting(() => {
    assertRows(table("kramdown_block_ial", "kramdownBlockIALTests", 26), (name, from) => luteEngine.MarkdownStr(name, from));
  });
});

test("TestKramdownBlockIALIDName", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.KramdownIALIDRenderName = "data-block-id";
  withTesting(() => {
    assertRows(table("kramdown_block_ial", "kramdownBlockIALIDNAmeTests", 5), (name, from) => luteEngine.MarkdownStr(name, from), JS_BUILD_DIFFERENCES);
  });
});
