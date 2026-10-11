// Port of test/autolink_test.go. Expected values: the Go table, extracted by tools/go-tests/extract-wave-a.mjs.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("autolink_test");

test("TestAutoLink", () => {
  const luteEngine = New();
  luteEngine.SetAutoSpace(true);
  markdownTable(luteEngine, rows(cases, "autoLinkTests", 34));
});
