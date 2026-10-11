// Bench-only copy of the OLD slices.Append, slices.AppendByte and moveBytes (before the
// short-run loop): every copy goes through TypedArray set() or copyWithin, and the
// same-buffer case allocates a whole-buffer view. Used only as the A side of the
// ab.append rows. Cap and CalculateNewCapacity are unchanged, so they are imported.
import { Cap, CalculateNewCapacity } from "../../src/runtime/slices.ts";

function moveBytesLegacy(dst: Uint8Array, dstOff: number, src: Uint8Array): void {
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

export function AppendLegacy(a: Uint8Array, b: Uint8Array): Uint8Array {
  const newLen = a.length + b.length;
  const cap = Cap(a);
  if (newLen <= cap) {
    const v = new Uint8Array(a.buffer, a.byteOffset, newLen);
    moveBytesLegacy(v, a.length, b);
    return v;
  }
  const nc = CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  v.set(a, 0);
  v.set(b, a.length);
  return v;
}

export function AppendByteLegacy(a: Uint8Array, c: number): Uint8Array {
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
