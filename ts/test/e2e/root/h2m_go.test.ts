// Ports of the Go tests that exercise HTML2Md / HTML2Markdown / HTML2Tree only (plus setters and already ported code):
//   test/h2m_test.go: TestHTML2Md, TestHTML2MdLanguageMath, TestHTML2MdDisableSyntax
//   test/h2m_code_banner_test.go: the HTML2Md halves of TestHTMLCodeBlockBanner and TestHTMLCodeBlockBannerPreservesUnrecognizedContent
//   test/callout_test.go: the HTML2Md half of TestHTML2MdCallout
//   test/html_escape_test.go: TestHTML2TreeEscapedText, TestHTML2MarkdownEscapedText
//   test/table_whitespace_test.go: TestHTML2MdTableInlineWhitespace
//   test/table_alignment_style_test.go: the HTML2Markdown half of TestHTMLTableCellAlignmentDifferencesSurviveMarkdown
// The tables come from h2m_go_cases.json, written by tools/h2m-go-tests/extract.mjs from the Go sources.
// Every case is also compared with the reference bundle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { New, ast, html, parse } from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";
import { newEngines } from "../helpers.ts";
import type { SetterCall } from "../helpers.ts";

type Row = string[];
const cases = JSON.parse(readFileSync(fileURLToPath(new URL("./h2m_go_cases.json", import.meta.url)), "utf8")) as Record<string, Row[]>;

function setup(setters: SetterCall[]): { port: Lute; oracle: Record<string, (...a: unknown[]) => unknown> } {
  const e = newEngines(setters);
  return { port: e.port, oracle: e.oracle as Record<string, (...a: unknown[]) => unknown> };
}

const MAIN_SETTERS: SetterCall[] = [
  ["SetAutoSpace", true],
  ["SetSup", true],
  ["SetSub", true],
  ["SetMark", true],
  ["SetGFMStrikethrough", true],
  ["SetInlineAsterisk", true],
  ["SetInlineUnderscore", true],
  ["SetKramdownIAL", true],
  ["SetHTMLTag2TextMark", true],
];

const DISABLE_SETTERS: SetterCall[] = [
  ["SetAutoSpace", true],
  ["SetSup", false],
  ["SetSub", false],
  ["SetMark", false],
  ["SetGFMStrikethrough", false],
  ["SetInlineAsterisk", false],
  ["SetInlineUnderscore", false],
  ["SetHTMLTag2TextMark", true],
];

test("Go TestHTML2Md", () => {
  const { port, oracle } = setup(MAIN_SETTERS);
  assert.equal(cases.html2MdTests.length, 273);
  for (const [name, from, to] of cases.html2MdTests) {
    assert.equal(port.HTML2Md(from), to, `case ${name}`);
    assert.equal(oracle.HTML2Md(from), to, `oracle, case ${name}`);
  }
});

test("Go TestHTML2MdLanguageMath", () => {
  const { port, oracle } = setup([]);
  for (const [name, from, to] of cases.html2MdLanguageMathRoundTrip) {
    const htmlStr = port.Md2HTML(from);
    assert.equal(htmlStr, oracle.Md2HTML(from), `case ${name}`);
    assert.equal(port.HTML2Md(htmlStr), to, `case ${name}`);
    assert.equal(oracle.HTML2Md(htmlStr), to, `oracle, case ${name}`);
  }
  for (const [name, from, to] of cases.html2MdLanguageMathHTML) {
    assert.equal(port.HTML2Md(from), to, `case ${name}`);
    assert.equal(oracle.HTML2Md(from), to, `oracle, case ${name}`);
  }
});

test("Go TestHTML2MdDisableSyntax", () => {
  const { port, oracle } = setup(DISABLE_SETTERS);
  for (const [name, from, to] of cases.html2MdDisableSyntaxTests) {
    assert.equal(port.HTML2Md(from), to, `case ${name}`);
    assert.equal(oracle.HTML2Md(from), to, `oracle, case ${name}`);
  }
});

test("Go TestHTMLCodeBlockBanner (HTML2Md half)", () => {
  for (const [name, htmlStr, markdown] of cases.codeBanner) {
    const { port, oracle } = setup([]);
    assert.equal(port.HTML2Md(htmlStr), markdown, name);
    assert.equal(oracle.HTML2Md(htmlStr), markdown, `oracle, ${name}`);
  }
});

