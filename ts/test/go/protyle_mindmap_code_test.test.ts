// Port of test/protyle_mindmap_code_test.go (TestProtyleMindmapIsOrdinaryCode).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, editor, New, render } from "../../src/index.ts";
import { StringFromBytes } from "../../src/runtime/conv.ts";

test("TestProtyleMindmapIsOrdinaryCode", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  for (const source of ["", "1\n", "- Root\n  - Child\n", "\n  &lt;script&gt; &amp; `code`  \n\n"]) {
    const markdown = "```mindmap\n" + source + "```\n";
    const [dom, tree] = engine.Md2BlockDOMTree(markdown, false);
    for (const output of [dom, engine.SpinBlockDOM(dom), engine.RenderNodeBlockDOM(tree.Root!.FirstChild!)]) {
      assert.ok(
        output.includes(`class="code-block"`) && output.includes(`>mindmap</span>`) && !output.includes(`class="render-node"`) && !output.includes(`data-subtype="mindmap"`),
        `mindmap did not follow ordinary code rendering: ${output}`,
      );
      const parsed = engine.BlockDOM2Tree(output)!.Root!.FirstChild!;
      assert.ok(
        parsed.Type === ast.NodeCodeBlock &&
          StringFromBytes(parsed.ChildByType(ast.NodeCodeBlockCode)!.Tokens!) === source &&
          StringFromBytes(parsed.ChildByType(ast.NodeCodeBlockFenceInfoMarker)!.CodeBlockInfo) === "mindmap",
        `code content or language changed for ${JSON.stringify(source)}`,
      );
    }
    const renderers: Record<string, string> = {
      preview: StringFromBytes(render.NewProtylePreviewRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()),
      export: StringFromBytes(render.NewProtyleExportRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()),
      docx: StringFromBytes(render.NewProtyleExportDocxRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()),
    };
    for (const [name, output] of Object.entries(renderers)) {
      assert.ok(!output.includes(`data-subtype="mindmap"`) && output.includes(`class="code-block`), `${name} still renders mindmap as a diagram: ${output}`);
    }
    const md = engine.BlockDOM2StdMd(dom);
    assert.ok(md.includes(source) && md.includes("```mindmap"), `Markdown export lost literal code: ${JSON.stringify(md)}`);
    for (const output of [engine.BlockDOM2HTML(dom), engine.BlockDOM2RichHTML(dom)]) {
      assert.ok(!output.includes("data-code=") && output.includes("<pre"), `HTML export must contain ordinary code: ${output}`);
    }
  }
  const caret = engine.Md2BlockDOM("```mindmap\n1" + editor.Caret + "2\n```", false);
  const output = engine.SpinBlockDOM(caret);
  assert.ok(output.includes("<wbr>") && !output.includes(`class="render-node"`), `editing must retain the caret inside a code block: ${output}`);
});
