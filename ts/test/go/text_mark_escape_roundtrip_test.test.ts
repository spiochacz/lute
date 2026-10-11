// Port of test/text_mark_escape_roundtrip_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, editor, html, util } from "../../src/index.ts";

test("TestTextMarkEscapedKramdownRoundTrip", async (t) => {
  for (const mark of ["em", "strong", "s", "mark", "sup", "sub", "u", "kbd", "code", "text", "a em"]) {
    await t.test(mark, () => {
      const engine = New();
      engine.SetTextMark(true);
      engine.SetProtyleWYSIWYG(true);
      engine.SetKramdownIAL(true);
      engine.SetAutoSpace(false);
      engine.SetSpin(true);
      const content = `<vitae> & &lt; "quote"`;
      const span = `<span data-type="` + mark + `" data-href="https://example.com">` + html.EscapeHTMLStr(content) + `</span>`;
      let dom = `<div data-node-id="20260918120000-abcdefg" data-type="NodeParagraph"><div contenteditable="true">` + span + `</div></div>`;
      const check = (got: string): void => {
        let text = util.DomText(util.ParseHTML(got));
        text = text.split(editor.Zwsp).join("").split(editor.WordJoiner).join("");
        assert.equal(text, content, `expected ${JSON.stringify(content)}, got ${JSON.stringify(text)} in ${got}`);
      };
      for (let i = 0; i < 3; i++) {
        check(engine.SpinBlockDOM(dom));
        const text = engine.BlockDOM2Content(dom).split(editor.Zwsp).join("");
        assert.equal(text, content, `plain content changed: ${JSON.stringify(text)}`);
        const markdown = engine.BlockDOM2Md(dom);
        dom = engine.Md2BlockDOM(markdown, false);
        check(dom);
        check(engine.InlineMd2BlockDOM(span));
      }
    });
  }
});
