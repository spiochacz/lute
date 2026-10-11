import { test } from "node:test";
import assert from "node:assert/strict";
import * as slices from "../runtime/slices.ts";
import { IsBackslashEscapePunct, Split, SplitWithoutBackslashEscape } from "./token.ts";

// The old byte-by-byte implementations, kept here only as the reference for the
// new Split and SplitWithoutBackslashEscape. Each element is built with
// slices.AppendByteInPlaceLikeGo, which is the code of AppendByte before structural
// change S1, so its length, content and capacity are the ones of the original.
// Under S1 the capacity of an element of at most 64 bytes is its length, so for those
// the test checks exact fit instead of the old capacity; the length and content are
// compared for every element.

function oldSplit(tokens: Uint8Array, separator: number): Uint8Array[] {
  let ret: Uint8Array[] = [];
  const length = tokens.length;
  let i = 0;
  let token = 0;
  let line: Uint8Array = new Uint8Array(0);
  for (; i < length; i++) {
    token = tokens[i];
    if (separator !== token) {
      line = slices.AppendByteInPlaceLikeGo(line, token);
      continue;
    }

    ret.push(line);
    line = new Uint8Array(0);
  }
  if (0 < line.length) {
    ret.push(line);
  }
  return ret;
}

function oldSplitWithoutBackslashEscape(tokens: Uint8Array, separator: number): Uint8Array[] {
  let ret: Uint8Array[] = [];
  const length = tokens.length;
  let token = 0;
  let line: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < length; i++) {
    token = tokens[i];
    if (separator !== token || IsBackslashEscapePunct(tokens, i)) {
      line = slices.AppendByteInPlaceLikeGo(line, token);
      continue;
    }

    ret.push(line);
    line = new Uint8Array(0);
  }
  if (0 < line.length) {
    ret.push(line);
  }
  return ret;
}

// assertSameElements compares content and length of every element. An element above 64 bytes also
// gets the capacity of the old byte-by-byte loop; an element of at most 64 bytes must be exact fit (capacity = length).
function assertSameElements(got: Uint8Array[], want: Uint8Array[], where: string): void {
  assert.equal(got.length, want.length, `${where}: element count`);
  for (let i = 0; i < want.length; i++) {
    const w = `${where}: element ${i}`;
    assert.equal(Buffer.from(got[i]).toString("hex"), Buffer.from(want[i]).toString("hex"), `${w} content`);
    assert.equal(got[i].length, want[i].length, `${w} length`);
    if (want[i].length > 64) {
      assert.equal(slices.Cap(got[i]), slices.Cap(want[i]), `${w} capacity`);
    } else {
      assert.equal(slices.Cap(got[i]), got[i].length, `${w} exact-fit capacity`);
    }
  }
}

// A small deterministic generator, so that a failure can be reproduced.
function generator(seed: number): (n: number) => number {
  let state = seed;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % n;
  };
}

// The alphabet mixes separators (| and newline), backslashes, punctuation that a
// backslash can escape, spaces, letters and bytes of a multi-byte character.
const alphabet = [0x7c, 0x7c, 0x5c, 0x5c, 0x61, 0x62, 0x20, 0x0a, 0x2a, 0x60, 0x21, 0xc3, 0xa9, 0x7c, 0x5c];
const separators = [0x7c, 0x0a, 0x61];

function randomInput(rnd: (n: number) => number, maxLen: number): Uint8Array {
  const n = rnd(maxLen + 1);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = alphabet[rnd(alphabet.length)];
  }
  return b;
}

test("Split and SplitWithoutBackslashEscape match the byte-by-byte versions on explicit inputs", () => {
  const inputs = ["", "|", "||", "a", "a|", "|a", "a|b|c", "a\\|b|c", "\\\\|x", "a\\", "\\|", "|||\\||a"];
  for (const s of inputs) {
    const b = new TextEncoder().encode(s);
    for (const sep of [0x7c, 0x61]) {
      assertSameElements(Split(b, sep), oldSplit(b, sep), `Split ${JSON.stringify(s)} sep=${sep}`);
      assertSameElements(
        SplitWithoutBackslashEscape(b, sep),
        oldSplitWithoutBackslashEscape(b, sep),
        `SplitWithoutBackslashEscape ${JSON.stringify(s)} sep=${sep}`,
      );
    }
  }
});

test("Split and SplitWithoutBackslashEscape match the byte-by-byte versions on generated inputs", () => {
  const rnd = generator(20261011);
  // Short inputs: many elements, many empty ones.
  for (let k = 0; k < 3000; k++) {
    const b = randomInput(rnd, 40);
    const sep = separators[rnd(separators.length)];
    assertSameElements(Split(b, sep), oldSplit(b, sep), `Split input ${k}`);
    assertSameElements(
      SplitWithoutBackslashEscape(b, sep),
      oldSplitWithoutBackslashEscape(b, sep),
      `SplitWithoutBackslashEscape input ${k}`,
    );
  }
  // Long inputs with few separators: elements longer than 1024 bytes, where the
  // capacity growth changes its formula.
  for (let k = 0; k < 150; k++) {
    const n = rnd(3001);
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      b[i] = rnd(40) === 0 ? 0x7c : alphabet[rnd(alphabet.length)];
    }
    const sep = 0x7c;
    assertSameElements(Split(b, sep), oldSplit(b, sep), `Split long ${k}`);
    assertSameElements(
      SplitWithoutBackslashEscape(b, sep),
      oldSplitWithoutBackslashEscape(b, sep),
      `SplitWithoutBackslashEscape long ${k}`,
    );
  }
});

test("elements of at most 64 bytes are exact fit, and elements above 64 bytes keep the old capacity", () => {
  const short = Split(new TextEncoder().encode("abc|de"), 0x7c);
  assert.deepEqual(short.map((e) => slices.Cap(e)), [3, 2]);
  const long = new Uint8Array(200).fill(0x61);
  long[100] = 0x7c;
  const parts = Split(long, 0x7c);
  assert.equal(parts[0].length, 100);
  assert.equal(slices.Cap(parts[0]), 128);
  assert.equal(parts[1].length, 99);
  assert.equal(slices.Cap(parts[1]), 128);
});

test("an element is a new slice: appending to it does not change the input", () => {
  const b = new TextEncoder().encode("abc|def");
  const before = Buffer.from(b).toString("hex");
  const parts = Split(b, 0x7c);
  slices.AppendByte(parts[0], 0x78);
  assert.equal(Buffer.from(b).toString("hex"), before);
});
