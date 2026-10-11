// Ported from lex/token.go @ 8e7896b6
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
import * as unicode from "../runtime/unicode.ts";

export const ItemBacktick = 0x60; /* ` */
export const ItemTilde = 0x7e; /* ~ */
export const ItemBang = 0x21; /* ! */
export const ItemCrosshatch = 0x23; /* # */
export const ItemAsterisk = 0x2a; /* * */
export const ItemOpenParen = 0x28; /* ( */
export const ItemCloseParen = 0x29; /* ) */
export const ItemHyphen = 0x2d; /* - */
export const ItemUnderscore = 0x5f; /* _ */
export const ItemPlus = 0x2b; /* + */
export const ItemEqual = 0x3d; /* = */
export const ItemTab = 0x09; /* \t */
export const ItemOpenBracket = 0x5b; /* [ */
export const ItemCloseBracket = 0x5d; /* ] */
export const ItemDoublequote = 0x22; /* " */
export const ItemSinglequote = 0x27; /* ' */
export const ItemLess = 0x3c; /* < */
export const ItemGreater = 0x3e; /* > */
export const ItemSpace = 0x20; /* space */
export const ItemNewline = 0x0a; /* \n */
export const ItemCarriageReturn = 0x0d; /* \r */
export const ItemBackslash = 0x5c; /* \ */
export const ItemSlash = 0x2f; /* / */
export const ItemDot = 0x2e; /* . */
export const ItemColon = 0x3a; /* : */
export const ItemQuestion = 0x3f; /* ? */
export const ItemAmpersand = 0x26; /* & */
export const ItemSemicolon = 0x3b; /* ; */
export const ItemPipe = 0x7c; /* | */
export const ItemDollar = 0x24; /* $ */
export const ItemCaret = 0x5e; /* ^ */
export const ItemOpenBrace = 0x7b; /* { */
export const ItemCloseBrace = 0x7d; /* } */

// IsWhitespace reports whether token is a white space character.
export function IsWhitespace(token: number): boolean {
  return ItemSpace === token || ItemNewline === token || ItemTab === token || 0x0b /* \v */ === token || 0x0c /* \f */ === token || 0x0d /* \r */ === token;
}

// IsUnicodeWhitespace reports whether r is a Unicode white space character.
export function IsUnicodeWhitespace(r: number): boolean {
  return unicode.IsSpace(r) || unicode.Is(unicode.Zs, r);
}

// IsDigit reports whether token is a digit 0-9.
export function IsDigit(token: number): boolean {
  return 0x30 /* 0 */ <= token && 0x39 /* 9 */ >= token;
}

// IsHexDigit reports whether token is a hexadecimal digit.
export function IsHexDigit(token: number): boolean {
  return IsDigit(token) || (token >= 0x61 /* a */ && token <= 0x66 /* f */) || (token >= 0x41 /* A */ && token <= 0x46 /* F */);
}

// TokenToUpper converts token to upper case.
export function TokenToUpper(token: number): number {
  if (token >= 0x61 /* a */ && token <= 0x7a /* z */) {
    return token - 0x61 /* a */ + 0x41 /* A */;
  }
  return token;
}

// IsASCIIPunct reports whether token is an ASCII punctuation character.
export function IsASCIIPunct(token: number): boolean {
  return (0x21 <= token && 0x2f >= token) || (0x3a <= token && 0x40 >= token) || (0x5b <= token && 0x60 >= token) || (0x7b <= token && 0x7e >= token);
}

// IsASCIILetter reports whether token is an ASCII letter.
export function IsASCIILetter(token: number): boolean {
  return (0x41 /* A */ <= token && 0x5a /* Z */ >= token) || (0x61 /* a */ <= token && 0x7a /* z */ >= token);
}

// IsASCIILetterNum reports whether token is an ASCII letter or digit.
export function IsASCIILetterNum(token: number): boolean {
  return (0x41 /* A */ <= token && 0x5a /* Z */ >= token) || (0x61 /* a */ <= token && 0x7a /* z */ >= token) || (0x30 /* 0 */ <= token && 0x39 /* 9 */ >= token);
}

