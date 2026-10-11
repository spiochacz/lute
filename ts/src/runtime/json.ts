// Port of the parts of Go's encoding/json used by Lute: the string encoder of
// json.Marshal. The JSON scanner that the TableCellRich decoder needs lives in
// ast/table_rich.ts, next to its only caller.
//
// Ported from Go 1.21 encoding/json (encode.go, appendString).

// PORT-NOTE: Go 1.21 writes control characters as a six-character escape with
// lowercase hex (backslash, u, 0, 0, then two hex digits) for every byte below
// 0x20 except newline, carriage return and tab. So backspace and form feed are
// written as the escapes for 0x08 and 0x0c. Go 1.22 changed this to the short
// forms backslash-b and backslash-f, which this port does NOT use. The reference
// build is Go 1.21.
// PORT-NOTE: Go also escapes the characters less-than, greater-than and ampersand
// as the escapes for 0x3c, 0x3e and 0x26 (HTML safety), and U+2028 and U+2029 as
// the escapes for those code points (JSONP safety).
// PORT-NOTE: a JS string cannot hold invalid UTF-8, so a lone surrogate (which Go
// would never see) is written as the escape for U+FFFD, the same as Go writes an
// invalid UTF-8 byte.

const hex = "0123456789abcdef";

// QuoteString returns s as a JSON string literal, encoded like Go 1.21 json.Marshal.
export function QuoteString(s: string): string {
  // PERF-TODO: string concatenation per character; a chunked copy would be faster for long strings.
  let out = "\"";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20) {
      switch (c) {
        case 0x0a /* \n */:
          out += "\\n";
          break;
        case 0x0d /* \r */:
          out += "\\r";
          break;
        case 0x09 /* \t */:
          out += "\\t";
          break;
        default:
          // Go 1.21: the six-character escape for backspace, form feed and every other control character.
          out += "\\u00" + hex[c >> 4] + hex[c & 0xf];
          break;
      }
    } else if (c === 0x22 /* " */) {
      out += "\\\"";
    } else if (c === 0x5c /* \ */) {
      out += "\\\\";
    } else if (c === 0x3c /* < */) {
      out += "\\u003c";
    } else if (c === 0x3e /* > */) {
      out += "\\u003e";
    } else if (c === 0x26 /* & */) {
      out += "\\u0026";
    } else if (c === 0x2028 || c === 0x2029) {
      out += "\\u202" + (c === 0x2028 ? "8" : "9");
    } else if (c >= 0xd800 && c <= 0xdfff) {
      // A surrogate pair is one code point and is kept as is; a lone surrogate
      // has no UTF-8 form and becomes U+FFFD.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        out += "\\ufffd";
      }
    } else {
      out += s[i];
    }
  }
  return out + "\"";
}
