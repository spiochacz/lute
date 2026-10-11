// Port of the parts of Go's strconv package used by Lute, for the Lute
// TypeScript port.
//
// Deliberate adaptations:
//
// 1. Integers are JS numbers. Values beyond +/-2^53 are not exact. Results that
//    Go computes as 64-bit integers (Atoi, ParseInt with bitSize 0 or 64) are
//    returned as the nearest JS number, so the clamped value of an out-of-range
//    64-bit parse is 2^63 (as a double), not 2^63-1.
//
// 2. Functions that return (value, error) in Go return [value, Error | null].
//    Error messages have Go's text, for example
//    `strconv.Atoi: parsing "abc": invalid syntax`. Go's *NumError is replaced by
//    a plain Error with that message.
//
// 3. Quote works on UTF-16 strings. Go escapes an invalid byte as \xNN; a JS
//    string has no bytes, so an unpaired surrogate (Go's invalid byte) is written
//    as �, which is what Go's appendEscapedRune writes for an invalid rune.
//
// 4. Only the argument combinations that Lute uses (and their close neighbours)
//    are implemented. Anything else throws an Error whose message starts with
//    "strconv.<Func>: unsupported arguments". See each function.

import * as utf8 from "./utf8.ts";
import * as unicode from "./unicode.ts";

const lowerHex = "0123456789abcdef";

function unsupported(fn: string, detail: string): Error {
  return new Error(`strconv.${fn}: unsupported arguments: ${detail}`);
}

function checkInteger(i: number, fn: string): void {
  if (!Number.isInteger(i)) {
    throw unsupported(fn, `argument ${String(i)} is not an integer`);
  }
}

// Quote returns a double-quoted Go string literal for s, escaped as Go's
// strconv.Quote does: \a \b \f \n \r \t \v \\ \" and \xNN for control characters
// below U+0020 and U+007F, \uNNNN and \UNNNNNNNN for non-printable runes
// (unicode.IsPrint decides), and printable runes written as they are.
export function Quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; ) {
    const [r, size] = utf8.DecodeRuneInString(s, i);
    // A surrogate that decodes with width 1 is unpaired: Go's invalid byte.
    const unpaired = size === 1 && r === utf8.RuneError && s.charCodeAt(i) >= 0xd800 && s.charCodeAt(i) <= 0xdfff;
    out += escapeRune(r, unpaired);
    i += size;
  }
  return out + '"';
}

function escapeRune(r: number, unpaired: boolean): string {
  if (r === 0x22 || r === 0x5c) {
    return "\\" + String.fromCharCode(r);
  }
  if (!unpaired && unicode.IsPrint(r)) {
    return String.fromCodePoint(r);
  }
  switch (r) {
    case 0x07:
      return "\\a";
    case 0x08:
      return "\\b";
    case 0x0c:
      return "\\f";
    case 0x0a:
      return "\\n";
    case 0x0d:
      return "\\r";
    case 0x09:
      return "\\t";
    case 0x0b:
      return "\\v";
  }
  if (r < 0x20 || r === 0x7f) {
    return "\\x" + lowerHex[(r >> 4) & 0xf] + lowerHex[r & 0xf];
  }
  if (unpaired || !utf8.ValidRune(r)) {
    return "\\ufffd";
  }
  if (r < 0x10000) {
    return "\\u" + r.toString(16).padStart(4, "0");
  }
  return "\\U" + r.toString(16).padStart(8, "0");
}

// Itoa returns the decimal representation of the integer i.
export function Itoa(i: number): string {
  checkInteger(i, "Itoa");
  return BigInt(i).toString();
}

// FormatInt returns the string representation of i in the given base, 2 to 36,
// with lower-case letters for digits above 9. Go panics for other bases.
export function FormatInt(i: number, base: number): string {
  checkInteger(i, "FormatInt");
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new Error("strconv: illegal AppendInt/FormatInt base");
  }
  return BigInt(i).toString(base);
}

// FormatBool returns "true" or "false" according to the value of b.
export function FormatBool(b: boolean): string {
  return b ? "true" : "false";
}

