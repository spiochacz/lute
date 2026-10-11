// Port of test/gfm_spec_test.go.
import { test } from "node:test";
import { New, parse } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("gfm_spec_test");

test("TestGFMSpec", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.SoftBreak2HardBreak = false;
  luteEngine.RenderOptions.AutoSpace = false;
  luteEngine.RenderOptions.GFMTaskListItemClass = ""; // 关闭类名渲染
  // Package-level state: Go's parse.AddAutoLinkDomainSuffix("baz") changes the process-wide TLD list and cannot be undone
  // (the port has no removal function); it stays added for the other test files run in the same process, as in Go.
  parse.AddAutoLinkDomainSuffix("baz");
  markdownTable(luteEngine, rows(cases, "gfmSpecTests", 39));
});
