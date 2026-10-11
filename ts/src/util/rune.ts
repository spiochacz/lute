// Ported from util/rune.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as editor from "../editor/index.ts";
import * as conv from "../runtime/conv.ts";
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";

export function ContainsStr(str: string, strs: string[]): boolean {
  if (0 === strs.length) {
    return false;
  }
  for (const s of strs) {
    if (strings.Contains(str, s)) {
      return true;
    }
  }
  return false;
}

export function IsEmptyStr(str: string): boolean {
  str = strings.ReplaceAll(str, editor.Zwsp, "");
  str = strings.ReplaceAll(str, editor.Zwj, "");
  return 0 === strings.TrimSpace(str).length;
}

export function WordCount(str: string): [number, number] {
  let runeCount = 0;
  let wordCount = 0;
  const words = strings.Fields(str);
  for (const word of words) {
    const [r, w] = wordCount0(word);
    runeCount += r;
    wordCount += w;
  }
  return [runeCount, wordCount];
}

function wordCount0(str: string): [number, number] {
  let runeCount = 0;
  let wordCount = 0;
  const runes = conv.RunesFromString(str);
  const length = runes.length;
  if (1 > length) {
    return [runeCount, wordCount];
  }

  runeCount = 1;
  wordCount = 1;
  let isAscii = runes[0] < utf8.RuneSelf;
  for (let i = 1; i < length; i++) {
    const r = runes[i];
    runeCount++;
    if (r >= utf8.RuneSelf) {
      wordCount++;
      isAscii = false;
      continue;
    }

    if ((r < utf8.RuneSelf) === isAscii) {
      continue;
    }
    wordCount++;
    isAscii = !isAscii;
  }
  return [runeCount, wordCount];
}

export function IsDigit(str: string): boolean {
  if (0 === str.length) {
    return false;
  }
  // PORT-NOTE: Go's `for _, r := range str` is a loop over code points; i is the
  // UTF-16 offset of the packed decode, advanced by its size.
  for (let i = 0; i < str.length; ) {
    const v = utf8.DecodeRuneInStringPacked(str, i);
    const r = v & 0xffffff;
    if (r < 0x30 /* 0 */ || r > 0x39 /* 9 */) {
      return false;
    }
    i += v >>> 24;
  }
  return true;
}
