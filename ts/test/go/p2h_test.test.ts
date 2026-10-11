// Port of test/p2h_test.go. TestBlockDOM2HTML (table) is already ported in test/e2e/root/protyle_go.test.ts with Go's expected values;
// this file ports TestBlockDOM2RichHTML, which that harness skips ("no table loop").

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

test("TestBlockDOM2RichHTML", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTextMark(true);
  const blockDOM = `<div data-node-id="20240101000000-abcdefg" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">foo <span data-type="strong em">bar</span> <span data-type="a strong" data-href="https://b3log.org" data-title="B3log">baz</span></div><div class="protyle-attr" contenteditable="false">` + "​" + `</div></div>`;
  const expected = '<p id="20240101000000-abcdefg">foo <strong><em>bar</em></strong> <a href="https://b3log.org" title="B3log"><strong>baz</strong></a></p>\n';
  assert.equal(luteEngine.BlockDOM2RichHTML(blockDOM), expected);
});
