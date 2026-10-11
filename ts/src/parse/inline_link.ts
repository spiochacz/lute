// Ported from parse/inline_link.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import { Context } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    parseInlineLinkDest(tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array];
  }
}

const dataImage: Uint8Array = conv.BytesFromString("data:image");

Context.prototype.parseInlineLinkDest = function (this: Context, tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array] {
  const context = this;
  let passed: Uint8Array | null = null;
  let remains: Uint8Array = new Uint8Array(0);
  let destination: Uint8Array = new Uint8Array(0);
  remains = tokens;
  const length = tokens.length;
  if (2 > length) {
    return [passed, remains, destination];
  }

  passed = slices.Make(0, 256);
  destination = slices.Make(0, 256);

  const isPointyBrackets = lex.ItemLess === tokens[1];
  if (isPointyBrackets) {
    let matchEnd = false;
    passed = slices.AppendByte(passed, tokens[0]);
    passed = slices.AppendByte(passed, tokens[1]);
    let i = 2;
    let size = 1;
    let r = 0;
    let dest: Uint8Array = new Uint8Array(0);
    let runes: Uint8Array = new Uint8Array(0);
    for (; i < length; i += size) {
      size = 1;
      const token = tokens[i];
      if (lex.ItemNewline === token) {
        passed = null;
        return [passed, remains, destination];
      }

      if (token < utf8.RuneSelf) {
        passed = slices.AppendByte(passed, token);
        dest = new Uint8Array([token]);
      } else {
        dest = new Uint8Array(0);
        const v = utf8.DecodeRunePacked(tokens, i);
        r = v & 0xFFFFFF;
        size = v >>> 24;
        runes = utf8.RuneBytes(r);
        passed = slices.Append(passed, runes);
        dest = slices.Append(dest, runes);
      }
      destination = slices.Append(destination, dest);
      if (lex.ItemGreater === token && !lex.IsBackslashEscapePunct(tokens, i)) {
        destination = destination.subarray(0, destination.length - 1);
        matchEnd = true;
        break;
      }
    }

    if (!matchEnd || length <= i + 1) {
      passed = null;
      return [passed, remains, destination];
    }

    if (lex.ItemGreater === tokens[i + 1] || lex.ItemCloseParen === tokens[i + 1]) {
      passed = slices.AppendByte(passed, tokens[i + 1]);
      remains = tokens.subarray(i + 2);
    } else { // Followed by a space
      remains = tokens.subarray(i + 1);
    }
  } else {
    let openParens = 0;
    let i = 0;
    let size = 1;
    let r = 0;
    let dest: Uint8Array = new Uint8Array(0);
    let runes: Uint8Array = new Uint8Array(0);
    let destStarted = false;
    for (; i < length; i += size) {
      size = 1;
      const token = tokens[i];
      if (token < utf8.RuneSelf) {
        passed = slices.AppendByte(passed, token);
        dest = new Uint8Array([token]);
      } else {
        dest = new Uint8Array(0);
        const v = utf8.DecodeRunePacked(tokens, i);
        r = v & 0xFFFFFF;
        size = v >>> 24;
        runes = utf8.RuneBytes(r);
        passed = slices.Append(passed, runes);
        dest = slices.Append(dest, runes);
      }
      destination = slices.Append(destination, dest);
      if (!destStarted && !lex.IsWhitespace(token) && 0 < i) {
        destStarted = true;
        destination = destination.subarray(1);
        destination = lex.TrimWhitespace(destination)!;
      }
      if (!context.ParseOption.ImgPathAllowSpace) {
        if (destStarted && (lex.IsWhitespace(token) || lex.IsControl(token))) {
          destination = destination.subarray(0, destination.length - size);
          passed = passed.subarray(0, passed.length - 1);
          openParens--;
          break;
        }
      } else {
        if (destStarted && lex.IsWhitespace(token) && i + 1 < length) {
          const nextToken = tokens[i + 1];
          if (0x22 /* " */ === nextToken || 0x27 /* ' */ === nextToken) {
            destination = destination.subarray(0, destination.length - size);
            passed = passed.subarray(0, passed.length - 1);
            openParens--;
            break;
          }
        }
      }
      if (lex.ItemOpenParen === token && !lex.IsBackslashEscapePunct(tokens, i)) {
        openParens++;
      }
      if (lex.ItemCloseParen === token && !lex.IsBackslashEscapePunct(tokens, i)) {
        openParens--;
        if (1 > openParens) {
          if (lex.ItemOpenParen === destination[0]) {
            destination = destination.subarray(1);
          }
          destination = destination.subarray(0, destination.length - 1);
          break;
        }
      }
    }

    remains = tokens.subarray(i);
    if (length > i && (lex.ItemCloseParen !== tokens[i] && lex.ItemSpace !== tokens[i] && lex.ItemNewline !== tokens[i])) {
      passed = null;
      return [passed, remains, destination];
    }

    if (0 !== openParens) {
      passed = null;
      return [passed, remains, destination];
    }
  }

  if (!context.ParseOption.DataImage && bytes.HasPrefix(bytes.ToLower(destination), dataImage)) {
    return [null, new Uint8Array(0), new Uint8Array(0)];
  }

  if (null !== passed) {
    if ((!context.ParseOption.VditorWYSIWYG && !context.ParseOption.VditorIR && !context.ParseOption.VditorSV && !context.ParseOption.ProtyleWYSIWYG) &&
      !context.ParseOption.ImgPathAllowSpace) {
      destination = html.EncodeDestination(html.UnescapeBytes(destination)!);
    }
  }
  return [passed, remains, destination];
};
