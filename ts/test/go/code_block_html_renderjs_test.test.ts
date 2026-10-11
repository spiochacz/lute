// Port of test/code_block_html_renderjs_test.go (Go build tag `javascript`: the variant the port implements).
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("code_block_html_renderjs_test");

test("TestJSCodeBlock", () => {
  const luteEngine = New();
  markdownTable(luteEngine, rows(cases, "jsCodeBlockTests", 1));
});