// IsASCIILetterNums reports whether tokens consist of ASCII letters or digits.
export function IsASCIILetterNums(tokens: Uint8Array): boolean {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (!IsASCIILetterNum(token)) {
      return false;
    }
  }
  return true;
}

// IsASCIILetterNumHyphen reports whether token is an ASCII letter, a digit or a hyphen -.
export function IsASCIILetterNumHyphen(token: number): boolean {
  return (0x41 /* A */ <= token && 0x5a /* Z */ >= token) || (0x61 /* a */ <= token && 0x7a /* z */ >= token) || (0x30 /* 0 */ <= token && 0x39 /* 9 */ >= token) || 0x2d /* - */ === token;
}

// IsControl reports whether token is a control character.
export function IsControl(token: number): boolean {
  return unicode.IsControl(token);
}

// IsBlank reports whether all tokens are spaces.
export function IsBlank(tokens: Uint8Array): boolean {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (ItemSpace !== token) {
      return false;
    }
  }
  return true;
}

// splitElement returns the element tokens[from:to] as a new slice. Its length is to-from. Its capacity is the one that
// the byte-by-byte slices.AppendByte loop of the Go original gives it (slices.CapAfterByteAppends), so a later append to
// the element behaves the same, for elements above 64 bytes. An element of at most 64 bytes has capacity equal to its
// length (structural change S1: a small slice is never appended in place), and CapAfterByteAppends gives that too, so
// the same call covers both. An empty element is new Uint8Array(0), as in the original.
// PORT-NOTE: perf, departs from lex/token.go (structural change S1): an element of at most 64 bytes is copied with a loop,
// because tokens.subarray would materialise the ArrayBuffer of an on-heap tokens array.
function splitElement(tokens: Uint8Array, from: number, to: number): Uint8Array {
  const n = to - from;
  if (0 === n) {
    return new Uint8Array(0);
  }
  const element = slices.Make(n, slices.CapAfterByteAppends(n));
  if (n <= 64) {
    for (let k = 0; k < n; k++) {
      element[k] = tokens[from + k];
    }
  } else {
    element.set(tokens.subarray(from, to), 0);
  }
  return element;
}

// PORT-NOTE: perf, departs from lex/token.go:127-146: the element bounds are found first and each element is then
// created in one copy, instead of one slices.AppendByte (a new view per byte) per byte. The elements are the same:
// an element is the run of bytes between two separators, so it is contiguous in tokens; the length and the capacity
// are those of the byte-by-byte appends (see splitElement); an empty element is pushed as new Uint8Array(0), and the
// last element is pushed only when it is non-empty, as in the original.
export function Split(tokens: Uint8Array, separator: number): Uint8Array[] {
  let ret: Uint8Array[] = [];
  const length = tokens.length;
  let start = 0;
  for (let i = 0; i < length; i++) {
    if (separator === tokens[i]) {
      ret.push(splitElement(tokens, start, i));
      start = i + 1;
    }
  }
  if (0 < length - start) {
    ret.push(splitElement(tokens, start, length));
  }
  return ret;
}

// SplitWithoutBackslashEscape splits Tokens into substrings using separator as the delimiter. Characters escaped by a backslash \ are not counted as separators.
export function SplitWithoutBackslashEscape(tokens: Uint8Array, separator: number): Uint8Array[] {
  // PORT-NOTE: perf, departs from lex/token.go:149-172: same as Split (see the note there). The separator test and
  // IsBackslashEscapePunct decide the element bounds, as in the original; an escaped separator stays inside its element.
  let ret: Uint8Array[] = [];
  const length = tokens.length;
  let start = 0;
  for (let i = 0; i < length; i++) {
    if (separator === tokens[i] && !IsBackslashEscapePunct(tokens, i)) {
      //if ItemPipe == token && inInlineMath(tokens, i) {
      //	line = append(line, token)
      //	continue
      //}

      ret.push(splitElement(tokens, start, i));
      start = i + 1;
    }
  }
  if (0 < length - start) {
    ret.push(splitElement(tokens, start, length));
  }
  return ret;
}

