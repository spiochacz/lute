import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { loadVectors } from "./testhelpers.ts";

// Misc vectors: IsNodeIDPattern, IsValidCalloutImageSrc (url.Parse based), the callout helpers, the callout constants, and NewNodeID under testing.
interface MiscVectors {
  isNodeIDPattern: [string, boolean][];
  isValidCalloutImageSrc: [string, boolean][];
  isBuiltInCalloutType: [string, boolean][];
  getCalloutIcon: [string, string][];
  getCalloutTitle: [string, string][];
  calloutConsts: Record<string, string>;
  newNodeIDTesting: string;
}

const v = loadVectors<MiscVectors>("misc_vectors.json");

test("IsNodeIDPattern matches Go for every vector", () => {
  for (const [s, want] of v.isNodeIDPattern) {
    assert.equal(ast.IsNodeIDPattern(s), want, JSON.stringify(s));
  }
});

// IsValidCalloutImageSrc is checked in callout_src_121.test.ts: it depends on
// url.Parse, and the port follows Go 1.21, so the expected values come from the
// Go 1.21 column there (the Go 1.27 column is compared with an explicit list).

test("IsBuiltInCalloutType matches Go", () => {
  for (const [s, want] of v.isBuiltInCalloutType) {
    assert.equal(ast.IsBuiltInCalloutType(s), want, JSON.stringify(s));
  }
});

test("GetCalloutIcon matches Go", () => {
  for (const [s, want] of v.getCalloutIcon) {
    assert.equal(ast.GetCalloutIcon(s), want, JSON.stringify(s));
  }
});

test("GetCalloutTitle matches Go", () => {
  for (const [s, want] of v.getCalloutTitle) {
    assert.equal(ast.GetCalloutTitle(s), want, JSON.stringify(s));
  }
});

test("Callout constants match Go", () => {
  const exported = ast as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(v.calloutConsts)) {
    assert.equal(exported[name], value, name);
  }
});

test("NewNodeID under testing returns the fixed Go test ID", () => {
  ast.SetTesting(true);
  try {
    assert.equal(ast.NewNodeID(), v.newNodeIDTesting);
    assert.equal(ast.NewNodeID(), v.newNodeIDTesting);
  } finally {
    ast.SetTesting(false);
  }
});
