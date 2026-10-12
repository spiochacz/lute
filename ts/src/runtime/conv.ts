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
// is not exported. The short ASCII fast paths of BytesFromString and StringFromBytes are also port additions.

import * as utf8 from "./utf8.ts";

const encoder = new TextEncoder();
// decoder throws on invalid UTF-8 (fatal), so one pass both validates and decodes. ignoreBOM keeps a leading U+FEFF.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// asciiShortMax is the length up to which StringFromBytesSlow checks for ASCII and
// builds the string without TextDecoder.
const asciiShortMax = 32;

// decodeCacheMax is the length up to which StringFromBytes goes through the decode cache (DecodeCache).
const decodeCacheMax = 32;

// decodeCacheSlots is the number of slots of the module's decode cache (a power of two).
const decodeCacheSlots = 4096;

// asciiBytesMax is the length up to which BytesFromString fills the array with
// charCodeAt, stopping at the first non-ASCII code unit, instead of calling TextEncoder.
const asciiBytesMax = 256;

// BytesFromString returns the UTF-8 encoding of s as a fresh array whose capacity
// equals its length (its own ArrayBuffer of exactly that size). Unpaired
// surrogates encode as U+FFFD (EF BF BD).
// PORT-NOTE: perf, departs from Go's []byte(s) conversion (no Lute source line; runtime layer): a string of at most 256 code
// units is copied by a loop into new Uint8Array(length) while its code units are below 0x80; the first unit at or above 0x80
// sends the string to TextEncoder, as before. TextEncoder.encode has a fixed cost of several hundred nanoseconds per call, which
// dominated the HTML and block DOM converters. The bytes are the same (one byte per code unit for ASCII, and an ASCII prefix has
// no surrogates), and the result is the same kind of array with capacity equal to its length.
export function BytesFromString(s: string): Uint8Array {
  // typeof keeps the old behaviour for a value that is not a string (TextEncoder reads undefined as ""), which s.length would throw on.
  if (typeof s === "string" && s.length <= asciiBytesMax) {
    const n = s.length;
    const ret = new Uint8Array(n);
    let i = 0;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) {
        break;
      }
      ret[i] = c;
    }
    if (i === n) {
      return ret;
    }
  }
  const out = encoder.encode(s);
  if (out.byteOffset === 0 && out.buffer.byteLength === out.length) {
    return out;
  }
  return new Uint8Array(out);
}

// DecodeCache is a direct-mapped table of decoded short byte strings. A slot holds a private copy of the
// bytes it was filled from and the string those bytes decode to. A lookup hashes the bytes, then compares
// them with the copy, so a collision costs a miss and never a wrong string. Slots are overwritten, never evicted.
export class DecodeCache {
  mask: number;
  keys: (Uint8Array | undefined)[];
  vals: string[];

  constructor(slots: number) {
    if (slots < 1 || (slots & (slots - 1)) !== 0) {
      throw new Error("DecodeCache: slots must be a power of two");
    }
    this.mask = slots - 1;
    this.keys = new Array(slots);
    this.vals = new Array(slots);
  }
}

// defaultDecodeCache is the cache of StringFromBytes. It is module-level state with a fixed size.
const defaultDecodeCache = new DecodeCache(decodeCacheSlots);

// StringFromBytes returns the string for the bytes of b, as Go's string(b).
// Valid UTF-8 decodes normally and keeps a leading U+FEFF. Each invalid byte
// becomes one U+FFFD.
// PORT-NOTE: perf, departs from Go's string(b) conversion (no Lute source line; runtime layer): a string of at most 32 bytes
// is looked up in defaultDecodeCache first. The same few hundred short byte strings (attribute values, entity names, data-*
// keys, short texts) recur in one document, and a hit returns the string that StringFromBytesSlow gave for the same bytes.
// Strings are immutable, so sharing one is not visible to a caller. Empty input never uses the cache.
export function StringFromBytes(b: Uint8Array): string {
  if (b.length <= decodeCacheMax) {
    return StringFromBytesWithCache(defaultDecodeCache, b);
  }
  return StringFromBytesSlow(b);
}

// StringFromBytesWithCache is StringFromBytes with the cache given by the caller, so that a test can use a
// tiny table and force collisions. Inputs longer than decodeCacheMax bytes and the empty input are decoded
// without the cache.
export function StringFromBytesWithCache(cache: DecodeCache, b: Uint8Array): string {
  const n = b.length;
  if (n === 0 || n > decodeCacheMax) {
    return StringFromBytesSlow(b);
  }
  let h = 2166136261;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ b[i], 16777619);
  }
  const k = (h >>> 0) & cache.mask;
  const kb = cache.keys[k];
  if (kb !== undefined && kb.length === n) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (kb[i] !== b[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      return cache.vals[k];
    }
  }
  const str = StringFromBytesSlow(b);
  cache.keys[k] = b.slice();
  cache.vals[k] = str;
  return str;
}

// StringFromBytesSlow is the decoder behind StringFromBytes without the cache. It is the reference of the
// differential tests in conv.test.ts.
export function StringFromBytesSlow(b: Uint8Array): string {
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
      // One flat string. Building it with `s += String.fromCharCode(b[i])` leaves a chain of cons-strings for every result of 13
      // characters or more, which is kept alive with the string: 30 percent of the DOM tree of the CommonMark spec was such chains.
      return String.fromCharCode.apply(null, b as unknown as number[]);
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
