import { test } from "node:test";
import assert from "node:assert/strict";
import * as bytes from "./bytes.ts";
import * as slices from "./slices.ts";
import * as utf8 from "./utf8.ts";

// Differential test of the Trim family (L10: ASCII cutset table). The reference
// below is a private copy of the implementation before the table was added, with
// the per-code-point scan of the cutset (inCutset) for every cutset.

function refInCutset(set: string, r: number): boolean {
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

function refTrimLeft(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return new Uint8Array(0);
  }
  if (cutset === "") {
    return s;
  }
  let start = 0;
  while (start < s.length) {
    let r = s[start];
    let w = 1;
    if (r >= 0x80) {
      const v = utf8.DecodeRunePacked(s, start);
      r = v & 0xffffff;
      w = v >>> 24;
    }
    if (!refInCutset(cutset, r)) {
      break;
    }
    start += w;
  }
  if (start === s.length) {
    return new Uint8Array(0);
  }
  return s.subarray(start);
}

function refTrimRight(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0 || cutset === "") {
    return s;
  }
  let end = s.length;
  while (end > 0) {
    let r = s[end - 1];
    let w = 1;
    if (r >= 0x80) {
      const v = utf8.DecodeLastRunePacked(s, end);
      r = v & 0xffffff;
      w = v >>> 24;
    }
    if (!refInCutset(cutset, r)) {
      break;
    }
    end -= w;
  }
  return s.subarray(0, end);
}

function refTrim(s: Uint8Array, cutset: string): Uint8Array {
  if (s.length === 0) {
    return new Uint8Array(0);
  }
  if (cutset === "") {
    return s;
  }
  return refTrimLeft(refTrimRight(s, cutset), cutset);
}

// Deterministic generator (the same linear congruential step as in the scratch checks).
let seed = 20261011;
function rnd(n: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}

const encoder = new TextEncoder();
// Pieces of input: ASCII white space and punctuation, letters, valid multi-byte
// characters, U+FFFD itself, and bytes that are not valid UTF-8 at all.
const asciiPieces = [0x20, 0x09, 0x0a, 0x0d, 0x23, 0x61, 0x62, 0x00, 0x7f, 0x0b, 0x0c];
const textPieces = ["é", "漢", "😀", "�", " ", "#", " ", "\n"];
const rawPieces = [0x80, 0x9f, 0xbf, 0xc3, 0xe6, 0xf0, 0xff, 0xc0];

function randomInput(): Uint8Array {
  const parts: number[] = [];
  const len = rnd(25);
  while (parts.length < len) {
    const k = rnd(10);
    if (k < 4) {
      parts.push(asciiPieces[rnd(asciiPieces.length)]);
    } else if (k < 7) {
      for (const b of encoder.encode(textPieces[rnd(textPieces.length)])) {
        parts.push(b);
      }
    } else if (k < 9) {
      parts.push(rawPieces[rnd(rawPieces.length)]);
    } else {
      parts.push(rnd(256));
    }
  }
  return new Uint8Array(parts);
}

// Cutsets used by Lute and the edge cases: ASCII, the empty string, non-ASCII,
// mixed, U+FFFD (which matches a RuneError of an invalid byte) and lone surrogates.
const fixedCutsets = [
  " \t\n",
  "\n",
  "#",
  "",
  "\u0000",
  "a#",
  "é",
  "é#",
  "�",
  "� #",
  "😀",
  "漢\n",
  "  ",
  "\ud800",
  "\t \r\n\v\f",
];

// Random ASCII cutsets, more than the cache holds, so the uncached path runs too.
const randomCutsets: string[] = [];
for (let i = 0; i < 120; i++) {
  let c = "";
  const len = 1 + rnd(6);
  for (let j = 0; j < len; j++) {
    c += String.fromCharCode(rnd(128));
  }
  randomCutsets.push(c);
}

function hex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameResult(name: string, input: Uint8Array, cutset: string, got: Uint8Array, want: Uint8Array): void {
  const where = `${name}(${hex(input)}, ${JSON.stringify(cutset)})`;
  assert.equal(hex(got), hex(want), `${where}: content`);
  assert.equal(got.length, want.length, `${where}: length`);
  // The input is a fresh array (byteOffset 0), so byteOffset is relative to it.
  assert.equal(got.byteOffset, want.byteOffset, `${where}: byteOffset`);
  assert.equal(slices.Cap(got), slices.Cap(want), `${where}: Cap`);
}

test("Trim, TrimLeft, TrimRight equal the reference on 20,000 generated inputs and several cutsets", () => {
  const cutsets = fixedCutsets.concat(randomCutsets);
  for (let i = 0; i < 20000; i++) {
    const input = randomInput();
    // Each input is checked against the fixed cutsets in turn, and against two random ones.
    const picks = [cutsets[i % fixedCutsets.length], cutsets[fixedCutsets.length + rnd(randomCutsets.length)], cutsets[rnd(fixedCutsets.length)]];
    for (const cutset of picks) {
      sameResult("Trim", input, cutset, bytes.Trim(input, cutset), refTrim(input, cutset));
      sameResult("TrimLeft", input, cutset, bytes.TrimLeft(input, cutset), refTrimLeft(input, cutset));
      sameResult("TrimRight", input, cutset, bytes.TrimRight(input, cutset), refTrimRight(input, cutset));
    }
  }
});

test("Trim family: the cutset table answers for bytes of 0x80 and more and for invalid UTF-8 at the edges", () => {
  // An invalid byte decodes as U+FFFD: an ASCII cutset must not trim it, and a cutset holding U+FFFD must.
  const edges = new Uint8Array([0xe6, 0x20, 0x61, 0x20, 0x80]);
  assert.equal(hex(bytes.Trim(edges, " \t\n")), hex(refTrim(edges, " \t\n")));
  assert.equal(hex(bytes.Trim(edges, " \t\n")), "e620612080");
  assert.equal(hex(bytes.Trim(edges, "� ")), hex(refTrim(edges, "� ")));
  assert.equal(hex(bytes.Trim(edges, "� ")), "61");
  assert.equal(hex(bytes.TrimRight(edges, " ")), hex(refTrimRight(edges, " ")));
  assert.equal(hex(bytes.TrimLeft(edges, "�")), hex(refTrimLeft(edges, "�")));
});
