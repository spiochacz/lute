// Port of test/disable_indent_code_block_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("disable_indent_code_block_test");

test("TestDisableIndentCodeBlock", () => {
  const luteEngine = New();
  luteEngine.SetIndentCodeBlock(false);
  markdownTable(luteEngine, rows(cases, "disableIndentCodeBlockTests", 2));
});
