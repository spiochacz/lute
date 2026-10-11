// Port of parse/html_text_style_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, parse } from "../../src/index.ts";
import * as atom from "../../src/html/atom/index.ts";

function style(color: string, family: string, size: number, sizeUnit: string, background = ""): parse.HTMLTextStyle {
  const s = new parse.HTMLTextStyle();
  s.Color = color;
  s.Background = background;
  s.Family = family;
  s.Size = size;
  s.SizeUnit = sizeUnit;
  return s;
}

function nodeWithStyle(tag: atom.Atom, val: string): html.Node {
  const n = new html.Node();
  n.DataAtom = tag;
  const attr = new html.Attribute();
  attr.Key = "style";
  attr.Val = val;
  n.Attr = [attr];
  return n;
}

test("TestResolveHTMLTextStyle", async (t) => {
  const parent = style("red", "Arial", 24, "px");
  const cases: { name: string; style: string; tag: atom.Atom; want: parse.HTMLTextStyle }[] = [
    { name: "inherit", style: "", tag: atom.Span, want: parent },
    { name: "small", style: "", tag: atom.Small, want: style("red", "Arial", 20, "px") },
    { name: "explicit small", style: "font-size:18px", tag: atom.Small, want: style("red", "Arial", 18, "px") },
    { name: "percentage", style: "font-size:50%", tag: atom.Span, want: style("red", "Arial", 12, "px") },
    { name: "em", style: "font-size:1.5em", tag: atom.Span, want: style("red", "Arial", 36, "px") },
    { name: "pt", style: "font-size:12pt", tag: atom.Span, want: style("red", "Arial", 16, "px") },
    { name: "priority", style: "COLOR: blue !important;color: green;background-color:currentColor", tag: atom.Span, want: style("blue", "Arial", 24, "px", "blue") },
    { name: "family", style: `font-family: 'Noto Sans', "Microsoft YaHei", sans-serif`, tag: atom.Span, want: style("red", `'Noto Sans', "Microsoft YaHei", sans-serif`, 24, "px") },
    {
      name: "unsafe",
      style: `color:url(https://example.com);background-color:expression(alert(1));font-family:"x";position:fixed;font-size:calc(1px + 2px)`,
      tag: atom.Span,
      want: style("red", `"x"`, 24, "px"),
    },
  ];
  for (const tc of cases) {
    await t.test(tc.name, () => {
      const got = parse.ResolveHTMLTextStyle(nodeWithStyle(tc.tag, tc.style), parent);
      assert.deepEqual(got, tc.want, `got ${JSON.stringify(got)}, want ${JSON.stringify(tc.want)}`);
      assert.ok(!got.CSS().includes("position"), "layout style leaked");
    });
  }
});

test("TestHTMLStyleDeclarations", () => {
  const got = parse.HTMLStyleDeclarations(`font-family:"A;B";color:rgb(1, 2, 3); COLOR:blue ! important;color:red;`);
  assert.ok(got.get("font-family") === `"A;B"` && got.get("color") === "blue", JSON.stringify([...got]));
});

test("TestHTMLBackgroundShorthand", () => {
  const cases: { css: string; expected: string }[] = [
    { css: "background-color:red;background:blue", expected: "blue" },
    { css: "background:blue;background-color:red", expected: "red" },
    { css: "background:blue!important;background-color:red", expected: "blue" },
    { css: "background-color:red!important;background:blue", expected: "red" },
    { css: "background:rgb(255,165,61)", expected: "rgb(255,165,61)" },
    { css: "background:url(https://example.com/image.png)", expected: "" },
  ];
  for (const tc of cases) {
    // Go builds &html.Node{Attr: ...} without DataAtom (zero value)
    const n = new html.Node();
    const attr = new html.Attribute();
    attr.Key = "style";
    attr.Val = tc.css;
    n.Attr = [attr];
    const got = parse.ResolveHTMLTextStyle(n, new parse.HTMLTextStyle());
    assert.equal(got.Background, tc.expected, `${tc.css}: got ${JSON.stringify(got.Background)}, want ${JSON.stringify(tc.expected)}`);
  }
});
