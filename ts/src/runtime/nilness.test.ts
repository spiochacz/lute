import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bytes from "./bytes.ts";
import * as slices from "./slices.ts";

// The recorded Go results (ts/tools/gen-bytes-vectors, Go 1.21.13) say for each call whether Go returned a nil slice ("nil": true). The vector arguments are
// non-nil slices ([]byte(s)), empty ones included. The nil conditions that the port relies on are asserted here, see "nil slices" in PORTING.md.

interface GoCase {
  args: unknown[];
  ret?: unknown;
  nil?: boolean;
  panic?: boolean;
}

const data: { functions: Record<string, GoCase[]> } = JSON.parse(readFileSync(new URL("./testdata/bytes_vectors.json", import.meta.url), "utf8"));

function fromHex(h: unknown): Uint8Array {
  const s = h as string;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

// check runs f on every vector of a Go function and compares "is nil" with the recorded flag.
function check(name: string, f: (a: unknown[]) => Uint8Array | null): { nils: number; total: number } {
  let nils = 0;
  let total = 0;
  for (const c of data.functions[name]) {
    if (c.panic) {
      continue;
    }
    total++;
    const got = f(c.args);
    const wantNil = c.nil === true;
    if (wantNil) {
      nils++;
    }
    assert.equal(got === null, wantNil, `${name} ${JSON.stringify(c.args)}: Go returned ${wantNil ? "nil" : "non-nil"}`);
  }
  return { nils, total };
}

test("nil exactly when the result is empty: TrimSpace, Trim, TrimLeft", () => {
  assert.ok(check("TrimSpace", (a) => slices.NilIfEmpty(bytes.TrimSpace(fromHex(a[0])))).nils > 0);
  assert.ok(check("Trim", (a) => slices.NilIfEmpty(bytes.Trim(fromHex(a[0]), a[1] as string))).nils > 0);
  assert.ok(check("TrimLeft", (a) => slices.NilIfEmpty(bytes.TrimLeft(fromHex(a[0]), a[1] as string))).nils > 0);
});

test("never nil for a non-nil input: TrimRight, TrimPrefix, TrimSuffix, Repeat, ToLower, Join of several", () => {
  assert.equal(check("TrimRight", (a) => bytes.TrimRight(fromHex(a[0]), a[1] as string)).nils, 0);
  assert.equal(check("TrimPrefix", (a) => bytes.TrimPrefix(fromHex(a[0]), fromHex(a[1]))).nils, 0);
  assert.equal(check("TrimSuffix", (a) => bytes.TrimSuffix(fromHex(a[0]), fromHex(a[1]))).nils, 0);
  assert.equal(check("Repeat", (a) => bytes.Repeat(fromHex(a[0]), a[1] as number)).nils, 0);
  assert.equal(check("ToLower", (a) => bytes.ToLower(fromHex(a[0]))).nils, 0);
});

test("Replace and ReplaceAll: nil when nothing is replaced and the input is empty", () => {
  assert.ok(check("ReplaceAll", (a) => bytes.ReplaceAllOrNil(fromHex(a[0]), fromHex(a[1]), fromHex(a[2]))).nils > 0);
  assert.ok(check("Replace", (a) => bytes.ReplaceOrNil(fromHex(a[0]), fromHex(a[1]), fromHex(a[2]), a[3] as number)).nils >= 0);
});

test("Join: nil only for exactly one empty element", () => {
  const elements = (a: unknown[]): Uint8Array[] => (a[0] as string[]).map(fromHex);
  const { total } = check("Join", (a) => bytes.JoinOrNil(elements(a), fromHex(a[1])));
  assert.ok(total > 0);
  // The generator's corpus has no single empty element; the rule is Go's append([]byte(nil), s[0]...).
  assert.equal(bytes.JoinOrNil([new Uint8Array(0)], new Uint8Array(0)), null);
  assert.deepEqual(bytes.JoinOrNil([], new Uint8Array(0)), new Uint8Array(0));
  assert.deepEqual(bytes.JoinOrNil([new Uint8Array(0), new Uint8Array(0)], new Uint8Array(0)), new Uint8Array(0));
});

test("ReplaceAllOrNil edge cases", () => {
  const e = new Uint8Array(0);
  const a = new Uint8Array([0x61]);
  assert.equal(bytes.ReplaceAllOrNil(e, a, e), null);
  assert.deepEqual(bytes.ReplaceAllOrNil(e, e, a), a); // an empty old matches once in an empty s
  assert.deepEqual(bytes.ReplaceAllOrNil(e, e, e), e);
  assert.equal(bytes.ReplaceOrNil(e, e, a, 0), null);
  assert.deepEqual(bytes.ReplaceAllOrNil(a, e, e), a);
});

test("NilIfEmpty and KeepNil", () => {
  assert.equal(slices.NilIfEmpty(new Uint8Array(0)), null);
  assert.deepEqual(slices.NilIfEmpty(new Uint8Array([1])), new Uint8Array([1]));
  assert.equal(slices.KeepNil(null, bytes.TrimSpace), null);
  assert.deepEqual(slices.KeepNil(new Uint8Array(0), bytes.TrimSpace), new Uint8Array(0));
});
