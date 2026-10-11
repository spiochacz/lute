// Port of test/mark_test.go (TestMark, TestMarkDisable); the tables are read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestMark", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.Mark = true;
  for (const [name, from, to] of table("mark", "markTests", 13)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});

test("TestMarkDisable", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.Mark = false;
  for (const [name, from, to] of table("mark", "markDisableTests", 8)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});
