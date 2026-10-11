// Port of test/protyle_merged_table_backslash_test.go (TestBlockDOM2StdMdMergedTablePreservesBackslashContent,
// TestBlockDOM2RichHTMLMergedTablePreservesBackslashContent).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

const mergedTableWithBackslashBlockDOM =
  `<div data-type="NodeTable" colgroup="|">` +
  `<div contenteditable="true" spellcheck="false"><table><colgroup><col><col></colgroup>` +
  `<thead><tr><th>1</th><th>reels</th></tr></thead><tbody>` +
  `<tr><td rowspan="2">4</td><td><span data-type="backslash">*</span>raj-s</td></tr>` +
  `<tr><td class="fn__none"></td><td><span data-type="backslash">*</span>[r]aj</td></tr>` +
  `</tbody></table><div class="protyle-action__table"><div class="table__resize"></div>` +
  `<div class="table__select"></div></div></div>` +
  `<div class="protyle-attr" contenteditable="false">&#8203;</div></div>`;

test("TestBlockDOM2StdMdMergedTablePreservesBackslashContent", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  const markdown = luteEngine.BlockDOM2StdMd(mergedTableWithBackslashBlockDOM);
  assert.ok(markdown.includes(String.raw`<td>\*raj-s</td>`) && markdown.includes(String.raw`<td>\*[r]aj</td>`), `expected escaped characters in merged table, got ${JSON.stringify(markdown)}`);
});

test("TestBlockDOM2RichHTMLMergedTablePreservesBackslashContent", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  const html = luteEngine.BlockDOM2RichHTML(mergedTableWithBackslashBlockDOM);
  assert.ok(html.includes(`<td>*raj-s</td>`) && html.includes(`<td>*[r]aj</td>`), `expected escaped character content in merged table, got ${JSON.stringify(html)}`);
});
