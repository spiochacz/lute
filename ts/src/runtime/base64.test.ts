import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as base64 from "./base64.ts";

const hexToBytes = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
};
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const vectors = JSON.parse(readFileSync(new URL("./testdata/base64_vectors.json", import.meta.url), "utf8")) as {
  encode: { bytes: string; encoded: string }[];
  decode: { input: string; valid: boolean; bytes: string }[];
};

test("RawURLEncodeToString matches Go 1.21 for every vector", () => {
  for (const c of vectors.encode) {
    assert.equal(base64.RawURLEncodeToString(hexToBytes(c.bytes)), c.encoded, `bytes ${c.bytes}`);
  }
});

test("RawURLDecodeString matches Go 1.21 for every vector", () => {
  for (const c of vectors.decode) {
    const [b, err] = base64.RawURLDecodeString(c.input);
    const label = JSON.stringify(c.input);
    assert.equal(err !== null, !c.valid, `error mismatch for ${label}`);
    if (c.valid) {
      assert.equal(bytesToHex(b), c.bytes, `bytes for ${label}`);
    }
  }
});

test("RawURLDecodeString: explicit rules", () => {
  assert.equal(bytesToHex(base64.RawURLDecodeString("")[0]), "");
  assert.equal(base64.RawURLDecodeString("Zm9v\r\n")[1], null);
  assert.equal(bytesToHex(base64.RawURLDecodeString("Zm\r9v\n")[0]), "666f6f");
  assert.notEqual(base64.RawURLDecodeString("Zm9v=")[1], null);
  assert.notEqual(base64.RawURLDecodeString("Zm9+")[1], null);
  assert.notEqual(base64.RawURLDecodeString("Zm9/")[1], null);
  assert.notEqual(base64.RawURLDecodeString("Z")[1], null);
  assert.equal(bytesToHex(base64.RawURLDecodeString("-_8")[0]), "fbff");
});
