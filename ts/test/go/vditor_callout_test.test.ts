// Port of test/vditor_callout_test.go (all three modes: WYSIWYG, IR and SV, plus the type attribute escaping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, html, util } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

function newVditorCalloutLute(): Lute {
  const luteEngine = New();
  luteEngine.SetCallout(true);
  luteEngine.SetSanitize(true);
  return luteEngine;
}

function browserTextContent(node: html.Node | null): string {
  let ret = "";
  if (node === null) {
    return ret;
  }
  if (html.TextNode === node.Type) {
    return node.Data;
  }
  for (let child = node.FirstChild; child !== null; child = child.NextSibling) {
    ret += browserTextContent(child);
  }
  return ret;
}

test("TestVditorCalloutRoundTrip", () => {
  const markdowns = [
    "> [!NOTE]\n> Content",
    "> [!TIP] Custom **title**\n> First\n>\n> Second",
    "> [!CUSTOM] ✂️ Custom title\n> * List\n>   > [!WARNING]\n>   > Nested",
    "> [!IMPORTANT] ![callout-icon](<https://example.com/icon.png>) Image\n> Content",
  ];

  for (const markdown of markdowns) {
    const luteEngine = newVditorCalloutLute();
    const expected = luteEngine.Md2HTML(markdown);

    const wysiwygDOM = luteEngine.Md2VditorDOM(markdown);
    assert.ok(!(wysiwygDOM.includes("not found render function") || !wysiwygDOM.includes('data-type="callout"')), `unexpected WYSIWYG DOM for ${JSON.stringify(markdown)}:\n${wysiwygDOM}`);
    const wysiwygMarkdown = luteEngine.VditorDOM2Md(wysiwygDOM);
    assert.equal(luteEngine.Md2HTML(wysiwygMarkdown), expected, `WYSIWYG round trip failed for ${JSON.stringify(markdown)}\nmarkdown:\n${wysiwygMarkdown}`);

    const irDOM = luteEngine.Md2VditorIRDOM(markdown);
    assert.ok(!(irDOM.includes("not found render function") || !irDOM.includes('data-type="callout"')), `unexpected IR DOM for ${JSON.stringify(markdown)}:\n${irDOM}`);
    const irMarkdown = luteEngine.VditorIRDOM2Md(irDOM);
    assert.equal(luteEngine.Md2HTML(irMarkdown), expected, `IR round trip failed for ${JSON.stringify(markdown)}\nmarkdown:\n${irMarkdown}`);

    const svDOM = luteEngine.Md2VditorSVDOM(markdown);
    assert.ok(!(svDOM.includes("not found render function") || !svDOM.includes("[!")), `unexpected SV DOM for ${JSON.stringify(markdown)}:\n${svDOM}`);
    const svMarkdown = browserTextContent(util.ParseHTML(svDOM));
    assert.equal(luteEngine.Md2HTML(svMarkdown), expected, `SV round trip failed for ${JSON.stringify(markdown)}\nDOM:\n${svDOM}\nmarkdown:\n${JSON.stringify(svMarkdown)}`);
  }
});

test("TestCalloutTypeAttributeEscaping", () => {
  const luteEngine = newVditorCalloutLute();
  const markdown = '> [!" onclick="alert(1)] Title\n> Content';
  const blockDOM = luteEngine.Md2BlockDOM(markdown, false);
  const outputs: Record<string, string> = {
    HTML: luteEngine.Md2HTML(markdown),
    WYSIWYG: luteEngine.Md2VditorDOM(markdown),
    IR: luteEngine.Md2VditorIRDOM(markdown),
    BlockDOM: blockDOM,
    "Protyle preview": luteEngine.ProtylePreviewStr("", markdown),
    "Protyle export": luteEngine.BlockDOM2HTML(blockDOM),
  };
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!output.includes(' onclick="'), `${name} contains an injected event attribute:\n${output}`);
  }
});
