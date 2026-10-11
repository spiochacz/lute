// Port of test/data_task_test.go. TestDataTaskMd2BlockDOM is also in e2e/root/protyle_go.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("data_task_test");

test("TestDataTaskHTML", () => {
  const luteEngine = New();
  luteEngine.SetDataTask(true);
  markdownTable(luteEngine, rows(cases, "dataTaskHTMLTests", 6));
});

test("TestDataTaskDisabledHTML", () => {
  const luteEngine = New();
  // DataTask 默认为 false，无需显式设置
  markdownTable(luteEngine, rows(cases, "dataTaskDisabledHTMLTests", 2));
});

test("TestDataTaskMd2BlockDOM", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetDataTask(true);
  ast.SetTesting(true);
  try {
    for (const [name, from, to] of rows(cases, "dataTaskMd2BlockDOMTests", 2)) {
      assert.equal(luteEngine.Md2BlockDOM(from!, true), to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
    }
  } finally {
    ast.SetTesting(false);
  }
});

test("TestDataTaskNoClassHTML", () => {
  const luteEngine = New();
  luteEngine.SetDataTask(true);
  luteEngine.RenderOptions.GFMTaskListItemClass = "";
  markdownTable(luteEngine, rows(cases, "dataTaskNoClassHTMLTests", 2));
});

test("TestDataTaskCustomMarker", () => {
  const luteEngine = New();
  luteEngine.SetArbitraryTaskListItemMarker(true);
  luteEngine.SetDataTask(true);
  markdownTable(luteEngine, rows(cases, "dataTaskCustomMarkerTests", 7));
});

test("TestBlockDOM2StdMdTaskMarkerNormalization", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetDataTask(true);
  engine.SetArbitraryTaskListItemMarker(true);
  engine.SetUnorderedListMarker("-");
  const markdown = "- [ ] todo\n- [/] progress\n\n  - [-] canceled\n- [X] done\n- [!] custom\n";
  const dom = engine.Md2BlockDOM(markdown, true);
  const normalized = "- [ ] todo\n- [X] progress\n\n  - [X] canceled\n- [X] done\n- [X] custom\n";
  assert.equal(engine.BlockDOM2StdMd(dom), normalized, "default export");
  engine.SetExportNormalizeTaskListMarker(false);
  assert.equal(engine.BlockDOM2StdMd(dom), markdown, "preserved copy");
  engine.SetExportNormalizeTaskListMarker(true);
  assert.equal(engine.BlockDOM2StdMd(dom), normalized, "standard export");
});