// ReplaceAll replaces all old in Tokens with nw.
// PORT-NOTE: Go's parameter is named new, which is a reserved word in TypeScript, so it is named nw (as in bytes.Replace).
export function ReplaceAll(tokens: Uint8Array, old: number, nw: number): Uint8Array {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === old) {
      tokens[i] = nw;
    }
  }
  return tokens;
}

// ReplaceNewlineSpace replaces all "\n " in Tokens with "\n".
export function ReplaceNewlineSpace(tokens: Uint8Array): Uint8Array {
  const length = tokens.length;
  let token = 0;
  for (let i = length - 1; 0 <= i; i--) {
    token = tokens[i];
    if (ItemNewline !== token && ItemSpace !== token) {
      break;
    }
    // PORT-NOTE: Go panics here (index -1) when i is 0, which happens only when every token is a newline or a space. The TypeScript throw reproduces that panic. Upstream code, not fixed.
    if (i - 1 < 0) {
      throw new RangeError("index out of range [-1]");
    }
    if (ItemNewline === tokens[i - 1] && (ItemSpace === token || ItemNewline === token)) {
      tokens = tokens.subarray(0, i);
    }
  }
  return tokens;
}

// TrimWhitespace returns the remains of tokens without the leading and trailing white space.
// PORT-NOTE: Go returns nil exactly when the input is nil (Trim returns tokens itself when it is empty, and slices it otherwise), so null in gives null out, and for a non-null input
// the result is never null; a caller's nil check (parse/link.go:328) is therefore always false for the non-null labels it passes.
export function TrimWhitespace(tokens: Uint8Array | null): Uint8Array | null {
  if (null === tokens) {
    return null;
  }
  let ret: Uint8Array | null = null;
  [, , ret] = Trim(tokens);
  return ret;
}

// Trim returns the leading white space, the trailing white space and the remains of tokens.
export function Trim(tokens: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
  let leftWhitespaces: Uint8Array = new Uint8Array(0);
  let rightWhitespaces: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  const length = tokens.length;
  if (0 === length) {
    // Go returns nil, nil, tokens here; nil is not represented for these results (see the vectors).
    return [leftWhitespaces, rightWhitespaces, tokens];
  }
  let start = 0;
  let end = length - 1;
  for (; start < length; start++) {
    if (!IsWhitespace(tokens[start])) {
      break;
    }
  }
  leftWhitespaces = tokens.subarray(0, start);
  if (start === length) {
    start--;
  }
  for (; 0 <= end; end--) {
    if (!IsWhitespace(tokens[end])) {
      break;
    }
  }
  if (end < start) {
    end = start - 1;
  }
  if (0 < end) {
    rightWhitespaces = tokens.subarray(end + 1, length);
  }
  remains = tokens.subarray(start, end + 1);
  return [leftWhitespaces, rightWhitespaces, remains];
}

// TrimRight returns the trailing white space of tokens and the remains.
export function TrimRight(tokens: Uint8Array): [Uint8Array, Uint8Array] {
  let whitespaces: Uint8Array = new Uint8Array(0);
  const length = tokens.length;
  if (1 > length) {
    return [whitespaces, tokens];
  }

  let i = length - 1;
  for (; 0 <= i; i--) {
    if (!IsWhitespace(tokens[i])) {
      break;
    }
    whitespaces = slices.AppendByte(whitespaces, tokens[i]);
  }
  return [whitespaces, tokens.subarray(0, i + 1)];
}

// TrimLeft returns the leading white space of tokens and the remains.
// whitespaces is null when no white space was found, because the caller tests it against nil (parse/link.go:60).
export function TrimLeft(tokens: Uint8Array): [Uint8Array | null, Uint8Array] {
  let whitespaces: Uint8Array | null = null;
  const length = tokens.length;
  if (1 > length) {
    return [whitespaces, tokens];
  }

  let i = 0;
  for (; i < length; i++) {
    if (!IsWhitespace(tokens[i])) {
      break;
    }
    whitespaces = slices.AppendByte(whitespaces ?? new Uint8Array(0), tokens[i]);
  }
  return [whitespaces, tokens.subarray(i)];
}

