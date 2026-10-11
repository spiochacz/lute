import { test } from "node:test";
import assert from "node:assert/strict";
import * as slices from "./slices.ts";
import * as conv from "./conv.ts";
import * as utf8 from "./utf8.ts";

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

test("BytesFromString encodes ASCII, CJK and emoji", () => {
  assert.equal(hex(conv.BytesFromString("")), "");
  assert.equal(hex(conv.BytesFromString("abc")), "61 62 63");
  assert.equal(hex(conv.BytesFromString("中")), "e4 b8 ad");
  assert.equal(hex(conv.BytesFromString("😀")), "f0 9f 98 80");
});

test("BytesFromString keeps a BOM", () => {
  assert.equal(hex(conv.BytesFromString("﻿a")), "ef bb bf 61");
});

test("BytesFromString encodes lone surrogates as U+FFFD", () => {
  assert.equal(hex(conv.BytesFromString("\uD800")), "ef bf bd");
  assert.equal(hex(conv.BytesFromString("\uDC00")), "ef bf bd");
  assert.equal(hex(conv.BytesFromString("a\uDC00b")), "61 ef bf bd 62");
  assert.equal(hex(conv.BytesFromString("𐀀")), "f0 90 80 80");
});

test("BytesFromString result has capacity equal to length", () => {
  for (const s of ["", "a", "中文字符", "😀", "﻿x", "a\uDC00"]) {
    const b = conv.BytesFromString(s);
    assert.equal(slices.Cap(b), b.length, JSON.stringify(s));
    assert.equal(b.buffer.byteLength, b.length, JSON.stringify(s));
    assert.equal(b.byteOffset, 0, JSON.stringify(s));
  }
});

test("StringFromBytes decodes valid UTF-8", () => {
  assert.equal(conv.StringFromBytes(new Uint8Array(0)), "");
  assert.equal(conv.StringFromBytes(Uint8Array.of(0x61, 0x62)), "ab");
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xe4, 0xb8, 0xad)), "中");
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xf0, 0x9f, 0x98, 0x80)), "😀");
});

test("StringFromBytes keeps a leading BOM", () => {
  const s = conv.StringFromBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61));
  assert.equal(s, "﻿a");
  assert.equal(s.length, 2);
});

test("StringFromBytes fast path for short ASCII and long ASCII", () => {
  assert.equal(conv.StringFromBytes(conv.BytesFromString("hello, world")), "hello, world");
  const long = "x".repeat(100) + "y";
  assert.equal(conv.StringFromBytes(conv.BytesFromString(long)), long);
});

test("StringFromBytes replaces each invalid byte with one U+FFFD", () => {
  // C0 80 is an overlong NUL: C0 is never a valid lead byte, so each byte is one U+FFFD.
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xc0, 0x80)), "��");
  // E4 B8 is a truncated 3-byte sequence. TextDecoder would give one U+FFFD; Go gives two.
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xe4, 0xb8)), "��");
  // FF is never valid UTF-8.
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xff)), "�");
  // ED A0 80 is the encoding of the surrogate U+D800, which is invalid in UTF-8.
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xed, 0xa0, 0x80)), "���");
  // Valid text around an invalid byte.
  assert.equal(conv.StringFromBytes(Uint8Array.of(0x61, 0xff, 0x62)), "a�b");
  assert.equal(conv.StringFromBytes(Uint8Array.of(0xe4, 0xb8, 0xad, 0xff, 0x61)), "中�a");
});

test("StringFromBytes handles invalid input longer than the ASCII fast path", () => {
  const b = new Uint8Array(40);
  b.fill(0x61);
  b[20] = 0xff;
  b[21] = 0xe4;
  const s = conv.StringFromBytes(b);
  assert.equal(s, "a".repeat(20) + "�" + "�" + "a".repeat(18));
});

