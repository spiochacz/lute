// Go slice mechanics on Uint8Array ([]byte).
//
// A Go slice has a length and a capacity. The capacity of a view `a` is the
// number of bytes from its start to the end of its ArrayBuffer:
// Cap(a) = a.buffer.byteLength - a.byteOffset. Two views over the same
// ArrayBuffer alias each other, and Append writes in place when the capacity
// allows, which is observable through the other views.
//
// Differences from Go that cannot be represented with typed arrays:
// - Go's three-index slice s[lo:hi:max] (capacity limit) has no equivalent,
//   so a view never has a capacity smaller than its buffer tail.
// - The growth policy follows the GopherJS bundle (javascript/lute.min.js,
//   $calculateNewCapacity), not the Go runtime's growslice size classes, so
//   capacities after reallocation are not Go's exact values.
//
// Size rule (structural change S1, 2026-10-11). The rule is decided from the
// length alone, so that a small array never needs an ArrayBuffer, and the
// `.buffer` getter (which materialises an on-heap array in V8) is never read
// for a small array on the append and make paths.
//
// SMALL = 64 bytes.
//
// - A small array has length <= 64. Its capacity is its length. It is never
//   appended in place: Append, AppendByte and AppendString of a small array
//   return a new exact-fit array new Uint8Array(n), which is on-heap in V8 and
//   has no ArrayBuffer. Make(len, cap) with cap <= 64 returns new Uint8Array(len).
// - A large array has length > 64. Its capacity is the buffer tail, as in Go
//   and as before S1. Append and AppendByte write in place when the result fits
//   the tail; otherwise they allocate a new ArrayBuffer of
//   CalculateNewCapacity(newLen, cap) bytes.
//
// Transitions:
// 1. Small a, result newLen > 64: a new ArrayBuffer of
//    CalculateNewCapacity(newLen, aLen) bytes, where aLen (the small capacity)
//    is the old capacity. The result is large from then on.
// 2. Large a, subarray of at most 64 bytes (a small view of a large buffer):
//    appending never writes into the parent buffer. In Go the append writes into
//    the parent's spare capacity. This is the one place where S1 removes a byte
//    write that Go makes, and it is intended.
// 3. Large a, subarray longer than 64 bytes: stays large, in place when it fits.
// 4. Append(a, empty) returns a itself, as Go's append with no elements does.
//    The result therefore shares a buffer with a and is not exact-fit.
// 5. Make(len, cap) with cap > 64 makes ArrayBuffer(cap) and a view of len.
//    If len > 64 the capacity is the buffer tail, as before. If len <= 64, plain
//    Append/AppendByte do NOT keep the capacity: the first append is a small-array
//    append (rule above), so the result is an exact-fit copy and the buffer is
//    dropped. Honouring it would need the capacity to be read from the buffer,
//    which materialises every small on-heap array. So the pre-sized accumulators
//    of the port (Make(0, cap) followed by appends, cap above 64: EscapeHTML,
//    EncodeDestination, unesc_str, heading, inline_link, link, file_annotation_ref,
//    text merge) append with AppendInPlaceLikeGo / AppendByteInPlaceLikeGo, which
//    keep the capacity at every length, as before S1 (each site has a PORT-NOTE).
//    Make(0, cap) with cap at most 64 (block_ref) is exact fit and not honoured.
// 6. Make(len, cap) with cap <= 64 gives capacity len (exact fit).
// 7. Clone is exact-fit (capacity = length), as before.
// 8. CapAfterByteAppends(n) is n for n <= 64 (exact-fit appends) and the
//    growth sequence from 64 above (64 -> 128 -> 256 ...), so for n > 64 it is
//    the capacity that the old sequence gave.
//
// Where Go relies on writing into the spare capacity of a SMALL array (in-place
// delete and similar), the port calls AppendInPlaceLikeGo or
// AppendByteInPlaceLikeGo. These are the pre-S1 bodies with no size rule: they
// use Cap(a) (the buffer tail), so they write in place exactly as Go does.
//
// Copy keeps its pre-S1 body (moveBytes). It reads `.buffer` to detect a shared
// buffer, so it materialises a small on-heap destination or source. Copy is not
// an S1 entry point.
//
// Port additions (not in Go): CalculateNewCapacity, Reslice, AppendByte,
// AppendString, AppendInPlaceLikeGo, AppendByteInPlaceLikeGo, CapAfterByteAppends
// are named after their Go equivalents but are helpers of this port.

