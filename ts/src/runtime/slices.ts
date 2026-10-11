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

// moveBytes copies src into dst starting at dstOff. It is overlap-safe even
// when src and dst are views of the same ArrayBuffer. TypedArray.prototype.set
// would clone the whole source buffer in that case, so copyWithin is used.
function moveBytes(dst: Uint8Array, dstOff: number, src: Uint8Array): void {
  if (src.length === 0) {
    return;
  }
  if (src.buffer === dst.buffer) {
    const whole = new Uint8Array(dst.buffer);
    whole.copyWithin(dst.byteOffset + dstOff, src.byteOffset, src.byteOffset + src.length);
  } else {
    dst.set(src, dstOff);
  }
}

// Append mirrors Go's append(a, b...). When the capacity of a holds the result,
// b is written into the shared buffer right after a and a view of the same
// buffer with the larger length is returned. Otherwise a new buffer is
// allocated and both a and b are copied into it.
export function Append(a: Uint8Array, b: Uint8Array): Uint8Array {
  const newLen = a.length + b.length;
  const cap = Cap(a);
  if (newLen <= cap) {
    const v = new Uint8Array(a.buffer, a.byteOffset, newLen);
    moveBytes(v, a.length, b);
    return v;
  }
  const nc = CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  v.set(a, 0);
  v.set(b, a.length);
  return v;
}

// AppendByte mirrors Go's append(a, c) for one byte, without allocating a
// temporary slice.
export function AppendByte(a: Uint8Array, c: number): Uint8Array {
  const newLen = a.length + 1;
  const cap = Cap(a);
  if (newLen <= cap) {
    const v = new Uint8Array(a.buffer, a.byteOffset, newLen);
    v[a.length] = c;
    return v;
  }
  const nc = CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  v.set(a, 0);
  v[a.length] = c;
  return v;
}

// AppendString mirrors Go's append(a, s...) where s is a string: it appends the
// UTF-8 encoding of s. Lone surrogates encode as U+FFFD (EF BF BD).
export function AppendString(a: Uint8Array, s: string): Uint8Array {
  return Append(a, encoder.encode(s));
}

// Copy mirrors Go's copy(dst, src): it copies min(len(dst), len(src)) bytes,
// is overlap-safe, and returns the number of bytes copied.
export function Copy(dst: Uint8Array, src: Uint8Array): number {
  const n = Math.min(dst.length, src.length);
  if (n > 0) {
    moveBytes(dst, 0, src.subarray(0, n));
  }
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
