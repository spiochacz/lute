// Port of test/super_block_test.go. Tables are read from cases/super_block_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestSuperBlock", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  luteEngine.SetVditorIR(true);
  luteEngine.ParseOptions.SuperBlock = true;
  for (const [name, from, to] of goTable("super_block_test", "superBlockTests", 8)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

