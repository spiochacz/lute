// Ported from util/url.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// This file is copied from the standard library (net/url), to reduce dependencies
// and keep the generated JavaScript small.

// PORT-NOTE: Go works on the bytes of a string. PathEscape and PathUnescape take
// a JS string, and unescape and escape take a Uint8Array of its UTF-8 bytes and
// index bytes exactly as Go does. Escaping percent-encodes the UTF-8 bytes of
// non-ASCII characters. Unescaping rebuilds bytes and decodes them with
// conv.StringFromBytes, so an invalid sequence becomes U+FFFD (one per invalid
// byte) where Go would keep the byte.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as strconv from "../runtime/strconv.ts";
import * as utf8 from "../runtime/utf8.ts";

// PORT-NOTE: Go's `type encoding int` with iota constants; the type is unexported.
type encoding = number;

const encodePath: encoding = 1;
const encodePathSegment: encoding = 2;
const encodeHost: encoding = 3;
const encodeZone: encoding = 4;
const encodeUserPassword: encoding = 5;
const encodeQueryComponent: encoding = 6;
const encodeFragment: encoding = 7;

// percent25 is the bytes of "%25", computed once.
const percent25: Uint8Array = conv.BytesFromString("%25");

const upperHexDigits = "0123456789ABCDEF";
const lowerHexDigits = "0123456789abcdef";

// PORT-NOTE: port addition. Go's strconv.Quote works on bytes and writes each
// invalid byte as \xNN, which a JS string cannot hold. quoteBytes quotes the
// bytes of a Go string the same way: valid runes go through strconv.Quote, and
// each invalid byte becomes \xNN.
function quoteBytes(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const v = utf8.DecodeRunePacked(b, i);
    const r = v & 0xffffff;
    const size = v >>> 24;
    if (r === utf8.RuneError && size === 1) {
      out += "\\x" + lowerHexDigits[b[i] >> 4] + lowerHexDigits[b[i] & 15];
    } else {
      out += strconv.Quote(conv.StringFromRune(r)).slice(1, -1);
    }
    i += size;
  }
  return '"' + out + '"';
}

// PORT-NOTE: Go's EscapeError is a string type. Here the constructor takes the
// bytes of the Go string, so that an error value cut inside a multi-byte
// character keeps its bytes, and the message is Go's Error() text.
export class EscapeError extends Error {
  constructor(e: Uint8Array) {
    super("invalid URL escape " + quoteBytes(e));
  }
}

// PORT-NOTE: as EscapeError, the constructor takes the bytes of the Go string.
export class InvalidHostError extends Error {
  constructor(e: Uint8Array) {
    super("invalid character " + quoteBytes(e) + " in host name");
  }
}

// PathUnescape does the inverse transformation of PathEscape,
// converting each 3-byte encoded substring of the form "%AB" into the
// hex-decoded byte 0xAB. It returns an error if any % is not followed
// by two hexadecimal digits.
//
// PathUnescape is identical to QueryUnescape except that it does not
// unescape '+' to ' ' (space).
export function PathUnescape(s: string): [string, Error | null] {
  const [ret, err] = unescape(conv.BytesFromString(s), encodePathSegment);
  return [conv.StringFromBytes(ret), err];
}

