// Port of test/space_test.go. Tables are read from cases/space_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestAutoSpace", () => {
  const luteEngine = New();
  luteEngine.SetAutoSpace(true);
  luteEngine.ParseOptions.Mark = true;
  luteEngine.ParseOptions.Tag = true;
  for (const [name, from, to] of goTable("space_test", "spaceTests", 48)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

