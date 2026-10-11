// Port of test/h2p_test.go. TestHTML2BlockDOM is also in e2e/root/protyle_go.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast } from "../../src/index.ts";
import { checkTable, goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("h2p_test");

test("TestHTML2BlockDOM", () => {
  const luteEngine = New();
  luteEngine.SetKramdownBlockIAL(true);
  luteEngine.SetHTML2MarkdownAttrs(["name", "custom-*"]);
  ast.SetTesting(true); // Go never resets it in this test; it is restored here
  try {
    checkTable(rows(cases, "html2BlockDOMTests", 7), (_name, from) => luteEngine.HTML2BlockDOM(from));
  } finally {
    ast.SetTesting(false);
  }
});

test("TestHTML2BlockDOMTableCaption", () => {
  const luteEngine = New();
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetHTML2MarkdownAttrs(["custom-*"]);
  ast.SetTesting(true);
  try {
    const from = rows(cases, "tableCaptionFrom", 1)[0]![0]!;
    const expected = rows(cases, "tableCaptionExpected", 1)[0]![0]!;
    const result = luteEngine.HTML2BlockDOM(from);
    assert.equal(result, expected, `expected\n\t${JSON.stringify(expected)}\ngot\n\t${JSON.stringify(result)}`);
  } finally {
    ast.SetTesting(false);
  }
});
