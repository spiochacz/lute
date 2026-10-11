// Port of test/html_text_style_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, parse } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("html_text_style_test");
const enc = new TextEncoder();

test("TestHTMLTextStyle", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetHTMLTag2TextMark(true);
  engine.SetKramdownIAL(true);
  for (const row of rows(cases, "textStyle", 8)) {
    const name = row[0]!;
    const input = row[1]!;
    const expected = row[2] as unknown as string[];
    const output = engine.HTML2BlockDOM(input);
    assert.ok(!output.includes('data-href=""'), `${name}: empty link in ${output}`);
    for (const e of expected) {
      assert.ok(output.includes(e), `${name}: missing ${JSON.stringify(e)} in ${output}`);
    }
  }
});

test("TestHTMLTextStyleRoundTrip", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetHTMLTag2TextMark(true);
  engine.SetKramdownIAL(true);
  const input = '<p><span style="color:red;font-family:Arial;font-size:24px">A<strong>B</strong><a href="https://example.com">C</a><small>D</small></span></p>';
  let blockDOM = engine.HTML2BlockDOM(input);
  for (let i = 0; i < 3; i++) {
    blockDOM = engine.SpinBlockDOM(blockDOM);
    for (const expected of ["color: red;", "font-family: Arial;", "font-size: 24.000000px;", "font-size: 20.000000px;", 'data-href="https://example.com"']) {
      assert.ok(blockDOM.includes(expected), `round ${i} lost ${JSON.stringify(expected)}: ${blockDOM}`);
    }
  }
});

test("TestHTMLQuotedFontFamilyRoundTrip", () => {
  const engine = New();
  engine.SetHeadingID(false);
  engine.SetProtyleWYSIWYG(true);
  engine.SetHTMLTag2TextMark(true);
  engine.SetKramdownIAL(true);
  engine.SetAutoSpace(false);
  for (const input of [
    `<p style='color:red;font-family:"Mona Sans VF", "Segoe UI", Arial;font-size:14px'>before <strong>bold</strong> after</p>`,
    `<h2 style="color:red;font-family:&quot;Mona Sans VF&quot;, &quot;Segoe UI&quot;, Arial;font-size:14px">before <strong>bold</strong> after</h2>`,
    `<table><tr><td style='color:red;font-family:"Mona Sans VF", "Segoe UI", Arial;font-size:14px'>before <strong>bold</strong> after</td></tr></table>`,
  ]) {
    let dom = engine.HTML2BlockDOM(input);
    for (let i = 0; i < 3; i++) {
      assert.ok(!dom.includes("{: style="), `round ${i} leaked attributes: ${dom}`);
      const tree = engine.BlockDOM2Tree(dom)!;
      let styled = 0;
      ast.Walk(tree.Root!, (n, entering) => {
        if (entering && n.Type === ast.NodeTextMark) {
          styled++;
          const style = n.IALAttr("style");
          for (const want of ['font-family: "Mona Sans VF", "Segoe UI", Arial;', "color: red;", "font-size: 14.000000px;"]) {
            assert.ok(style.includes(want), `round ${i} lost ${JSON.stringify(want)}: ${dom}`);
          }
          if (n.TextMarkTextContent === "bold") {
            assert.ok(n.ContainTextMarkTypes("strong"), `bold was lost: ${dom}`);
          }
        }
        return ast.WalkContinue;
      });
      assert.ok(styled >= 3, `text fragments were lost: ${dom}`);
      dom = engine.SpinBlockDOM(dom);
    }
  }
});

test("TestMarkdownHTMLStyleBoundaries", () => {
  const engine = New();
  for (const input of ["`<small>x</small>`", "```html\n<small>x</small>\n```", "before <small>unclosed"]) {
    const tree = parse.Parse("", enc.encode(input), engine.ParseOptions);
    parse.NormalizeInlineHTMLTextStyles(tree);
    ast.Walk(tree.Root!, (n, entering) => {
      assert.ok(!(entering && n.Type === ast.NodeTextMark && n.IALAttr("style") !== ""), `unexpected style in ${input}`);
      return ast.WalkContinue;
    });
  }
  let input = '<small>A &amp; <a href="java&#x09;script:alert(1)">B</a></small>';
  let tree = parse.Parse("", enc.encode(input), engine.ParseOptions);
  parse.NormalizeInlineHTMLTextStyles(tree);
  ast.Walk(tree.Root!, (n, entering) => {
    assert.ok(!(entering && n.Type === ast.NodeTextMark && n.TextMarkAHref !== ""), "unsafe link retained");
    return ast.WalkContinue;
  });
  input = '<span data-type="block-ref" data-id="20260101000000-abcdefg">reference</span> <small>small</small>';
  tree = parse.Parse("", enc.encode(input), engine.ParseOptions);
  parse.NormalizeInlineHTMLTextStyles(tree);
  let protected_ = false;
  ast.Walk(tree.Root!, (n, entering) => {
    if (entering && n.Type === ast.NodeInlineHTML && n.TokensStr().includes('data-type="block-ref"')) {
      protected_ = true;
    }
    return ast.WalkContinue;
  });
  assert.ok(protected_, "native text mark was consumed by external style conversion");
});

test("TestMarkdownHTMLTextStyle", () => {
  const engine = New();
  for (const input of ["A<small>B **C** <small>D</small> [E](https://example.com)</small>F", 'A<span style="color:red;font-family:Arial">B<strong>C</strong></span>F']) {
    const tree = parse.Parse("", enc.encode(input), engine.ParseOptions);
    parse.NormalizeInlineHTMLTextStyles(tree);
    let styled = 0;
    ast.Walk(tree.Root!, (n, entering) => {
      if (entering && n.Type === ast.NodeTextMark && n.IALAttr("style") !== "") {
        styled++;
      }
      assert.ok(!(entering && n.Type === ast.NodeInlineHTML), `unconverted HTML: ${n.TokensStr()}`);
      return ast.WalkContinue;
    });
    assert.ok(styled !== 0, `no styled text: ${input}`);
  }
});
