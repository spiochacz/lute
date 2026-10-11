// Port of test/tag_test.go. Tables are read from cases/tag_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestTag", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.Tag = true;
  for (const [name, from, to] of goTable("tag_test", "tagTests", 2)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestTagDisable", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.Tag = false;
  for (const [name, from, to] of goTable("tag_test", "tagDisableTests", 1)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

