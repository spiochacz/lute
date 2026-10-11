// Port of test/render_list_style_test.go. TestRenderListStyleVditor is already ported in test/e2e/root/vditor_wysiwyg_go.test.ts;
// this file ports TestRenderListStyle and TestRenderListStyleVditorIR. The tables are read from the Go source.

import { test } from "node:test";
import { New } from "../../src/index.ts";
import { assertRows, table } from "./wave3_support.ts";

test("TestRenderListStyle", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.RenderListStyle = true;
  assertRows(table("render_list_style", "renderListStyleTests", 5), (name, from) => luteEngine.MarkdownStr(name, from));
});

test("TestRenderListStyleVditorIR", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.RenderListStyle = true;
  assertRows(table("render_list_style", "renderListStyleVditorIRTests", 5), (_name, from) => luteEngine.SpinVditorIRDOM(from));
});
