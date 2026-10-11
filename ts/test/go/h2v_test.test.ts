// Port of test/h2v_test.go (also e2e/root/vditor_wysiwyg_go.test.ts, which asserts only the shape of the ToC output).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { checkTable, goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("h2v_test");

test("TestHTML2VditorDOM", () => {
  const luteEngine = New();
  checkTable(rows(cases, "html2VditorDOMTests", 6), (_name, from) => luteEngine.HTML2VditorDOM(from));
});

test("TestHTML2VditorDOMToC", () => {
  const luteEngine = New();
  luteEngine.SetToC(true);
  const from = rows(cases, "tocFrom", 1)[0]![0]!;
  const expected = rows(cases, "tocExpected", 1)[0]![0]!;
  const result = luteEngine.HTML2VditorDOM(from);
  assert.equal(result, expected, "failed\nexpected\n\t" + JSON.stringify(expected) + "\ngot\n\t" + JSON.stringify(result) + "\noriginal html\n\t" + JSON.stringify(from));
});