function syntaxError(fn: string, s: string): Error {
  return new Error(`strconv.${fn}: parsing ${Quote(s)}: invalid syntax`);
}

function rangeError(fn: string, s: string): Error {
  return new Error(`strconv.${fn}: parsing ${Quote(s)}: value out of range`);
}

// digitValue returns the value of an ASCII digit or letter (case-insensitive),
// or 99 for any other code unit. Go accepts both cases of letters in bases above
// 10.
function digitValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) {
    return c - 0x30;
  }
  if (c >= 0x61 && c <= 0x7a) {
    return c - 0x61 + 10;
  }
  if (c >= 0x41 && c <= 0x5a) {
    return c - 0x41 + 10;
  }
  return 99;
}

// parseIntCore follows Go's ParseInt (sign, then ParseUint) for a base in 2..36
// and a bit size of 0 (64) or 1..64. fn is the Go function name used in errors:
// "Atoi" or "ParseInt". Underscores are not allowed because base 0 is not
// supported.
function parseIntCore(s0: string, base: number, bitSize: number, fn: string): [number, Error | null] {
  if (s0 === "") {
    return [0, syntaxError(fn, s0)];
  }
  let s = s0;
  let neg = false;
  if (s[0] === "+") {
    s = s.slice(1);
  } else if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  }
  if (s === "") {
    return [0, syntaxError(fn, s0)];
  }
  if (base === 0) {
    throw unsupported(fn, "base 0 (prefix detection) is not implemented");
  }
  if (!(2 <= base && base <= 36)) {
    return [0, new Error(`strconv.${fn}: parsing ${Quote(s0)}: invalid base ${base}`)];
  }
  if (bitSize === 0) {
    bitSize = 64;
  } else if (bitSize < 0 || bitSize > 64) {
    return [0, new Error(`strconv.${fn}: parsing ${Quote(s0)}: invalid bit size ${bitSize}`)];
  }
  const bigBase = BigInt(base);
  let un = 0n;
  for (let k = 0; k < s.length; k++) {
    const d = digitValue(s.charCodeAt(k));
    if (d >= base) {
      return [0, syntaxError(fn, s0)];
    }
    un = un * bigBase + BigInt(d);
  }
  const cutoff = 1n << BigInt(bitSize - 1);
  if (!neg && un >= cutoff) {
    return [Number(cutoff - 1n), rangeError(fn, s0)];
  }
  if (neg && un > cutoff) {
    return [Number(-cutoff), rangeError(fn, s0)];
  }
  return [Number(neg ? -un : un), null];
}

// Atoi returns the decimal integer in s, which may have a single leading + or -
// sign and nothing else. Whitespace, underscores and other bases are rejected.
// Out-of-range input returns the clamped 64-bit value and a range error.
export function Atoi(s: string): [number, Error | null] {
  return parseIntCore(s, 10, 64, "Atoi");
}

// ParseInt interprets s in the given base (2 to 36) and bit size (0, or 1 to 64;
// 0 means 64) and returns the value with an optional leading sign. Base 0 (prefix
// detection with underscores) is not supported and throws. Out-of-range input
// returns the clamped value and a range error; syntax errors return 0.
export function ParseInt(s: string, base: number, bitSize: number): [number, Error | null] {
  return parseIntCore(s, base, bitSize, "ParseInt");
}

function asciiLower(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : s[i];
  }
  return out;
}

