// Ported from ast/table_rich.go @ 8e7896b6

import * as base64 from "../runtime/base64.ts";
import * as conv from "../runtime/conv.ts";
import * as json from "../runtime/json.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";

export const TableCellRichSpec = 1;
export const TableCellRichFormat = "kramdown";
export const TableCellRichAttribute = "data-sy-table-cell-rich";
export const TableCellRichIAL = "table-cell-rich";

// TableCellRich holds a table cell's rich text source; its format version is independent of the document spec version.
// Raw and Invalid are json:"-" in Go: they are not part of the encoded payload.
export class TableCellRich {
  Spec: number;
  Format: string;
  Content: string;
  Raw: string;
  Invalid: boolean;

  constructor() {
    this.Spec = 0;
    this.Format = "";
    this.Content = "";
    this.Raw = "";
    this.Invalid = false;
  }

  // Validate checks the payload version. A damaged internal payload stays in Raw so the caller can refuse to write it.
  // PORT-NOTE: Go's Validate and Encode accept a nil receiver (`if nil == rich`). A method
  // cannot be called on null in TypeScript, so callers that hold a nil TableCellRich must
  // check for null themselves and treat the result as Go does (Validate: no error, Encode: "").
  Validate(): Error | null {
    if (this.Invalid || "" !== this.Raw || TableCellRichSpec !== this.Spec || TableCellRichFormat !== this.Format) {
      return new Error(`unsupported table cell rich text format [${this.Spec}, ${this.Format}]`);
    }
    if (strings.ContainsRune(this.Content, 0) || !utf8.ValidString(this.Content)) {
      return new Error("table cell rich text contains invalid text");
    }
    return null;
  }

  // Encode encodes for internal Markdown and BlockDOM, so newlines, quotes and pipes cannot break the cell boundary.
  Encode(): string {
    if (this.Invalid || "" !== this.Raw) {
      return this.Raw;
    }
    // json.Marshal of the struct: keys in declaration order spec, format, content; Raw and Invalid are skipped.
    const data: Uint8Array = conv.BytesFromString(
      "{\"spec\":" + strconv.Itoa(this.Spec) +
      ",\"format\":" + json.QuoteString(this.Format) +
      ",\"content\":" + json.QuoteString(this.Content) + "}",
    );
    return base64.RawURLEncodeToString(data);
  }
}

// invalidTableCellRich is Go's &TableCellRich{Raw: encoded, Invalid: true}.
function invalidTableCellRich(encoded: string): TableCellRich {
  const rich = new TableCellRich();
  rich.Raw = encoded;
  rich.Invalid = true;
  return rich;
}

// rawMember is one top-level member of a JSON object: the unescaped key and the raw text of its value.
class rawMember {
  key: string;
  raw: string;

  constructor(key: string, raw: string) {
    this.key = key;
    this.raw = raw;
  }
}

// skipWS returns the index of the first non-JSON-whitespace character at or after i.
function skipWS(text: string, i: number): number {
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
      break;
    }
    i++;
  }
  return i;
}

// scanString returns the index just after the string literal that starts at text[i] (a '"').
// The text is known to be valid JSON, so escapes only need to skip the escaped character.
function scanString(text: string, i: number): number {
  i++;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 0x5c /* \ */) {
      i += 2;
      continue;
    }
    if (c === 0x22 /* " */) {
      return i + 1;
    }
    i++;
  }
  return i;
}

// scanValue returns the index just after the JSON value that starts at text[i].
function scanValue(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c === 0x22 /* " */) {
    return scanString(text, i);
  }
  if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
    let depth = 0;
    while (i < text.length) {
      const d = text.charCodeAt(i);
      if (d === 0x22) {
        i = scanString(text, i);
        continue;
      }
      if (d === 0x7b || d === 0x5b) {
        depth++;
      } else if (d === 0x7d || d === 0x5d) {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
      i++;
    }
    return i;
  }
  // number, true, false, null
  while (i < text.length) {
    const d = text.charCodeAt(i);
    if (d === 0x2c || d === 0x7d || d === 0x5d || d === 0x20 || d === 0x09 || d === 0x0a || d === 0x0d) {
      break;
    }
    i++;
  }
  return i;
}

