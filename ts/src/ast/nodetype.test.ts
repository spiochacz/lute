import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { loadVectors } from "./testhelpers.ts";

// NodeType vectors from the Go generator: every constant name and value, String() for -2..maxVal+2, and Str2NodeType for every name.
interface NodeTypeVectors {
  maxVal: number;
  constants: [string, number][];
  strings: [number, string][];
  str2type: [string, number][];
}

const vectors = loadVectors<NodeTypeVectors>("nodetype_vectors.json");

test("NodeType constants match Go names and values", () => {
  const exported = ast as unknown as Record<string, unknown>;
  assert.equal(vectors.constants.length, 143);
  for (const [name, value] of vectors.constants) {
    assert.equal(exported[name], value, name);
  }
  assert.equal(ast.NodeTypeMaxVal, vectors.maxVal);
});

test("NodeTypeString matches Go String() for -2..maxVal+2", () => {
  for (const [value, want] of vectors.strings) {
    assert.equal(ast.NodeTypeString(value), want, "String(" + value + ")");
  }
});

test("NodeTypeString of an unknown value uses the NodeType(n) form", () => {
  assert.equal(ast.NodeTypeString(-1), "NodeType(-1)");
  assert.equal(ast.NodeTypeString(1025), "NodeType(1025)");
});

test("Str2NodeType matches Go for every constant name and unknown names", () => {
  for (const [name, want] of vectors.str2type) {
    assert.equal(ast.Str2NodeType(name), want, name);
  }
});

test("Str2NodeType maps the String() form of a value without a constant", () => {
  // Go's init() maps String() of every value below NodeTypeMaxVal, not only the named constants.
  const named = new Set(vectors.constants.map((c) => c[1]));
  let v = 0;
  while (named.has(v)) {
    v++;
  }
  assert.equal(ast.Str2NodeType(ast.NodeTypeString(v)), v);
});

test("GetTesting defaults to false and SetTesting changes it", () => {
  assert.equal(ast.GetTesting(), false);
  ast.SetTesting(true);
  try {
    assert.equal(ast.GetTesting(), true);
  } finally {
    ast.SetTesting(false);
  }
  assert.equal(ast.GetTesting(), false);
});
