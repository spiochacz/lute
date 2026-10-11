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
