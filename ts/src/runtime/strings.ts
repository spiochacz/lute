// Port of the parts of Go's strings package used by Lute, for the Lute
// TypeScript port. Behaviour follows Go 1.21 strings.
//
// Deliberate adaptations, shared by every function in this file:
//
// 1. A Go string is a byte sequence; here it is a JS string. Every index or
//    length that a function takes or returns is a UTF-16 code unit index, not a
//    UTF-8 byte offset. Go's strings.Index("żółw", "w") is 6; here it is 3.
//    Byte arguments (IndexByte, Builder.WriteByte) must be ASCII, because a
//    single byte >= 0x80 cannot be represented by a JS string; those calls throw.
//
// 2. Go iterates runes. Here a rune is a code point: a surrogate pair is one
//    rune. An unpaired surrogate corresponds to an invalid byte in Go, so it
//    decodes to RuneError (U+FFFD) with width 1, as in unicode/utf8. Where Go
//    preserves invalid bytes (TrimSpace, TrimLeft, TrimRight, Trim, Fields,
//    Split, Cut, Index, ...), the unpaired surrogate is preserved. Where Go's
//    Map (and so ToLower, ToUpper) rewrites an invalid byte, the unpaired
//    surrogate is rewritten to U+FFFD, or dropped if the mapping returns a
//    negative value.
//
// 3. Rune classification and case mapping come from unicode.ts, which is
//    verified against Go. Nothing here uses JS toLowerCase, toUpperCase, trim,
//    localeCompare or regex Unicode classes.
//
// 4. NewReplacer with an empty old string. Go's generic replacer steps one byte
//    at a time, so it inserts the replacement between the bytes of multi-byte
//    characters, which produces invalid UTF-8. That cannot be a JS string. This
//    port inserts at every code point boundary instead, which equals Go's
//    result for ASCII input. Go's Replace (not the Replacer) inserts at rune
//    boundaries, and so does this port. Lute never passes an empty old string
//    to NewReplacer.
//
// 5. strings.Builder keeps Go's method signatures: WriteString and WriteRune
//    return [bytesWritten, null], WriteByte returns null (Go's error). Len
//    returns the UTF-8 byte length (utf8.ByteLen), as Go's Builder.Len does.

import * as utf8 from "./utf8.ts";
import * as unicode from "./unicode.ts";

// encodeRune returns the UTF-8 text of r as a JS string. Like Go's WriteRune, a
// rune that is out of range or a surrogate becomes U+FFFD.
function encodeRune(r: number): string {
  if (!utf8.ValidRune(r)) {
    return String.fromCodePoint(utf8.RuneError);
  }
  return String.fromCodePoint(r);
}

function checkByte(c: number, fn: string): void {
  if (!Number.isInteger(c) || c < 0 || c >= 0x80) {
    throw new Error(
      `strings.${fn}: byte ${c} is not representable in a JS string (only ASCII bytes are supported)`,
    );
  }
}

// runeIn reports whether rune c is one of the runes of set (set is treated as a
// set of runes, not a set of bytes).
function runeIn(set: string, c: number): boolean {
  for (let i = 0; i < set.length; ) {
    const v = utf8.DecodeRuneInStringPacked(set, i);
    if ((v & 0xffffff) === c) {
      return true;
    }
    i += v >>> 24;
  }
  return false;
}

function trimLeftFunc(s: string, f: (r: number) => boolean): string {
  let i = 0;
  while (i < s.length) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    if (!f(v & 0xffffff)) {
      break;
    }
    i += v >>> 24;
  }
  return i === 0 ? s : s.slice(i);
}

function trimRightFunc(s: string, f: (r: number) => boolean): string {
  let end = s.length;
  while (end > 0) {
    const v = utf8.DecodeLastRuneInStringPacked(s, end);
    if (!f(v & 0xffffff)) {
      break;
    }
    end -= v >>> 24;
  }
  return end === s.length ? s : s.slice(0, end);
}

// explode splits s into its runes, at most n of them (n < 0 means all). The
// last element holds the rest of s when n is smaller than the rune count.
function explode(s: string, n: number): string[] {
  const l = utf8.RuneCountInString(s);
  if (n < 0 || n > l) {
    n = l;
  }
  const a: string[] = [];
  let i = 0;
  for (let k = 0; k < n - 1; k++) {
    const size = utf8.DecodeRuneInStringPacked(s, i) >>> 24;
    a.push(s.slice(i, i + size));
    i += size;
  }
  if (n > 0) {
    a.push(s.slice(i));
  }
  return a;
}

