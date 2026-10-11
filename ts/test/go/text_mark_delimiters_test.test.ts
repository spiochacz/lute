// Port of test/text_mark_delimiters_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

test("TestSpinCrossTextMarkDelimiters", async (t) => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetTextMark(true);
  engine.SetKramdownIAL(true);
  engine.SetSpin(true);
  engine.SetMark(true);
  const wrap = (content: string): string =>
    `<div data-node-id="20260908150000-abcdefg" data-type="NodeParagraph" class="p"><div contenteditable="true">` + content + `</div><div class="protyle-attr" contenteditable="false"></div></div>`;
  const cases: { name: string; input: string; want: string }[] = [
    { name: "close-inside", input: `*<span data-type="strong">11*<wbr></span>`, want: `<span data-type="em strong">11</span>` },
    { name: "open-inside", input: `<span data-type="strong">*11</span>*<wbr>`, want: `<span data-type="em strong">11</span>` },
    { name: "different-styles", input: `<span data-type="strong">*foo</span><span data-type="mark">bar*</span><wbr>`, want: `<span data-type="em strong">foo</span><span data-type="em mark">bar</span>` },
    { name: "mixed-text", input: `*foo<span data-type="strong">bar*</span><wbr>`, want: `<span data-type="em">foo</span><span data-type="em strong">bar</span>` },
    { name: "attributes", input: `*<span data-type="strong text" style="color: red;">11*</span><wbr>`, want: `style="color: red;"` },
    { name: "unmatched", input: `*<span data-type="strong">11<wbr></span>`, want: `*<span data-type="strong">11<wbr></span>` },
    { name: "code-boundary", input: `*<span data-type="strong code">11*</span><wbr>`, want: `11*</span>` },
    { name: "escaped", input: `\\*<span data-type="strong">11*</span><wbr>`, want: `<span data-type="strong">11*</span>` },
  ];
  for (const tc of cases) {
    await t.test(tc.name, () => {
      const got = engine.SpinBlockDOM(wrap(tc.input));
      assert.ok(got.includes(tc.want), `expected ${JSON.stringify(tc.want)} in ${JSON.stringify(got)}`);
      assert.ok(got.includes("<wbr>"), `caret lost: ${JSON.stringify(got)}`);
      // 空样式节点中的光标可在下一轮规范化时移到节点外，正文格式必须保持稳定。
      const again = engine.SpinBlockDOM(got);
      assert.ok(again.includes(tc.want), `format changed: ${JSON.stringify(got)} / ${JSON.stringify(again)}`);
      const stable = engine.SpinBlockDOM(again);
      assert.equal(stable, again, `not stable: ${JSON.stringify(again)} / ${JSON.stringify(stable)}`);
    });
  }
  engine.SetInlineAsterisk(false);
  const got = engine.SpinBlockDOM(wrap(`*<span data-type="strong">11*</span><wbr>`));
  assert.ok(!got.includes(`data-type="em`), `disabled emphasis parsed: ${JSON.stringify(got)}`);
});
