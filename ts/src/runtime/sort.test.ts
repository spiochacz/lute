import { test } from "node:test";
import assert from "node:assert/strict";
import * as sort from "./sort.ts";

test("Strings sorts ASCII like sort.Strings", () => {
  const a = ["b", "a", "", "ab", "B", "a b", "aa"];
  sort.Strings(a);
  assert.deepEqual(a, ["", "B", "a", "a b", "aa", "ab", "b"]);
});

test("Strings sorts by code point, not UTF-16 unit, for astral characters", () => {
  // U+FFFD, U+FFFF and U+E000 are BMP characters above surrogates; U+10000 and U+1F600 are astral.
  // In UTF-16 order the astral strings (lead surrogate D800..DBFF) sort before U+E000..U+FFFF; in code point
  // (UTF-8 byte) order they sort after U+FFFF.
  const input = ["\u{1F600}", "�", "\u{10000}", "￿", "", "\u{10FFFF}", "퟿", "a", "\u{1F600}x"];
  const expected = ["a", "퟿", "", "�", "￿", "\u{10000}", "\u{1F600}", "\u{1F600}x", "\u{10FFFF}"];
  sort.Strings(input);
  assert.deepEqual(input, expected);
});

test("Strings differs from the default JS sort on astral characters", () => {
  const a = ["�", "\u{10000}"];
  a.sort();
  assert.deepEqual(a, ["\u{10000}", "�"]); // UTF-16 order: the default sort is wrong here
  const b = ["�", "\u{10000}"];
  sort.Strings(b);
  assert.deepEqual(b, ["�", "\u{10000}"]); // code point order
});

test("Strings sorts in place and handles empty and single arrays", () => {
  const e: string[] = [];
  sort.Strings(e);
  assert.deepEqual(e, []);
  const one = ["x"];
  sort.Strings(one);
  assert.deepEqual(one, ["x"]);
});

test("Strings: a prefix sorts before its extensions, astral included", () => {
  const a = ["\u{1F600}\u{1F600}", "\u{1F600}", "\u{1F5FF}", ""];
  sort.Strings(a);
  assert.deepEqual(a, ["", "\u{1F5FF}", "\u{1F600}", "\u{1F600}\u{1F600}"]);
});