// genSplit is Go's genSplit with sepSave = 0.
function genSplit(s: string, sep: string, n: number): string[] {
  if (n === 0) {
    return [];
  }
  if (sep === "") {
    return explode(s, n);
  }
  if (n < 0) {
    n = Count(s, sep) + 1;
  }
  const a: string[] = [];
  let start = 0;
  while (a.length < n - 1) {
    const m = s.indexOf(sep, start);
    if (m < 0) {
      break;
    }
    a.push(s.slice(start, m));
    start = m + sep.length;
  }
  a.push(s.slice(start));
  return a;
}

// Map returns a copy of s with every rune r replaced by mapping(r). A negative
// result drops the rune. See adaptation 2 for unpaired surrogates.
export function Map(mapping: (r: number) => number, s: string): string {
  let out = "";
  let last = 0;
  let i = 0;
  while (i < s.length) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    const c = v & 0xffffff;
    const size = v >>> 24;
    // A surrogate that decodes with width 1 is unpaired: Go's invalid byte.
    const unpaired = size === 1 && c === utf8.RuneError && s.charCodeAt(i) >= 0xd800 && s.charCodeAt(i) <= 0xdfff;
    const r = mapping(c);
    if (r === c && !unpaired) {
      i += size;
      continue;
    }
    out += s.slice(last, i);
    if (r >= 0) {
      out += encodeRune(r);
    }
    i += size;
    last = i;
  }
  return last === 0 ? out + s : out + s.slice(last);
}

// ToLower returns s with all Unicode letters mapped to lower case.
export function ToLower(s: string): string {
  return Map(unicode.ToLower, s);
}

// ToUpper returns s with all Unicode letters mapped to upper case.
export function ToUpper(s: string): string {
  return Map(unicode.ToUpper, s);
}

// EqualFold reports whether s and t are equal under simple Unicode case folding.
export function EqualFold(s: string, t: string): boolean {
  let i = 0;
  let j = 0;
  while (i < s.length && j < t.length) {
    const sv = utf8.DecodeRuneInStringPacked(s, i);
    const tv = utf8.DecodeRuneInStringPacked(t, j);
    let sr = sv & 0xffffff;
    let tr = tv & 0xffffff;
    i += sv >>> 24;
    j += tv >>> 24;
    if (tr === sr) {
      continue;
    }
    if (tr < sr) {
      const swap = tr;
      tr = sr;
      sr = swap;
    }
    if (tr < utf8.RuneSelf) {
      if (0x41 <= sr && sr <= 0x5a && tr === sr + 0x20) {
        continue;
      }
      return false;
    }
    let r = unicode.SimpleFold(sr);
    while (r !== sr && r < tr) {
      r = unicode.SimpleFold(r);
    }
    if (r === tr) {
      continue;
    }
    return false;
  }
  return i === s.length && j === t.length;
}

// ContainsRune reports whether the rune r is contained in s.
export function ContainsRune(s: string, r: number): boolean {
  return IndexRune(s, r) >= 0;
}

// ContainsAny reports whether any Unicode code point in chars is in s.
export function ContainsAny(s: string, chars: string): boolean {
  return IndexAny(s, chars) >= 0;
}

// Contains reports whether substr is within s.
export function Contains(s: string, substr: string): boolean {
  return s.includes(substr);
}

// HasPrefix reports whether s begins with prefix.
export function HasPrefix(s: string, prefix: string): boolean {
  return s.startsWith(prefix);
}

// HasSuffix reports whether s ends with suffix.
export function HasSuffix(s: string, suffix: string): boolean {
  return s.endsWith(suffix);
}

// Index returns the UTF-16 index of the first instance of substr in s, or -1.
export function Index(s: string, substr: string): number {
  return s.indexOf(substr);
}

// LastIndex returns the UTF-16 index of the last instance of substr in s, or -1.
export function LastIndex(s: string, substr: string): number {
  return s.lastIndexOf(substr);
}

// IndexByte returns the UTF-16 index of the first instance of the ASCII byte c
// in s, or -1. Bytes >= 0x80 throw (adaptation 1).
export function IndexByte(s: string, c: number): number {
  checkByte(c, "IndexByte");
  return s.indexOf(String.fromCharCode(c));
}

// IndexRune returns the UTF-16 index of the first instance of rune r in s, or
// -1. For RuneError it also matches unpaired surrogates, which Go sees as invalid
// bytes. An invalid rune value returns -1.
export function IndexRune(s: string, r: number): number {
  if (0 <= r && r < utf8.RuneSelf) {
    return s.indexOf(String.fromCharCode(r));
  }
  if (r === utf8.RuneError) {
    for (let i = 0; i < s.length; ) {
      const v = utf8.DecodeRuneInStringPacked(s, i);
      const c = v & 0xffffff;
      const size = v >>> 24;
      if (c === utf8.RuneError) {
        return i;
      }
      i += size;
    }
    return -1;
  }
  if (!utf8.ValidRune(r)) {
    return -1;
  }
  return s.indexOf(String.fromCodePoint(r));
}