// topLevelMembers lists the members of a top-level JSON object in document order, one entry per occurrence.
// PORT-NOTE: replaces the json.Unmarshal into map[string]json.RawMessage step, which keeps only the last value of
// a duplicate key. Go's struct decode still checks every occurrence, so the duplicates are kept here.
// text must be valid JSON whose top-level value is an object.
function topLevelMembers(text: string): rawMember[] {
  const out: rawMember[] = [];
  let i = skipWS(text, 0) + 1; // past '{'
  i = skipWS(text, i);
  if (text.charCodeAt(i) === 0x7d /* } */) {
    return out;
  }
  for (;;) {
    const keyEnd = scanString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipWS(text, keyEnd);
    i = skipWS(text, i + 1); // past ':'
    const valueEnd = scanValue(text, i);
    out.push(new rawMember(key, text.slice(i, valueEnd)));
    i = skipWS(text, valueEnd);
    if (text.charCodeAt(i) === 0x2c /* , */) {
      i = skipWS(text, i + 1);
      continue;
    }
    return out;
  }
}

// replaceLoneSurrogates replaces each unpaired UTF-16 surrogate with U+FFFD. Go's decoder does the same for a
// \uD800-style escape that is not followed by its pair.
function replaceLoneSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      out += "�";
    } else {
      out += s[i];
    }
  }
  return out;
}

// decodeStringLiteral returns the value of a JSON string literal (raw starts with '"').
function decodeStringLiteral(raw: string): string {
  return replaceLoneSurrogates(JSON.parse(raw) as string);
}

// decodeIntLiteral returns the value of a JSON number literal for a Go int field (strconv.ParseInt with base 10
// and bit size 64). It returns null when Go's struct decode would report an UnmarshalTypeError.
// PORT-NOTE: the value is a double, so values beyond 2^53 are rounded. The int64 range is checked on the exact
// BigInt value of the literal text, not on the rounded double. Callers only need Spec to compare with 1 for
// Validate, so the rounding does not change any result.
function decodeIntLiteral(raw: string): number | null {
  if (raw.length === 0 || raw.charCodeAt(0) === 0x22 || raw.charCodeAt(0) === 0x74 || raw.charCodeAt(0) === 0x66 ||
    raw.charCodeAt(0) === 0x5b || raw.charCodeAt(0) === 0x7b) {
    return null;
  }
  // Fractions and exponents are not integer syntax for ParseInt.
  if (raw.indexOf(".") >= 0 || raw.indexOf("e") >= 0 || raw.indexOf("E") >= 0) {
    return null;
  }
  const n = BigInt(raw);
  if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) {
    return null;
  }
  return Number(n);
}

// DecodeTableCellRich keeps an undecodable raw payload, so it is not silently overwritten as a plain cell.
// PORT-NOTE: Go returns a nil-free pointer here in every case (an invalid result has Invalid set), so the TypeScript
// result is never null.
export function DecodeTableCellRich(encoded: string): TableCellRich {
  const [data, err] = base64.RawURLDecodeString(encoded);
  if (err !== null || !utf8.Valid(data)) {
    return invalidTableCellRich(encoded);
  }
  const text = conv.StringFromBytes(data);

  // json.Unmarshal(data, &fields) with fields map[string]json.RawMessage: the whole text must be valid JSON,
  // and its top-level value must be an object (null gives a nil map in Go).
  let top: unknown;
  try {
    top = JSON.parse(text);
  } catch {
    return invalidTableCellRich(encoded);
  }
  if (top === null || typeof top !== "object" || Array.isArray(top)) {
    return invalidTableCellRich(encoded);
  }
  const members = topLevelMembers(text);

  // fields: duplicate keys count once, the last value wins.
  const fields = new Map<string, string>();
  for (const m of members) {
    fields.set(m.key, m.raw);
  }
  if (fields.size !== 3) {
    return invalidTableCellRich(encoded);
  }
  for (const key of ["spec", "format", "content"]) {
    const raw = fields.get(key);
    if (raw === undefined || raw === "null") {
      return invalidTableCellRich(encoded);
    }
  }

  // json.Unmarshal(data, rich): every occurrence of every member is decoded in order. A type error in any
  // occurrence makes the whole decode fail, even if a later occurrence of the same key is valid. A null is a no-op.
  const rich = new TableCellRich();
  for (const m of members) {
    if (m.raw === "null") {
      continue;
    }
    switch (m.key) {
      case "spec": {
        const spec = decodeIntLiteral(m.raw);
        if (spec === null) {
          return invalidTableCellRich(encoded);
        }
        rich.Spec = spec;
        break;
      }
      case "format":
      case "content": {
        if (m.raw.charCodeAt(0) !== 0x22) {
          return invalidTableCellRich(encoded);
        }
        const s = decodeStringLiteral(m.raw);
        if (m.key === "format") {
          rich.Format = s;
        } else {
          rich.Content = s;
        }
        break;
      }
    }
  }
  rich.Raw = "";
  rich.Invalid = false;
  return rich;
}
