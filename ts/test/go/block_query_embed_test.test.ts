// Port of test/block_query_embed_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("block_query_embed_test");

test("TestBlockQueryEmbed", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.BlockRef = true;
  markdownTable(luteEngine, rows(cases, "blockQueryEmbedTests", 1));
});
