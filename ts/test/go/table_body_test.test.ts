// Port of test/table_body_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, render } from "../../src/index.ts";
import { StringFromBytes } from "../../src/runtime/conv.ts";

test("TestTableRenderersOmitEmptyBody", () => {
  const luteEngine = New();
  const [blockDOM, tree] = luteEngine.Md2BlockDOMTree("| foo |\n| --- |\n", false);
  const outputs: Record<string, string> = {
    "block DOM": blockDOM,
    preview: luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions),
    export: StringFromBytes(render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
  };
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!(output.includes("<tbody") || output.includes("</tbody>")), `${name} contains an empty table body: ${JSON.stringify(output)}`);
  }
});

test("TestTableRenderersKeepNonemptyBody", () => {
  const luteEngine = New();
  const [blockDOM, tree] = luteEngine.Md2BlockDOMTree("| foo |\n| --- |\n| bar |\n", false);
  const outputs: Record<string, string> = {
    "block DOM": blockDOM,
    preview: luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions),
    export: StringFromBytes(render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
  };
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!(!output.includes("<tbody") || !output.includes("</tbody>")), `${name} omits a nonempty table body: ${JSON.stringify(output)}`);
  }
});