// IndexAny returns the UTF-16 index of the first rune of s that is in chars, or
// -1. An empty chars returns -1.
export function IndexAny(s: string, chars: string): number {
  if (chars === "") {
    return -1;
  }
  for (let i = 0; i < s.length; ) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    const c = v & 0xffffff;
    const size = v >>> 24;
    if (runeIn(chars, c)) {
      return i;
    }
    i += size;
  }
  return -1;
}

// Count counts the non-overlapping instances of substr in s. An empty substr
// counts the runes of s plus one.
export function Count(s: string, substr: string): number {
  if (substr === "") {
    return utf8.RuneCountInString(s) + 1;
  }
  let n = 0;
  let i = 0;
  for (;;) {
    const j = s.indexOf(substr, i);
    if (j < 0) {
      return n;
    }
    n++;
    i = j + substr.length;
  }
}

// Cut slices s around the first instance of sep, returning the text before and
// after sep and whether sep was found.
export function Cut(s: string, sep: string): [string, string, boolean] {
  const i = s.indexOf(sep);
  if (i >= 0) {
    return [s.slice(0, i), s.slice(i + sep.length), true];
  }
  return [s, "", false];
}

// Split slices s into all substrings separated by sep. An empty sep splits s
// into its runes.
export function Split(s: string, sep: string): string[] {
  return genSplit(s, sep, -1);
}

// SplitN is Split with at most n substrings: n < 0 means no limit and n == 0
// returns no substrings (Go returns nil).
export function SplitN(s: string, sep: string, n: number): string[] {
  return genSplit(s, sep, n);
}