test("StringFromRune encodes valid runes and maps invalid runes to U+FFFD", () => {
  assert.equal(conv.StringFromRune(0x61), "a");
  assert.equal(conv.StringFromRune(0x4e2d), "中");
  assert.equal(conv.StringFromRune(0x1f600), "😀");
  assert.equal(conv.StringFromRune(0x10ffff), "\u{10ffff}");
  assert.equal(conv.StringFromRune(0), "\0");
  assert.equal(conv.StringFromRune(-1), "�");
  assert.equal(conv.StringFromRune(0xd800), "�");
  assert.equal(conv.StringFromRune(0xdfff), "�");
  assert.equal(conv.StringFromRune(0x110000), "�");
});

test("RunesFromString decodes code points", () => {
  assert.deepEqual(conv.RunesFromString(""), []);
  assert.deepEqual(conv.RunesFromString("abc"), [0x61, 0x62, 0x63]);
  assert.deepEqual(conv.RunesFromString("中文"), [0x4e2d, 0x6587]);
  assert.deepEqual(conv.RunesFromString("a😀b"), [0x61, 0x1f600, 0x62]);
  assert.deepEqual(conv.RunesFromString("﻿"), [0xfeff]);
});

test("RunesFromString turns an unpaired surrogate into U+FFFD", () => {
  assert.deepEqual(conv.RunesFromString("\uD800"), [0xfffd]);
  assert.deepEqual(conv.RunesFromString("a\uDC00b"), [0x61, 0xfffd, 0x62]);
  assert.deepEqual(conv.RunesFromString("\uD800a"), [0xfffd, 0x61]);
});

test("StringFromRunes joins runes and maps invalid runes to U+FFFD", () => {
  assert.equal(conv.StringFromRunes([]), "");
  assert.equal(conv.StringFromRunes([0x61, 0x4e2d, 0x1f600]), "a中😀");
  assert.equal(conv.StringFromRunes([0x61, -5, 0xd800, 0x62]), "a��b");
});

test("round trips for valid strings", () => {
  for (const s of ["", "ascii", "中文字符", "😀😃", "﻿bom", "mix 中 😀 é ǅ"]) {
    assert.equal(conv.StringFromBytes(conv.BytesFromString(s)), s, JSON.stringify(s));
    assert.equal(conv.StringFromRunes(conv.RunesFromString(s)), s, JSON.stringify(s));
  }
});

test("round trip of bytes for valid UTF-8", () => {
  const b = Uint8Array.of(0xe4, 0xb8, 0xad, 0x61, 0xf0, 0x9f, 0x98, 0x80);
  assert.deepEqual(conv.BytesFromString(conv.StringFromBytes(b)), b);
});

test("lone surrogate and invalid bytes are lossy, as documented", () => {
  // Invalid bytes cannot survive a round trip through a JS string.
  const b = Uint8Array.of(0xff);
  assert.deepEqual(conv.BytesFromString(conv.StringFromBytes(b)), Uint8Array.of(0xef, 0xbf, 0xbd));
});

test("StringFromBytes: one decoding pass gives the same result as validate-then-decode", () => {
  // Reference: utf8.Valid decides; valid input is decoded without BOM stripping, invalid input is read per byte.
  const plain = new TextDecoder("utf-8", { ignoreBOM: true });
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  // Bytes biased towards the boundaries of UTF-8 sequences, so that valid and invalid inputs both occur often.
  const pool = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xbb];
  let valid = 0;
  for (let i = 0; i < 4000; i++) {
    const n = rnd(12);
    const b = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      b[j] = rnd(3) === 0 ? rnd(256) : pool[rnd(pool.length)];
    }
    let want = "";
    if (utf8.Valid(b)) {
      valid++;
      want = plain.decode(b);
    } else {
      for (let k = 0; k < n; ) {
        const v = utf8.DecodeRunePacked(b, k);
        want += String.fromCodePoint(v & 0xffffff);
        k += v >>> 24;
      }
    }
    assert.equal(conv.StringFromBytes(b), want, hex(b));
  }
  assert.ok(valid > 100 && valid < 3900, `valid inputs: ${valid}`);
});
