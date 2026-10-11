// Port of test/emoji_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("emoji_test");

test("TestEmoji", () => {
  const luteEngine = New(); // 默认已经开启 Emoji 处理
  markdownTable(luteEngine, rows(cases, "emojiTests", 23));
});

test("TestCleanEmoji", () => {
  const luteEngine = New();
  let result = luteEngine.RemoveEmoji("❤️ foo");
  assert.equal(result, "foo", "remove emoji failed");
  result = luteEngine.RemoveEmoji("bar ❤️ foo");
  assert.equal(result, "bar  foo", "remove emoji failed");
  result = luteEngine.RemoveEmoji("❤️ foo ❤️bar");
  assert.equal(result, "foo bar", "remove emoji failed");
});
