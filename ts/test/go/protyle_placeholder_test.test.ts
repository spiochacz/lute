// Port of test/protyle_placeholder_test.go: the inline placeholder (Zwsp / WordJoiner) tests of the Protyle block DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, editor, New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { withTesting } from "./wave3_support.ts";

const count = (s: string, sub: string): number => s.split(sub).length - 1;

function newProtylePlaceholderLute(): Lute {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTag(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetHTMLTag2TextMark(true);
  luteEngine.SetAutoSpace(false);
  luteEngine.SetSpin(true);
  return luteEngine;
}

function protylePlaceholderBlockDOM(inlines: string): string {
  return (
    `<div data-node-id="20260830120000-abcdefg" data-node-index="1" data-type="NodeParagraph" class="p" updated="20260830120000"><div contenteditable="true" spellcheck="false">` +
    inlines +
    `</div><div class="protyle-attr" contenteditable="false">` +
    editor.Zwsp +
    `</div></div>`
  );
}

// Go's []rune(value) has one element per code point.
function assertSingleCodepoint(name: string, value: string, expected: number): void {
  const codepoints = Array.from(value, (c) => c.codePointAt(0));
  assert.ok(codepoints.length === 1 && expected === codepoints[0], `expected ${name} to be U+${expected.toString(16).toUpperCase().padStart(4, "0")}, got ${JSON.stringify(codepoints)}`);
}

const markers: { name: string; value: string }[] = [
  { name: "zwsp", value: editor.Zwsp },
  { name: "zero-width-no-break-space", value: "﻿" },
  { name: "word-joiner", value: editor.WordJoiner },
];

test("TestProtyleInlinePlaceholderCodepoints", () => {
  assertSingleCodepoint("Zwsp", editor.Zwsp, 0x200b);
  assertSingleCodepoint("WordJoiner", editor.WordJoiner, 0x2060);
  assert.notEqual(editor.Zwsp, editor.WordJoiner, "the external and internal placeholders must use different codepoints");
});

test("TestProtyleInlinePlaceholderRendering", async (t) => {
  const luteEngine = newProtylePlaceholderLute();
  const tests = [
    { name: "code", markdown: "a`code`b", dataType: "code", content: "code" },
    { name: "combined-code", markdown: "a**`code`**b", dataType: "strong code", content: "code" },
    { name: "kbd", markdown: "a<kbd>key</kbd>b", dataType: "kbd", content: "key" },
    { name: "tag", markdown: "a#tag#b", dataType: "tag", content: "tag" },
  ];
  for (const tc of tests) {
    await t.test(tc.name, () => {
      const dom = luteEngine.Md2BlockDOM(tc.markdown, false);
      const open = "a" + editor.Zwsp + `<span data-type="` + tc.dataType + `">` + editor.WordJoiner + tc.content;
      const close = tc.content + "</span>" + editor.Zwsp + "b";
      assert.ok(dom.includes(open) && dom.includes(close), `inline placeholder invariant failed\nexpected open ${JSON.stringify(open)} and close ${JSON.stringify(close)}\ngot ${JSON.stringify(dom)}`);
    });
  }
});

test("TestBlockDOMInlinePlaceholderCompatibility", async (t) => {
  const luteEngine = newProtylePlaceholderLute();
  const luteWithoutTextMarks = newProtylePlaceholderLute();
  luteWithoutTextMarks.SetTextMark(false);
  const containers = [
    { name: "code", open: `<span data-type="code">`, close: "</span>" },
    { name: "combined-code", open: `<span data-type="strong code">`, close: "</span>" },
    { name: "kbd-span", open: `<span data-type="kbd">`, close: "</span>" },
    { name: "kbd", open: "<kbd>", close: "</kbd>" },
    { name: "tag", open: `<span data-type="tag">`, close: "</span>" },
    { name: "code-element", open: "<code>", close: "</code>" },
  ];
  for (const marker of markers) {
    for (const container of containers) {
      await t.test(marker.name + "/" + container.name, () => {
        const inlines = "outside" + editor.WordJoiner + container.open + marker.value + "value" + editor.WordJoiner + "tail" + container.close;
        const tree = luteEngine.BlockDOM2Tree(protylePlaceholderBlockDOM(inlines))!;
        let content = "";
        ast.Walk(tree.Root!, (node, entering) => {
          if (entering && ast.NodeTextMark === node.Type && "" === content) {
            content = node.TextMarkTextContent;
          }
          return ast.WalkContinue;
        });
        assert.equal(content, "value" + editor.WordJoiner + "tail", "text mark content");
        assert.equal(tree.Root!.Text(), "outside" + editor.WordJoiner + content, "AST text");
        const withoutTextMarks = luteWithoutTextMarks.BlockDOM2Md(protylePlaceholderBlockDOM(inlines));
        assert.ok(
          withoutTextMarks.includes("value" + editor.WordJoiner + "tail") &&
            2 === count(withoutTextMarks, editor.WordJoiner) &&
            !withoutTextMarks.includes("﻿") &&
            !withoutTextMarks.includes(editor.Zwsp),
          `placeholder normalization without TextMark failed: ${JSON.stringify(withoutTextMarks)}`,
        );
      });
    }
  }
});

test("TestBlockDOMInlinePlaceholderNormalizationIsScoped", () => {
  const luteEngine = newProtylePlaceholderLute();
  const inlines =
    "outside" +
    editor.WordJoiner +
    `<span data-type="strong">` +
    editor.WordJoiner +
    "strong</span>" +
    `<kbd><span>foo</span>` +
    editor.WordJoiner +
    `bar</kbd>` +
    `<kbd>` +
    editor.WordJoiner +
    `outer<code>` +
    editor.WordJoiner +
    `inner</code></kbd>` +
    `<span data-type="code">` +
    editor.WordJoiner +
    editor.WordJoiner +
    `double</span>` +
    `<span data-type="code-block kbdish hashtag">` +
    editor.WordJoiner +
    `similar</span>` +
    `<span data-type="code">&NoBreak;entity</span>`;
  const tree = luteEngine.BlockDOM2Tree(protylePlaceholderBlockDOM(inlines))!;
  const expected =
    "outside" + editor.WordJoiner + editor.WordJoiner + "strongfoo" + editor.WordJoiner + "barouterinner" + editor.WordJoiner + "double" + editor.WordJoiner + "similarentity";
  assert.equal(tree.Root!.Text(), expected, "scoped normalization text");
});

test("TestBlockDOMInlinePlaceholderPreservesAttributeWordJoiners", () => {
  const luteEngine = newProtylePlaceholderLute();
  const href = "before" + editor.WordJoiner + "after";
  const math = "x" + editor.WordJoiner + "y";
  const inlines = `<span data-type="a" data-href="` + href + `">link</span>` + `<span data-type="inline-math" data-content="` + math + `"></span>`;
  const tree = luteEngine.BlockDOM2Tree(protylePlaceholderBlockDOM(inlines))!;
  let gotHref = "";
  let gotMath = "";
  ast.Walk(tree.Root!, (node, entering) => {
    if (entering && ast.NodeTextMark === node.Type) {
      if (node.IsTextMarkType("a")) {
        gotHref = node.TextMarkAHref;
      }
      if (node.IsTextMarkType("inline-math")) {
        gotMath = node.TextMarkInlineMathContent;
      }
    }
    return ast.WalkContinue;
  });
  assert.ok(href === gotHref && math === gotMath, `expected word joiners in attributes to be preserved, got href ${JSON.stringify(gotHref)} and math ${JSON.stringify(gotMath)}`);
});

test("TestSpinBlockDOMInlinePlaceholderCanonicalAndIdempotent", () => {
  const luteEngine = newProtylePlaceholderLute();
  withTesting(() => {
    const inlines =
      `a<span data-type="code">` + "﻿" + `code</span>b` +
      `c<span data-type="strong code">` + editor.Zwsp + `both</span>d` +
      `e<span data-type="kbd">` + editor.WordJoiner + `key</span>f` +
      `g<span data-type="tag">` + editor.Zwsp + `tag</span>h`;
    const spun = luteEngine.SpinBlockDOM(protylePlaceholderBlockDOM(inlines));
    const checks = [
      "a" + editor.Zwsp + `<span data-type="code">` + editor.WordJoiner + "code</span>" + editor.Zwsp + "b",
      "c" + editor.Zwsp + `<span data-type="strong code">` + editor.WordJoiner + "both</span>" + editor.Zwsp + "d",
      "e" + editor.Zwsp + `<span data-type="kbd">` + editor.WordJoiner + "key</span>" + editor.Zwsp + "f",
      "g" + editor.Zwsp + `<span data-type="tag">` + editor.WordJoiner + "tag</span>" + editor.Zwsp + "h",
    ];
    for (const check of checks) {
      assert.ok(spun.includes(check), `canonical placeholder sequence ${JSON.stringify(check)} not found in ${JSON.stringify(spun)}`);
    }
    assert.ok(!spun.includes("﻿"), `legacy placeholder leaked into spun DOM: ${JSON.stringify(spun)}`);
    const spunAgain = luteEngine.SpinBlockDOM(spun);
    assert.equal(spunAgain, spun, "SpinBlockDOM is not idempotent");
  });
});

test("TestBlockDOMInlinePlaceholderDoesNotLeakToExports", async (t) => {
  const luteEngine = newProtylePlaceholderLute();
  for (const marker of markers) {
    await t.test(marker.name, () => {
      const dom = protylePlaceholderBlockDOM(`before <span data-type="code">` + marker.value + `code</span> after`);
      const tree = luteEngine.BlockDOM2Tree(dom)!;
      const exports: Record<string, string> = {
        ast: tree.Root!.Text(),
        markdown: luteEngine.BlockDOM2Md(dom),
        standard: luteEngine.BlockDOM2StdMd(dom),
        html: luteEngine.BlockDOM2HTML(dom),
        "rich-html": luteEngine.BlockDOM2RichHTML(dom),
      };
      for (const [name, output] of Object.entries(exports)) {
        assert.ok(!output.includes(marker.value), `${name} export leaked ${marker.name} placeholder: ${JSON.stringify(output)}`);
      }
    });
  }
});

test("TestBlockDOMInlinePlaceholderPreservesRealWordJoiners", async (t) => {
  const luteEngine = newProtylePlaceholderLute();
  for (const marker of markers) {
    await t.test(marker.name, () => {
      const inlines = "before" + editor.WordJoiner + `<span data-type="code">` + marker.value + editor.WordJoiner + "co" + editor.WordJoiner + "de</span>after";
      const dom = protylePlaceholderBlockDOM(inlines);
      const exports: Record<string, string> = {
        ast: luteEngine.BlockDOM2Tree(dom)!.Root!.Text(),
        markdown: luteEngine.BlockDOM2Md(dom),
        standard: luteEngine.BlockDOM2StdMd(dom),
        html: luteEngine.BlockDOM2HTML(dom),
        "rich-html": luteEngine.BlockDOM2RichHTML(dom),
      };
      for (const [name, output] of Object.entries(exports)) {
        const n = count(output, editor.WordJoiner);
        assert.equal(n, 3, `expected ${name} to preserve 3 real word joiners, got ${n} in ${JSON.stringify(output)}`);
      }
    });
  }
});
