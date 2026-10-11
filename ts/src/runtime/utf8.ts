// Port of Go's unicode/utf8 package (Go 1.27) for the Lute TypeScript port.
//
// Byte functions (DecodeRune, DecodeLastRune, EncodeRune, RuneBytes, RuneLen,
// RuneCount, Valid, ValidRune, FullRune) follow utf8.go exactly, including the
// handling of invalid sequences: any invalid sequence decodes to RuneError
// with size 1. Overlong encodings, surrogates and values above 0x10FFFF are
// invalid.
//
// Deliberate adaptation: the *InString functions take a JS string, which is
// UTF-16. Their sizes are counted in UTF-16 code units (1 or 2), not in UTF-8
// bytes, and an unpaired surrogate is treated as one invalid unit that decodes
// to RuneError with size 1. ByteLen(s) returns what Go's len(s) would return for
// the UTF-8 form of s, where an unpaired surrogate counts as 3 bytes (the size
// of U+FFFD, which is what Go stores for a lone surrogate).

export const RuneError = 0xfffd;
export const RuneSelf = 0x80;
export const MaxRune = 0x10ffff;
export const UTFMax = 4;

const surrogateMin = 0xd800;
const surrogateMax = 0xdfff;

const locb = 0x80;
const hicb = 0xbf;

// Lead byte classes (see utf8.go). Low 3 bits: sequence size. High nibble:
// index into the accept ranges below.
const xx = 0xf1; // invalid: size 1
const as = 0xf0; // ASCII: size 1
const s1 = 0x02; // accept 0, size 2
const s2 = 0x13; // accept 1, size 3
const s3 = 0x03; // accept 0, size 3
const s4 = 0x23; // accept 2, size 3
const s5 = 0x34; // accept 3, size 4
const s6 = 0x04; // accept 0, size 4
const s7 = 0x44; // accept 4, size 4

const maskx = 0x3f;
const mask2 = 0x1f;
const mask3 = 0x0f;
const mask4 = 0x07;

const rune1Max = (1 << 7) - 1;
const rune2Max = (1 << 11) - 1;
const rune3Max = (1 << 16) - 1;

const t2 = 0xc0;
const t3 = 0xe0;
const t4 = 0xf0;
const tx = 0x80;

// first maps a lead byte to its class, as the `first` array in utf8.go.
const first = new Uint8Array(256);
first.fill(as, 0x00, 0x80);
first.fill(xx, 0x80, 0xc2);
first.fill(s1, 0xc2, 0xe0);
first[0xe0] = s2;
first.fill(s3, 0xe1, 0xf0);
first[0xed] = s4;
first[0xf0] = s5;
first.fill(s6, 0xf1, 0xf4);
first[0xf4] = s7;
first.fill(xx, 0xf5, 0x100);

