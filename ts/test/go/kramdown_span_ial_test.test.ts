// Port of test/kramdown_span_ial_test.go (TestKramdownSpanIALs); the table is read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestKramdownSpanIALs", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  luteEngine.ParseOptions.KramdownSpanIAL = true;
  luteEngine.RenderOptions.KramdownBlockIAL = false;
  luteEngine.ParseOptions.Mark = true;
  luteEngine.ParseOptions.Tag = true;
  for (const [name, from, to] of table("kramdown_span_ial", "kramdownSpanIALTests", 10)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});
