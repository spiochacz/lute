// Port of test/mindmap_test.go (TestMindmap); the table is read from the Go source (editor.Caret is decoded by the extractor).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestMindmap", () => {
  const luteEngine = New();
  for (const [name, from, to] of table("mindmap", "mindmapTests", 3)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});