// unescape unescapes a string; the mode specifies
// which section of the URL string is being unescaped.
// PORT-NOTE: takes the UTF-8 bytes of the Go string and returns bytes, which the
// caller decodes. On error the result is empty, as Go returns "". The name
// shadows the JavaScript global unescape inside this module.
function unescape(s: Uint8Array, mode: encoding): [Uint8Array, Error | null] {
  // Count %, check that they're well-formed.
  let n = 0;
  let hasPlus = false;
  for (let i = 0; i < s.length; ) {
    switch (s[i]) {
      case 0x25 /* % */:
        n++;
        if (i + 2 >= s.length || !ishex(s[i + 1]) || !ishex(s[i + 2])) {
          s = s.subarray(i);
          if (s.length > 3) {
            s = s.subarray(0, 3);
          }
          return [new Uint8Array(0), new EscapeError(s)];
        }
        // Per https://tools.ietf.org/html/rfc3986#page-21
        // in the host component %-encoding can only be used
        // for non-ASCII bytes.
        // But https://tools.ietf.org/html/rfc6874#section-2
        // introduces %25 being allowed to escape a percent sign
        // in IPv6 scoped-address literals. Yay.
        if (mode === encodeHost && unhex(s[i + 1]) < 8 && !bytes.Equal(s.subarray(i, i + 3), percent25)) {
          return [new Uint8Array(0), new EscapeError(s.subarray(i, i + 3))];
        }
        if (mode === encodeZone) {
          // RFC 6874 says basically "anything goes" for zone identifiers
          // and that even non-ASCII can be redundantly escaped,
          // but it seems prudent to restrict %-escaped bytes here to those
          // that are valid host name bytes in their unescaped form.
          // That is, you can use escaping in the zone identifier but not
          // to introduce bytes you couldn't just write directly.
          // But Windows puts spaces here! Yay.
          const v = (unhex(s[i + 1]) << 4) | unhex(s[i + 2]);
          if (!bytes.Equal(s.subarray(i, i + 3), percent25) && v !== 0x20 /* space */ && shouldEscape(v, encodeHost)) {
            return [new Uint8Array(0), new EscapeError(s.subarray(i, i + 3))];
          }
        }
        i += 3;
        break;
      case 0x2b /* + */:
        hasPlus = mode === encodeQueryComponent;
        i++;
        break;
      default:
        if ((mode === encodeHost || mode === encodeZone) && s[i] < 0x80 && shouldEscape(s[i], mode)) {
          return [new Uint8Array(0), new InvalidHostError(s.subarray(i, i + 1))];
        }
        i++;
        break;
    }
  }

  if (n === 0 && !hasPlus) {
    return [s, null];
  }

  const t: Uint8Array = new Uint8Array(s.length - 2 * n);
  let j = 0;
  for (let i = 0; i < s.length; ) {
    switch (s[i]) {
      case 0x25 /* % */:
        t[j] = (unhex(s[i + 1]) << 4) | unhex(s[i + 2]);
        j++;
        i += 3;
        break;
      case 0x2b /* + */:
        if (mode === encodeQueryComponent) {
          t[j] = 0x20; /* space */
        } else {
          t[j] = 0x2b; /* + */
        }
        j++;
        i++;
        break;
      default:
        t[j] = s[i];
        j++;
        i++;
        break;
    }
  }
  return [t, null];
}

// PathEscape escapes the string so it can be safely placed
// inside a URL path segment.
export function PathEscape(s: string): string {
  return conv.StringFromBytes(escape(conv.BytesFromString(s), encodePathSegment));
}

// escape escapes the bytes of a string, as Go's escape does for the string.
// PORT-NOTE: Go returns the input string itself when nothing is escaped, and
// uses a 64-byte stack buffer when the output fits. Here the output is a new
// array with the same contents in both cases.
function escape(s: Uint8Array, mode: encoding): Uint8Array {
  let spaceCount = 0;
  let hexCount = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (shouldEscape(c, mode)) {
      if (c === 0x20 /* space */ && mode === encodeQueryComponent) {
        spaceCount++;
      } else {
        hexCount++;
      }
    }
  }

  if (spaceCount === 0 && hexCount === 0) {
    return s;
  }

  const required = s.length + 2 * hexCount;
  const t: Uint8Array = new Uint8Array(required);

  if (hexCount === 0) {
    t.set(s);
    for (let i = 0; i < s.length; i++) {
      if (s[i] === 0x20 /* space */) {
        t[i] = 0x2b; /* + */
      }
    }
    return t;
  }

  let j = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 0x20 /* space */ && mode === encodeQueryComponent) {
      t[j] = 0x2b; /* + */
      j++;
    } else if (shouldEscape(c, mode)) {
      t[j] = 0x25; /* % */
      t[j + 1] = upperHexDigits.charCodeAt(c >> 4);
      t[j + 2] = upperHexDigits.charCodeAt(c & 15);
      j += 3;
    } else {
      t[j] = s[i];
      j++;
    }
  }
  return t;
}

