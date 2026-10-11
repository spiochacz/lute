// Shared helpers for the ast vector tests. This file is not a test (it has no .test.ts suffix).
import { readFileSync } from "node:fs";
import { Node } from "./node.ts";

// loadVectors reads a JSON file from ts/src/ast/testdata (written by ts/tools/gen-ast-vectors).
export function loadVectors<T>(name: string): T {
  return JSON.parse(readFileSync(new URL("./testdata/" + name, import.meta.url), "utf8")) as T;
}

export function hexToBytes(h: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, "0");
  }
  return s;
}

// dumpForest is the canonical tree dump used by the tree vectors: for every node with no parent, in creation order,
// one line per node in pre-order: "<depth> <type> <tokens-hex>\n".
export function dumpForest(nodes: Node[]): string {
  let out = "";
  const walk = (n: Node, depth: number): void => {
    out += depth + " " + n.Type + " " + bytesToHex(n.Tokens ?? new Uint8Array(0)) + "\n";
    for (let c = n.FirstChild; null !== c; c = c.Next) {
      walk(c, depth + 1);
    }
  };
  for (const n of nodes) {
    if (null === n.Parent) {
      walk(n, 0);
    }
  }
  return out;
}

// expectResult checks an expected vector value. "PANIC" means the Go call panicked, so the TypeScript call must throw.
export function expectResult(
  assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void; throws: (fn: () => unknown, m?: string) => void },
  label: string,
  expected: unknown,
  actual: () => unknown
): void {
  if (expected === "PANIC") {
    assert.throws(actual, label);
    return;
  }
  assert.deepEqual(actual(), expected, label);
}
