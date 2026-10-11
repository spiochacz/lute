// Port of Go's bytes package (the functions Lute uses) and bytes.Buffer.
//
// Conventions:
// - Go []byte is Uint8Array; Go byte and rune are number; Go string is a JS string.
// - Go returns nil for some empty results. Here every nil becomes an empty
//   Uint8Array (never null). Go's nil-ness is recorded in the vectors but not
//   represented.
// - Functions that return a sub-slice of their input in Go (TrimSpace, TrimPrefix,
//   TrimLeft, Split elements, CutPrefix, ...) return a subarray VIEW of the same
//   buffer, not a copy. Functions that allocate in Go (ReplaceAll, ToLower,
//   Repeat, Join, ...) return a fresh array.
// - String arguments (cutset, chars) are sets of code points.
// - Invalid UTF-8 follows Go: each invalid byte decodes as one RuneError.
//
// Port additions (not in Go): HasPrefixAt and IndexByteFrom.
//
// Go's three-index slices (s[:m:m]) used by Split and explode cannot be
// represented with typed arrays. Their elements here have capacity up to the end
// of the source buffer. See slices.ts.

import * as utf8 from "./utf8.ts";
import * as unicode from "./unicode.ts";
import { Cap, Clone, Copy } from "./slices.ts";

const emptyBytes = (): Uint8Array => new Uint8Array(0);

// ASCII white space as defined by Go's bytes.asciiSpace.
const asciiSpace = new Uint8Array(256);
for (const c of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]) {
  asciiSpace[c] = 1;
}

const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

// scratch is used by WriteRune to encode a rune before copying it.
const scratch = new Uint8Array(4);

// inCutset reports whether the code point r is one of the code points of the
// string set. It scans the string as Array.from does, one code point at a time,
// so it matches the old codePoints-based lookup without building an array per
// call.
function inCutset(set: string, r: number): boolean {
  for (let i = 0; i < set.length; i++) {
    const c = set.codePointAt(i) as number;
    if (c > 0xffff) {
      i++;
    }
    if (c === r) {
      return true;
    }
  }
  return false;
}

// PORT-NOTE: perf, departs from 1:1 (Go stdlib bytes.TrimLeft, TrimRight): the cutsets used by Lute are short and fixed, and inCutset scans the cutset for every code point. asciiCutsetCache keeps, per cutset, a 128-entry membership table when every code point of the cutset is ASCII, and null otherwise (those keep inCutset). A code point of 0x80 or more is never in an ASCII cutset, so the table answers exactly what inCutset answers, for every input byte including invalid UTF-8 (RuneError, 0xFFFD, is not ASCII).
const asciiCutsetCache = new Map<string, Uint8Array | null>();
const asciiCutsetCacheMax = 64; // Cutsets beyond this many distinct strings are not cached, so an unbounded set of cutsets cannot grow the map.

// cutsetTable returns the membership table of cutset (1 for each ASCII code point of it), or null when cutset has a non-ASCII code unit.
function cutsetTable(cutset: string): Uint8Array | null {
  const cached = asciiCutsetCache.get(cutset);
  if (cached !== undefined) {
    return cached;
  }
  const table = new Uint8Array(128);
  let result: Uint8Array | null = table;
  for (let i = 0; i < cutset.length; i++) {
    const c = cutset.charCodeAt(i);
    if (c >= 0x80) {
      result = null;
      break;
    }
    table[c] = 1;
  }
  if (asciiCutsetCache.size < asciiCutsetCacheMax) {
    asciiCutsetCache.set(cutset, result);
  }
  return result;
}

// inCutsetTable reports whether the code point r is in cutset. table is cutsetTable(cutset); when it is null, the string is scanned.
function inCutsetTable(cutset: string, table: Uint8Array | null, r: number): boolean {
  if (table === null) {
    return inCutset(cutset, r);
  }
  return r < 0x80 && table[r] === 1;
}

