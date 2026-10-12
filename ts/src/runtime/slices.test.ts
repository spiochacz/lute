import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as slices from "./slices.ts";

// The aliasing scenarios are the same programs as in
// ts/tools/gen-bytes-vectors/main.go (buildSliceCases). Go's final array
// contents (full capacity) and returned slice are the oracle.

interface SliceScenario {
  name: string;
  base: string;
  ret: string;
}

const vectors: { slices: SliceScenario[] } = JSON.parse(
  readFileSync(new URL("./testdata/bytes_vectors.json", import.meta.url), "utf8"),
);

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const code = (s: string): number => s.charCodeAt(0);
// full returns the whole capacity of a slice, like Go's s[:cap(s)].
const full = (s: Uint8Array): Uint8Array => new Uint8Array(s.buffer, s.byteOffset, slices.Cap(s));

interface Result {
  base: Uint8Array;
  ret: Uint8Array;
}

// Each scenario mirrors the Go program of the same name.
const scenarios: Record<string, () => Result> = {
  append_within_cap_shares_array: () => {
    const s = slices.Make(3, 10);
    slices.Copy(s, enc("abc"));
    let a = s.subarray(0, 1);
    a = slices.AppendByte(a, code("x"));
    return { base: full(s), ret: a };
  },
  append_beyond_cap_detaches: () => {
    const s = slices.Make(3, 3);
    slices.Copy(s, enc("abc"));
    const t = slices.AppendByte(s, code("x"));
    t[0] = code("Z");
    return { base: full(s), ret: t };
  },
  delete_in_place: () => {
    const orig = enc("0123456789");
    const s = slices.Append(orig.subarray(0, 2), orig.subarray(5));
    return { base: full(orig), ret: s };
  },
  filter_in_place_tmp_s0: () => {
    const orig = enc("a1b2c3d4");
    let tmp = orig.subarray(0, 0);
    for (let i = 0; i < orig.length; i++) {
      const c = orig[i];
      if (c >= 0x30 && c <= 0x39) {
        tmp = slices.AppendByte(tmp, c);
      }
    }
    return { base: full(orig), ret: tmp };
  },
  copy_overlap_shift_right: () => {
    const s = enc("abcdef");
    slices.Copy(s.subarray(2), s.subarray(0, 4));
    return { base: full(s), ret: s };
  },
  copy_overlap_shift_left: () => {
    const s = enc("abcdef");
    slices.Copy(s, s.subarray(2));
    return { base: full(s), ret: s };
  },
  two_appends_share_array: () => {
    const s = slices.Make(0, 8);
    const a = slices.AppendByte(s, code("a"));
    slices.AppendByte(s, code("b"));
    return { base: full(s), ret: a };
  },
  append_sub_view_writes_tail: () => {
    const s = slices.Make(4, 8);
    let a = s.subarray(1, 3);
    a = slices.AppendByte(a, code("q"));
    return { base: full(s), ret: a };
  },
  reslice_past_len_exposes_bytes: () => {
    const s = slices.Make(2, 8);
    slices.Copy(s, enc("hi"));
    const t = slices.Reslice(s, 6);
    return { base: full(s), ret: t };
  },
  append_multiple_shared_tail: () => {
    let s = slices.Make(0, 6);
    s = slices.Append(s, enc("ab"));
    const t = slices.AppendByte(s, code("c"));
    slices.AppendByte(s, code("d"));
    return { base: full(s), ret: t };
  },
  delete_in_place_cap8: () => {
    const orig = enc("abcdefgh");
    const s2 = slices.Append(orig.subarray(0, 2), orig.subarray(5));
    return { base: full(orig), ret: s2 };
  },
  copy_into_offset_returns_count: () => {
    const dst = slices.Make(5);
    const n = slices.Copy(dst.subarray(1), enc("hello"));
    return { base: full(dst), ret: Uint8Array.of(0x30 + n) };
  },
};

