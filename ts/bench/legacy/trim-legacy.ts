// Bench-only copy of the OLD cutset trims: the cutset is turned into an array of
// code points on every call, and every non-ASCII rune is decoded with
// DecodeRune(s.subarray(i)). Used only as the A side of the A/B rows.
import * as utf8 from "../../src/runtime/utf8.ts";

const emptyBytes = (): Uint8Array => new Uint8Array(0);

function codePoints(str: string): number[] {
  return Array.from(str, (ch) => ch.codePointAt(0) as number);
}

export function TrimLeft(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return emptyBytes();
  }
  if (cutset === "") {
    return s;
  }
  const set = codePoints(cutset);
  let start = 0;
  while (start < s.length) {
    let r = s[start];
    let w = 1;
    if (r >= 0x80) {
      [r, w] = utf8.DecodeRune(s.subarray(start));
    }
    if (!set.includes(r)) {
      break;
    }
    start += w;
  }
  if (start === s.length) {
    return emptyBytes();
  }
  return s.subarray(start);
}

export function TrimRight(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0 || cutset === "") {
    return s;
  }
  const set = codePoints(cutset);
  let end = s.length;
  while (end > 0) {
    let r = s[end - 1];
    let w = 1;
    if (r >= 0x80) {
      [r, w] = utf8.DecodeLastRune(s.subarray(0, end));
    }
    if (!set.includes(r)) {
      break;
    }
    end -= w;
  }
  return s.subarray(0, end);
}

export function Trim(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return emptyBytes();
  }
  if (cutset === "") {
    return s;
  }
  return TrimLeft(TrimRight(s, cutset), cutset);
}
