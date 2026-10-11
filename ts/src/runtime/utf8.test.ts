import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as utf8 from "./utf8.ts";

interface ByteVector {
  hex: string;
  decodeRune: [number, number];
  decodeLast: [number, number];
  valid: boolean;
  runeCount: number;
  fullRune: boolean;
}

interface StringVector {
  codeUnits: number[];
  byteLen: number;
  runeCount: number;
}

interface VectorFile {
  goVersion: string;
  vectors: ByteVector[];
  strings: StringVector[];
  encode: { checksum: number; count: number };
}

const data: VectorFile = JSON.parse(
  readFileSync(new URL("./testdata/utf8_vectors.json", import.meta.url), "utf8"),
);

function bytesOf(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvByte(h: number, b: number): number {
  return Math.imul(h ^ b, FNV_PRIME) >>> 0;
}

function fnvWord(h: number, v: number): number {
  for (let i = 0; i < 4; i++) {
    h = fnvByte(h, (v >>> (8 * i)) & 0xff);
  }
  return h;
}

test("byte functions match Go on every recorded vector", () => {
  assert.ok(data.vectors.length >= 500, `expected a few hundred vectors, got ${data.vectors.length}`);
  for (const v of data.vectors) {
    const p = bytesOf(v.hex);
    const label = `bytes ${v.hex || "(empty)"}`;
    assert.deepEqual(utf8.DecodeRune(p), v.decodeRune, `DecodeRune ${label}`);
    assert.deepEqual(utf8.DecodeLastRune(p), v.decodeLast, `DecodeLastRune ${label}`);
    assert.equal(utf8.Valid(p), v.valid, `Valid ${label}`);
    assert.equal(utf8.RuneCount(p), v.runeCount, `RuneCount ${label}`);
    assert.equal(utf8.FullRune(p), v.fullRune, `FullRune ${label}`);
  }
});

test("ByteLen and RuneCountInString match Go on lone-surrogate strings", () => {
  for (const s of data.strings) {
    const str = String.fromCharCode(...s.codeUnits);
    const label = `units [${s.codeUnits.map((u) => u.toString(16)).join(" ")}]`;
    assert.equal(utf8.ByteLen(str), s.byteLen, `ByteLen ${label}`);
    assert.equal(utf8.RuneCountInString(str), s.runeCount, `RuneCountInString ${label}`);
  }
});

test("EncodeRune and RuneLen match the Go checksum for all code points 0..0x10FFFF", () => {
  let h = FNV_OFFSET;
  const buf = new Uint8Array(utf8.UTFMax);
  let count = 0;
  for (let r = 0; r <= utf8.MaxRune; r++) {
    const n = utf8.EncodeRune(buf, r);
    for (let i = 0; i < n; i++) {
      h = fnvByte(h, buf[i]);
    }
    h = fnvWord(h, utf8.RuneLen(r) >>> 0);
    count++;
  }
  assert.equal(count, data.encode.count);
  assert.equal(h >>> 0, data.encode.checksum);
});

test("every code point round-trips through the string functions", () => {
  for (let cp = 0; cp <= utf8.MaxRune; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) {
      // Lone surrogates are invalid in the UTF-16 model.
      const s = String.fromCharCode(cp);
      assert.deepEqual(utf8.DecodeRuneInString(s), [utf8.RuneError, 1]);
      assert.deepEqual(utf8.DecodeLastRuneInString(s), [utf8.RuneError, 1]);
      assert.equal(utf8.ValidString(s), false);
      assert.equal(utf8.ByteLen(s), 3);
      continue;
    }
    const s = String.fromCodePoint(cp);
    const size = cp > 0xffff ? 2 : 1;
    assert.deepEqual(utf8.DecodeRuneInString(s), [cp, size], `DecodeRuneInString ${cp}`);
    assert.deepEqual(utf8.DecodeLastRuneInString(s), [cp, size], `DecodeLastRuneInString ${cp}`);
    assert.equal(utf8.RuneCountInString(s), 1);
    assert.equal(utf8.ValidString(s), true);
    assert.equal(utf8.ByteLen(s), utf8.RuneLen(cp), `ByteLen ${cp}`);
    assert.equal(utf8.ByteLen(s), utf8.RuneBytes(cp).length);
  }
});

test("string helpers: explicit edge cases", () => {
  assert.deepEqual(utf8.DecodeRuneInString(""), [utf8.RuneError, 0]);
  assert.deepEqual(utf8.DecodeRuneInString("", 0), [utf8.RuneError, 0]);
  assert.deepEqual(utf8.DecodeRuneInString("a", 1), [utf8.RuneError, 0]);
  assert.deepEqual(utf8.DecodeRuneInString("😀"), [0x1f600, 2]);
  assert.deepEqual(utf8.DecodeRuneInString("x😀", 1), [0x1f600, 2]);
  assert.deepEqual(utf8.DecodeRuneInString("\uDE00\uD83D"), [utf8.RuneError, 1]);
  assert.deepEqual(utf8.DecodeLastRuneInString(""), [utf8.RuneError, 0]);
  assert.deepEqual(utf8.DecodeLastRuneInString("😀"), [0x1f600, 2]);
  assert.deepEqual(utf8.DecodeLastRuneInString("😀", 2), [0x1f600, 2]);
  assert.deepEqual(utf8.DecodeLastRuneInString("😀", 1), [utf8.RuneError, 1]);
  assert.equal(utf8.RuneCountInString("\uD800𐀀"), 2);
  assert.equal(utf8.ValidString("😀"), true);
  assert.equal(utf8.ValidString("\uDE00\uD83D"), false);
  assert.equal(utf8.ByteLen("😀"), 4);
  assert.equal(utf8.ByteLen("\uD83D"), 3);
  assert.equal(utf8.ByteLen("中文a"), 7);
});

