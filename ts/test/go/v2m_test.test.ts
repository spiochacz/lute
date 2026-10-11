// Port of test/v2m_test.go. Tables are read from cases/v2m_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestVditorDOM2Md", () => {
  const luteEngine = New();
  for (const [name, from, to] of goTable("v2m_test", "vditorDOM2MdTests", 120)) {
    const md = luteEngine.VditorDOM2Md(from);
    assert.equal(md, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("TestVditorIRDOM2Md", () => {
  const luteEngine = New();
  for (const [name, from, to] of goTable("v2m_test", "vditorIRDOM2MdTests", 13)) {
    const md = luteEngine.VditorIRDOM2Md(from);
    assert.equal(md, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});
