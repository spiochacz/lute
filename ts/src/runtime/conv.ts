// Go conversions between strings, bytes and runes: []byte(s), string(b),
// string(r), []rune(s) and string(rs) for the Lute TypeScript port.
//
// Limitation: a JS string cannot hold invalid UTF-8. Go strings are byte
// sequences and can carry invalid bytes, but a JS string is a sequence of UTF-16
// code units. StringFromBytes is therefore lossy for invalid input: every invalid
// byte becomes one U+FFFD (Go's per-byte rule, which differs from TextDecoder for
// truncated sequences), so the original bytes cannot be recovered. Lone
// surrogates in a JS string encode as U+FFFD (EF BF BD) in BytesFromString,
// which is also lossy in the same way.
//
// Port additions (not in Go): StringFromBytes is implemented here with
// utf8.DecodeRunePacked, because the per-byte decoding inside bytes.Buffer.String
// is not exported. The short ASCII fast path is also a port addition.

import * as utf8 from "./utf8.ts";

const encoder = new TextEncoder();
// decoder throws on invalid UTF-8 (fatal), so one pass both validates and decodes. ignoreBOM keeps a leading U+FEFF.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// asciiShortMax is the length up to which StringFromBytes checks for ASCII and
// builds the string without TextDecoder.
const asciiShortMax = 32;

// BytesFromString returns the UTF-8 encoding of s as a fresh array whose capacity
// equals its length (its own ArrayBuffer of exactly that size). Unpaired
// surrogates encode as U+FFFD (EF BF BD).
export function BytesFromString(s: string): Uint8Array {
  const out = encoder.encode(s);
  if (out.byteOffset === 0 && out.buffer.byteLength === out.length) {
    return out;
  }
  return new Uint8Array(out);
}

// StringFromBytes returns the string for the bytes of b, as Go's string(b).
// Valid UTF-8 decodes normally and keeps a leading U+FEFF. Each invalid byte
// becomes one U+FFFD.
export function StringFromBytes(b: Uint8Array): string {
  const n = b.length;
  if (n <= asciiShortMax) {
    let ascii = true;
    for (let i = 0; i < n; i++) {
      if (b[i] >= 0x80) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      let s = "";
      for (let i = 0; i < n; i++) {
        s += String.fromCharCode(b[i]);
      }
      return s;
    }
  }
  // PORT-NOTE: perf, departs from Go's string(b) conversion (no Lute source line; runtime layer): one fatal TextDecoder
  // pass replaces utf8.Valid plus a second decode. The fatal decoder rejects exactly the byte sequences utf8.Valid
  // rejects (overlong forms, surrogates, values above U+10FFFF, truncated sequences), and for valid input it gives the
  // same string as the non-fatal decoder did. Invalid input throws and takes the per-byte loop below, as before.
  try {
    return decoder.decode(b);
  } catch {
    // invalid UTF-8: fall through to the per-byte replacement below
  }
  let out = "";
  for (let i = 0; i < n; ) {
    const v = utf8.DecodeRunePacked(b, i);
    out += String.fromCodePoint(v & 0xffffff);
    i += v >>> 24;
  }
  return out;
}

// StringFromRune returns the string of the UTF-8 encoding of r, as Go's
// string(r). Invalid runes (negative, surrogates, above 0x10FFFF) give U+FFFD.
export function StringFromRune(r: number): string {
  if (!utf8.ValidRune(r)) {
    return "�";
  }
  return String.fromCodePoint(r);
}

// RunesFromString returns the code points of s, as Go's []rune(s). An unpaired
// surrogate becomes 0xFFFD.
export function RunesFromString(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; ) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    out.push(v & 0xffffff);
    i += v >>> 24;
  }
  return out;
}

// StringFromRunes returns the string of the runes rs, as Go's string([]rune).
// Each invalid rune becomes U+FFFD.
export function StringFromRunes(rs: number[]): string {
  let out = "";
  for (const r of rs) {
    out += StringFromRune(r);
  }
  return out;
}
