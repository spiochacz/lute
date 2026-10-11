// Port of test/tag_protyle_punctuation_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

test("TestProtyleTagPunctuationBoundary", () => {
  const luteEngine = New();
  luteEngine.SetTextMark(true);
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTag(true);

  const inputs = [
    "Per the exit condition, #83 shifts state. Escalated via the close (`20260819002715-enfbv43`, Routine Close), and whether this warrants breaking the standing \"#83 has no dedicated card\" convention.",
    "#83 shifts state. See (#113)",
    "#83 shifts state. See [#113]",
  ];
  for (const input of inputs) {
    const dom = luteEngine.Md2BlockDOM(input, false);
    assert.ok(!dom.includes(`data-type="tag`), `tag should not span a punctuation-prefixed hash reference\ninput\n\t${JSON.stringify(input)}\ngot\n\t${JSON.stringify(dom)}`);
    const markdown = luteEngine.BlockDOM2StdMd(dom).trim();
    assert.equal(markdown, input, `markdown should round-trip unchanged`);
  }
});

test("TestProtyleTagPunctuationBoundaryKeepsValidSyntax", () => {
  const luteEngine = New();
  luteEngine.SetTextMark(true);
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTag(true);

  for (const input of ["#foo#", "(#foo#)", `"#foo#"`, "#foo bar#"]) {
    const dom = luteEngine.Md2BlockDOM(input, false);
    assert.ok(dom.includes(`data-type="tag"`), `valid tag syntax should remain supported\ninput\n\t${JSON.stringify(input)}\ngot\n\t${JSON.stringify(dom)}`);
  }

  const adjacentTagsDOM = luteEngine.Md2BlockDOM("#foo##bar#", false);
  const count = adjacentTagsDOM.split(`data-type="tag"`).length - 1; // strings.Count
  assert.equal(count, 2, `adjacent tags should remain separate, DOM ${JSON.stringify(adjacentTagsDOM)}`);

  const strongDOM = luteEngine.Md2BlockDOM("**foo.**1", false);
  assert.ok(strongDOM.includes(`data-type="strong"`), `Protyle punctuation handling should continue to support strong syntax\ngot\n\t${JSON.stringify(strongDOM)}`);
});