// Return true if the specified character should be escaped when
// appearing in a URL string, according to RFC 3986.
//
// Please be informed that for now shouldEscape does not check all
// reserved characters correctly. See golang.org/issue/5684.
function shouldEscape(c: number, mode: encoding): boolean {
  // §2.3 Unreserved characters (alphanum)
  if ((0x41 /* A */ <= c && c <= 0x5a) /* Z */ || (0x61 /* a */ <= c && c <= 0x7a) /* z */ || (0x30 /* 0 */ <= c && c <= 0x39) /* 9 */) {
    return false;
  }

  if (mode === encodeHost || mode === encodeZone) {
    // §3.2.2 Host allows
    //	sub-delims = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
    // as part of reg-name.
    // We add : because we include :port as part of host.
    // We add [ ] because we include [ipv6]:port as part of host.
    // We add < > because they're the only characters left that
    // we could possibly allow, and Parse will reject them if we
    // escape them (because hosts can't use %-encoding for
    // ASCII bytes).
    switch (c) {
      case 0x21 /* ! */:
      case 0x24 /* $ */:
      case 0x26 /* & */:
      case 0x27 /* ' */:
      case 0x28 /* ( */:
      case 0x29 /* ) */:
      case 0x2a /* * */:
      case 0x2b /* + */:
      case 0x2c /* , */:
      case 0x3b /* ; */:
      case 0x3d /* = */:
      case 0x3a /* : */:
      case 0x5b /* [ */:
      case 0x5d /* ] */:
      case 0x3c /* < */:
      case 0x3e /* > */:
      case 0x22 /* " */:
        return false;
    }
  }

  switch (c) {
    case 0x2d /* - */:
    case 0x5f /* _ */:
    case 0x2e /* . */:
    case 0x7e /* ~ */:
      // §2.3 Unreserved characters (mark)
      return false;

    case 0x24 /* $ */:
    case 0x26 /* & */:
    case 0x2b /* + */:
    case 0x2c /* , */:
    case 0x2f /* / */:
    case 0x3a /* : */:
    case 0x3b /* ; */:
    case 0x3d /* = */:
    case 0x3f /* ? */:
    case 0x40 /* @ */:
      // §2.2 Reserved characters (reserved)
      // Different sections of the URL allow a few of
      // the reserved characters to appear unescaped.
      switch (mode) {
        case encodePath:
          // §3.3
          // The RFC allows : @ & = + $ but saves / ; , for assigning
          // meaning to individual path segments. This package
          // only manipulates the path as a whole, so we allow those
          // last three as well. That leaves only ? to escape.
          return c === 0x3f /* ? */;

        case encodePathSegment:
          // §3.3
          // The RFC allows : @ & = + $ but saves / ; , for assigning
          // meaning to individual path segments.
          return c === 0x2f /* / */ || c === 0x3b /* ; */ || c === 0x2c /* , */ || c === 0x3f /* ? */;

        case encodeUserPassword:
          // §3.2.1
          // The RFC allows ';', ':', '&', '=', '+', '$', and ',' in
          // userinfo, so we must escape only '@', '/', and '?'.
          // The parsing of userinfo treats ':' as special so we must escape
          // that too.
          return c === 0x40 /* @ */ || c === 0x2f /* / */ || c === 0x3f /* ? */ || c === 0x3a /* : */;

        case encodeQueryComponent:
          // §3.4
          // The RFC reserves (so we must escape) everything.
          return true;

        case encodeFragment:
          // §4.1
          // The RFC text is silent but the grammar allows
          // everything, so escape nothing.
          return false;
      }
  }

  if (mode === encodeFragment) {
    // RFC 3986 §2.2 allows not escaping sub-delims. A subset of sub-delims are
    // included in reserved from RFC 2396 §2.2. The remaining sub-delims do not
    // need to be escaped. To minimize potential breakage, we apply two restrictions:
    // (1) we always escape sub-delims outside of the fragment, and (2) we always
    // escape single quote to avoid breaking callers that had previously assumed that
    // single quotes would be escaped. See issue #19917.
    switch (c) {
      case 0x21 /* ! */:
      case 0x28 /* ( */:
      case 0x29 /* ) */:
      case 0x2a /* * */:
        return false;
    }
  }

  // Everything else must be escaped.
  return true;
}

function ishex(c: number): boolean {
  if (0x30 /* 0 */ <= c && c <= 0x39 /* 9 */) {
    return true;
  } else if (0x61 /* a */ <= c && c <= 0x66 /* f */) {
    return true;
  } else if (0x41 /* A */ <= c && c <= 0x46 /* F */) {
    return true;
  }
  return false;
}

function unhex(c: number): number {
  if (0x30 /* 0 */ <= c && c <= 0x39 /* 9 */) {
    return c - 0x30;
  } else if (0x61 /* a */ <= c && c <= 0x66 /* f */) {
    return c - 0x61 + 10;
  } else if (0x41 /* A */ <= c && c <= 0x46 /* F */) {
    return c - 0x41 + 10;
  }
  return 0;
}