const encoder = new TextEncoder();

// SMALL is the largest length of a small array (see the size rule above).
const SMALL = 64;

// Cap returns the capacity of the slice a: the bytes from its start to the end
// of the underlying ArrayBuffer.
export function Cap(a: Uint8Array): number {
  return a.buffer.byteLength - a.byteOffset;
}

// CalculateNewCapacity is the growth policy used when Append must reallocate:
// max(needed, oldCap < 1024 ? oldCap*2 : floor(oldCap*5/4)). This is the
// formula of $calculateNewCapacity in javascript/lute.min.js (GopherJS).
export function CalculateNewCapacity(needed: number, oldCap: number): number {
  const grown = oldCap < 1024 ? oldCap * 2 : Math.floor((oldCap * 5) / 4);
  return Math.max(needed, grown);
}

// Reslice is a port addition. It mirrors Go's s[:n] for n up to Cap(s), which
// subarray cannot express because subarray clamps to the current length.
export function Reslice(a: Uint8Array, len: number): Uint8Array {
  if (!Number.isInteger(len) || len < 0 || len > Cap(a)) {
    throw new RangeError("slice bounds out of range");
  }
  return new Uint8Array(a.buffer, a.byteOffset, len);
}

// Make returns a zeroed slice of length len with capacity cap.
// PORT-NOTE: perf, departs from 1:1 (structural change S1): a capacity of at most 64 bytes
// gives an exact-fit on-heap array with no ArrayBuffer. A larger capacity keeps the ArrayBuffer.
// The capacity of a result shorter than 65 bytes is not kept for appends, see rule 5.
export function Make(len: number, cap: number = len): Uint8Array {
  if (!Number.isInteger(len) || len < 0) {
    throw new RangeError("makeslice: len out of range");
  }
  if (!Number.isInteger(cap) || cap < len) {
    throw new RangeError("makeslice: cap out of range");
  }
  if (cap <= SMALL) {
    return new Uint8Array(len);
  }
  return new Uint8Array(new ArrayBuffer(cap), 0, len);
}

// SHORT_COPY is the longest run that moveBytes copies with an indexed loop.
// Above it, TypedArray.prototype.set and copyWithin are used. The ab.append rows of
// bench/runtime-micro.ts rule out 64 (the 64-byte append is 1.8x slower with the loop).
// They do not separate 16 from 32: no row measures a piece of 17 to 32 bytes, and the
// 16 vs 32 differences were within noise. 16 is kept as the largest value whose
// boundary row (16-byte pieces) does not regress.
const SHORT_COPY = 16;

// moveBytes copies the first n bytes of src into dst starting at dstOff. It is
// overlap-safe even when src and dst are views of the same ArrayBuffer.
// PORT-NOTE: perf, departs from 1:1: short runs (up to SHORT_COPY bytes) are copied
// with an indexed loop, because the call overhead of set() and copyWithin dominates
// for a few bytes. When both views share one ArrayBuffer the loop runs forward if the
// destination starts before the source and backward otherwise, which is memmove's
// result for overlapping ranges, and the whole-buffer view is not allocated on this
// path. Longer runs keep set() and copyWithin, so the bytes written are the same either way.
function moveBytes(dst: Uint8Array, dstOff: number, src: Uint8Array, n: number): void {
  if (n === 0) {
    return;
  }
  if (n <= SHORT_COPY) {
    if (dst.buffer === src.buffer) {
      if (dst.byteOffset + dstOff < src.byteOffset) {
        for (let k = 0; k < n; k++) {
          dst[dstOff + k] = src[k];
        }
      } else {
        for (let k = n - 1; k >= 0; k--) {
          dst[dstOff + k] = src[k];
        }
      }
    } else {
      for (let k = 0; k < n; k++) {
        dst[dstOff + k] = src[k];
      }
    }
    return;
  }
  if (dst.buffer === src.buffer) {
    const whole = new Uint8Array(dst.buffer);
    whole.copyWithin(dst.byteOffset + dstOff, src.byteOffset, src.byteOffset + n);
  } else {
    dst.set(n === src.length ? src : src.subarray(0, n), dstOff);
  }
}

