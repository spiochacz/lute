// Ported from html/escape.go @ 8e7896b6
// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";
import { lookupEntity } from "./entity.ts";

// These replacements permit compatibility with old numeric entities that
// assumed Windows-1252 encoding.
// https://html.spec.whatwg.org/multipage/syntax.html#consume-a-character-reference
const replacementTable: number[] = [
  0x20ac, // First entry is what 0x80 should be replaced with.
  0x0081,
  0x201a,
  0x0192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x02c6,
  0x2030,
  0x0160,
  0x2039,
  0x0152,
  0x008d,
  0x017d,
  0x008f,
  0x0090,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x02dc,
  0x2122,
  0x0161,
  0x203a,
  0x0153,
  0x009d,
  0x017e,
  0x0178, // Last entry is 0x9F.
  // 0x00->'�' is handled programmatically.
  // 0x0D->'\u000D' is a no-op.
];

// unescapeEntity reads an entity like "&lt;" from b[src:] and writes the
// corresponding "<" to b[dst:], returning the incremented dst and src cursors.
// Precondition: b[src] == '&' && dst <= src.
// attribute should be true if parsing an attribute value.
// PORT-NOTE: exported only so that escape.vectors.test.ts can call it. Go keeps it unexported.
export function unescapeEntity(b: Uint8Array, dst: number, src: number, attribute: boolean): [number, number] {
  let dst1 = 0;
  let src1 = 0;

  // https://html.spec.whatwg.org/multipage/syntax.html#consume-a-character-reference

  // i starts at 1 because we already know that s[0] == '&'.
  let i = 1;
  const s = b.subarray(src);

  if (s.length <= 1) {
    b[dst] = b[src];
    return [dst + 1, src + 1];
  }

  if (s[i] === 0x23 /* # */) {
    if (s.length <= 3) {
      // We need to have at least "&#.".
      b[dst] = b[src];
      return [dst + 1, src + 1];
    }
    i++;
    let c = s[i];
    let hex = false;
    if (c === 0x78 /* x */ || c === 0x58 /* X */) {
      hex = true;
      i++;
    }

    // PORT-NOTE: x is a Go rune (int32), so the arithmetic wraps at 32 bits. Math.imul and
    // "| 0" reproduce that wrap for long digit runs.
    let x = 0;
    while (i < s.length) {
      c = s[i];
      i++;
      if (hex) {
        if (0x30 <= c && c <= 0x39) {
          x = (Math.imul(16, x) + c - 0x30) | 0;
          continue;
        } else if (0x61 <= c && c <= 0x66) {
          x = (Math.imul(16, x) + c - 0x61 + 10) | 0;
          continue;
        } else if (0x41 <= c && c <= 0x46) {
          x = (Math.imul(16, x) + c - 0x41 + 10) | 0;
          continue;
        }
      } else if (0x30 <= c && c <= 0x39) {
        x = (Math.imul(10, x) + c - 0x30) | 0;
        continue;
      }
      if (c !== 0x3b /* ; */) {
        i--;
      }
      break;
    }

    if (i <= 3) {
      // No characters matched.
      b[dst] = b[src];
      return [dst + 1, src + 1];
    }

    if (0x80 <= x && x <= 0x9f) {
      // Replace characters from Windows-1252 with UTF-8 equivalents.
      x = replacementTable[x - 0x80];
    } else if (x === 0 || (0xd800 <= x && x <= 0xdfff) || x > 0x10ffff) {
      // Replace invalid characters with the replacement character.
      x = 0xfffd;
    }

    return [dst + utf8.EncodeRune(b.subarray(dst), x), src + i];
  }

  // Consume the maximum number of characters possible, with the
  // consumed characters matching one of the named references.

  while (i < s.length) {
    const c = s[i];
    i++;
    // Lower-cased characters are more common in entities, so we check for them first.
    if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a) || (0x30 <= c && c <= 0x39)) {
      continue;
    }
    if (c !== 0x3b /* ; */) {
      i--;
    }
    break;
  }

  let max = i;
  if (max < 1) {
    max = 1;
  }
  // PORT-NOTE: byte offset. entityName holds only ASCII letters, digits and ';', so its
  // length in UTF-16 units equals its length in bytes.
  const entityName = conv.StringFromBytes(s.subarray(1, max));
  if (entityName === "") {
    // No-op.
  } else if (attribute && entityName.charCodeAt(entityName.length - 1) !== 0x3b /* ; */ && s.length > i && s[i] === 0x3d /* = */) {
    // No-op.
  } else {
    const x = lookupEntity(entityName);
    if (x !== "") {
      return [dst + utf8.EncodeRune(b.subarray(dst), conv.RunesFromString(x)[0]), src + i];
    }
    if (!attribute) {
      // PORT-NOTE: byte offset. entityName is ASCII, so len(entityName) is the same in bytes.
      let maxLen = entityName.length - 1;
      if (maxLen > 6) {
        maxLen = 6;
      }
      for (let j = maxLen; j > 1; j--) {
        const y = lookupEntity(entityName.slice(0, j));
        if (y !== "") {
          return [dst + utf8.EncodeRune(b.subarray(dst), conv.RunesFromString(y)[0]), src + j + 1];
        }
      }
    }
  }

  dst1 = dst + i;
  src1 = src + i;
  slices.Copy(b.subarray(dst, dst1), b.subarray(src, src1));
  return [dst1, src1];
}

