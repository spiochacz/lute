// Port of test/gitconflict_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("gitconflict_test");

test("TestGitConflict", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.GitConflict = true;
  markdownTable(luteEngine, rows(cases, "gitConflictTests", 1));
});
