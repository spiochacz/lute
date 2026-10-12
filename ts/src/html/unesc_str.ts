// Ported from html/unesc_str.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as lex from "../lex/index.ts";
import { lookupEntity } from "./entity.ts";

// UnescapeBytes returns tokens with its entities unescaped, and each backslash
// escape of ASCII punctuation (for example \* ) removed.
// PORT-NOTE: Go tests the input with nil, and returns nil for a nil input. The
// result is nil exactly when the input is nil, so both are typed as nullable.
export function UnescapeBytes(tokens: Uint8Array | null): Uint8Array | null {
  let ret: Uint8Array | null = null;
  if (null === tokens) {
    return ret;
  }

  // PORT-NOTE: byte offset. The input is converted through a JS string, so bytes that are
  // not valid UTF-8 are not kept (conv.StringFromBytes), unlike Go's string(tokens).
  tokens = conv.BytesFromString(HtmlUnescapeString(conv.StringFromBytes(tokens)));
  const length = tokens.length;
  ret = slices.Make(0, length);
  for (let i = 0; i < length; i++) {
    if (lex.IsBackslashEscapePunct(tokens, i)) {
      ret = ret.subarray(0, ret.length - 1);
    }
    ret = slices.AppendByte(ret, tokens[i]);
  }
  return ret;
}

// HtmlUnescapeString unescapes the entities of s, like "&lt;" becoming "<".
export function HtmlUnescapeString(s: string): string {
  // Acknowledgement: https://gitlab.com/golang-commonmark

  // PORT-NOTE: byte offset. Every index here is a UTF-16 index into s. The entity
  // matched by parseEntity is ASCII only, so its length is the same in bytes and in
  // UTF-16 units.
  // PERF-TODO: parseEntity is called with s.slice(i) for each ampersand, so a string with many ampersands copies the rest of s each time.
  let i = strings.IndexByte(s, lex.ItemAmpersand);
  if (i < 0) {
    return s;
  }

  let anyChanges = false;
  let entityStr = "";
  let entityLen = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x26 /* & */) {
      [entityStr, entityLen] = parseEntity(s.slice(i));
      if (entityLen > 0) {
        anyChanges = true;
        break;
      }
    }
    i++;
  }

  if (!anyChanges) {
    return s;
  }

  // PORT-NOTE: Go copies into a []byte sized in bytes (len(s)-entityLen+len(entityStr)) and
  // then converts it. Here the output is built as a JS string with the same pieces in the
  // same order: copy(buf[:i], s), then entityStr, then the rest of s with each entity replaced.
  let buf = s.slice(0, i) + entityStr;
  i += entityLen;
  while (i < s.length) {
    const b = s.charCodeAt(i);
    if (b === 0x26 /* & */) {
      [entityStr, entityLen] = parseEntity(s.slice(i));
      if (entityLen > 0) {
        buf += entityStr;
        i += entityLen;
        continue;
      }
    }

    buf += s.charAt(i);
    i++;
  }

  return buf;
}

// parseEntity parses the entity at the start of s (s[0] is the ampersand). It returns
// the replacement text and the length of the entity in s, or "" and 0 when s does not
// start with an entity.
// PORT-NOTE: exported only so that escape.vectors.test.ts can call it. Go keeps it unexported.
export function parseEntity(s: string): [string, number] {
  let st = 0;
  let n = 0;

  for (let i = 1; i < s.length; i++) {
    const b = s.charCodeAt(i);

    switch (st) {
      case 0: // initial state
        if (b === 0x23 /* # */) {
          st = 1;
        } else if (lex.IsASCIILetter(b)) {
          n = 1;
          st = 2;
        } else {
          return ["", 0];
        }
        break;

      case 1: // &#
        if (b === 0x78 /* x */ || b === 0x58 /* X */) {
          st = 3;
        } else if (lex.IsDigit(b)) {
          n = 1;
          st = 4;
        } else {
          return ["", 0];
        }
        break;

      case 2: // &q
        if (lex.IsASCIILetterNum(b)) {
          n++;
          if (n > 31) {
            return ["", 0];
          }
        } else if (b === 0x3b /* ; */) {
          // PORT-NOTE: Go's "e, ok := Entities[...]" is written as a lookup where "" means not found.
          const e = lookupEntity(s.slice(i - n, i + 1));
          if (e !== "") {
            return [e, i + 1];
          }
          return ["", 0];
        } else {
          return ["", 0];
        }
        break;

      case 3: // &#x
        if (lex.IsHexDigit(b)) {
          n = 1;
          st = 5;
        } else {
          return ["", 0];
        }
        break;

      case 4: // &#0
        if (lex.IsDigit(b)) {
          n++;
          if (n > 8) {
            return ["", 0];
          }
        } else if (b === 0x3b /* ; */) {
          const [c] = strconv.ParseInt(s.slice(i - n, i), 10, 32);
          if (!isValidEntityCode(c)) {
            return [BadEntity, i + 1];
          }
          return [conv.StringFromRune(c), i + 1];
        } else {
          return ["", 0];
        }
        break;

      case 5: // &#x0
        if (lex.IsHexDigit(b)) {
          n++;
          if (n > 8) {
            return ["", 0];
          }
        } else if (b === 0x3b /* ; */) {
          const [c, err] = strconv.ParseInt(s.slice(i - n, i), 16, 32);
          if (null !== err) {
            return [BadEntity, i + 1];
          }
          if (!isValidEntityCode(c)) {
            return [BadEntity, i + 1];
          }
          return [conv.StringFromRune(c), i + 1];
        } else {
          return ["", 0];
        }
        break;
    }
  }
  return ["", 0];
}

// BadEntity is the replacement for an entity that is not valid: U+FFFD.
export const BadEntity: string = conv.StringFromRune(utf8.RuneError);

// isValidEntityCode reports whether the code point c can be written as a character
// reference.
// PORT-NOTE: exported only so that escape.vectors.test.ts can call it. Go keeps it unexported.
export function isValidEntityCode(c: number): boolean {
  if (!utf8.ValidRune(c)) {
    return false;
  }
  // never used
  if (c >= 0xfdd0 && c <= 0xfdef) {
    return false;
  }
  if ((c & 0xffff) === 0xffff || (c & 0xffff) === 0xfffe) {
    return false;
  }
  // control codes
  if (c >= 0x00 && c <= 0x08) {
    return false;
  }
  if (c === 0x0b) {
    return false;
  }
  if (c >= 0x0e && c <= 0x1f) {
    return false;
  }
  if (c >= 0x7f && c <= 0x9f) {
    return false;
  }

  return true;
}
