// Port of test/strikethrough_test.go. Tables are read from cases/strikethrough_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestStrikethrough", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.GFMStrikethrough = true;
  for (const [name, from, to] of goTable("strikethrough_test", "strikethroughTests", 3)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestStrikethroughDisabled", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.GFMStrikethrough = false;
  for (const [name, from, to] of goTable("strikethrough_test", "strikethroughDisabledTests", 3)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestFullWidthStrikethrough", () => {
  const luteEngine = New();
  luteEngine.SetFullWidthStrikethrough(true);

  const tests: [string, string, string][] = [
    ["full-width", "～～foo～～", "<p><del>foo</del></p>\n"],
    ["suffix", "～～foo～～111", "<p><del>foo</del>111</p>\n"],
    ["ascii", "~~foo~~111", "<p><del>foo</del>111</p>\n"],
    ["mixed-open", "～～foo~~", "<p><del>foo</del></p>\n"],
    ["mixed-close", "~~foo～～", "<p><del>foo</del></p>\n"],
    ["single", "～foo～", "<p>～foo～</p>\n"],
    ["triple", "～～～foo～～～", "<p>～～～foo～～～</p>\n"],
    ["code", "`～～foo～～`", "<p><code>～～foo～～</code></p>\n"],
  ];
  for (const [name, from, to] of tests) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }

  const formatted = luteEngine.FormatStr("full-width-format", "～～foo～～");
  assert.equal(formatted, "~~foo~~\n", `full-width strikethrough markers were not normalized, got ${JSON.stringify(formatted)}`);
});

test("TestFullWidthStrikethroughDisabled", () => {
  const luteEngine = New();
  luteEngine.SetFullWidthStrikethrough(false);

  const html = luteEngine.MarkdownStr("full-width-disabled", "～～foo～～");
  assert.equal(html, "<p>～～foo～～</p>\n", `disabled full-width strikethrough was parsed, got ${JSON.stringify(html)}`);
});

test("TestSpinBlockDOMFullWidthStrikethrough", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetSpin(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetFullWidthStrikethrough(true);

  const dom = `<div data-node-id="20260808120000-abcdefg" data-node-index="1" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">～～foo～～<wbr>111</div><div class="protyle-attr" contenteditable="false">​</div></div>`;
  let spun = luteEngine.SpinBlockDOM(dom);
  assert.ok(spun.includes(`<span data-type="s">foo</span><wbr>111`), `full-width strikethrough was not parsed around the caret, got ${JSON.stringify(spun)}`);

  luteEngine.SetFullWidthStrikethrough(false);
  spun = luteEngine.SpinBlockDOM(dom);
  assert.ok(spun.includes(`～～foo～～<wbr>111`), `disabled full-width strikethrough changed the source text, got ${JSON.stringify(spun)}`);
});
