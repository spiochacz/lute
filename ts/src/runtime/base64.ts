// Port of the parts of Go's encoding/base64 used by Lute: base64.RawURLEncoding.
//
// Ported from Go 1.21 encoding/base64 (encoding.go, base64.go).
// - Alphabet: A-Z a-z 0-9 - _ (URL alphabet), no padding.
// - Decoding skips '\r' and '\n' anywhere in the input (Go's decoder ignores
//   newlines). Any other character outside the alphabet, including '=', is an
//   error. A remaining length of 1 modulo 4 is an error.
// - Non-zero trailing bits are accepted, as in Go's non-strict mode.
// - On error the result is an empty array; Go returns partial output with the
//   error, and callers in Lute ignore it on error.
//
// PORT-NOTE: Go's CorruptInputError carries a byte offset. The
// message here is "illegal base64 data" and carries no offset.

const rawURLAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// decodeMap maps a char code (0..127) to its 6-bit value, or -1 when not in the alphabet.
const decodeMap: Int8Array = buildDecodeMap();

function buildDecodeMap(): Int8Array {
  const m = new Int8Array(128);
  m.fill(-1);
  for (let i = 0; i < rawURLAlphabet.length; i++) {
    m[rawURLAlphabet.charCodeAt(i)] = i;
  }
  return m;
}

// RawURLEncodeToString returns the base64 encoding of b (Go RawURLEncoding.EncodeToString).
export function RawURLEncodeToString(b: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= b.length; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += rawURLAlphabet[(v >> 18) & 0x3f] + rawURLAlphabet[(v >> 12) & 0x3f] +
      rawURLAlphabet[(v >> 6) & 0x3f] + rawURLAlphabet[v & 0x3f];
  }
  const rem = b.length - i;
  if (rem === 1) {
    const v = b[i] << 16;
    out += rawURLAlphabet[(v >> 18) & 0x3f] + rawURLAlphabet[(v >> 12) & 0x3f];
  } else if (rem === 2) {
    const v = (b[i] << 16) | (b[i + 1] << 8);
    out += rawURLAlphabet[(v >> 18) & 0x3f] + rawURLAlphabet[(v >> 12) & 0x3f] +
      rawURLAlphabet[(v >> 6) & 0x3f];
  }
  return out;
}

// RawURLDecodeString decodes s (Go RawURLEncoding.DecodeString).
export function RawURLDecodeString(s: string): [Uint8Array, Error | null] {
  // PERF-TODO: collects the 6-bit values in a JS array before packing bytes.
  const vals: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0d /* \r */ || c === 0x0a /* \n */) {
      continue;
    }
    const v = c < 128 ? decodeMap[c] : -1;
    if (v < 0) {
      return [new Uint8Array(0), new Error("illegal base64 data")];
    }
    vals.push(v);
  }
  if (vals.length % 4 === 1) {
    return [new Uint8Array(0), new Error("illegal base64 data")];
  }

  const out = new Uint8Array(Math.floor((vals.length * 6) / 8));
  let o = 0;
  let i = 0;
  for (; i + 4 <= vals.length; i += 4) {
    const v = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out[o++] = (v >> 16) & 0xff;
    out[o++] = (v >> 8) & 0xff;
    out[o++] = v & 0xff;
  }
  const rem = vals.length - i;
  if (rem === 2) {
    const v = (vals[i] << 18) | (vals[i + 1] << 12);
    out[o++] = (v >> 16) & 0xff;
  } else if (rem === 3) {
    const v = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6);
    out[o++] = (v >> 16) & 0xff;
    out[o++] = (v >> 8) & 0xff;
  }
  return [out, null];
}
