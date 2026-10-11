// Port of test/math_test.go (TestMath, TestInlineMath, TestInlineMathDisabled, TestInlineMathDigit); the tables are read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestMath", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  for (const [name, from, to] of table("math", "mathTests", 16)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});

test("TestInlineMath", () => {
  const luteEngine = New();
  luteEngine.SetInlineMath(true);
  for (const [name, from, to] of table("math", "inlineMathTests", 2)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});

test("TestInlineMathDisabled", () => {
  const luteEngine = New();
  luteEngine.SetInlineMath(false);
  for (const [name, from, to] of table("math", "inlineMathDisabledTests", 1)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});

test("TestInlineMathDigit", () => {
  const luteEngine = New();
  luteEngine.SetInlineMathAllowDigitAfterOpenMarker(true);
  for (const [name, from, to] of table("math", "inlineMathDigitAllowTests", 2)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});