// equalAt reports whether p occurs in s starting at off. The caller guarantees
// that off + p.length <= s.length.
function equalAt(s: Uint8Array, off: number, p: Uint8Array): boolean {
  for (let i = 0; i < p.length; i++) {
    if (s[off + i] !== p[i]) {
      return false;
    }
  }
  return true;
}

// indexFrom returns the absolute index of the first instance of sep in s at or
// after from, or -1. An empty sep returns from (callers keep from <= s.length).
function indexFrom(s: Uint8Array, sep: Uint8Array, from: number): number {
  const n = sep.length;
  if (n === 0) {
    return from;
  }
  const last = s.length - n;
  if (last < from) {
    return -1;
  }
  const c0 = sep[0];
  let i = s.indexOf(c0, from);
  while (i !== -1 && i <= last) {
    if (equalAt(s, i, sep)) {
      return i;
    }
    i = s.indexOf(c0, i + 1);
  }
  return -1;
}

// Equal reports whether a and b have the same length and contents.
export function Equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && equalAt(a, 0, b);
}

// EqualFold reports whether s and t are equal under simple Unicode case folding.
// Invalid bytes decode as RuneError and compare equal to each other, as in Go.
export function EqualFold(s: Uint8Array, t: Uint8Array): boolean {
  const minLen = Math.min(s.length, t.length);
  let i = 0;
  let hasUnicode = false;
  for (; i < minLen; i++) {
    const sr = s[i];
    const tr = t[i];
    if ((sr | tr) >= 0x80) {
      hasUnicode = true;
      break;
    }
    if (tr === sr) {
      continue;
    }
    let lo = sr;
    let hi = tr;
    if (hi < lo) {
      lo = tr;
      hi = sr;
    }
    if (lo >= 0x41 && lo <= 0x5a && hi === lo + 0x20) {
      continue;
    }
    return false;
  }
  if (!hasUnicode) {
    return s.length === t.length;
  }

  let ps = i;
  let pt = i;
  while (ps < s.length && pt < t.length) {
    let sr: number;
    let sw: number;
    let tr: number;
    let tw: number;
    if (s[ps] < 0x80) {
      sr = s[ps];
      sw = 1;
    } else {
      const v = utf8.DecodeRunePacked(s, ps);
      sr = v & 0xffffff;
      sw = v >>> 24;
    }
    if (t[pt] < 0x80) {
      tr = t[pt];
      tw = 1;
    } else {
      const v = utf8.DecodeRunePacked(t, pt);
      tr = v & 0xffffff;
      tw = v >>> 24;
    }
    ps += sw;
    pt += tw;

    if (tr === sr) {
      continue;
    }
    let lo = sr;
    let hi = tr;
    if (hi < lo) {
      lo = tr;
      hi = sr;
    }
    if (hi < 0x80) {
      if (lo >= 0x41 && lo <= 0x5a && hi === lo + 0x20) {
        continue;
      }
      return false;
    }
    // General case: walk the fold orbit of lo until it reaches or passes hi.
    let r = unicode.SimpleFold(lo);
    while (r !== lo && r < hi) {
      r = unicode.SimpleFold(r);
    }
    if (r === hi) {
      continue;
    }
    return false;
  }
  return s.length - ps === t.length - pt;
}

// HasPrefix reports whether s begins with prefix.
export function HasPrefix(s: Uint8Array, prefix: Uint8Array): boolean {
  return s.length >= prefix.length && equalAt(s, 0, prefix);
}

// HasSuffix reports whether s ends with suffix.
export function HasSuffix(s: Uint8Array, suffix: Uint8Array): boolean {
  return s.length >= suffix.length && equalAt(s, s.length - suffix.length, suffix);
}

// HasPrefixAt is a port addition. It is the same as
// HasPrefix(s.subarray(off), prefix) without allocating. It returns false when
// off is outside [0, s.length].
export function HasPrefixAt(s: Uint8Array, off: number, prefix: Uint8Array): boolean {
  if (!Number.isInteger(off) || off < 0 || off > s.length) {
    return false;
  }
  return s.length - off >= prefix.length && equalAt(s, off, prefix);
}

