// Port of test/list_setext_continuation_test.go: TestFormatListSetextContinuation, TestVditorDOMListSetextContinuation,
// TestSpinVditorSVListSetextContinuation, TestSpinVditorSVThematicBreakAtDocumentStart. (TestVditorDOMListSetextContinuation is also in
// test/e2e/root/vditor_wysiwyg_go.test.ts; this file ports the whole Go file.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, util } from "../../src/index.ts";

test("TestFormatListSetextContinuation", () => {
  const luteEngine = New();
  const tests: { name: string; markdown: string; formatted: string }[] = [
    { name: "unordered-equal", markdown: "* a\n* b\n=", formatted: "* a\n* b\n  \\=\n" },
    { name: "unordered-hyphens", markdown: "* a\n* b\n--", formatted: "* a\n* b\n  \\--\n" },
    { name: "ordered-equals", markdown: "1. a\n2. b\n===", formatted: "1. a\n2. b\n   \\===\n" },
    { name: "nested-equal", markdown: "* a\n  * b\n=", formatted: "* a\n  * b\n    \\=\n" },
    { name: "leading-space", markdown: "* a\n* b\n =", formatted: "* a\n* b\n  \\=\n" },
  ];
  for (const tc of tests) {
    const formatted = luteEngine.FormatStr(tc.name, tc.markdown);
    assert.equal(formatted, tc.formatted, `test case [${tc.name}] failed`);
    const formattedAgain = luteEngine.FormatStr(tc.name, formatted);
    assert.equal(formattedAgain, formatted, `test case [${tc.name}] is not idempotent`);
    const before = luteEngine.MarkdownStr(tc.name, tc.markdown);
    const after = luteEngine.MarkdownStr(tc.name, formatted);
    assert.equal(after, before, `test case [${tc.name}] changed semantics`);
  }

  const heading = "* a\n* b\n  =";
  assert.equal(luteEngine.FormatStr("heading", heading), "* a\n* b\n  =\n", "list Setext heading should remain a heading");
});

test("TestVditorDOMListSetextContinuation", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  const dom = `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li><li data-marker="*">b
-<wbr></li></ul>`;
  const markdown = luteEngine.VditorDOM2Md(dom);
  assert.equal(markdown, "* a\n* b\n  \\-\n");
  const spun = luteEngine.SpinVditorDOM(dom);
  assert.ok(!spun.includes("<h2") && spun.includes(`data-type="backslash"`), `list continuation should remain literal, got ${JSON.stringify(spun)}`);
});

test("TestSpinVditorSVListSetextContinuation", () => {
  const luteEngine = New();
  luteEngine.SetVditorSV(true);
  for (const marker of ["-", "--", "=", "==="]) {
    const markdown = "* a\n* b\n" + marker + "‸";
    const spun = luteEngine.SpinVditorSVDOM(markdown);
    assert.ok(!spun.includes("heading-marker") && spun.includes("\\" + marker), `marker ${JSON.stringify(marker)} should remain literal, got ${JSON.stringify(spun)}`);
    const root = util.ParseHTML(spun);
    const spunAgain = luteEngine.SpinVditorSVDOM(util.DomText(root));
    assert.ok(!spunAgain.includes("heading-marker"), `marker ${JSON.stringify(marker)} became a heading after a second spin: ${JSON.stringify(spunAgain)}`);
  }
});

test("TestSpinVditorSVThematicBreakAtDocumentStart", () => {
  const luteEngine = New();
  luteEngine.SetVditorSV(true);
  const spun = luteEngine.SpinVditorSVDOM("***\n‸");
  assert.ok(!spun.includes("yaml-front-matter") && spun.includes(">***</span>"), `thematic break should not become YAML front matter, got ${JSON.stringify(spun)}`);
  const root = util.ParseHTML(spun);
  const spunAgain = luteEngine.SpinVditorSVDOM(util.DomText(root));
  assert.ok(!spunAgain.includes("yaml-front-matter") && spunAgain.includes(">***</span>"), `thematic break became YAML front matter after a second spin: ${JSON.stringify(spunAgain)}`);
});
