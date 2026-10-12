// Ported from html/escape_encode.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import { UnescapeString } from "./escape.ts";

const amp: Uint8Array = conv.BytesFromString("&amp;");
const lt: Uint8Array = conv.BytesFromString("&lt;");
const gt: Uint8Array = conv.BytesFromString("&gt;");
const quot: Uint8Array = conv.BytesFromString("&quot;");

export function UnescapeAttrVal(v: string): string {
  v = strings.ReplaceAll(v, editor.IALValEscNewLine, "\n");
  v = strings.ReplaceAll(v, "&#123;", "{");
  v = strings.ReplaceAll(v, "&#125;", "}");
  return UnescapeString(v);
}

export function EscapeAttrVal(v: string): string {
  let ret = "";
  ret = conv.StringFromBytes(EscapeHTML(conv.BytesFromString(v)));
  ret = strings.ReplaceAll(ret, "\n", editor.IALValEscNewLine);
  ret = strings.ReplaceAll(ret, "{", "&#123;");
  ret = strings.ReplaceAll(ret, "}", "&#125;");
  return ret;
}

export function UnescapeHTMLStr(h: string): string {
  return UnescapeString(h);
}

export function EscapeHTMLStr(h: string): string {
  return conv.StringFromBytes(EscapeHTML(conv.BytesFromString(h)));
}

// PORT-NOTE: byte offset. The input is converted through a JS string, so bytes that are
// not valid UTF-8 are not kept (conv.StringFromBytes), unlike Go's string(h).
export function UnescapeHTML(h: Uint8Array): Uint8Array {
  return conv.BytesFromString(UnescapeString(conv.StringFromBytes(h)));
}

// EscapeHTML escapes the characters &, <, > and " of html. When there is nothing to
// escape, the input array itself is returned.
export function EscapeHTML(html: Uint8Array): Uint8Array {
  let ret: Uint8Array = html;
  const length = html.length;
  let start = 0;
  let i = 0;
  let inited = false;
  for (; i < length; i++) {
    switch (html[i]) {
      case lex.ItemAmpersand:
        if (!inited) {
          // Lazy initialization reduces memory allocation, the same below.
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, amp);
        start = i + 1;
        break;
      case lex.ItemLess:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, lt);
        start = i + 1;
        break;
      case lex.ItemGreater:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, gt);
        start = i + 1;
        break;
      case lex.ItemDoublequote:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, quot);
        start = i + 1;
        break;
    }
  }
  if (inited) {
    ret = slices.Append(ret, html.subarray(start));
  }
  return ret;
}

// EncodeDestination percent-encodes rawurl, avoiding double encoding.
// It doesn't touch:
// - alphanumeric characters ([0-9a-zA-Z]);
// - percent-encoded characters (%[0-9a-fA-F]{2});
// - excluded characters ([;/?:@&=+$,-_.!~*'()#]).
// Invalid UTF-8 sequences are replaced with U+FFFD.
// PORT-NOTE: The Go code does not do what this comment says for invalid UTF-8. A byte that
// fails to decode (RuneError with size 1) is percent-encoded as its own byte, not as U+FFFD.
// The port keeps that behaviour; the vectors record it.
export function EncodeDestination(rawurl: Uint8Array): Uint8Array {
  // Acknowledgement: https://gitlab.com/golang-commonmark/mdurl

  const hexdigit = "0123456789ABCDEF";
  let ret: Uint8Array = slices.Make(0, 256);
  let i = 0;
  let token = 0;
  // PERF-TODO: rawurl.subarray(i) allocates a view per character; decoding by index would avoid it.
  while (i < rawurl.length) {
    const [r, rlen] = utf8.DecodeRune(rawurl.subarray(i));
    if (utf8.RuneSelf <= r) {
      for (let j = i, n = i + rlen; j < n; j++) {
        const b = rawurl[j];
        token = rawurl[j];
        ret = slices.AppendByte(ret, 0x25 /* % */);
        ret = slices.AppendByte(ret, hexdigit.charCodeAt((b >> 4) & 0xf));
        ret = slices.AppendByte(ret, hexdigit.charCodeAt(b & 0xf));
      }
    } else if (r === 0x25 /* % */) {
      token = rawurl[i];
      if (i + 2 < rawurl.length && lex.IsHexDigit(rawurl[i + 1]) && lex.IsHexDigit(rawurl[i + 2])) {
        ret = slices.AppendByte(ret, 0x25 /* % */);
        ret = slices.AppendByte(ret, lex.TokenToUpper(rawurl[i + 1]));
        ret = slices.AppendByte(ret, lex.TokenToUpper(rawurl[i + 2]));
        i += 2;
      } else {
        ret = slices.AppendByte(ret, 0x25 /* % */);
        ret = slices.AppendByte(ret, 0x32 /* 2 */);
        ret = slices.AppendByte(ret, 0x35 /* 5 */);
      }
    } else if (strings.IndexByte("!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~", r) === -1) {
      token = rawurl[i];
      ret = slices.AppendByte(ret, 0x25 /* % */);
      ret = slices.AppendByte(ret, hexdigit.charCodeAt((r >> 4) & 0xf));
      ret = slices.AppendByte(ret, hexdigit.charCodeAt(r & 0xf));
    } else {
      token = rawurl[i];
      ret = slices.AppendByte(ret, token);
    }
    i += rlen;
  }
  return ret;
}