// IndexByteFrom is a port addition. It returns the absolute index of the first
// instance of byte c in s at or after from, or -1.
export function IndexByteFrom(s: Uint8Array, c: number, from: number): number {
  return s.indexOf(c, from < 0 ? 0 : from);
}

// IndexByte returns the index of the first instance of c in b, or -1.
export function IndexByte(b: Uint8Array, c: number): number {
  return b.indexOf(c);
}

// Index returns the index of the first instance of sep in s, or -1. An empty sep
// returns 0.
export function Index(s: Uint8Array, sep: Uint8Array): number {
  return indexFrom(s, sep, 0);
}

// Contains reports whether subslice is within b.
export function Contains(b: Uint8Array, subslice: Uint8Array): boolean {
  return indexFrom(b, subslice, 0) !== -1;
}

// IndexAny returns the byte index of the first code point of s that is in chars,
// or -1. An empty chars returns -1. Invalid bytes decode as RuneError.
export function IndexAny(s: Uint8Array, chars: string): number {
  if (chars === "") {
    return -1;
  }
  let i = 0;
  while (i < s.length) {
    let r: number;
    let w: number;
    if (s[i] < 0x80) {
      r = s[i];
      w = 1;
    } else {
      const v = utf8.DecodeRunePacked(s, i);
      r = v & 0xffffff;
      w = v >>> 24;
    }
    if (inCutset(chars, r)) {
      return i;
    }
    i += w;
  }
  return -1;
}

// ContainsAny reports whether any code point of chars is within b.
export function ContainsAny(b: Uint8Array, chars: string): boolean {
  return IndexAny(b, chars) >= 0;
}

// LastIndexByte returns the index of the last instance of c in s, or -1.
export function LastIndexByte(s: Uint8Array, c: number): number {
  return s.lastIndexOf(c);
}

// LastIndex returns the index of the last instance of sep in s, or -1. An empty
// sep returns len(s).
export function LastIndex(s: Uint8Array, sep: Uint8Array): number {
  const n = sep.length;
  if (n === 0) {
    return s.length;
  }
  if (n === 1) {
    return LastIndexByte(s, sep[0]);
  }
  if (n > s.length) {
    return -1;
  }
  for (let i = s.length - n; i >= 0; i--) {
    if (equalAt(s, i, sep)) {
      return i;
    }
  }
  return -1;
}

// Count counts the non-overlapping instances of sep in s. An empty sep returns
// the number of UTF-8 sequences in s (invalid bytes count as one each) plus 1.
export function Count(s: Uint8Array, sep: Uint8Array): number {
  if (sep.length === 0) {
    return utf8.RuneCount(s) + 1;
  }
  let n = 0;
  let off = 0;
  for (;;) {
    const i = indexFrom(s, sep, off);
    if (i === -1) {
      return n;
    }
    n++;
    off = i + sep.length;
  }
}

// explode splits s into UTF-8 sequences, at most n of them. The last element
// holds the unsplit remainder. Invalid bytes are split into single bytes.
function explode(s: Uint8Array, n: number): Uint8Array[] {
  if (n <= 0 || n > s.length) {
    n = s.length;
  }
  const a: Uint8Array[] = [];
  let off = 0;
  while (off < s.length) {
    if (a.length + 1 >= n) {
      a.push(s.subarray(off));
      break;
    }
    const size = utf8.DecodeRunePacked(s, off) >>> 24;
    a.push(s.subarray(off, off + size));
    off += size;
  }
  return a;
}

