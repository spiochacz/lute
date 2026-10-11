// Port of test/toc_test.go. Tables are read from cases/toc_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestToC", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  luteEngine.ParseOptions.ToC = true;
  for (const [name, from, to] of goTable("toc_test", "tocTests", 2)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