test("EncodeRune writes RuneError for invalid runes", () => {
  const buf = new Uint8Array(4);
  for (const r of [-1, -2147483648, 0xd800, 0xdfff, 0x110000, 0x7fffffff]) {
    assert.equal(utf8.EncodeRune(buf, r), 3, `size for ${r}`);
    assert.deepEqual(Array.from(buf.subarray(0, 3)), [0xef, 0xbf, 0xbd], `bytes for ${r}`);
    assert.equal(utf8.RuneLen(r), -1, `RuneLen ${r}`);
    assert.equal(utf8.ValidRune(r), false, `ValidRune ${r}`);
  }
  assert.equal(utf8.ValidRune(0xd7ff), true);
  assert.equal(utf8.ValidRune(0xe000), true);
  assert.equal(utf8.ValidRune(0x10ffff), true);
  assert.deepEqual(Array.from(utf8.RuneBytes(0x20ac)), [0xe2, 0x82, 0xac]);
  assert.deepEqual(Array.from(utf8.RuneBytes(0x41)), [0x41]);
});

function unpack(v: number): [number, number] {
  return [v & 0xffffff, v >>> 24];
}

test("DecodeRunePacked equals DecodeRune(subarray(i)) at every offset of every vector", () => {
  for (const v of data.vectors) {
    const p = bytesOf(v.hex);
    for (let i = 0; i <= p.length; i++) {
      const want = utf8.DecodeRune(p.subarray(i));
      assert.deepEqual(unpack(utf8.DecodeRunePacked(p, i)), want, `DecodeRunePacked ${v.hex || "(empty)"} at ${i}`);
    }
  }
});

test("DecodeLastRunePacked equals DecodeLastRune(subarray(0, end)) at every end of every vector", () => {
  for (const v of data.vectors) {
    const p = bytesOf(v.hex);
    for (let end = 0; end <= p.length; end++) {
      const want = utf8.DecodeLastRune(p.subarray(0, end));
      assert.deepEqual(unpack(utf8.DecodeLastRunePacked(p, end)), want, `DecodeLastRunePacked ${v.hex || "(empty)"} at ${end}`);
    }
  }
});

test("packed decoders return RuneError with size 0 outside the range", () => {
  const p = bytesOf("e4b8ad");
  assert.deepEqual(unpack(utf8.DecodeRunePacked(p, -1)), [utf8.RuneError, 0]);
  assert.deepEqual(unpack(utf8.DecodeRunePacked(p, 3)), [utf8.RuneError, 0]);
  assert.deepEqual(unpack(utf8.DecodeLastRunePacked(p, 0)), [utf8.RuneError, 0]);
  assert.deepEqual(unpack(utf8.DecodeLastRunePacked(p, 4)), [utf8.RuneError, 0]);
  assert.deepEqual(unpack(utf8.DecodeRunePacked(p, 0)), [0x4e2d, 3]);
});

test("DecodeLastRunePacked with begin equals DecodeLastRune(subarray(begin, end))", () => {
  for (const v of data.vectors) {
    const p = bytesOf(v.hex);
    for (let begin = 0; begin <= p.length; begin++) {
      for (let end = begin + 1; end <= p.length; end++) {
        const want = utf8.DecodeLastRune(p.subarray(begin, end));
        assert.deepEqual(unpack(utf8.DecodeLastRunePacked(p, end, begin)), want, `begin ${begin} end ${end} of ${v.hex}`);
      }
    }
  }
});

test("packed string decoders equal the tuple versions at every index", () => {
  const unpackPair = (v: number): [number, number] => [v & 0xffffff, v >>> 24];
  const strs = data.strings.map((v) => String.fromCharCode(...v.codeUnits));
  strs.push("", "a", "中文", "😀x", "x�", "�y", "�😀");
  for (const s of strs) {
    for (let i = 0; i <= s.length; i++) {
      assert.deepEqual(unpackPair(utf8.DecodeRuneInStringPacked(s, i)), i < s.length ? utf8.DecodeRuneInString(s, i) : [utf8.RuneError, 0], `DecodeRuneInStringPacked at ${i}`);
      assert.deepEqual(unpackPair(utf8.DecodeLastRuneInStringPacked(s, i)), i > 0 ? utf8.DecodeLastRuneInString(s, i) : [utf8.RuneError, 0], `DecodeLastRuneInStringPacked at ${i}`);
    }
  }
});