// unescape unescapes b's entities in-place, so that "a&lt;b" becomes "a<b".
// attribute should be true if parsing an attribute value.
export function unescape(b: Uint8Array, attribute: boolean): Uint8Array {
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0x26 /* & */) {
      let [dst, src] = unescapeEntity(b, i, i, attribute);
      while (src < b.length) {
        const c2 = b[src];
        if (c2 === 0x26 /* & */) {
          [dst, src] = unescapeEntity(b, dst, src, attribute);
        } else {
          b[dst] = c2;
          dst = dst + 1;
          src = src + 1;
        }
      }
      return b.subarray(0, dst);
    }
  }
  return b;
}

// lower lower-cases the A-Z bytes in b in-place, so that "aBc" becomes "abc".
export function lower(b: Uint8Array): Uint8Array {
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (0x41 <= c && c <= 0x5a) {
      b[i] = c + 0x20;
    }
  }
  return b;
}

const escapedChars = "&'<>\"\r";

// escape writes s to w with the special characters escaped.
// PORT-NOTE: Go's writer interface is defined in render.go; here the writer is the runtime bytes.Buffer.
// The writer is the runtime bytes.Buffer, which has no error results, so the error checks
// of Go are not needed: the function always returns null.
export function escape(w: bytes.Buffer, s: string): Error | null {
  let i = strings.IndexAny(s, escapedChars);
  while (i !== -1) {
    w.WriteString(s.slice(0, i));
    let esc = "";
    switch (s.charCodeAt(i)) {
      case 0x26: // &
        esc = "&amp;";
        break;
      case 0x27: // '
        // "&#39;" is shorter than "&apos;" and apos was not in HTML until HTML5.
        esc = "&#39;";
        break;
      case 0x3c: // <
        esc = "&lt;";
        break;
      case 0x3e: // >
        esc = "&gt;";
        break;
      case 0x22: // "
        // "&#34;" is shorter than "&quot;".
        esc = "&#34;";
        break;
      case 0x0d: // \r
        esc = "&#13;";
        break;
      default:
        throw new Error("unrecognized escape character");
    }
    s = s.slice(i + 1);
    w.WriteString(esc);
    i = strings.IndexAny(s, escapedChars);
  }
  w.WriteString(s);
  return null;
}

// EscapeString escapes special characters like "<" to become "&lt;". It
// escapes only five such characters: <, >, &, ' and ".
// UnescapeString(EscapeString(s)) == s always holds, but the converse isn't
// always true.
export function EscapeString(s: string): string {
  if (strings.IndexAny(s, escapedChars) === -1) {
    return s;
  }
  const buf = new bytes.Buffer();
  escape(buf, s);
  return buf.String();
}

// UnescapeString unescapes entities like "&lt;" to become "<". It unescapes a
// larger range of entities than EscapeString escapes. For example, "&aacute;"
// unescapes to "á", as does "&#225;" and "&xE1;".
// UnescapeString(EscapeString(s)) == s always holds, but the converse isn't
// always true.
export function UnescapeString(s: string): string {
  for (let i = 0; i < s.length; ) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    if ((v & 0xffffff) === 0x26 /* & */) {
      return conv.StringFromBytes(unescape(conv.BytesFromString(s), false));
    }
    i += v >>> 24;
  }
  return s;
}