export function Accept(tokens: Uint8Array, token: number): number {
  let pos = 0;
  const length = tokens.length;
  for (; pos < length; pos++) {
    if (token !== tokens[pos]) {
      break;
    }
  }
  return pos;
}

export function AcceptTokenss(tokens: Uint8Array, someTokenss: Uint8Array[]): number {
  let pos = 0;
  const length = tokens.length;
  const length2 = someTokenss.length;
  for (let i = 0; i < length; i++) {
    const remains = tokens.subarray(i);
    for (let j = 0; j < length2; j++) {
      const someTokens = someTokenss[j];
      pos = AcceptTokens(remains, someTokens);
      if (0 <= pos) {
        return pos;
      }
    }
  }
  return -1;
}

export function AcceptTokens(remains: Uint8Array, someTokens: Uint8Array): number {
  let pos = 0;
  const length = someTokens.length;
  for (; pos < length; pos++) {
    // PORT-NOTE: Go panics when remains is shorter than someTokens (index out of range). The TypeScript throw reproduces that panic. Upstream code, not fixed.
    if (pos >= remains.length) {
      throw new RangeError("index out of range [" + pos + "] with length " + remains.length);
    }
    if (someTokens[pos] !== remains[pos]) {
      return -1;
    }
  }
  return pos;
}

export function IsBlankLine(tokens: Uint8Array): boolean {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (ItemSpace !== token && ItemTab !== token && ItemNewline !== token) {
      return false;
    }
  }
  return true;
}

export function SplitWhitespace(tokens: Uint8Array): Uint8Array[] {
  let i = 0;
  let ret: Uint8Array[] = [];
  ret.push(new Uint8Array(0));
  let lastIsWhitespace = false;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (IsWhitespace(token)) {
      if (!lastIsWhitespace) {
        i++;
        ret.push(new Uint8Array(0));
      }
      lastIsWhitespace = true;
    } else {
      ret[i] = slices.AppendByte(ret[i], token);
      lastIsWhitespace = false;
    }
  }
  return ret;
}

// IsBackslashEscapePunct reports whether the value at pos in Tokens is an ASCII punctuation character escaped by a backslash \.
export function IsBackslashEscapePunct(tokens: Uint8Array, pos: number): boolean {
  // PORT-NOTE: Go panics when pos is out of range (index out of range). The TypeScript throw reproduces that panic. Upstream code, not fixed.
  if (pos < 0 || pos >= tokens.length) {
    throw new RangeError("index out of range [" + pos + "] with length " + tokens.length);
  }
  if (!IsASCIIPunct(tokens[pos])) {
    return false;
  }

  let backslashes = 0;
  for (let i = pos - 1; 0 <= i; i--) {
    if (ItemBackslash !== tokens[i]) {
      break;
    }
    backslashes++;
  }
  return 0 !== backslashes % 2;
}

export function StatWhitespace(tokens: Uint8Array): [number, number, number] {
  let newlines = 0;
  let spaces = 0;
  let tabs = 0;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (ItemNewline === token) {
      newlines++;
    } else if (ItemSpace === token) {
      spaces++;
    } else if (ItemTab === token) {
      tabs++;
    }
  }
  return [newlines, spaces, tabs];
}

export function Spnl(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array] {
  let ret = false;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  let whitespaces: Uint8Array | null;
  [whitespaces, remains] = TrimLeft(tokens);
  passed = whitespaces ?? new Uint8Array(0);
  const [newlines] = StatWhitespace(passed);
  if (1 < newlines) {
    // Go returns nil for passed here; nil is not represented for this result.
    return [false, new Uint8Array(0), tokens];
  }
  ret = true;
  return [ret, passed, remains];
}

export function Peek(tokens: Uint8Array, pos: number): number {
  if (pos < tokens.length) {
    // PORT-NOTE: Go panics for a negative pos (index out of range). The TypeScript throw reproduces that panic. Upstream code, not fixed.
    if (pos < 0) {
      throw new RangeError("index out of range [" + pos + "]");
    }
    return tokens[pos];
  }
  return 0;
}

