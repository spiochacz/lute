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
// Port additions (not in Go): CalculateNewCapacity, Reslice, AppendByte, AppendString
// are named after their Go equivalents but are helpers of this port.

const encoder = new TextEncoder();

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
export function Make(len: number, cap: number = len): Uint8Array {
  if (!Number.isInteger(len) || len < 0) {
    throw new RangeError("makeslice: len out of range");
  }
  if (!Number.isInteger(cap) || cap < len) {
    throw new RangeError("makeslice: cap out of range");
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

// Append mirrors Go's append(a, b...). When the capacity of a holds the result,
// b is written into the shared buffer right after a and a view of the same
// buffer with the larger length is returned. Otherwise a new buffer is
// allocated and both a and b are copied into it.
// PORT-NOTE: perf, departs from 1:1: the lengths and the buffer are read once into
// locals, and moveBytes takes the count, so no subarray view is made for b. The
// result (length, content, capacity, aliasing) is the same as before.
export function Append(a: Uint8Array, b: Uint8Array): Uint8Array {
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

// AppendByte mirrors Go's append(a, c) for one byte, without allocating a
// temporary slice.
// PORT-NOTE: perf, departs from 1:1: the length, buffer and offset are read once, and the
// copy on growth uses moveBytes, which loops for short slices. The result is the same.
export function AppendByte(a: Uint8Array, c: number): Uint8Array {
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
// The capacity changes only when the length passes it, and then becomes
// CalculateNewCapacity(length, capacity), so the loop jumps from one growth to the
// next and runs in O(log n).
export function CapAfterByteAppends(n: number): number {
  let cap = 0;
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
