// Ported from lex/lexer.go @ 8e7896b6
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
import { ItemCarriageReturn, ItemNewline } from "./token.ts";

// nulTokens is the NUL byte, as []byte{0} in Go.
const nulTokens: Uint8Array = new Uint8Array([0x00]);

// replacementTokens is U+FFFD as bytes, as []byte("�") in Go.
const replacementTokens: Uint8Array = conv.BytesFromString("�");

// Lexer describes the lexer structure.
export class Lexer {
  input: Uint8Array; // the input text bytes
  length: number; // the length of the input text bytes
  offset: number; // the current byte position

  constructor() {
    this.input = new Uint8Array(0);
    this.length = 0;
    this.offset = 0;
  }

  // NextLine returns the next line.
  NextLine(): Uint8Array | null {
    if (this.offset >= this.length) {
      return null;
    }

    const start = this.offset;
    let hasNUL = false;
    let i = this.offset;
    let ret: Uint8Array | null = null;
    for (; i < this.length; i++) {
      const b = this.input[i];
      if (ItemNewline === b) {
        i++;
        break;
      } else if (ItemCarriageReturn === b) {
        // When returning the current line, normalize its line ending and skip the LF of a CRLF pair without moving the following lines.
        this.input[i] = ItemNewline;
        i++;
        ret = this.input.subarray(start, i);
        if (i < this.length && ItemNewline === this.input[i]) {
          i++;
        }
        break;
      } else if (0 === b) {
        hasNUL = true;
      }
    }
    if (null === ret) {
      ret = this.input.subarray(start, i);
    }
    if (hasNUL) {
      // Allocate the replacement buffer only for the current line when it contains NUL. Other bytes, including invalid UTF-8, are kept.
      ret = bytes.ReplaceAll(ret, nulTokens, replacementTokens);
    }
    this.offset = i;
    return ret;
  }
}

// NewLexer creates a lexer.
export function NewLexer(input: Uint8Array): Lexer {
  const ret = new Lexer();
  ret.input = input;
  ret.length = input.length;
  if (0 < ret.length && ItemNewline !== ret.input[ret.length - 1]) {
    // Pre-process so that the input ends with \n.
    ret.input = slices.AppendByte(ret.input, ItemNewline);
    ret.length++;
  }
  return ret;
}
