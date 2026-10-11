// Port of test/block_ref_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("block_ref_test");

test("TestBlockRef", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.BlockRef = true;
  markdownTable(luteEngine, rows(cases, "blockRefTests", 5));
});