test("Go TestHTMLCodeBlockBannerPreservesUnrecognizedContent", () => {
  assert.equal(cases.codeBannerPreserves.length, 9);
  for (const [body] of cases.codeBannerPreserves) {
    const { port, oracle } = setup([]);
    const want = port.HTML2Md("<div>" + body + "</div>");
    assert.equal(port.HTML2Md(`<div class="md-code-block">` + body + `</div>`), want, body);
    assert.equal(oracle.HTML2Md(`<div class="md-code-block">` + body + `</div>`), want, `oracle, ${body}`);
  }
  const { port, oracle } = setup([]);
  const htmlStr = `<div class="md-code-block-other"><div class="md-code-block-banner"><span>bash</span></div><pre>echo x</pre></div>`;
  assert.ok(port.HTML2Md(htmlStr).startsWith("bash\n\n```\n"));
  assert.equal(port.HTML2Md(htmlStr), oracle.HTML2Md(htmlStr));
});

test("Go TestHTML2MdCallout (HTML2Md half)", () => {
  const { port, oracle } = setup([["SetCallout", true]]);
  for (const [name, from, to] of cases.calloutHTML2Md) {
    assert.equal(port.HTML2Md(from), to, name);
    assert.equal(oracle.HTML2Md(from), to, `oracle, ${name}`);
  }
});

test("Go TestHTML2TreeEscapedText", () => {
  for (const enabled of [true, false]) {
    const port = New();
    port.SetProtyleWYSIWYG(true);
    port.SetTextMark(true);
    port.SetHTMLTag2TextMark(true);
    port.SetInlineAsterisk(enabled);
    port.SetInlineUnderscore(enabled);
    port.SetGFMStrikethrough(enabled);
    port.SetMark(enabled);
    port.SetSup(enabled);
    port.SetSub(enabled);
    for (const tag of ["strong", "em", "s", "mark", "sup", "sub"]) {
      const source = "a = b \\= \\ *x* _y_ ~z~ $m$ ^n^ <t> `c`";
      const tree = port.HTML2Tree("<" + tag + ">" + html.EscapeHTMLStr(source) + "</" + tag + ">")!;
      parse.TextMarks2Inlines(tree);
      parse.NestedInlines2FlattedSpansHybrid(tree, false);
      let actual = "";
      ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
        if (entering && n.Type === ast.NodeTextMark) {
          assert.equal(n.TextMarkType, tag);
          actual += html.UnescapeString(n.TextMarkTextContent);
        }
        return ast.WalkContinue;
      });
      assert.equal(actual, source, `${tag}/syntax=${enabled}`);
    }
  }
});

test("Go TestHTML2MarkdownEscapedText", () => {
  const { port, oracle } = setup([["SetProtyleWYSIWYG", true]]);
  for (const [name, source, expected] of cases.escapedMarkdown) {
    const [actual, err] = port.HTML2Markdown(source);
    assert.equal(err, null);
    assert.equal(actual, expected, name);
    assert.deepEqual(oracle.HTML2Markdown(source), [expected, null], name);
  }
});

test("Go TestHTML2MdTableInlineWhitespace", () => {
  const { port, oracle } = setup([]);
  const htmlStr =
    "<table>\n<thead><tr><th>\n a <em>em</em> b <strong>strong</strong> c <code>code</code> d " +
    '<a href="https://example.com">link</a> e <del>del</del> f \n</th></tr></thead>\n' +
    "<tbody><tr><td>x</td></tr></tbody>\n</table>";
  const expected = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |";
  assert.equal(port.HTML2Md(htmlStr).split("\n")[0], expected);
  assert.equal((oracle.HTML2Md(htmlStr) as string).split("\n")[0], expected);
});

test("Go TestHTMLTableCellAlignmentDifferencesSurviveMarkdown (HTML2Markdown half)", () => {
  const { port, oracle } = setup([]);
  const input =
    `<table><thead><tr><th style="text-align: center">Header</th><th>Other</th></tr></thead>` +
    `<tbody><tr><td style="text-align: right">different</td><td>same</td></tr></tbody></table>`;
  const [markdown, err] = port.HTML2Markdown(input);
  assert.equal(err, null);
  assert.ok(markdown.includes("text-align: right;") && markdown.includes("| :-"), markdown);
  assert.equal(port.HTML2Md(input), oracle.HTML2Md(input));
});