for (const sc of vectors.slices) {
  test(`scenario ${sc.name} matches Go`, () => {
    const run = scenarios[sc.name];
    assert.ok(run, `no TypeScript scenario for ${sc.name}`);
    const got = run();
    assert.equal(toHex(got.base), sc.base, "final array contents (full capacity)");
    assert.equal(toHex(got.ret), sc.ret, "returned slice");
  });
}

test("there are at least 8 aliasing scenarios and all Go scenarios are covered", () => {
  assert.ok(vectors.slices.length >= 8);
  assert.deepStrictEqual(
    Object.keys(scenarios).sort(),
    vectors.slices.map((s) => s.name).sort(),
  );
});

// ---- Growth and helper behaviour (growth formula is from the GopherJS bundle) ----

test("CalculateNewCapacity matches the bundle formula", () => {
  // max(needed, oldCap < 1024 ? oldCap*2 : floor(oldCap*5/4))
  assert.equal(slices.CalculateNewCapacity(2100, 1000), 2100);
  assert.equal(slices.CalculateNewCapacity(10, 1000), 2000);
  assert.equal(slices.CalculateNewCapacity(10, 1023), 2046);
  assert.equal(slices.CalculateNewCapacity(1100, 1024), 1280);
  assert.equal(slices.CalculateNewCapacity(1, 0), 1);
  assert.equal(slices.CalculateNewCapacity(3000, 2000), 3000);
  assert.equal(slices.CalculateNewCapacity(2600, 2000), 2600);
  assert.equal(slices.CalculateNewCapacity(2400, 2000), 2500);
});

test("CapAfterByteAppends equals the capacity of real AppendByte loops for every n from 0 to 5000", () => {
  // One run of 5000 single-byte appends visits every n: after n appends the capacity must be CapAfterByteAppends(n).
  let a: Uint8Array = new Uint8Array(0);
  for (let n = 0; n <= 5000; n++) {
    assert.equal(slices.Cap(a), slices.CapAfterByteAppends(n), `n=${n}`);
    assert.equal(a.length, n);
    a = slices.AppendByte(a, n & 0xff);
  }
  assert.equal(slices.CapAfterByteAppends(0), 0);
  assert.equal(slices.CapAfterByteAppends(1), 1);
  assert.equal(slices.CapAfterByteAppends(3), 4);
  assert.equal(slices.CapAfterByteAppends(1025), 1280);
});

test("Append reallocates with the grown capacity and leaves the original untouched", () => {
  const s = slices.Make(1024, 1024);
  s.fill(0x41);
  const t = slices.AppendByte(s, 0x42);
  assert.equal(slices.Cap(t), 1280);
  assert.equal(t.length, 1025);
  assert.notEqual(t.buffer, s.buffer);
  assert.equal(s.length, 1024);
  assert.equal(s[1023], 0x41);
});

test("Append writes in place when capacity allows (overlapping source)", () => {
  const s = enc("abcdefgh");
  const a = s.subarray(0, 4);
  const r = slices.Append(a, s.subarray(2, 6));
  assert.equal(toHex(r), toHex(enc("abcdcdef")));
  assert.equal(toHex(s), toHex(enc("abcdcdef")));
});

test("Copy returns min(len) and is overlap-safe", () => {
  const dst = slices.Make(3);
  assert.equal(slices.Copy(dst, enc("hello")), 3);
  assert.equal(toHex(dst), toHex(enc("hel")));
  const s = enc("abcdef");
  assert.equal(slices.Copy(s.subarray(1), s), 5);
  assert.equal(toHex(s), toHex(enc("aabcde")));
});

test("Clone has capacity equal to length and does not alias", () => {
  const s = slices.Make(2, 10);
  s.set([1, 2]);
  const c = slices.Clone(s);
  assert.equal(slices.Cap(c), 2);
  assert.notEqual(c.buffer, s.buffer);
  assert.equal(toHex(c), "0102");
});

test("Make validates len and cap and zeroes the array", () => {
  const s = slices.Make(3, 10);
  assert.equal(s.length, 3);
  assert.equal(slices.Cap(s), 10);
  assert.equal(toHex(full(s)), "0000000000000000000000000000".slice(0, 20));
  assert.throws(() => slices.Make(5, 2), RangeError);
  assert.throws(() => slices.Make(-1), RangeError);
});

