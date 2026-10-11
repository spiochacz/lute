// Port of test/sanitizer_test.go. Tables are read from cases/sanitizer_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, render } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestSanitizer", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.Sanitize = true;
  for (const [name, from, to] of goTable("sanitizer_test", "sanitizerTests", 19)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});

test("TestSanitizerVditor", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.RenderOptions.Sanitize = true;
  for (const [name, from, to] of goTable("sanitizer_test", "sanitizerVditorTests", 9)) {
    const html = luteEngine.SpinVditorDOM(from);
    assert.equal(html, to, `test case [${name}] failed, original text ${JSON.stringify(from)}`);
  }
});

test("TestSanitize", () => {
  let output = render.Sanitize('<img src="foo" onload="alert(1)" onerror="alert(2)"/>');
  assert.equal(output, '<img src="foo" />', "sanitize failed");

  output = render.Sanitize("![a](&quot;<img src=xss onerror=alert(1)>)\n");
  assert.equal(output, '![a](&#34;<img src="xss">)\n', "sanitize failed");
});