// genSplit is Go's bytes.genSplit. sepSave is how many bytes of the separator
// are kept at the end of each element (len(sep) for SplitAfter, else 0). n > 0
// caps the number of elements, n < 0 means no cap, and n == 0 returns none.
function genSplit(s: Uint8Array, sep: Uint8Array, sepSave: number, n: number): Uint8Array[] {
  if (n === 0) {
    return [];
  }
  if (sep.length === 0) {
    return explode(s, n);
  }
  if (n < 0) {
    n = Count(s, sep) + 1;
  }
  if (n > s.length + 1) {
    n = s.length + 1;
  }
  const a: Uint8Array[] = [];
  n--;
  let off = 0;
  while (a.length < n) {
    const m = indexFrom(s, sep, off);
    if (m < 0) {
      break;
    }
    a.push(s.subarray(off, m + sepSave));
    off = m + sep.length;
  }
  a.push(s.subarray(off));
  return a;
}

// Split slices s around each instance of sep. An empty sep splits after each
// UTF-8 sequence.
export function Split(s: Uint8Array, sep: Uint8Array): Uint8Array[] {
  return genSplit(s, sep, 0, -1);
}

// SplitN is Split with at most n elements; n == 0 returns none, n < 0 is no limit.
export function SplitN(s: Uint8Array, sep: Uint8Array, n: number): Uint8Array[] {
  return genSplit(s, sep, 0, n);
}

// SplitAfter is Split, but each element keeps its trailing separator.
export function SplitAfter(s: Uint8Array, sep: Uint8Array): Uint8Array[] {
  return genSplit(s, sep, sep.length, -1);
}

// Join concatenates the elements of s, separated by sep. It returns a fresh array.
export function Join(s: Uint8Array[], sep: Uint8Array): Uint8Array {
  if (s.length === 0) {
    return emptyBytes();
  }
  if (s.length === 1) {
    return Clone(s[0]);
  }
  let total = sep.length * (s.length - 1);
  for (const v of s) {
    total += v.length;
  }
  const b = new Uint8Array(total);
  b.set(s[0], 0);
  let bp = s[0].length;
  for (let i = 1; i < s.length; i++) {
    b.set(sep, bp);
    bp += sep.length;
    b.set(s[i], bp);
    bp += s[i].length;
  }
  return b;
}

// Repeat returns a fresh array of count copies of b. It throws for a negative
// count or an overflowing length, as Go panics.
export function Repeat(b: Uint8Array, count: number): Uint8Array {
  if (count === 0) {
    return emptyBytes();
  }
  if (count < 0) {
    throw new RangeError("bytes: negative Repeat count");
  }
  const n = b.length * count;
  if (!Number.isSafeInteger(n)) {
    throw new RangeError("bytes: Repeat output length overflow");
  }
  if (b.length === 0) {
    return emptyBytes();
  }
  const nb = new Uint8Array(n);
  nb.set(b, 0);
  let bp = b.length;
  while (bp < n) {
    const chunk = Math.min(bp, n - bp);
    nb.copyWithin(bp, 0, chunk);
    bp += chunk;
  }
  return nb;
}

// mapRunes returns a fresh array with f applied to each rune of s. Invalid
// bytes map through RuneError, so they are written as EF BF BD (as in Go's Map).
function mapRunes(s: Uint8Array, f: (r: number) => number): Uint8Array {
  const out = new Buffer();
  for (let i = 0; i < s.length; ) {
    let r = s[i];
    let wid = 1;
    if (r >= 0x80) {
      const v = utf8.DecodeRunePacked(s, i);
      r = v & 0xffffff;
      wid = v >>> 24;
    }
    const m = f(r);
    if (m >= 0) {
      out.WriteRune(m);
    }
    i += wid;
  }
  return out.Bytes();
}

// ToLower returns a fresh array with all Unicode letters mapped to lower case.
export function ToLower(s: Uint8Array): Uint8Array {
  let isASCII = true;
  let hasUpper = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= 0x80) {
      isASCII = false;
      break;
    }
    hasUpper = hasUpper || (c >= 0x41 && c <= 0x5a);
  }
  if (isASCII) {
    if (!hasUpper) {
      return Clone(s);
    }
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      b[i] = c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
    }
    return b;
  }
  return mapRunes(s, unicode.ToLower);
}