// Fields splits s around each instance of one or more consecutive white-space
// runes (unicode.IsSpace), returning the non-empty pieces.
export function Fields(s: string): string[] {
  const out: string[] = [];
  let start = -1;
  let i = 0;
  while (i < s.length) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    const c = v & 0xffffff;
    const size = v >>> 24;
    if (unicode.IsSpace(c)) {
      if (start >= 0) {
        out.push(s.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
    i += size;
  }
  if (start >= 0) {
    out.push(s.slice(start));
  }
  return out;
}

// TrimSpace returns s with leading and trailing unicode.IsSpace runes removed.
// U+0085 and U+00A0 are spaces; U+200B and U+FEFF are not.
export function TrimSpace(s: string): string {
  return trimRightFunc(trimLeftFunc(s, unicode.IsSpace), unicode.IsSpace);
}

// Trim returns s with all leading and trailing runes contained in cutset removed.
export function Trim(s: string, cutset: string): string {
  if (s === "" || cutset === "") {
    return s;
  }
  const inSet = (r: number) => runeIn(cutset, r);
  return trimRightFunc(trimLeftFunc(s, inSet), inSet);
}

// TrimLeft returns s with all leading runes contained in cutset removed.
export function TrimLeft(s: string, cutset: string): string {
  if (s === "" || cutset === "") {
    return s;
  }
  return trimLeftFunc(s, (r) => runeIn(cutset, r));
}

// TrimRight returns s with all trailing runes contained in cutset removed.
export function TrimRight(s: string, cutset: string): string {
  if (s === "" || cutset === "") {
    return s;
  }
  return trimRightFunc(s, (r) => runeIn(cutset, r));
}

// TrimPrefix returns s without the leading prefix string.
export function TrimPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

// TrimSuffix returns s without the trailing suffix string.
export function TrimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

// ReplaceAll returns a copy of s with all non-overlapping instances of old
// replaced by new. An empty old inserts new at every rune boundary.
export function ReplaceAll(s: string, old: string, nw: string): string {
  if (old !== "" && old !== nw) {
    return s.split(old).join(nw);
  }
  return Replace(s, old, nw, -1);
}

// Replace returns a copy of s with the first n non-overlapping instances of old
// replaced by new (n < 0 replaces all, n == 0 returns s). An empty old inserts
// new at the start and after each rune, up to n times.
export function Replace(s: string, old: string, nw: string, n: number): string {
  if (old === nw || n === 0) {
    return s;
  }
  const m = Count(s, old);
  if (m === 0) {
    return s;
  }
  if (n < 0 || m < n) {
    n = m;
  }
  let out = "";
  let start = 0;
  for (let i = 0; i < n; i++) {
    let j = start;
    if (old === "") {
      if (i > 0) {
        j += utf8.DecodeRuneInStringPacked(s, start) >>> 24;
      }
    } else {
      j = s.indexOf(old, start);
    }
    out += s.slice(start, j) + nw;
    start = j + old.length;
  }
  return out + s.slice(start);
}

// Repeat returns a new string consisting of count copies of s. A negative count
// throws, as Go panics.
export function Repeat(s: string, count: number): string {
  if (count < 0) {
    throw new Error("strings: negative Repeat count");
  }
  return s.repeat(count);
}

// Join concatenates the elements of elems, with sep between them.
export function Join(elems: string[], sep: string): string {
  return elems.join(sep);
}

// Replacer replaces a list of strings with replacements. See NewReplacer.
export class Replacer {
  readonly #olds: string[];
  readonly #news: string[];
  // Keys by the first code unit of a non-empty old string, in argument order,
  // each list already merged with the empty olds. Key: code unit.
  readonly #byFirst: Record<number, number[]> = Object.create(null);
  // Indices of the empty olds, in argument order.
  readonly #empties: number[] = [];

  constructor(olds: string[], news: string[]) {
    this.#olds = olds;
    this.#news = news;
    const firsts: number[] = [];
    for (let k = 0; k < olds.length; k++) {
      const old = olds[k];
      if (old === "") {
        this.#empties.push(k);
      } else {
        const c0 = old.charCodeAt(0);
        if (this.#byFirst[c0] === undefined) {
          this.#byFirst[c0] = [];
          firsts.push(c0);
        }
        this.#byFirst[c0].push(k);
      }
    }
    for (const c0 of firsts) {
      this.#byFirst[c0] = [...this.#byFirst[c0], ...this.#empties].sort((a, b) => a - b);
    }
  }

  // candidates returns the key indices that may match at a position whose code
  // unit is c (or at the end of the input when c is undefined), in argument order.
  #candidates(c: number | undefined): number[] {
    if (c === undefined) {
      return this.#empties;
    }
    return this.#byFirst[c] ?? this.#empties;
  }

  // Replace returns a copy of s with all replacements performed. Scanning is
  // left to right. At each position the matching old string that comes first in
  // the argument list wins (not the longest), the matched text is replaced, and
  // scanning resumes after it. Replacement text is never rescanned.
  Replace(s: string): string {
    let out = "";
    let last = 0;
    let i = 0;
    let prevMatchEmpty = false;
    for (;;) {
      const cands = this.#candidates(i < s.length ? s.charCodeAt(i) : undefined);
      let best = -1;
      for (const k of cands) {
        const old = this.#olds[k];
        if (old === "") {
          // Go ignores the empty match at a position right after an empty match.
          if (prevMatchEmpty) {
            continue;
          }
          best = k;
          break;
        }
        if (s.startsWith(old, i)) {
          best = k;
          break;
        }
      }
      if (best >= 0) {
        const old = this.#olds[best];
        out += s.slice(last, i) + this.#news[best];
        i += old.length;
        last = i;
        prevMatchEmpty = old === "";
        continue;
      }
      if (i >= s.length) {
        break;
      }
      prevMatchEmpty = false;
      i += utf8.DecodeRuneInStringPacked(s, i) >>> 24;
    }
    return out + s.slice(last);
  }
}

// NewReplacer returns a Replacer from old, new pairs given as a flat argument
// list. It throws when the count is odd, as Go panics.
export function NewReplacer(...oldnew: string[]): Replacer {
  if (oldnew.length % 2 === 1) {
    throw new Error("strings.NewReplacer: odd argument count");
  }
  const olds: string[] = [];
  const news: string[] = [];
  for (let i = 0; i < oldnew.length; i += 2) {
    olds.push(oldnew[i]);
    news.push(oldnew[i + 1]);
  }
  return new Replacer(olds, news);
}

// Builder is Go's strings.Builder. String returns the accumulated text, Len the
// UTF-8 byte length of that text.
export class Builder {
  #parts: string[] = [];
  #bytes = 0;

  // WriteString appends s and returns the bytes written and a null error.
  WriteString(s: string): [number, null] {
    const n = utf8.ByteLen(s);
    this.#parts.push(s);
    this.#bytes += n;
    return [n, null];
  }

  // WriteByte appends the ASCII byte c and returns a null error.
  WriteByte(c: number): null {
    checkByte(c, "Builder.WriteByte");
    this.#parts.push(String.fromCharCode(c));
    this.#bytes += 1;
    return null;
  }

  // WriteRune appends the UTF-8 encoding of r (U+FFFD for invalid runes) and
  // returns the bytes written and a null error.
  WriteRune(r: number): [number, null] {
    const s = encodeRune(r);
    const n = utf8.ByteLen(s);
    this.#parts.push(s);
    this.#bytes += n;
    return [n, null];
  }

  String(): string {
    if (this.#parts.length > 1) {
      this.#parts = [this.#parts.join("")];
    }
    return this.#parts.length === 0 ? "" : this.#parts[0];
  }

  Len(): number {
    return this.#bytes;
  }

  Reset(): void {
    this.#parts = [];
    this.#bytes = 0;
  }

  // Grow is a no-op apart from Go's negative-count check.
  Grow(n: number): void {
    if (n < 0) {
      throw new Error("strings.Builder.Grow: negative count");
    }
  }
}
