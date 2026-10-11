// Ported from render/space.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as editor from "../editor/index.ts";
import { BaseRenderer } from "./types.ts";

declare module "./types.ts" {
  interface BaseRenderer {
    Space(tokens: Uint8Array): Uint8Array;
  }
}

// Space adds a space between Chinese and Western text in tokens.
BaseRenderer.prototype.Space = function (this: BaseRenderer, tokens: Uint8Array): Uint8Array {
  const r = this;
  let text = conv.StringFromBytes(tokens);
  text = Space0(text);
  return conv.BytesFromString(text);
};

export function Space0(text: string): string {
  let ret = "";
  const runes = conv.RunesFromString(text);
  const length = runes.length;
  let r = 0;
  for (let i = 0; i < length; ) {
    r = runes[i];
    if (i < length - 3 && 0x69 /* i */ === runes[i + 1] && 0x6e /* n */ === runes[i + 2] && 0x67 /* g */ === runes[i + 3] && unicode.Is(unicode.Han, runes[i])) {
      // No space is needed before ing, for example 打码ing https://github.com/88250/lute/issues/9
      // PERF-TODO: Go builds the result with string concatenation per rune; ported as written
      ret += conv.StringFromRune(r) + "ing";
      i += 4;
      continue;
    }
    ret = addSpaceAtBoundary(ret, r);
    i++;
  }
  return ret;
}

export function addSpaceAtBoundary(prefix: string, nextChar: number): string {
  if (0 === prefix.length) {
    return conv.StringFromRune(nextChar);
  }

  // UPSTREAM-BUG: this compares prefix as a whole string with "1" and "9", so it is true for any prefix that starts with 1-8 (for example "1abc"), not only for a single digit
  if ("1" <= prefix && "9" >= prefix && 65039 === nextChar) { // Emoji 1-9
    // Handling it here is not quite right, Unicode Emoji should be parsed into nodes directly in emoji.go
    return prefix + conv.StringFromRune(nextChar);
  }

  const currentChar = utf8.DecodeLastRuneInString(prefix)[0];
  if (allowSpace(currentChar, nextChar)) {
    return prefix + " " + conv.StringFromRune(nextChar);
  }
  return prefix + conv.StringFromRune(nextChar);
}

export function allowSpace(currentChar: number, nextChar: number): boolean {
  if (unicode.IsSpace(currentChar) || unicode.IsSpace(nextChar) ||
    (editor.CaretRune === currentChar) || (editor.CaretRune === nextChar) ||
    !unicode.IsPrint(currentChar) || !unicode.IsPrint(nextChar)) {
    return false;
  }

  const currentIsCJK = isCJK(currentChar);
  const nextIsPunct = (0x25 /* % */ !== nextChar && 0x40 /* @ */ !== nextChar && (unicode.IsPunct(nextChar) || 0x7e /* ~ */ === nextChar || 0x3d /* = */ === nextChar || 0x23 /* # */ === nextChar)) || isFullWidth(nextChar);
  if (currentIsCJK && nextIsPunct) {
    return false;
  }

  const currentIsPunct = (0x25 /* % */ !== currentChar && 0x40 /* @ */ !== currentChar && (unicode.IsPunct(currentChar) || 0x7e /* ~ */ === currentChar || 0x3d /* = */ === currentChar || 0x23 /* # */ === currentChar)) || isFullWidth(currentChar);
  const nextIsCJK = isCJK(nextChar);
  if (nextIsCJK && currentIsPunct) {
    return false;
  }

  if ((!currentIsCJK && !nextIsCJK) || (currentIsCJK && nextIsCJK)) {
    return false;
  }
  return true;
}

export function isCJK(r: number): boolean {
  return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Lm, r) ||
    unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) ||
    unicode.Is(unicode.Hangul, r);
}

export function isFullWidth(r: number): boolean {
  // PORT-NOTE: Go uses width.LookupRune(r).Kind() == EastAsianWide || EastAsianFullwidth
  return unicode.IsEastAsianWideOrFullwidth(r);
}