// Trim removes the leading and trailing code points of s that are in cutset.
export function Trim(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return emptyBytes();
  }
  if (cutset === "") {
    return s;
  }
  return TrimLeft(TrimRight(s, cutset), cutset);
}

// TrimLeft returns a view of s without the leading code points that are in cutset.
export function TrimLeft(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return emptyBytes();
  }
  if (cutset === "") {
    return s;
  }
  // PORT-NOTE: perf, departs from 1:1 (Go stdlib bytes.TrimLeft): membership through cutsetTable, see asciiCutsetCache.
  const table = cutsetTable(cutset);
  let start = 0;
  while (start < s.length) {
    let r = s[start];
    let w = 1;
    if (r >= 0x80) {
      const v = utf8.DecodeRunePacked(s, start);
      r = v & 0xffffff;
      w = v >>> 24;
    }
    if (!inCutsetTable(cutset, table, r)) {
      break;
    }
    start += w;
  }
  if (start === s.length) {
    return emptyBytes();
  }
  return s.subarray(start);
}

// TrimRight returns a view of s without the trailing code points that are in cutset.
export function TrimRight(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0 || cutset === "") {
    return s;
  }
  // PORT-NOTE: perf, departs from 1:1 (Go stdlib bytes.TrimRight): membership through cutsetTable, see asciiCutsetCache.
  const table = cutsetTable(cutset);
  let end = s.length;
  while (end > 0) {
    let r = s[end - 1];
    let w = 1;
    if (r >= 0x80) {
      const v = utf8.DecodeLastRunePacked(s, end);
      r = v & 0xffffff;
      w = v >>> 24;
    }
    if (!inCutsetTable(cutset, table, r)) {
      break;
    }
    end -= w;
  }
  return s.subarray(0, end);
}

// TrimSpace returns a view of s without leading and trailing white space as
// defined by unicode.IsSpace.
export function TrimSpace(s: Uint8Array): Uint8Array {
  let start = 0;
  while (start < s.length) {
    const c = s[start];
    if (c < 0x80) {
      if (asciiSpace[c] === 0) {
        break;
      }
      start++;
      continue;
    }
    const v = utf8.DecodeRunePacked(s, start);
    const r = v & 0xffffff;
    const w = v >>> 24;
    if (!unicode.IsSpace(r)) {
      break;
    }
    start += w;
  }
  let stop = s.length;
  while (stop > start) {
    const c = s[stop - 1];
    if (c < 0x80) {
      if (asciiSpace[c] === 0) {
        break;
      }
      stop--;
      continue;
    }
    const v = utf8.DecodeLastRunePacked(s, stop, start);
    const r = v & 0xffffff;
    const w = v >>> 24;
    if (!unicode.IsSpace(r)) {
      break;
    }
    stop -= w;
  }
  if (start === stop) {
    return emptyBytes();
  }
  return s.subarray(start, stop);
}

// Replace returns a fresh array with the first n non-overlapping instances of old
// replaced by nw. An empty old matches at the start and after each UTF-8
// sequence. n < 0 means no limit.
export function Replace(s: Uint8Array, old: Uint8Array, nw: Uint8Array, n: number): Uint8Array {
  let m = 0;
  if (n !== 0) {
    m = Count(s, old);
  }
  if (m === 0) {
    return Clone(s);
  }
  if (n < 0 || m < n) {
    n = m;
  }
  const t = new Uint8Array(s.length + n * (nw.length - old.length));
  let w = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    let j = start;
    if (old.length === 0) {
      if (i > 0) {
        j += utf8.DecodeRunePacked(s, start) >>> 24;
      }
    } else {
      j = indexFrom(s, old, start);
    }
    t.set(s.subarray(start, j), w);
    w += j - start;
    t.set(nw, w);
    w += nw.length;
    start = j + old.length;
  }
  t.set(s.subarray(start), w);
  w += s.length - start;
  return t.subarray(0, w);
}