// DecodeDestination decodes a percent-encoded URL.
// Invalid percent-encoded sequences are left as is.
// Invalid UTF-8 sequences are replaced with U+FFFD.
export function DecodeDestination(rawurl: Uint8Array): Uint8Array {
  // Acknowledgement: https://gitlab.com/golang-commonmark/mdurl

  // PERF-TODO: rawurl.subarray(i) allocates a view per character in the loop below; decoding by index would avoid it.
  const buf = new bytes.Buffer();
  let i = 0;
  // Go writes the bytes "\xEF\xBF\xBD", which is U+FFFD in UTF-8.
  const replacement = "�";
  outer: while (i < rawurl.length) {
    const [r, rlen] = utf8.DecodeRune(rawurl.subarray(i));
    if (r === 0x25 /* % */ && i + 2 < rawurl.length && lex.IsHexDigit(rawurl[i + 1]) && lex.IsHexDigit(rawurl[i + 2])) {
      let b = (unhex(rawurl[i + 1]) << 4) | unhex(rawurl[i + 2]);
      if (b < 0x80) {
        buf.WriteByte(b);
        i += 3;
        continue;
      }
      let n = 0;
      if ((b & 0xe0) === 0xc0) {
        n = 1;
      } else if ((b & 0xf0) === 0xe0) {
        n = 2;
      } else if ((b & 0xf8) === 0xf0) {
        n = 3;
      }
      if (n === 0) {
        buf.WriteString(replacement);
        i += 3;
        continue;
      }
      const rb: Uint8Array = slices.Make(n + 1);
      rb[0] = b;
      let j = i + 3;
      for (let k = 0; k < n; k++) {
        const adv = advance(rawurl, j);
        b = adv[0];
        j = adv[1];
        if (j > rawurl.length || (b & 0xc0) !== 0x80) {
          buf.WriteString(replacement);
          i += 3;
          continue outer;
        }
        rb[k + 1] = b;
      }
      const [rr] = utf8.DecodeRune(rb);
      buf.WriteRune(rr);
      i = j;
      continue;
    }
    buf.WriteRune(r);
    i += rlen;
  }
  return buf.Bytes();
}

// PORT-NOTE: Go panics for a byte that is not a hex digit. The callers test IsHexDigit
// first, so the throw is not reached from this package.
// PORT-NOTE: exported only so that escape.vectors.test.ts can call it. Go keeps it unexported.
export function unhex(b: number): number {
  if (lex.IsDigit(b)) {
    return b - 0x30;
  } else if (b >= 0x61 && b <= 0x66) {
    return b - 0x61 + 10;
  } else if (b >= 0x41 && b <= 0x46) {
    return b - 0x41 + 10;
  }
  throw new Error("unhex: not a hex digit");
}

// PORT-NOTE: exported only so that escape.vectors.test.ts can call it. Go keeps it unexported.
export function advance(s: Uint8Array, pos: number): [number, number] {
  if (pos >= s.length) {
    return [0, s.length + 1];
  }
  if (s[pos] !== 0x25 /* % */) {
    return [s[pos], pos + 1];
  }
  if (pos + 2 < s.length && lex.IsHexDigit(s[pos + 1]) && lex.IsHexDigit(s[pos + 2])) {
    return [(unhex(s[pos + 1]) << 4) | unhex(s[pos + 2]), pos + 3];
  }
  return [0x25 /* % */, pos + 1];
}
