import { test } from "node:test";
import assert from "node:assert/strict";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as lex from "../lex/index.ts";
import * as escapeEncode from "./escape_encode.ts";

// Differential test of EscapeHTML against oldEscapeHTML, a private copy of the
// implementation before the counted single allocation (the Go-shaped code with Append
// calls). The copy uses the current slices.Append, which is itself checked against its
// pre-change copy in slices.test.ts.

const amp = conv.BytesFromString("&amp;");
const lt = conv.BytesFromString("&lt;");
const gt = conv.BytesFromString("&gt;");
const quot = conv.BytesFromString("&quot;");

function oldEscapeHTML(html: Uint8Array): Uint8Array {
  let ret: Uint8Array = html;
  const length = html.length;
  let start = 0;
  let i = 0;
  let inited = false;
  for (; i < length; i++) {
    switch (html[i]) {
      case lex.ItemAmpersand:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, amp);
        start = i + 1;
        break;
      case lex.ItemLess:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, lt);
        start = i + 1;
        break;
      case lex.ItemGreater:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, gt);
        start = i + 1;
        break;
      case lex.ItemDoublequote:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = slices.Append(ret, html.subarray(start, i));
        ret = slices.Append(ret, quot);
        start = i + 1;
        break;
    }
  }
  if (inited) {
    ret = slices.Append(ret, html.subarray(start));
  }
  return ret;
}

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

function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

const SPECIALS = [0x26, 0x3c, 0x3e, 0x22]; // & < > "

// plainByte returns a random byte that is not one of the four special bytes.
function plainByte(r: () => number): number {
  for (;;) {
    const b = int(r, 0, 255);
    if (!SPECIALS.includes(b)) {
      return b;
    }
  }
}

