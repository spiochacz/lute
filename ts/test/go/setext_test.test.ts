// Port of test/setext_test.go. Tables are read from cases/setext_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestSetext", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  for (const [name, from, to] of goTable("setext_test", "setextTests", 1)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestDisableSetext", () => {
  const luteEngine = New();
  luteEngine.SetSetext(false);
  for (const [name, from, to] of goTable("setext_test", "setextDisableTests", 1)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

