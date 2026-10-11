// Port of test/term_typo_test.go. Tables are read from cases/term_typo_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestTermTypo", () => {
  const luteEngine = New();
  luteEngine.SetAutoSpace(true);
  luteEngine.SetFixTermTypo(true);
  luteEngine.PutTerms(new Map([["customtest", "CUSTOMtest"]])); // per engine: RenderOptions.Terms is created by New(), nothing leaks
  for (const [name, from, to] of goTable("term_typo_test", "termTypoTests", 8)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestTermTypoFormat", () => {
  const luteEngine = New();
  luteEngine.SetAutoSpace(true);
  luteEngine.SetFixTermTypo(true);
  // luteEngine.PutTerms(...) is commented out in the Go test
  for (const [name, from, to] of goTable("term_typo_test", "termTypoFormatTests", 1)) {
    const html = luteEngine.FormatStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