// genInput returns a generated input with a density class: none, few (1 to 3 special
// bytes), or many (30% to 60% special bytes, so that the output usually exceeds length+128).
// Some inputs are a subarray at an offset of a larger buffer.
function genInput(r: () => number): { input: Uint8Array; kind: string } {
  const kindRoll = r();
  let len: number;
  let kind: string;
  if (kindRoll < 0.05) {
    len = 0;
    kind = "empty";
  } else if (kindRoll < 0.3) {
    len = int(r, 1, 60);
    kind = "none";
  } else if (kindRoll < 0.6) {
    len = int(r, 1, 200);
    kind = "few";
  } else {
    len = int(r, 1, 400);
    kind = "many";
  }
  const off = r() < 0.3 ? int(r, 1, 10) : 0;
  const buf = new Uint8Array(off + len + int(r, 0, 10));
  for (let i = 0; i < buf.length; i++) {
    buf[i] = plainByte(r);
  }
  if (kind === "few") {
    const n = int(r, 1, 3);
    for (let k = 0; k < n; k++) {
      buf[off + int(r, 0, len - 1)] = SPECIALS[int(r, 0, 3)];
    }
  } else if (kind === "many") {
    const density = 0.3 + r() * 0.3;
    for (let i = 0; i < len; i++) {
      if (r() < density) {
        buf[off + i] = SPECIALS[int(r, 0, 3)];
      }
    }
  }
  const input = off === 0 && r() < 0.5 ? buf.slice(0, len) : new Uint8Array(buf.buffer, off, len);
  return { input, kind: off > 0 ? kind + "-subarray" : kind };
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

test("EscapeHTML matches the pre-change implementation on 20000 generated inputs", () => {
  const r = rng(0x5eed0004);
  const seen = new Map<string, number>();
  let fallback = 0;
  let counted = 0;
  let identity = 0;
  for (let i = 0; i < 20000; i++) {
    const { input, kind } = genInput(r);
    // Neither function changes its input, so both run on the same array.
    const want = oldEscapeHTML(input);
    const got = escapeEncode.EscapeHTML(input);
    seen.set(kind, (seen.get(kind) ?? 0) + 1);
    assert.equal(got.length, want.length, `case ${i} (${kind}): length`);
    assert.equal(toHex(got), toHex(want), `case ${i} (${kind}): content`);
    assert.equal(slices.Cap(got), slices.Cap(want), `case ${i} (${kind}): Cap`);
    assert.equal(got === input, want === input, `case ${i} (${kind}): identity when nothing is escaped`);
    if (got === input) {
      identity++;
      assert.equal(toHex(got), toHex(input), `case ${i}: unchanged input`);
    } else {
      counted++;
      // More than 128 extra bytes: the output is longer than length+128, so the fallback ran.
      if (got.length > input.length + 128) {
        fallback++;
      }
    }
  }
  // The generated cases must exercise every branch: nothing to escape, the counted path,
  // and the fallback for more than 128 extra bytes, plus empty and subarray inputs.
  assert.ok(identity > 0, "no input without special bytes");
  assert.ok(counted > 0, "no input with special bytes");
  assert.ok(fallback > 0, "fallback path not reached");
  for (const k of ["empty", "none", "few", "many", "few-subarray", "many-subarray", "none-subarray"]) {
    assert.ok((seen.get(k) ?? 0) > 0, `kind ${k} not generated`);
  }
});

test("EscapeHTML returns the input itself when nothing is escaped, including a subarray", () => {
  const buf = conv.BytesFromString("xx plain text yy");
  const sub = buf.subarray(3, 13);
  assert.equal(escapeEncode.EscapeHTML(sub), sub);
  assert.equal(escapeEncode.EscapeHTML(new Uint8Array(0)).length, 0);
});

test("EscapeHTML allocates once with the capacity of length+128", () => {
  const got = escapeEncode.EscapeHTML(conv.BytesFromString("a<b>c&d\"e"));
  assert.equal(conv.StringFromBytes(got), "a&lt;b&gt;c&amp;d&quot;e");
  assert.equal(slices.Cap(got), 9 + 128);
});

// findCounts returns counts (amp, third, quot) with 4*amp + 3*third + 5*quot = extra, where
// third is the number of '<' (or '>' when useGt is set). Returns null if none exists.
function findCounts(extra: number): [number, number, number] | null {
  for (let quot = 0; 5 * quot <= extra; quot++) {
    const rem = extra - 5 * quot;
    for (let amp = 0; 4 * amp <= rem; amp++) {
      if ((rem - 4 * amp) % 3 === 0) {
        return [amp, (rem - 4 * amp) / 3, quot];
      }
    }
  }
  return null;
}

test("EscapeHTML matches the pre-change implementation for extra lengths 120 to 140 (the 128 boundary)", () => {
  // The counted path must run for extra <= 128 and the fallback for extra >= 129. A wrong
  // comparison would make slices.Make(outLen, length+128) throw at 129.
  for (let extra = 120; extra <= 140; extra++) {
    const counts = findCounts(extra);
    assert.ok(counts !== null, `no counts for extra ${extra}`);
    const [amp, third, quot] = counts!;
    for (const useGt of [false, true]) {
      for (const padding of [0, 1, 300]) {
        // Specials interleaved with plain bytes, then padding plain bytes.
        const specials: number[] = [];
        for (let k = 0; k < amp; k++) specials.push(0x26);
        for (let k = 0; k < third; k++) specials.push(useGt ? 0x3e : 0x3c);
        for (let k = 0; k < quot; k++) specials.push(0x22);
        const bytes: number[] = [];
        for (const s of specials) {
          bytes.push(s, 0x78); // special, then 'x'
        }
        for (let k = 0; k < padding; k++) bytes.push(0x79);
        const input = Uint8Array.from(bytes);
        const want = oldEscapeHTML(input);
        const got = escapeEncode.EscapeHTML(input);
        assert.equal(got.length - input.length, extra, `extra ${extra}: length difference`);
        assert.equal(toHex(got), toHex(want), `extra ${extra}: content`);
        assert.equal(slices.Cap(got), slices.Cap(want), `extra ${extra}: Cap`);
        // Counted path (extra <= 128): capacity is exactly length+128. Fallback: capacity has grown.
        assert.equal(slices.Cap(got) === input.length + 128, extra <= 128, `extra ${extra}: counted or fallback path`);
      }
    }
  }
});

// UnescapeHTML and the common named references: the fast paths must give the same bytes as the general path.
const generalUnescapeHTML = (h: Uint8Array): Uint8Array => conv.BytesFromString(escapeEncode.UnescapeHTMLStr(conv.StringFromBytes(h)));

test("UnescapeHTML: ASCII without '&' gives a fresh copy with the same bytes", () => {
  for (const s of ["", "a", "plain ASCII <b>tags</b> and \"quotes\"", "x".repeat(300)]) {
    const h = conv.BytesFromString(s);
    const got = escapeEncode.UnescapeHTML(h);
    assert.deepEqual(got, h, JSON.stringify(s));
    assert.notEqual(got, h, "the result is a fresh array, as Go's []byte(...) is");
    assert.equal(slices.Cap(got), got.length, JSON.stringify(s));
  }
});

test("UnescapeHTML: the fast path and the round trip agree on random inputs", () => {
  let seed = 9001;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pool = [0x61, 0x20, 0x3c, 0x3e, 0x22, 0x26, 0x26, 0x6c, 0x74, 0x3b, 0x0a, 0x7f, 0x80, 0xc3, 0xa9, 0xff, 0xed, 0xa0];
  for (let i = 0; i < 4000; i++) {
    const n = rnd(40);
    const h = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      h[j] = pool[rnd(pool.length)];
    }
    assert.deepEqual(escapeEncode.UnescapeHTML(h), generalUnescapeHTML(h), `input ${Array.from(h).join(" ")}`);
  }
});

test("UnescapeHTML: invalid UTF-8 without '&' still takes the round trip (U+FFFD for each invalid byte)", () => {
  const h = Uint8Array.of(0x61, 0xff, 0x62);
  assert.deepEqual(escapeEncode.UnescapeHTML(h), Uint8Array.of(0x61, 0xef, 0xbf, 0xbd, 0x62));
});

test("the common named references give the code points that lookupEntity gives", async () => {
  const { lookupEntity } = await import("./entity.ts");
  const { UnescapeString } = await import("./escape.ts");
  for (const name of ["lt;", "gt;", "amp;", "quot;", "apos;", "nbsp;"]) {
    assert.equal(UnescapeString("&" + name), lookupEntity(name), name);
    assert.notEqual(lookupEntity(name), "", name);
    // the same name followed by a letter, and inside a longer text, goes the same way
    assert.equal(UnescapeString("x&" + name + "y"), "x" + lookupEntity(name) + "y", name);
  }
});
