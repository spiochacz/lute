// Port of test/html_esc_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../../src/index.ts";

test("TestEscapeAttrVal", () => {
  const str = "foo\n<bar>'baz&中 文";
  const result = html.EscapeAttrVal(str);
  assert.equal(html.UnescapeAttrVal(result), str, "escape html failed");
});

test("TestEscapeHTMLStr", () => {
  const str = "foo\n<bar>'baz&中 文";
  const result = html.EscapeHTMLStr(str);
  assert.equal(html.UnescapeHTMLStr(result), str, "escape html failed");
});

test("TestEscapeString", () => {
  const str = "foo\n<bar>'baz&中 文";
  const result = html.EscapeString(str);
  assert.equal(html.UnescapeString(result), str, "escape html failed");
});