// copyIntoFresh copies all of src into dst at dstOff, where dst is a newly
// allocated array that shares no buffer with src. It reads no `.buffer`, so
// neither a small source nor a small destination is materialised.
// PORT-NOTE: perf, departs from 1:1 (structural change S1): used only for fresh destinations.
function copyIntoFresh(dst: Uint8Array, dstOff: number, src: Uint8Array): void {
  const n = src.length;
  if (n <= SHORT_COPY) {
    for (let k = 0; k < n; k++) {
      dst[dstOff + k] = src[k];
    }
  } else {
    dst.set(src, dstOff);
  }
}

// Append mirrors Go's append(a, b...). See the size rule at the top of the file.
// A large a whose capacity holds the result gets b written into the shared
// buffer right after a, and a view of the same buffer with the larger length is
// returned. Otherwise the result is a new array: exact-fit when it is small,
// a new ArrayBuffer of the grown capacity when it is large.
// PORT-NOTE: perf, departs from 1:1 (structural change S1): a small a (length <= 64) is
// never appended in place, and the result of a small append is an exact-fit on-heap array.
// Append(a, empty) returns a.
export function Append(a: Uint8Array, b: Uint8Array): Uint8Array {
  const aLen = a.length;
  const bLen = b.length;
  if (0 === bLen) {
    return a;
  }
  const newLen = aLen + bLen;
  if (SMALL < aLen) {
    const buf = a.buffer;
    const off = a.byteOffset;
    const cap = buf.byteLength - off; // Cap(a)
    if (newLen <= cap) {
      const v = new Uint8Array(buf, off, newLen);
      // set() copies the source first when both views share a buffer, so the overlap is safe.
      v.set(b, aLen);
      return v;
    }
    const nv = new Uint8Array(new ArrayBuffer(CalculateNewCapacity(newLen, cap)), 0, newLen);
    nv.set(a, 0);
    copyIntoFresh(nv, aLen, b);
    return nv;
  }
  if (newLen <= SMALL) {
    const v = new Uint8Array(newLen);
    copyIntoFresh(v, 0, a);
    copyIntoFresh(v, aLen, b);
    return v;
  }
  const nv = new Uint8Array(new ArrayBuffer(CalculateNewCapacity(newLen, aLen)), 0, newLen);
  copyIntoFresh(nv, 0, a);
  copyIntoFresh(nv, aLen, b);
  return nv;
}

// AppendByte mirrors Go's append(a, c) for one byte, without allocating a
// temporary slice. See the size rule at the top of the file.
// PORT-NOTE: perf, departs from 1:1 (structural change S1): a small a is never appended in
// place. The result is a new exact-fit array (or a new ArrayBuffer once it passes 64 bytes).
export function AppendByte(a: Uint8Array, c: number): Uint8Array {
  const aLen = a.length;
  const newLen = aLen + 1;
  if (SMALL < aLen) {
    const buf = a.buffer;
    const off = a.byteOffset;
    const cap = buf.byteLength - off; // Cap(a)
    if (newLen <= cap) {
      const v = new Uint8Array(buf, off, newLen);
      v[aLen] = c;
      return v;
    }
    const nv = new Uint8Array(new ArrayBuffer(CalculateNewCapacity(newLen, cap)), 0, newLen);
    nv.set(a, 0);
    nv[aLen] = c;
    return nv;
  }
  if (newLen <= SMALL) {
    const v = new Uint8Array(newLen);
    copyIntoFresh(v, 0, a);
    v[aLen] = c;
    return v;
  }
  const nv = new Uint8Array(new ArrayBuffer(CalculateNewCapacity(newLen, aLen)), 0, newLen);
  copyIntoFresh(nv, 0, a);
  nv[aLen] = c;
  return nv;
}

