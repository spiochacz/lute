import { test } from "node:test";
import assert from "node:assert/strict";
import { Node } from "./node.ts";
import { loadVectors } from "./testhelpers.ts";

// Predicate vectors: for every type value in -2..maxVal+2, a node with only Type set, and the results of the predicates
// that depend only on Type. canContain holds one character per candidate type -2..maxVal+2.
interface PredicateVector {
  type: number;
  isBlock: boolean;
  isContainerBlock: boolean;
  isMarker: boolean;
  isCloseMarker: boolean;
  acceptLines: boolean;
  markerTrue: string;
  markerFalse: string;
  canContain: string;
}

const vectors = loadVectors<{ types: PredicateVector[] }>("predicates_vectors.json").types;

for (const v of vectors) {
  test(`Predicates for node type ${v.type}`, () => {
    const n = new Node(v.type);
    assert.equal(n.IsBlock(), v.isBlock, "IsBlock");
    assert.equal(n.IsContainerBlock(), v.isContainerBlock, "IsContainerBlock");
    assert.equal(n.IsMarker(), v.isMarker, "IsMarker");
    assert.equal(n.IsCloseMarker(), v.isCloseMarker, "IsCloseMarker");
    assert.equal(n.AcceptLines(), v.acceptLines, "AcceptLines");
    assert.equal(n.Marker(true), v.markerTrue, "Marker(true)");
    assert.equal(n.Marker(false), v.markerFalse, "Marker(false)");
    assert.equal(v.canContain.length, vectors.length, "canContain length");
    for (let i = 0; i < v.canContain.length; i++) {
      // Character i is the candidate type i - 2.
      assert.equal(n.CanContain(i - 2), v.canContain.charAt(i) === "1", "CanContain(" + (i - 2) + ")");
    }
  });
}
