// Port of test/html_entity_test.go.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("html_entity_test");

test("TestHTMLEntity", () => {
  const luteEngine = New();
  markdownTable(luteEngine, rows(cases, "htmlEntityTests", 1));
});
