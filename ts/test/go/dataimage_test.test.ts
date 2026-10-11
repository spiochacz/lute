// Port of test/dataimage_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("dataimage_test");

test("TestDataImageDisable", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.DataImage = false;
  markdownTable(luteEngine, rows(cases, "dataImageTests", 1));
});
