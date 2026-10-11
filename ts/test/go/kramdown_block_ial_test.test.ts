// Port of test/kramdown_block_ial_test.go (TestKramdownBlockIALs, TestKramdownBlockIALIDName); the tables are read from the Go source.

import { test } from "node:test";
import { New } from "../../src/index.ts";
import type { JsBuildDifference } from "./wave3_support.ts";
import { assertRows, table, withTesting } from "./wave3_support.ts";

// Row 4 of kramdownBlockIALIDNAmeTests: Go renders the fenced code block through the Chroma highlighter (class="highlight-chroma"). The JavaScript
// build has no syntax highlighter, so the reference and the port render a plain code block, but the block attributes stay on the pre element as in
// native Go (deliberate departure, tasks/002-upstream-bugs.md item 59; oracle patch 0001).
const JS_BUILD_DIFFERENCES: Record<string, JsBuildDifference> = {
  "4": { reference: "<pre data-block-id=\"20201105103725-3ad5wcz\"><code>foo\n</code></pre>\n", reason: "javascript build variant has no syntax highlighting (Go: <pre data-block-id=...><code class=\"highlight-chroma\">...)" },
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
