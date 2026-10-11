// Port of test/spin_block_test.go. Tables are read from cases/spin_block_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestSpinBlockDOM", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetDataTask(true);
  luteEngine.SetMark(true);
  luteEngine.SetBlockRef(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetSuperBlock(true);
  luteEngine.SetTag(true);
  luteEngine.SetSub(true);
  luteEngine.SetSup(true);
  luteEngine.SetGitConflict(true);
  luteEngine.SetIndentCodeBlock(false);
  luteEngine.SetEmojiSite("http://127.0.0.1:6806/stage/protyle/images/emoji");
  luteEngine.SetAutoSpace(true);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetInlineMathAllowDigitAfterOpenMarker(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetCallout(true);
  luteEngine.SetCustomBlock(true);
  luteEngine.SetSpin(true);

  ast.SetTesting(true);
  try {
    for (const [name, from, to] of goTable("spin_block_test", "spinBlockDOMTests", 290)) {
      const html = luteEngine.SpinBlockDOM(from);
      assert.equal(html, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
      if ("288" === name) {
        const spunAgain = luteEngine.SpinBlockDOM(html);
        assert.equal(spunAgain, html, `test case [${name}] is not idempotent`);
      }
    }
  } finally {
    ast.SetTesting(false);
  }
});

test("TestSpinBlockDOMStrikethrough1Disabled", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.ParseOptions.Mark = true;
  luteEngine.ParseOptions.BlockRef = true;
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetSuperBlock(true);
  luteEngine.SetTag(true);
  luteEngine.SetGFMStrikethrough(true);
  luteEngine.SetGFMStrikethrough1(false);
  luteEngine.SetSub(false);
  luteEngine.SetSup(true);
  luteEngine.SetGitConflict(true);
  luteEngine.SetIndentCodeBlock(false);
  luteEngine.SetEmojiSite("http://127.0.0.1:6806/stage/protyle/images/emoji");
  luteEngine.SetAutoSpace(true);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetInlineMathAllowDigitAfterOpenMarker(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetSpin(true);

  ast.SetTesting(true);
  try {
    for (const [name, from, to] of goTable("spin_block_test", "spinBlockDOMStrikethrough1DisabledTests", 1)) {
      const html = luteEngine.SpinBlockDOM(from);
      assert.equal(html, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
    }
  } finally {
    ast.SetTesting(false);
  }
});