test("AppendString appends the UTF-8 encoding", () => {
  assert.equal(toHex(slices.AppendString(enc("a"), "é")), "61c3a9");
  assert.equal(toHex(slices.AppendString(new Uint8Array(0), "\uD800")), "efbfbd");
});

// ---- Differential test against the code before the short-copy change ----
// The oldXxx functions below are private copies of the implementations as they were
// before moveBytes got its indexed-loop path. The current functions must match them
// on every generated case: content, length, Cap, whether the result shares a's
// buffer, and the full contents of the buffer afterwards.

function oldMoveBytes(dst: Uint8Array, dstOff: number, src: Uint8Array): void {
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

function oldAppend(a: Uint8Array, b: Uint8Array): Uint8Array {
  const newLen = a.length + b.length;
  const cap = slices.Cap(a);
  if (newLen <= cap) {
    const v = new Uint8Array(a.buffer, a.byteOffset, newLen);
    oldMoveBytes(v, a.length, b);
    return v;
  }
  const nc = slices.CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  v.set(a, 0);
  v.set(b, a.length);
  return v;
}

function oldAppendByte(a: Uint8Array, c: number): Uint8Array {
  const newLen = a.length + 1;
  const cap = slices.Cap(a);
  if (newLen <= cap) {
    const v = new Uint8Array(a.buffer, a.byteOffset, newLen);
    v[a.length] = c;
    return v;
  }
  const nc = slices.CalculateNewCapacity(newLen, cap);
  const v = new Uint8Array(new ArrayBuffer(nc), 0, newLen);
  v.set(a, 0);
  v[a.length] = c;
  return v;
}

function oldCopy(dst: Uint8Array, src: Uint8Array): number {
  const n = Math.min(dst.length, src.length);
  if (n > 0) {
    oldMoveBytes(dst, 0, src.subarray(0, n));
  }
  return n;
}

// Seeded generator (mulberry32), so every run sees the same cases.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// int returns a whole number in [lo, hi].
function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

// A generated case: a buffer of `size` bytes, a = bytes [off, off+aLen) of it, and
// b either a fresh array (shared = false) or a subarray of the same buffer (shared = true).
interface AppendCase {
  seed: Uint8Array;
  off: number;
  aLen: number;
  shared: boolean;
  bStart: number;
  bLen: number;
  bFresh: Uint8Array;
}

function genAppendCase(r: () => number): AppendCase {
  const aLen = r() < 0.1 ? 0 : int(r, 0, 40);
  const spare = r() < 0.4 ? 0 : int(r, 1, 64);
  const off = int(r, 0, 8);
  const size = off + aLen + spare;
  const seed = new Uint8Array(size);
  for (let i = 0; i < size; i++) seed[i] = int(r, 0, 255);
  const shared = r() < 0.5;
  // b is 0..80 bytes, so it is shorter and longer than the short-copy threshold.
  const bLen0 = r() < 0.1 ? 0 : int(r, 0, 80);
  const bStart = int(r, 0, size);
  const bLen = shared ? Math.min(bLen0, size - bStart) : bLen0;
  const bFresh = new Uint8Array(bLen0);
  for (let i = 0; i < bLen0; i++) bFresh[i] = int(r, 0, 255);
  return { seed, off, aLen, shared, bStart, bLen, bFresh };
}

// build returns a's buffer and views, both for the old and for the new run.
function buildCase(c: AppendCase): { buf: Uint8Array; a: Uint8Array; b: Uint8Array } {
  const buf = c.seed.slice();
  const a = new Uint8Array(buf.buffer, c.off, c.aLen);
  const b = c.shared ? new Uint8Array(buf.buffer, c.bStart, c.bLen) : c.bFresh.slice();
  return { buf, a, b };
}

const hexOf = (b: Uint8Array): string => toHex(b);

// Coverage counters: the generated cases must reach every branch named in the test.
interface Coverage {
  aEmpty: number;
  bEmpty: number;
  bShort: number;
  bLong: number;
  realloc: number;
  inPlace: number;
  sharedBefore: number;
  sharedAfter: number;
  sharedOverlap: number;
}

function countCase(cov: Coverage, c: AppendCase, reallocates: boolean): void {
  const dst = c.off + c.aLen;
  if (c.aLen === 0) cov.aEmpty++;
  if (c.bLen === 0) cov.bEmpty++;
  if (c.bLen <= 16) cov.bShort++; // 16 is SHORT_COPY in slices.ts
  else cov.bLong++;
  if (reallocates) cov.realloc++;
  else cov.inPlace++;
  if (c.shared) {
    if (c.bStart + c.bLen <= dst) cov.sharedBefore++;
    else if (c.bStart >= dst) cov.sharedAfter++;
    else cov.sharedOverlap++;
  }
}

test("Append matches the pre-change implementation on 20000 generated cases", () => {
  const r = rng(0x5eed0001);
  const cov: Coverage = { aEmpty: 0, bEmpty: 0, bShort: 0, bLong: 0, realloc: 0, inPlace: 0, sharedBefore: 0, sharedAfter: 0, sharedOverlap: 0 };
  for (let i = 0; i < 20000; i++) {
    const c = genAppendCase(r);
    const o = buildCase(c);
    const n = buildCase(c);
    const want = oldAppend(o.a, o.b);
    const got = slices.Append(n.a, n.b);
    countCase(cov, c, want.buffer !== o.a.buffer);
    assert.equal(got.length, want.length, `case ${i}: length`);
    assert.equal(hexOf(got), hexOf(want), `case ${i}: content`);
    assert.equal(slices.Cap(got), slices.Cap(want), `case ${i}: Cap`);
    assert.equal(got.buffer === n.a.buffer, want.buffer === o.a.buffer, `case ${i}: shares a's buffer`);
    assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(new Uint8Array(o.buf.buffer)), `case ${i}: buffer after`);
  }
  assert.ok(cov.aEmpty > 0 && cov.bEmpty > 0 && cov.bShort > 0 && cov.bLong > 0, JSON.stringify(cov));
  assert.ok(cov.realloc > 0 && cov.inPlace > 0, JSON.stringify(cov));
  assert.ok(cov.sharedBefore > 0 && cov.sharedAfter > 0 && cov.sharedOverlap > 0, JSON.stringify(cov));
});