// ParseFloat parses a decimal floating-point number with bit size 64 (Go's
// ParseFloat(s, 64)). It accepts the decimal grammar of Go (optional sign,
// digits with an optional point, optional exponent), and "inf", "infinity" (with
// optional sign) and "nan" (case-insensitive). Overflow returns +/-Inf and a
// range error. Hexadecimal floats and underscores throw, because they are not
// supported.
export function ParseFloat(s: string, bitSize: number): [number, Error | null] {
  const fn = "ParseFloat";
  if (bitSize !== 64) {
    throw unsupported(fn, `bit size ${bitSize} (only 64 is implemented)`);
  }
  if (s.includes("_")) {
    throw unsupported(fn, "underscores are not implemented");
  }
  let i = 0;
  let neg = false;
  const hasSign = s[0] === "+" || s[0] === "-";
  if (hasSign) {
    neg = s[0] === "-";
    i = 1;
  }
  const rest = asciiLower(s.slice(i));
  if (rest === "inf" || rest === "infinity") {
    return [neg ? -Infinity : Infinity, null];
  }
  if (!hasSign && asciiLower(s) === "nan") {
    return [NaN, null];
  }
  if (rest.startsWith("0x")) {
    throw unsupported(fn, "hexadecimal floats are not implemented");
  }
  let p = i;
  let digits = 0;
  while (p < s.length && s.charCodeAt(p) >= 0x30 && s.charCodeAt(p) <= 0x39) {
    p++;
    digits++;
  }
  if (p < s.length && s[p] === ".") {
    p++;
    while (p < s.length && s.charCodeAt(p) >= 0x30 && s.charCodeAt(p) <= 0x39) {
      p++;
      digits++;
    }
  }
  if (digits === 0) {
    return [0, syntaxError(fn, s)];
  }
  if (p < s.length && (s[p] === "e" || s[p] === "E")) {
    p++;
    if (p < s.length && (s[p] === "+" || s[p] === "-")) {
      p++;
    }
    let expDigits = 0;
    while (p < s.length && s.charCodeAt(p) >= 0x30 && s.charCodeAt(p) <= 0x39) {
      p++;
      expDigits++;
    }
    if (expDigits === 0) {
      return [0, syntaxError(fn, s)];
    }
  }
  if (p !== s.length) {
    return [0, syntaxError(fn, s)];
  }
  // The validated text is a decimal literal, which Number parses with correct
  // rounding, as Go does.
  const v = Number(s);
  if (!Number.isFinite(v)) {
    return [v, rangeError(fn, s)];
  }
  return [v, null];
}

// decompose returns the exact value of a finite, non-negative double as
// mant * 2^exp, with mant a BigInt.
function decompose(a: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, a);
  const bits = (BigInt(dv.getUint32(0)) << 32n) | BigInt(dv.getUint32(4));
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) {
    return [frac, -1074];
  }
  return [frac | (1n << 52n), expBits - 1075];
}

// FormatFloat formats f with format 'f' (decimal, no exponent) and a
// non-negative precision, for bit size 64. The rounding is exact: the binary
// value is rounded to prec digits after the point with ties to even, as Go does.
// NaN, +Inf and -Inf are written "NaN", "+Inf" and "-Inf". Other formats, a
// negative precision (shortest representation) and bit size 32 throw.
export function FormatFloat(f: number, fmt: string, prec: number, bitSize: number): string {
  const fn = "FormatFloat";
  if (bitSize !== 64) {
    throw unsupported(fn, `bit size ${bitSize} (only 64 is implemented)`);
  }
  if (fmt !== "f") {
    throw unsupported(fn, `format '${fmt}' (only 'f' is implemented)`);
  }
  if (!Number.isInteger(prec) || prec < 0) {
    throw unsupported(fn, `precision ${prec} (only non-negative precisions are implemented)`);
  }
  if (Number.isNaN(f)) {
    return "NaN";
  }
  if (f === Infinity) {
    return "+Inf";
  }
  if (f === -Infinity) {
    return "-Inf";
  }
  const neg = f < 0 || Object.is(f, -0);
  const [mant, exp] = decompose(Math.abs(f));
  const scale = 10n ** BigInt(prec);
  let q: bigint;
  if (exp >= 0) {
    q = (mant << BigInt(exp)) * scale;
  } else {
    const num = mant * scale;
    const den = 1n << BigInt(-exp);
    q = num / den;
    const twice = 2n * (num % den);
    if (twice > den || (twice === den && (q & 1n) === 1n)) {
      q += 1n;
    }
  }
  let digits = q.toString();
  if (prec > 0) {
    digits = digits.padStart(prec + 1, "0");
    digits = digits.slice(0, digits.length - prec) + "." + digits.slice(digits.length - prec);
  }
  return (neg ? "-" : "") + digits;
}