// ReplaceAll is Replace with no limit on the number of replacements.
export function ReplaceAll(s: Uint8Array, old: Uint8Array, nw: Uint8Array): Uint8Array {
  return Replace(s, old, nw, -1);
}

// TrimPrefix returns a view of s without the leading prefix, or s if it does not
// start with prefix.
export function TrimPrefix(s: Uint8Array, prefix: Uint8Array): Uint8Array {
  return HasPrefix(s, prefix) ? s.subarray(prefix.length) : s;
}

// TrimSuffix returns a view of s without the trailing suffix, or s if it does not
// end with suffix.
export function TrimSuffix(s: Uint8Array, suffix: Uint8Array): Uint8Array {
  return HasSuffix(s, suffix) ? s.subarray(0, s.length - suffix.length) : s;
}

// CutPrefix returns a view of s without the leading prefix and whether it was
// found. If not found, it returns s and false.
export function CutPrefix(s: Uint8Array, prefix: Uint8Array): [Uint8Array, boolean] {
  if (!HasPrefix(s, prefix)) {
    return [s, false];
  }
  return [s.subarray(prefix.length), true];
}

// Buffer is Go's bytes.Buffer restricted to the methods Lute uses (no read side).
//
// arr is the storage. Its length is the capacity. n is the number of bytes in
// use, and the contents are arr[0:n]. Storage grows by doubling. NewBuffer
// adopts the caller's array, so writes within its spare capacity are visible
// through the caller's view, as in Go.
export class Buffer {
  arr: Uint8Array;
  n: number;

  constructor(buf?: Uint8Array) {
    if (buf === undefined) {
      this.arr = new Uint8Array(0);
      this.n = 0;
    } else {
      this.arr = new Uint8Array(buf.buffer, buf.byteOffset, Cap(buf));
      this.n = buf.length;
    }
  }

  // reserve makes room for extra more bytes, reallocating by doubling when needed.
  private reserve(extra: number): void {
    const need = this.n + extra;
    const cap = this.arr.length;
    if (need <= cap) {
      return;
    }
    let newCap = cap * 2;
    if (newCap < need) {
      newCap = need;
    }
    if (newCap < 64) {
      newCap = 64;
    }
    const next = new Uint8Array(newCap);
    next.set(this.arr.subarray(0, this.n), 0);
    this.arr = next;
  }

  // Bytes returns a view of the contents. Like Go, it aliases the storage until
  // the next write.
  Bytes(): Uint8Array {
    return this.arr.subarray(0, this.n);
  }

  // String returns the contents decoded as UTF-8. Each invalid byte becomes one
  // U+FFFD, as with Go's rune decoding.
  String(): string {
    const b = this.Bytes();
    if (utf8.Valid(b)) {
      return textDecoder.decode(b);
    }
    let out = "";
    for (let i = 0; i < b.length; ) {
      const v = utf8.DecodeRunePacked(b, i);
      out += String.fromCodePoint(v & 0xffffff);
      const w = v >>> 24;
      i += w;
    }
    return out;
  }

  // Len returns the number of bytes of the unread contents.
  Len(): number {
    return this.n;
  }

  // Cap returns the capacity of the storage.
  Cap(): number {
    return this.arr.length;
  }

  // Truncate discards all but the first n bytes. It throws when n is out of range.
  // Truncate(0) is Reset.
  Truncate(n: number): void {
    if (n === 0) {
      this.Reset();
      return;
    }
    if (n < 0 || n > this.n) {
      throw new RangeError("bytes.Buffer: truncation out of range");
    }
    this.n = n;
  }

  // Reset empties the buffer but keeps its storage.
  Reset(): void {
    this.n = 0;
  }

  // Grow ensures room for n more bytes without reallocating. It throws when n is
  // negative.
  Grow(n: number): void {
    if (n < 0) {
      throw new RangeError("bytes.Buffer.Grow: negative count");
    }
    this.reserve(n);
  }