// acceptLo and acceptHi give the valid range for the second byte, indexed by
// the high nibble of the lead class (acceptRanges in utf8.go).
const acceptLo = new Uint8Array([0x80, 0xa0, 0x80, 0x90, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const acceptHi = new Uint8Array([0xbf, 0xbf, 0x9f, 0xbf, 0x8f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

// decodePacked decodes the UTF-8 sequence starting at p[off] within the n bytes
// p[off .. off+n) and returns rune | (size << 24). n must be at least 1. The
// rune is at most 0x10FFFF (21 bits) and the size at most 4, so the packed value
// is a small non-negative integer.
function decodePacked(p: Uint8Array, off: number, n: number): number {
  const p0 = p[off];
  if (p0 < RuneSelf) {
    return p0 | (1 << 24);
  }
  const x = first[p0];
  if (x >= as) {
    // Continuation byte or invalid lead byte (ASCII was handled above).
    return RuneError | (1 << 24);
  }
  const sz = x & 7;
  const accept = x >> 4;
  if (n < sz) {
    return RuneError | (1 << 24);
  }
  const b1 = p[off + 1];
  if (b1 < acceptLo[accept] || acceptHi[accept] < b1) {
    return RuneError | (1 << 24);
  }
  if (sz <= 2) {
    return (((p0 & mask2) << 6) | (b1 & maskx)) | (2 << 24);
  }
  const b2 = p[off + 2];
  if (b2 < locb || hicb < b2) {
    return RuneError | (1 << 24);
  }
  if (sz <= 3) {
    return (((p0 & mask3) << 12) | ((b1 & maskx) << 6) | (b2 & maskx)) | (3 << 24);
  }
  const b3 = p[off + 3];
  if (b3 < locb || hicb < b3) {
    return RuneError | (1 << 24);
  }
  return (((p0 & mask4) << 18) | ((b1 & maskx) << 12) | ((b2 & maskx) << 6) | (b3 & maskx)) | (4 << 24);
}

// decodeAt decodes the UTF-8 sequence starting at p[off] within the n bytes
// p[off .. off+n). It returns [rune, size]; n must be at least 1.
function decodeAt(p: Uint8Array, off: number, n: number): [number, number] {
  const v = decodePacked(p, off, n);
  return [v & 0xffffff, v >>> 24];
}

// FullRune reports whether the bytes in p begin with a full UTF-8 encoding of
// a rune. An invalid encoding is considered a full Rune since it will convert
// as a width-1 error rune.
export function FullRune(p: Uint8Array): boolean {
  const n = p.length;
  if (n === 0) {
    return false;
  }
  const x = first[p[0]];
  if (n >= (x & 7)) {
    return true; // ASCII, invalid or valid.
  }
  const accept = x >> 4;
  if (n > 1 && (p[1] < acceptLo[accept] || acceptHi[accept] < p[1])) {
    return true;
  } else if (n > 2 && (p[2] < locb || hicb < p[2])) {
    return true;
  }
  return false;
}

// DecodeRune unpacks the first UTF-8 encoding in p and returns the rune and
// its width in bytes. An empty p returns [RuneError, 0]; an invalid encoding
// returns [RuneError, 1].
export function DecodeRune(p: Uint8Array): [number, number] {
  if (p.length < 1) {
    return [RuneError, 0];
  }
  return decodeAt(p, 0, p.length);
}

// RuneStart reports whether the byte could be the first byte of an encoded rune.
export function RuneStart(b: number): boolean {
  return (b & 0xc0) !== 0x80;
}

// DecodeLastRune unpacks the last UTF-8 encoding in p and returns the rune and
// its width in bytes. An empty p returns [RuneError, 0]; an invalid encoding
// returns [RuneError, 1].
export function DecodeLastRune(p: Uint8Array): [number, number] {
  const end = p.length;
  if (end === 0) {
    return [RuneError, 0];
  }
  let start = end - 1;
  const r = p[start];
  if (r < RuneSelf) {
    return [r, 1];
  }
  const lim = Math.max(end - UTFMax, 0);
  for (start--; start >= lim; start--) {
    if (RuneStart(p[start])) {
      break;
    }
  }
  if (start < 0) {
    start = 0;
  }
  const [dr, size] = decodeAt(p, start, end - start);
  if (start + size !== end) {
    return [RuneError, 1];
  }
  return [dr, size];
}

// DecodeRunePacked is DecodeRune(p.subarray(i)) without allocating a view or a
// tuple. The result is packed as rune | (size << 24): unpack with
// rune = v & 0xFFFFFF and size = v >>> 24. An index outside [0, p.length) returns
// RuneError with size 0 (that is, the packed value RuneError).
export function DecodeRunePacked(p: Uint8Array, i: number): number {
  if (!(i >= 0 && i < p.length)) {
    return RuneError;
  }
  return decodePacked(p, i, p.length - i);
}

// DecodeLastRunePacked is DecodeLastRune(p.subarray(begin, end)) without
// allocating, packed as in DecodeRunePacked. begin defaults to 0. An empty or
// out-of-range [begin, end) returns RuneError with size 0.
export function DecodeLastRunePacked(p: Uint8Array, end: number, begin = 0): number {
  if (!(begin >= 0 && begin < end && end <= p.length)) {
    return RuneError;
  }
  const r = p[end - 1];
  if (r < RuneSelf) {
    return r | (1 << 24);
  }
  const lim = Math.max(end - UTFMax, begin);
  let start = end - 1;
  for (start--; start >= lim; start--) {
    if (RuneStart(p[start])) {
      break;
    }
  }
  if (start < begin) {
    start = begin;
  }
  const v = decodePacked(p, start, end - start);
  if (start + (v >>> 24) !== end) {
    return RuneError | (1 << 24);
  }
  return v;
}

// DecodeRuneInString returns the code point starting at UTF-16 index i of s and
// its size in UTF-16 code units (1 or 2). An index outside s returns
// [RuneError, 0]; an unpaired surrogate returns [RuneError, 1].
export function DecodeRuneInString(s: string, i = 0): [number, number] {
  if (i < 0 || i >= s.length) {
    return [RuneError, 0];
  }
  const c = s.charCodeAt(i);
  if (c < surrogateMin || c > surrogateMax) {
    return [c, 1];
  }
  if (c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= surrogateMax) {
      return [((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000, 2];
    }
  }
  return [RuneError, 1];
}

// DecodeLastRuneInString returns the code point that ends at UTF-16 index end
// of s (exclusive) and its size in UTF-16 code units (1 or 2). An empty range
// returns [RuneError, 0]; an unpaired surrogate returns [RuneError, 1].
export function DecodeLastRuneInString(s: string, end: number = s.length): [number, number] {
  if (end <= 0 || end > s.length) {
    return [RuneError, 0];
  }
  const c = s.charCodeAt(end - 1);
  if (c < surrogateMin || c > surrogateMax) {
    return [c, 1];
  }
  if (c >= 0xdc00 && end >= 2) {
    const h = s.charCodeAt(end - 2);
    if (h >= surrogateMin && h <= 0xdbff) {
      return [((h - 0xd800) << 10) + (c - 0xdc00) + 0x10000, 2];
    }
  }
  return [RuneError, 1];
}

// DecodeRuneInStringPacked is DecodeRuneInString(s, i) without allocating. The
// result is packed as rune | (size << 24), where size counts UTF-16 code units.
// An index outside s returns RuneError with size 0.
export function DecodeRuneInStringPacked(s: string, i: number): number {
  if (!(i >= 0 && i < s.length)) {
    return RuneError;
  }
  const c = s.charCodeAt(i);
  if (c < surrogateMin || c > surrogateMax) {
    return c | (1 << 24);
  }
  if (c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= surrogateMax) {
      return (((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000) | (2 << 24);
    }
  }
  return RuneError | (1 << 24);
}

// DecodeLastRuneInStringPacked is DecodeLastRuneInString(s, end) without
// allocating, packed as in DecodeRuneInStringPacked.
export function DecodeLastRuneInStringPacked(s: string, end: number = s.length): number {
  if (!(end > 0 && end <= s.length)) {
    return RuneError;
  }
  const c = s.charCodeAt(end - 1);
  if (c < surrogateMin || c > surrogateMax) {
    return c | (1 << 24);
  }
  if (c >= 0xdc00 && end >= 2) {
    const h = s.charCodeAt(end - 2);
    if (h >= surrogateMin && h <= 0xdbff) {
      return (((h - 0xd800) << 10) + (c - 0xdc00) + 0x10000) | (2 << 24);
    }
  }
  return RuneError | (1 << 24);
}

// RuneLen returns the number of bytes in the UTF-8 encoding of r, or -1 if r
// is not a valid rune.
export function RuneLen(r: number): number {
  if (r < 0) {
    return -1;
  } else if (r <= rune1Max) {
    return 1;
  } else if (r <= rune2Max) {
    return 2;
  } else if (surrogateMin <= r && r <= surrogateMax) {
    return -1;
  } else if (r <= rune3Max) {
    return 3;
  } else if (r <= MaxRune) {
    return 4;
  }
  return -1;
}

// EncodeRune writes into p (which must be large enough) the UTF-8 encoding of
// the rune and returns the number of bytes written. Invalid runes are encoded
// as RuneError.
export function EncodeRune(p: Uint8Array, r: number): number {
  const i = r >>> 0;
  if (i <= rune1Max) {
    p[0] = r;
    return 1;
  }
  if (i <= rune2Max) {
    p[0] = t2 | (r >> 6);
    p[1] = tx | (r & maskx);
    return 2;
  }
  if (i < surrogateMin || (surrogateMax < i && i <= rune3Max)) {
    p[0] = t3 | (r >> 12);
    p[1] = tx | ((r >> 6) & maskx);
    p[2] = tx | (r & maskx);
    return 3;
  }
  if (i > rune3Max && i <= MaxRune) {
    p[0] = t4 | (r >> 18);
    p[1] = tx | ((r >> 12) & maskx);
    p[2] = tx | ((r >> 6) & maskx);
    p[3] = tx | (r & maskx);
    return 4;
  }
  // Invalid rune: encode RuneError (EF BF BD).
  p[0] = t3 | (RuneError >> 12);
  p[1] = tx | ((RuneError >> 6) & maskx);
  p[2] = tx | (RuneError & maskx);
  return 3;
}

// RuneBytes returns a new Uint8Array holding the UTF-8 encoding of r, the
// equivalent of Go's AppendRune applied to an empty slice.
export function RuneBytes(r: number): Uint8Array {
  const buf = new Uint8Array(UTFMax);
  const n = EncodeRune(buf, r);
  return buf.slice(0, n);
}

// RuneCount returns the number of runes in p. Erroneous and short encodings
// are treated as a single rune of width 1 byte.
export function RuneCount(p: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < p.length; n++) {
    i += decodePacked(p, i, p.length - i) >>> 24;
  }
  return n;
}

// RuneCountInString returns the number of code points in s. An unpaired
// surrogate counts as one.
export function RuneCountInString(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; n++) {
    i += DecodeRuneInString(s, i)[1];
  }
  return n;
}

// ValidRune reports whether r can be legally encoded as UTF-8. Code points
// that are out of range or are surrogate halves are illegal.
export function ValidRune(r: number): boolean {
  if (0 <= r && r < surrogateMin) {
    return true;
  } else if (surrogateMax < r && r <= MaxRune) {
    return true;
  }
  return false;
}

// Valid reports whether p consists entirely of valid UTF-8-encoded runes.
export function Valid(p: Uint8Array): boolean {
  let i = 0;
  while (i < p.length) {
    const v = decodePacked(p, i, p.length - i);
    if ((v & 0xffffff) === RuneError && v >>> 24 === 1) {
      return false;
    }
    i += v >>> 24;
  }
  return true;
}

// ValidString reports whether s contains no unpaired surrogates, that is,
// whether it is the UTF-16 form of valid code points only.
export function ValidString(s: string): boolean {
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < surrogateMin || c > surrogateMax) {
      i++;
      continue;
    }
    if (c > 0xdbff || i + 1 >= s.length) {
      return false;
    }
    const d = s.charCodeAt(i + 1);
    if (d < 0xdc00 || d > surrogateMax) {
      return false;
    }
    i += 2;
  }
  return true;
}

// ByteLen returns the length in bytes of the UTF-8 encoding of s, which is what
// Go's len(s) returns for the same text. It does not allocate. An unpaired
// surrogate counts as 3 bytes.
export function ByteLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= surrogateMax) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}