test("AppendByte matches the pre-change implementation on 20000 generated cases", () => {
  const r = rng(0x5eed0002);
  for (let i = 0; i < 20000; i++) {
    const c = genAppendCase(r);
    const o = buildCase(c);
    const n = buildCase(c);
    const byte = int(r, 0, 255);
    const want = oldAppendByte(o.a, byte);
    const got = slices.AppendByte(n.a, byte);
    assert.equal(got.length, want.length, `case ${i}: length`);
    assert.equal(hexOf(got), hexOf(want), `case ${i}: content`);
    assert.equal(slices.Cap(got), slices.Cap(want), `case ${i}: Cap`);
    assert.equal(got.buffer === n.a.buffer, want.buffer === o.a.buffer, `case ${i}: shares a's buffer`);
    assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(new Uint8Array(o.buf.buffer)), `case ${i}: buffer after`);
  }
});

test("Copy matches the pre-change implementation on 20000 generated cases", () => {
  const r = rng(0x5eed0003);
  for (let i = 0; i < 20000; i++) {
    const c = genAppendCase(r);
    const o = buildCase(c);
    const n = buildCase(c);
    // Copy into a's view (length aLen) from b; with a shared buffer the two ranges may overlap.
    const wantN = oldCopy(o.a, o.b);
    const gotN = slices.Copy(n.a, n.b);
    assert.equal(gotN, wantN, `case ${i}: count`);
    assert.equal(hexOf(n.a), hexOf(o.a), `case ${i}: dst content`);
    assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(new Uint8Array(o.buf.buffer)), `case ${i}: buffer after`);
  }
});
