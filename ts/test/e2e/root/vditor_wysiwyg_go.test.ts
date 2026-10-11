// Ports of the Go tests that exercise the WYSIWYG methods of vditor_wysiwyg.go (SpinVditorDOM, VditorDOM2Md, Md2VditorDOM, HTML2VditorDOM, VditorDOM2HTML):
// test/spin_wysiwyg_test.go, test/v2m_test.go (TestVditorDOM2Md), test/m2v_test.go (TestMd2VditorDOM), test/h2v_test.go, and the WYSIWYG parts of
// test/sanitizer_test.go, test/render_list_style_test.go, test/vditor_callout_test.go, test/list_setext_continuation_test.go,
// test/link_base_prefix_test.go and test/table_whitespace_test.go.
// The tables are read from vditor_wysiwyg_go_cases.json, generated from the Go files by tools/extract-vditor-wysiwyg-go-tests.mjs.
// The few tests that are not tables are transcribed (they are a handful of lines each).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";

type Cases = [name: string, from: string, to: string][];
const cases = JSON.parse(readFileSync(new URL("./vditor_wysiwyg_go_cases.json", import.meta.url), "utf8")) as Record<string, Cases | string[]>;

function table(name: string): Cases {
  return cases[name] as Cases;
}

test("SpinVditorDOM: the Go test cases (test/spin_wysiwyg_test.go)", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.SetDataTask(true);
  luteEngine.ParseOptions.ToC = true;
  luteEngine.RenderOptions.Sanitize = true;
  luteEngine.SetMark(true);
  luteEngine.SetSup(true);
  luteEngine.SetSub(true);

  assert.equal(table("spinVditorDOMTests").length, 163);
  for (const [name, from, to] of table("spinVditorDOMTests")) {
    assert.equal(luteEngine.SpinVditorDOM(from), to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("SpinVditorDOM: table in list spins twice to the same result (TestSpinVditorDOMTableInList)", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  assert.equal(table("spinVditorDOMTableInListTests").length, 2);
  for (const [name, from, to] of table("spinVditorDOMTableInListTests")) {
    const once = luteEngine.SpinVditorDOM(from);
    assert.equal(once, to, `test case [${name}] failed after first spin`);
    assert.equal(luteEngine.SpinVditorDOM(once), to, `test case [${name}] failed after second spin`);
  }
});

test("VditorDOM2Md: the Go test cases (test/v2m_test.go TestVditorDOM2Md)", () => {
  const luteEngine = New();
  assert.equal(table("vditorDOM2MdTests").length, 120);
  for (const [name, from, to] of table("vditorDOM2MdTests")) {
    assert.equal(luteEngine.VditorDOM2Md(from), to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("Md2VditorDOM: the Go test cases (test/m2v_test.go TestMd2VditorDOM)", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.ParseOptions.ToC = true;
  luteEngine.RenderOptions.ToC = true;
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.Sanitize = true;

  assert.equal(table("md2VditorDOMTests").length, 26);
  for (const [name, from, to] of table("md2VditorDOMTests")) {
    assert.equal(luteEngine.Md2VditorDOM(from), to, `test case [${name}] failed, original markdown ${JSON.stringify(from)}`);
  }
});

test("HTML2VditorDOM: the Go test cases (test/h2v_test.go TestHTML2VditorDOM)", () => {
  const luteEngine = New();
  assert.equal(table("html2VditorDOMTests").length, 6);
  for (const [name, from, to] of table("html2VditorDOMTests")) {
    assert.equal(luteEngine.HTML2VditorDOM(from), to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("HTML2VditorDOM: ToC (test/h2v_test.go TestHTML2VditorDOMToC)", () => {
  const luteEngine = New();
  luteEngine.SetToC(true);
  const from = "<p>[ToC]</p><h2>教_程</h2><h2>array_contains</h2>";
  const result = luteEngine.HTML2VditorDOM(from);
  // The full expected value of the Go test is compared through the oracle in vditor_wysiwyg.test.ts; here the shape is asserted.
  assert.ok(result.includes('data-type="toc-block"'), result);
  assert.ok(result.includes('data-target-id="教程"'), result);
});

test("SpinVditorDOM: sanitizer cases (test/sanitizer_test.go TestSanitizerVditor)", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.RenderOptions.Sanitize = true;
  assert.equal(table("sanitizerVditorTests").length, 9);
  for (const [name, from, to] of table("sanitizerVditorTests")) {
    assert.equal(luteEngine.SpinVditorDOM(from), to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("SpinVditorDOM: render list style (test/render_list_style_test.go TestRenderListStyleVditor)", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.RenderListStyle = true;
  assert.equal(table("renderListStyleVditorTests").length, 5);
  for (const [name, from, to] of table("renderListStyleVditorTests")) {
    assert.equal(luteEngine.SpinVditorDOM(from), to, `test case [${name}] failed`);
  }
});

test("Vditor callout: the WYSIWYG half of TestVditorCalloutRoundTrip", () => {
  const markdowns = cases.calloutMarkdowns as string[];
  assert.equal(markdowns.length, 4);
  for (const markdown of markdowns) {
    const luteEngine = New();
    luteEngine.SetCallout(true);
    luteEngine.SetSanitize(true);
    const expected = luteEngine.Md2HTML(markdown);

    const wysiwygDOM = luteEngine.Md2VditorDOM(markdown);
    assert.ok(!wysiwygDOM.includes("not found render function") && wysiwygDOM.includes('data-type="callout"'), `unexpected WYSIWYG DOM for ${JSON.stringify(markdown)}:\n${wysiwygDOM}`);
    const wysiwygMarkdown = luteEngine.VditorDOM2Md(wysiwygDOM);
    assert.equal(luteEngine.Md2HTML(wysiwygMarkdown), expected, `WYSIWYG round trip failed for ${JSON.stringify(markdown)}\nmarkdown:\n${wysiwygMarkdown}`);
  }
});

test("Vditor callout: the type attribute is escaped in the WYSIWYG DOM (TestCalloutTypeAttributeEscaping, WYSIWYG part)", () => {
  const luteEngine = New();
  luteEngine.SetCallout(true);
  luteEngine.SetSanitize(true);
  const markdown = '> [!" onclick="alert(1)] Title\n> Content';
  assert.ok(!luteEngine.Md2VditorDOM(markdown).includes(' onclick="'));
  assert.ok(!luteEngine.Md2HTML(markdown).includes(' onclick="'));
});

test("VditorDOM2Md and SpinVditorDOM: list Setext continuation (test/list_setext_continuation_test.go TestVditorDOMListSetextContinuation)", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);

  const dom = `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li><li data-marker="*">b
-<wbr></li></ul>`;
  const markdown = luteEngine.VditorDOM2Md(dom);
  assert.equal(markdown, "* a\n* b\n  \\-\n");
  const spun = luteEngine.SpinVditorDOM(dom);
  assert.ok(!spun.includes("<h2") && spun.includes('data-type="backslash"'), spun);
});

test("Md2VditorDOM: the link base does not touch a data image (test/link_base_prefix_test.go TestVditorLinkBaseDataImage, WYSIWYG part)", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.SetLinkBase("http://domain.com/path/");
  const dom = luteEngine.Md2VditorDOM("![foo](data:image/png;base64,AAAA)");
  assert.ok(dom.includes('src="data:image/png;base64,AAAA"'), dom);
});

test("VditorDOM2Md(Md2VditorDOM): table inline whitespace (test/table_whitespace_test.go, WYSIWYG part)", () => {
  const luteEngine = New();
  const markdown = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |\n| --- |\n| x |\n";
  const expected = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |";
  const actual = luteEngine.VditorDOM2Md(luteEngine.Md2VditorDOM(markdown)).split("\n")[0];
  assert.equal(actual, expected);
});