// AppendInPlaceLikeGo is Go's append(a, b...) for any size, with no size rule:
// the capacity is the buffer tail (Cap(a)), and b is written into the shared
// buffer when the result fits it. It is the code of Append before S1.
// Use it only where Go writes into the spare capacity of a small slice and that
// write is observed through another view (see the call sites marked PORT-NOTE).
// PORT-NOTE: this is the pre-S1 Append, kept for the Go aliasing at those sites.
export function AppendInPlaceLikeGo(a: Uint8Array, b: Uint8Array): Uint8Array {
  const aLen = a.length;
  const bLen = b.length;
  const newLen = aLen + bLen;
  const buf = a.buffer;
  const off = a.byteOffset;
  const cap = buf.byteLength - off; // Cap(a)
  if (newLen <= cap) {
    const v = new Uint8Array(buf, off, newLen);
    moveBytes(v, aLen, b, bLen);
    return v;
  }
  const nc = CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  moveBytes(v, 0, a, aLen);
  moveBytes(v, aLen, b, bLen);
  return v;
}

// AppendByteInPlaceLikeGo is Go's append(a, c) for one byte for any size, with no
// size rule. It is the code of AppendByte before S1. See AppendInPlaceLikeGo.
// PORT-NOTE: this is the pre-S1 AppendByte, kept for the Go aliasing at those sites.
export function AppendByteInPlaceLikeGo(a: Uint8Array, c: number): Uint8Array {
  const aLen = a.length;
  const newLen = aLen + 1;
  const buf = a.buffer;
  const off = a.byteOffset;
  const cap = buf.byteLength - off; // Cap(a)
  if (newLen <= cap) {
    const v = new Uint8Array(buf, off, newLen);
    v[aLen] = c;
    return v;
  }
  const nc = CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  moveBytes(v, 0, a, aLen);
  v[aLen] = c;
  return v;
}

// CapAfterByteAppends is a port addition. It returns the capacity of a slice that
// started as new Uint8Array(0) and received n single-byte appends with AppendByte.
// PORT-NOTE: perf, departs from 1:1 (structural change S1): up to 64 bytes the appends
// are exact-fit, so the capacity is n. Above 64 the capacity is the growth sequence from 64
// (CalculateNewCapacity(cap + 1, cap) each time the length passes the capacity), so the loop
// jumps from one growth to the next and runs in O(log n).
export function CapAfterByteAppends(n: number): number {
  if (n <= SMALL) {
    return n;
  }
  let cap = SMALL;
  while (cap < n) {
    cap = CalculateNewCapacity(cap + 1, cap);
  }
  return cap;
}

// AppendString mirrors Go's append(a, s...) where s is a string: it appends the
// UTF-8 encoding of s. Lone surrogates encode as U+FFFD (EF BF BD).
export function AppendString(a: Uint8Array, s: string): Uint8Array {
  return Append(a, encoder.encode(s));
}

// Copy mirrors Go's copy(dst, src): it copies min(len(dst), len(src)) bytes,
// is overlap-safe, and returns the number of bytes copied.
// PORT-NOTE: perf, departs from 1:1: moveBytes takes the count, so the source is not
// cut with subarray. The bytes copied are the same.
export function Copy(dst: Uint8Array, src: Uint8Array): number {
  const n = Math.min(dst.length, src.length);
  moveBytes(dst, 0, src, n);
  return n;
}

// Clone returns a fresh copy of a whose capacity equals its length.
export function Clone(a: Uint8Array): Uint8Array {
  return new Uint8Array(a);
}

// NilIfEmpty is a port addition for Go results that are nil exactly when they are empty
// (bytes.TrimSpace, bytes.Trim, bytes.TrimLeft, bytes.TrimFunc, bytes.TrimLeftFunc). The runtime
// functions return an empty array where Go returns nil; wrap the call when the result is
// assigned to a nullable location (see "nil slices" in PORTING.md).
export function NilIfEmpty(b: Uint8Array): Uint8Array | null {
  return 0 === b.length ? null : b;
}

// KeepNil is a port addition for Go functions whose result is nil exactly when their
// input slice is nil, because they only slice or return their input
// (bytes.TrimPrefix, bytes.TrimSuffix, bytes.TrimRight, bytes.TrimRightFunc, lex.TrimWhitespace,
// lex.TrimRight, lex.ReplaceNewlineSpace, lex.ReplaceAll and slicing s[a:b]).
// It applies f to src, or returns null when src is null.
export function KeepNil(src: Uint8Array | null, f: (b: Uint8Array) => Uint8Array): Uint8Array | null {
  return null === src ? null : f(src);
}