// BytesShowLength returns the length of the byte array when shown as a UTF8 string.
export function BytesShowLength(bytes: Uint8Array): number {
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    // Bitwise AND with 11000000 equals 10000000 means the byte is the first byte of a UTF8 sequence.
    if ((bytes[i] & 0xc0) !== 0x80) {
      if (bytes[i] < 0x7f) {
        length++;
      } else {
        length += 2;
      }
    }
  }
  return length;
}

export function RepeatBackslashBeforePipe(content: string): string {
  const buf = new bytes.Buffer();
  let last = 0;
  let backslashCnt = 0;
  // Go indexes the bytes of content, so the loop walks its UTF-8 bytes.
  const contentBytes = conv.BytesFromString(content);
  for (let i = 0; i < contentBytes.length; i++) {
    const b = contentBytes[i];
    if (ItemPipe === b) {
      if (ItemBackslash !== last) {
        buf.WriteByte(ItemBackslash);
      }
      if (1 <= backslashCnt) {
        buf.WriteByte(ItemBackslash);
      }
    }
    last = b;
    if (ItemBackslash === last) {
      backslashCnt++;
    } else {
      backslashCnt = 0;
    }
    buf.WriteByte(b);
  }
  return buf.String();
}

// PERF-TODO: each marker copies the whole tail after it, so the cost is O(length x markers). A single pass that builds the result once would avoid it.
export function EscapeCommonMarkers(tokens: Uint8Array): Uint8Array {
  for (let i = 0; i < tokens.length; i++) {
    if (IsCommonInlineMarker(tokens[i])) {
      const remains = slices.Append(new Uint8Array([ItemBackslash]), tokens.subarray(i));
      tokens = tokens.subarray(0, i);
      // PORT-NOTE: Go appends remains into the spare capacity of the caller's tokens, which overwrites the caller's bytes after i (the
      // dynamic audit found non-zero bytes overwritten here), so this uses slices.AppendInPlaceLikeGo, the pre-S1 code.
      tokens = slices.AppendInPlaceLikeGo(tokens, remains);
      i++;
    }
  }
  return tokens;
}

// PERF-TODO: same as EscapeCommonMarkers: each marker copies the whole tail after it.
export function EscapeProtyleMarkers(tokens: Uint8Array): Uint8Array {
  for (let i = 0; i < tokens.length; i++) {
    if (IsProtyleInlineMarker(tokens[i])) {
      const remains = slices.Append(new Uint8Array([ItemBackslash]), tokens.subarray(i));
      tokens = tokens.subarray(0, i);
      // PORT-NOTE: same in-place append as EscapeCommonMarkers, through slices.AppendInPlaceLikeGo.
      tokens = slices.AppendInPlaceLikeGo(tokens, remains);
      i++;
    }
  }
  return tokens;
}

export function IsCommonInlineMarker(token: number): boolean {
  switch (token) {
    case ItemAsterisk:
    case ItemUnderscore:
    case ItemBackslash:
    case ItemBacktick:
    case ItemTilde:
    case ItemDollar:
      return true;
    default:
      return false;
  }
}

export function IsProtyleInlineMarker(token: number): boolean {
  switch (token) {
    case ItemAsterisk:
    case ItemUnderscore:
    case ItemBackslash:
    case ItemBacktick:
    case ItemTilde:
    case ItemDollar:
    case ItemEqual:
    case ItemCaret:
    case ItemLess:
    case ItemGreater:
      return true;
    default:
      return false;
  }
}

export function IsMarker(token: number): boolean {
  switch (token) {
    case ItemAsterisk:
    case ItemUnderscore:
    case ItemOpenBracket:
    case ItemBang:
    case ItemNewline:
    case ItemBackslash:
    case ItemBacktick:
    case ItemLess:
    case ItemCloseBracket:
    case ItemAmpersand:
    case ItemTilde:
    case ItemDollar:
    case ItemOpenBrace:
    case ItemOpenParen:
    case ItemEqual:
    case ItemCrosshatch:
      return true;
    default:
      return false;
  }
}
