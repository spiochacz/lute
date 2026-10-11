// Port of test/custom_block_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, html as lutehtml, parse, render } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function count(s: string, sub: string): number {
  return s.split(sub).length - 1;
}

test("TestCustomBlockOptionAndFence", () => {
  const markdown = ";;;plugin:test\ncontent\n;;;\nafter";
  const luteEngine = New();
  let tree = parse.Parse("", enc.encode(markdown), luteEngine.ParseOptions);
  assert.notEqual(tree.Root!.FirstChild!.Type, ast.NodeCustomBlock, "custom block parsing should be disabled by default");

  luteEngine.SetCustomBlock(true);
  tree = parse.Parse("", enc.encode(markdown), luteEngine.ParseOptions);
  let customBlock = tree.Root!.FirstChild!;
  assert.ok(
    ast.NodeCustomBlock === customBlock.Type && "plugin:test" === customBlock.CustomBlockInfo && "content\n" === customBlock.TokensStr(),
    `unexpected custom block: type=${customBlock.Type}, info=${JSON.stringify(customBlock.CustomBlockInfo)}, content=${JSON.stringify(customBlock.TokensStr())}`,
  );
  assert.ok(null !== customBlock.Next && ast.NodeParagraph === customBlock.Next.Type, "an exact three-semicolon closing fence should close the custom block");
  const invalid: Record<string, string> = {
    "two-semicolon opening fence": ";;plugin:test\ncontent\n;;;",
    "four-semicolon opening fence": ";;;;plugin:test\ncontent\n;;;",
    "semicolon in info": ";;;plugin;test\ncontent\n;;;",
  };
  for (const [, input] of Object.entries(invalid)) {
    const t = parse.Parse("", enc.encode(input), luteEngine.ParseOptions);
    assert.notEqual(t.Root!.FirstChild!.Type, ast.NodeCustomBlock, `invalid opening fence parsed as a custom block: ${JSON.stringify(input)}`);
  }

  tree = parse.Parse("", enc.encode(";;;plugin:test\ncontent\n;;;;\nafter"), luteEngine.ParseOptions);
  customBlock = tree.Root!.FirstChild!;
  assert.ok(
    ast.NodeCustomBlock === customBlock.Type && null === customBlock.Next && customBlock.TokensStr().includes(";;;;\nafter"),
    `a four-semicolon line should remain custom block content: type=${customBlock.Type}, content=${JSON.stringify(customBlock.TokensStr())}`,
  );
});

test("TestCustomBlockSafeFallbackRenderers", () => {
  const luteEngine = New();
  luteEngine.SetCustomBlock(true);
  const info = 'plugin:test"\tonmouseover="alert(1)';
  const content = '<script>alert("x")</script>&amp;\n';
  const markdown = ";;;" + info + "\n" + content + ";;;";

  const outputs: Record<string, string> = {
    Protyle: luteEngine.Md2BlockDOM(markdown, false),
    HTML: luteEngine.MarkdownStr("", markdown),
    "Protyle preview": luteEngine.ProtylePreviewStr("", markdown),
  };
  let tree = parse.Parse("", enc.encode(markdown), luteEngine.ParseOptions);
  outputs["Protyle export"] = dec.decode(render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render());
  tree = parse.Parse("", enc.encode(markdown), luteEngine.ParseOptions);
  outputs["Docx export"] = dec.decode(render.NewProtyleExportDocxRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render());

  const escapedInfo = lutehtml.EscapeHTMLStr(info);
  const escapedContent = lutehtml.EscapeHTMLStr(content);
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!output.includes('onmouseover="'), `${name} contains an injected event attribute:\n${output}`);
    assert.ok(output.includes('data-info="' + escapedInfo + '"'), `${name} did not escape custom block info:\n${output}`);
    assert.ok(!output.includes("<script>") && output.includes("<pre>" + escapedContent + "</pre>"), `${name} did not render a safe visible fallback:\n${output}`);
  }

  const protyle = outputs["Protyle"]!;
  const rootTag = protyle.slice(0, protyle.indexOf(">"));
  assert.equal(count(rootTag, 'data-type="NodeCustomBlock"'), 1, `Protyle custom block should contain one data-type attribute:\n${protyle}`);
  assert.ok(rootTag.includes('contenteditable="false"') && protyle.includes('class="custom-block__content"'), `Protyle custom block is missing its non-editable root or content mount:\n${protyle}`);
});

function assertCustomBlockContent(luteEngine: Lute, markdown: string, expected: string): void {
  const tree = parse.Parse("", enc.encode(markdown), luteEngine.ParseOptions);
  const node = tree.Root!.FirstChild;
  assert.ok(node !== null, `custom block missing after round trip: markdown=${JSON.stringify(markdown)}`);
  assert.ok(ast.NodeCustomBlock === node.Type && expected === node.TokensStr(), `unexpected custom block round trip: type=${node.Type}, content=${JSON.stringify(node.TokensStr())}, markdown=${JSON.stringify(markdown)}`);
}

function assertCustomBlockDOMContent(luteEngine: Lute, blockDOM: string, expected: string): void {
  const tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const node = tree.Root!.FirstChild;
  assert.ok(node !== null, `custom block missing after DOM round trip: DOM=${JSON.stringify(blockDOM)}`);
  assert.ok(ast.NodeCustomBlock === node.Type && expected === node.TokensStr(), `unexpected custom block DOM round trip: type=${node.Type}, content=${JSON.stringify(node.TokensStr())}, DOM=${JSON.stringify(blockDOM)}`);
}

test("TestCustomBlockEntityRoundTripAndRenderedSubtree", () => {
  const luteEngine = New();
  luteEngine.SetCustomBlock(true);
  const content = 'literal &amp; &quot; &#123; & <tag> "quoted"\n';
  let markdown = ";;;plugin:entity\n" + content + ";;;";
  let blockDOM = luteEngine.Md2BlockDOM(markdown, false);
  assert.ok(
    blockDOM.includes('data-content="literal &amp;amp; &amp;quot; &amp;#123; &amp; &lt;tag&gt; &quot;quoted&quot;' + '\n"'),
    `custom block data-content was not escaped exactly once:\n${blockDOM}`,
  );

  assertCustomBlockContent(luteEngine, luteEngine.BlockDOM2Md(blockDOM), content);
  assertCustomBlockDOMContent(luteEngine, luteEngine.SpinBlockDOM(blockDOM), content);

  const contentStart = blockDOM.indexOf('<div class="custom-block__content">');
  const attrStart = blockDOM.indexOf('<div class="protyle-attr"');
  assert.ok(!(0 > contentStart || contentStart >= attrStart), `unexpected custom block DOM:\n${blockDOM}`);
  const pluginRenderTree =
    '<div class="custom-block__content"><div data-node-id="rendered-child" data-type="NodeParagraph" class="p"><div contenteditable="true">PLUGIN_RENDER_TREE</div></div></div>';
  blockDOM = blockDOM.slice(0, contentStart) + pluginRenderTree + blockDOM.slice(attrStart);
  markdown = luteEngine.BlockDOM2Md(blockDOM);
  assert.ok(!markdown.includes("PLUGIN_RENDER_TREE"), `plugin render subtree leaked into Markdown:\n${markdown}`);
  assertCustomBlockContent(luteEngine, markdown, content);
  const spun = luteEngine.SpinBlockDOM(blockDOM);
  assert.ok(!spun.includes("PLUGIN_RENDER_TREE"), `plugin render subtree leaked through SpinBlockDOM:\n${spun}`);
  assertCustomBlockDOMContent(luteEngine, spun, content);
});