  // Write appends p and returns the number of bytes written.
  Write(p: Uint8Array): number {
    this.reserve(p.length);
    if (p.buffer === this.arr.buffer) {
      // p may alias the storage, so use the overlap-safe copy.
      Copy(this.arr.subarray(this.n), p);
    } else {
      this.arr.set(p, this.n);
    }
    this.n += p.length;
    return p.length;
  }

  // WriteByte appends one byte.
  WriteByte(c: number): void {
    this.reserve(1);
    this.arr[this.n] = c;
    this.n++;
  }

  // WriteString appends the UTF-8 encoding of s and returns the number of bytes
  // written. Unpaired surrogates encode as U+FFFD (EF BF BD).
  WriteString(s: string): number {
    const len = s.length;
    const start = this.n;
    this.reserve(3 * len);
    const a = this.arr;
    let n = this.n;
    let i = 0;
    for (; i < len; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) {
        break;
      }
      a[n++] = c;
    }
    for (; i < len; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) {
        a[n++] = c;
        continue;
      }
      if (c < 0x800) {
        a[n++] = 0xc0 | (c >> 6);
        a[n++] = 0x80 | (c & 0x3f);
        continue;
      }
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          a[n++] = 0xf0 | (cp >> 18);
          a[n++] = 0x80 | ((cp >> 12) & 0x3f);
          a[n++] = 0x80 | ((cp >> 6) & 0x3f);
          a[n++] = 0x80 | (cp & 0x3f);
          i++;
          continue;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) {
        c = 0xfffd;
      }
      a[n++] = 0xe0 | (c >> 12);
      a[n++] = 0x80 | ((c >> 6) & 0x3f);
      a[n++] = 0x80 | (c & 0x3f);
    }
    this.n = n;
    return n - start;
  }

  // WriteRune appends the UTF-8 encoding of r and returns the number of bytes
  // written. Invalid runes encode as U+FFFD.
  WriteRune(r: number): number {
    if (r >= 0 && r < 0x80) {
      this.WriteByte(r);
      return 1;
    }
    this.reserve(4);
    const w = utf8.EncodeRune(scratch, r);
    for (let k = 0; k < w; k++) {
      this.arr[this.n + k] = scratch[k];
    }
    this.n += w;
    return w;
  }
}

// NewBuffer returns a Buffer whose initial contents are buf. The buffer adopts
// buf's storage, so writes within its spare capacity show through buf.
export function NewBuffer(buf: Uint8Array): Buffer {
  return new Buffer(buf);
}

// NewBufferString returns a Buffer whose initial contents are the UTF-8 encoding of s.
export function NewBufferString(s: string): Buffer {
  const b = new Buffer();
  b.WriteString(s);
  return b;
}

// ReplaceOrNil is Replace with Go's nil result: Replace returns nil when it replaces nothing
// and s is empty (append([]byte(nil), s...)), that is when len(s) == 0 and (n == 0 or old is not
// empty). An empty s with an empty old and n != 0 matches once and gives a non-nil result.
// Port addition; use it where the result is assigned to a nullable location.
export function ReplaceOrNil(s: Uint8Array, old: Uint8Array, nw: Uint8Array, n: number): Uint8Array | null {
  if (0 === s.length && (0 === n || 0 < old.length)) {
    return null;
  }
  return Replace(s, old, nw, n);
}

// ReplaceAllOrNil is ReplaceOrNil with no limit on the number of replacements: nil exactly
// when s is empty and old is not.
export function ReplaceAllOrNil(s: Uint8Array, old: Uint8Array, nw: Uint8Array): Uint8Array | null {
  return ReplaceOrNil(s, old, nw, -1);
}

// JoinOrNil is Join with Go's nil result: with exactly one element, Join returns
// append([]byte(nil), s[0]...), which is nil when that element is empty. With no element or
// two or more it returns a non-nil slice. Port addition; use it where the result is assigned
// to a nullable location.
export function JoinOrNil(s: Uint8Array[], sep: Uint8Array): Uint8Array | null {
  if (1 === s.length && 0 === s[0].length) {
    return null;
  }
  return Join(s, sep);
}
