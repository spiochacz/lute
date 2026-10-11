// Port of test/supsub_test.go. Tables are read from cases/supsub_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestSupSub", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.Sup = true;
  luteEngine.ParseOptions.Sub = true;
  for (const [name, from, to] of goTable("supsub_test", "supsubTests", 10)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

