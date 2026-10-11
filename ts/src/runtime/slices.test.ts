import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as slices from "./slices.ts";

// The aliasing scenarios are the same programs as in
// ts/tools/gen-bytes-vectors/main.go (buildSliceCases). Go's final array
// contents (full capacity) and returned slice are the oracle.
//
// Structural change S1 (2026-10-11): an array of at most 64 bytes is never appended in place (see the rules at the top of
// slices.ts), but Go appends in place for those. The scenarios therefore run the Go programs with the bases that Go makes
// (legacyMake, the Make of before S1) and the in-place appends (AppendInPlaceLikeGo, AppendByteInPlaceLikeGo, the code of before S1).
// The rules of S1 are tested further down.

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
// legacyMake is Make before S1: capacity cap is the tail of an ArrayBuffer of that size, for every size.
const legacyMake = (len: number, cap: number = len): Uint8Array => new Uint8Array(new ArrayBuffer(cap), 0, len);
const appendIn = slices.AppendInPlaceLikeGo;
const appendByteIn = slices.AppendByteInPlaceLikeGo;

interface Result {
  base: Uint8Array;
  ret: Uint8Array;
}

// Each scenario mirrors the Go program of the same name.
const scenarios: Record<string, () => Result> = {
  append_within_cap_shares_array: () => {
    const s = legacyMake(3, 10);
    slices.Copy(s, enc("abc"));
    let a = s.subarray(0, 1);
    a = appendByteIn(a, code("x"));
    return { base: full(s), ret: a };
  },
  append_beyond_cap_detaches: () => {
    const s = legacyMake(3, 3);
    slices.Copy(s, enc("abc"));
    const t = appendByteIn(s, code("x"));
    t[0] = code("Z");
    return { base: full(s), ret: t };
  },
  delete_in_place: () => {
    const orig = enc("0123456789");
    const s = appendIn(orig.subarray(0, 2), orig.subarray(5));
    return { base: full(orig), ret: s };
  },
  filter_in_place_tmp_s0: () => {
    const orig = enc("a1b2c3d4");
    let tmp = orig.subarray(0, 0);
    for (let i = 0; i < orig.length; i++) {
      const c = orig[i];
      if (c >= 0x30 && c <= 0x39) {
        tmp = appendByteIn(tmp, c);
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
    const s = legacyMake(0, 8);
    const a = appendByteIn(s, code("a"));
    appendByteIn(s, code("b"));
    return { base: full(s), ret: a };
  },
  append_sub_view_writes_tail: () => {
    const s = legacyMake(4, 8);
    let a = s.subarray(1, 3);
    a = appendByteIn(a, code("q"));
    return { base: full(s), ret: a };
  },
  reslice_past_len_exposes_bytes: () => {
    const s = legacyMake(2, 8);
    slices.Copy(s, enc("hi"));
    const t = slices.Reslice(s, 6);
    return { base: full(s), ret: t };
  },
  append_multiple_shared_tail: () => {
    let s = legacyMake(0, 6);
    s = appendIn(s, enc("ab"));
    const t = appendByteIn(s, code("c"));
    appendByteIn(s, code("d"));
    return { base: full(s), ret: t };
  },
  delete_in_place_cap8: () => {
    const orig = enc("abcdefgh");
    const s2 = appendIn(orig.subarray(0, 2), orig.subarray(5));
    return { base: full(orig), ret: s2 };
  },
  copy_into_offset_returns_count: () => {
    const dst = legacyMake(5);
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
  // S1 (changed): up to 64 bytes the appends are exact fit, so the capacity is the length (it was 4 for n = 3).
  assert.equal(slices.CapAfterByteAppends(3), 3);
  assert.equal(slices.CapAfterByteAppends(64), 64);
  assert.equal(slices.CapAfterByteAppends(65), 128);
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

test("Append writes in place when capacity allows (overlapping source), for an array longer than 64 bytes", () => {
  // S1: the base must be longer than 64 bytes. A base of at most 64 bytes is never appended in place (see the next test).
  const s = new Uint8Array(80);
  for (let i = 0; i < s.length; i++) s[i] = 0x61 + (i % 26);
  const orig = s.slice();
  const a = s.subarray(0, 70);
  const r = slices.Append(a, s.subarray(2, 12));
  const want = new Uint8Array(80);
  want.set(orig.subarray(0, 70), 0);
  want.set(orig.subarray(2, 12), 70);
  assert.equal(toHex(r), toHex(want));
  assert.equal(toHex(s), toHex(want));
});

test("Append of a base of at most 64 bytes does not write into the base's buffer (S1)", () => {
  const s = enc("abcdefgh");
  const a = s.subarray(0, 4);
  const r = slices.Append(a, s.subarray(2, 6));
  assert.equal(toHex(r), toHex(enc("abcdcdef")));
  assert.equal(toHex(s), toHex(enc("abcdefgh")));
  assert.notEqual(r.buffer, s.buffer);
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
  // S1 (changed): a capacity of at most 64 bytes gives an exact-fit array, so the capacity is the length (it was 10 for Make(3, 10)).
  const s = slices.Make(3, 10);
  assert.equal(s.length, 3);
  assert.equal(slices.Cap(s), 3);
  assert.equal(toHex(s), "000000");
  // A capacity above 64 bytes is kept for a length above 64.
  const t = slices.Make(70, 100);
  assert.equal(t.length, 70);
  assert.equal(slices.Cap(t), 100);
  assert.equal(toHex(full(t)), "00".repeat(100));
  assert.throws(() => slices.Make(5, 2), RangeError);
  assert.throws(() => slices.Make(-1), RangeError);
});

test("AppendString appends the UTF-8 encoding", () => {
  assert.equal(toHex(slices.AppendString(enc("a"), "é")), "61c3a9");
  assert.equal(toHex(slices.AppendString(new Uint8Array(0), "\uD800")), "efbfbd");
});

// ---- The rules of S1 (structural change, 2026-10-11) ----

test("results of at most 64 bytes are exact fit: Make, Append, AppendByte, AppendString", () => {
  for (const n of [0, 1, 2, 17, 33, 63, 64]) {
    const m = slices.Make(n, 64);
    assert.equal(slices.Cap(m), n, `Make(${n}, 64)`);
  }
  let a: Uint8Array = new Uint8Array(0);
  for (let n = 1; n <= 64; n++) {
    a = slices.AppendByte(a, 0x61);
    assert.equal(slices.Cap(a), n, `AppendByte to length ${n}`);
  }
  const b = slices.Append(enc("abc"), enc("de"));
  assert.equal(slices.Cap(b), 5);
  assert.equal(slices.Cap(slices.AppendString(new Uint8Array(0), "héllo")), 6);
});

test("Make keeps a capacity above 64 for a length above 64: the appends write in place", () => {
  const s = slices.Make(70, 256);
  const t = slices.AppendByte(s, 0x7a);
  assert.equal(t.buffer, s.buffer);
  assert.equal(slices.Cap(t), 256);
  assert.equal(full(s)[70], 0x7a);
});

test("Make(0, cap) with cap above 64 is not kept for the first appends (known departure, rule 5)", () => {
  const s = slices.Make(0, 256);
  const t = slices.AppendByte(s, 0x01);
  assert.notEqual(t.buffer, s.buffer);
  assert.equal(slices.Cap(t), 1);
  // Growth starts from the length: the result passes 64 bytes with CalculateNewCapacity(65, 64) = 128.
  let u = t;
  for (let n = 2; n <= 65; n++) {
    u = slices.AppendByte(u, n & 0xff);
  }
  assert.equal(u.length, 65);
  assert.equal(slices.Cap(u), 128);
});

test("a small result that passes 64 bytes gets an ArrayBuffer of CalculateNewCapacity(newLen, aLen), then appends in place", () => {
  const a = slices.Make(40);
  const b = slices.Append(a, new Uint8Array(30));
  assert.equal(b.length, 70);
  assert.equal(slices.Cap(b), slices.CalculateNewCapacity(70, 40));
  assert.equal(slices.Cap(b), 80);
  const c = slices.AppendByte(b, 0x21);
  assert.equal(c.buffer, b.buffer);
  assert.equal(slices.Cap(c), 80);
});

test("a subarray of at most 64 bytes of a large array is never written into the parent", () => {
  const parent = new Uint8Array(100).fill(0x61);
  const child = parent.subarray(0, 10);
  const r1 = slices.AppendByte(child, 0x7a);
  assert.equal(parent[10], 0x61);
  assert.notEqual(r1.buffer, parent.buffer);
  assert.equal(slices.Cap(r1), 11);
  const r2 = slices.Append(child, new Uint8Array(3).fill(0x78));
  assert.equal(parent[10], 0x61);
  assert.equal(parent[11], 0x61);
  assert.notEqual(r2.buffer, parent.buffer);
});

test("a subarray longer than 64 bytes of a large array is written in place, as in Go", () => {
  const parent = new Uint8Array(100).fill(0x61);
  const child = parent.subarray(0, 70);
  const r = slices.AppendByte(child, 0x7a);
  assert.equal(r.buffer, parent.buffer);
  assert.equal(parent[70], 0x7a);
});

test("Append(a, empty) returns a itself", () => {
  const a = enc("abc");
  assert.equal(slices.Append(a, new Uint8Array(0)), a);
  const big = new Uint8Array(100);
  assert.equal(slices.Append(big, new Uint8Array(0)), big);
});

test("two appends from one small base give two independent arrays", () => {
  const s = enc("abc");
  const a = slices.AppendByte(s, code("x"));
  const b = slices.AppendByte(s, code("y"));
  assert.equal(toHex(a), toHex(enc("abcx")));
  assert.equal(toHex(b), toHex(enc("abcy")));
  assert.notEqual(a.buffer, b.buffer);
});

test("two appends from one large base with spare capacity share the array, as in Go", () => {
  const s = slices.Make(70, 100);
  const a = slices.AppendByte(s, 0x78);
  slices.AppendByte(s, 0x79);
  assert.equal(full(s)[70], 0x79);
  assert.equal(a[70], 0x79);
});

test("small inputs and results never read .buffer: a getter that throws is installed on them", () => {
  const guard = (a: Uint8Array): Uint8Array => {
    Object.defineProperty(a, "buffer", {
      get() {
        throw new Error("read of .buffer on a small array");
      },
    });
    return a;
  };
  const a = guard(enc("abcdefghij"));
  const b = guard(enc("klmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"));
  assert.equal(slices.Append(a, guard(enc("kl"))).length, 12);
  assert.equal(slices.Append(a, b).length, 10 + b.length);
  assert.equal(slices.AppendByte(a, 0x21).length, 11);
  assert.equal(slices.AppendString(a, "é").length, 12);
  const big = new Uint8Array(100);
  assert.equal(slices.Append(big, guard(enc("xy"))).length, 102);
  assert.equal(slices.Make(3, 10).length, 3);
});

test("AppendInPlaceLikeGo and AppendByteInPlaceLikeGo write in place for any size (the code before S1)", () => {
  const parent = legacyMake(3, 10);
  slices.Copy(parent, enc("abc"));
  const r = appendIn(parent.subarray(0, 1), enc("xy"));
  assert.equal(r.buffer, parent.buffer);
  assert.equal(toHex(full(parent)), toHex(enc("axy")) + "00".repeat(7));
  const q = appendByteIn(parent.subarray(0, 2), 0x7a);
  assert.equal(q.buffer, parent.buffer);
  assert.equal(parent[2], 0x7a);
});

// ---- Differential tests against the code before S1 and before the short-copy change ----
// The oldXxx functions below are private copies of the implementations as they were before moveBytes got
// its indexed-loop path (and before S1). For an array longer than 64 bytes the current functions must match them
// on every generated case: content, length, Cap, whether the result shares a's buffer, and the full contents of
// the buffer afterwards. For an array of at most 64 bytes, S1 changes the capacity and the aliasing on purpose;
// the test then checks content and length against the old functions, that the result is exact fit (or a new
// ArrayBuffer of the grown capacity once it passes 64 bytes), and that a's buffer is not written.

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
// The buffer is sometimes large (spare up to 300), so a small a can be a view of a large buffer.
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
  const pick = r();
  let aLen: number;
  if (pick < 0.08) {
    aLen = 0;
  } else if (pick < 0.3) {
    aLen = int(r, 60, 68); // around the 64-byte rule
  } else {
    aLen = int(r, 0, 200);
  }
  const spare = r() < 0.4 ? 0 : int(r, 1, r() < 0.5 ? 64 : 300);
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
  smallToLarge: number;
  smallOfLargeBuffer: number;
  aBoundary: number;
}

function newCoverage(): Coverage {
  return {
    aEmpty: 0, bEmpty: 0, bShort: 0, bLong: 0, realloc: 0, inPlace: 0, sharedBefore: 0, sharedAfter: 0, sharedOverlap: 0,
    smallToLarge: 0, smallOfLargeBuffer: 0, aBoundary: 0,
  };
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
  if (c.aLen >= 63 && c.aLen <= 65) cov.aBoundary++;
  if (c.aLen <= 64 && c.aLen + c.bLen > 64) cov.smallToLarge++;
  if (c.aLen <= 64 && c.seed.length > 64) cov.smallOfLargeBuffer++;
}

test("Append matches the pre-change implementation on generated cases where a is longer than 64 bytes", () => {
  const r = rng(0x5eed0001);
  const cov = newCoverage();
  let large = 0;
  for (let i = 0; i < 20000; i++) {
    const c = genAppendCase(r);
    if (c.aLen <= 64) {
      continue;
    }
    large++;
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
  assert.ok(large > 5000, `large cases ${large}`);
  assert.ok(cov.realloc > 0 && cov.inPlace > 0, JSON.stringify(cov));
  assert.ok(cov.sharedBefore > 0 && cov.sharedAfter > 0 && cov.sharedOverlap > 0, JSON.stringify(cov));
});

test("Append on a of at most 64 bytes: content and length as before S1, exact fit, a's buffer never written", () => {
  const r = rng(0x5eed0004);
  const cov = newCoverage();
  let small = 0;
  for (let i = 0; i < 20000; i++) {
    const c = genAppendCase(r);
    if (c.aLen > 64) {
      continue;
    }
    small++;
    const o = buildCase(c);
    const n = buildCase(c);
    const want = oldAppend(o.a, o.b);
    const got = slices.Append(n.a, n.b);
    countCase(cov, c, want.buffer !== o.a.buffer);
    assert.equal(got.length, want.length, `case ${i}: length`);
    assert.equal(hexOf(got), hexOf(want), `case ${i}: content`);
    assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(c.seed), `case ${i}: a's buffer is not written`);
    const newLen = c.aLen + c.bLen;
    if (c.bLen === 0) {
      assert.equal(got, n.a, `case ${i}: Append with empty b returns a`);
    } else {
      assert.notEqual(got.buffer, n.a.buffer, `case ${i}: result does not share a's buffer`);
      const wantCap = newLen <= 64 ? newLen : slices.CalculateNewCapacity(newLen, c.aLen);
      assert.equal(slices.Cap(got), wantCap, `case ${i}: capacity (exact fit, or the grown capacity above 64)`);
    }
  }
  assert.ok(small > 5000, `small cases ${small}`);
  assert.ok(cov.smallToLarge > 0 && cov.smallOfLargeBuffer > 0 && cov.aBoundary > 0, JSON.stringify(cov));
});

test("AppendByte matches the pre-change implementation for a longer than 64 bytes, and is exact fit for a of at most 64", () => {
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
    if (c.aLen > 64) {
      assert.equal(slices.Cap(got), slices.Cap(want), `case ${i}: Cap`);
      assert.equal(got.buffer === n.a.buffer, want.buffer === o.a.buffer, `case ${i}: shares a's buffer`);
      assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(new Uint8Array(o.buf.buffer)), `case ${i}: buffer after`);
    } else {
      assert.equal(hexOf(new Uint8Array(n.buf.buffer)), hexOf(c.seed), `case ${i}: a's buffer is not written`);
      assert.notEqual(got.buffer, n.a.buffer, `case ${i}: does not share a's buffer`);
      const newLen = c.aLen + 1;
      assert.equal(slices.Cap(got), newLen <= 64 ? newLen : slices.CalculateNewCapacity(newLen, c.aLen), `case ${i}: Cap`);
    }
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
