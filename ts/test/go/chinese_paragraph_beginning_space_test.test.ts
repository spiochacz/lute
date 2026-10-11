// Port of test/chinese_paragraph_beginning_space_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("chinese_paragraph_beginning_space_test");

test("TestChineseParagraphBeginningSpace", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.ChineseParagraphBeginningSpace = true;
  markdownTable(luteEngine, rows(cases, "chineseParagraphBeginningSpaceTests", 5));
});
