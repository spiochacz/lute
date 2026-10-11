// Oracle harness: loads the reference oracle bundle (by default
// test/oracle/lute.ref.min.cjs, the GopherJS build of the Go implementation at the
// commit in UPSTREAM_PIN plus the patches in tools/oracle/patches/; see README.md
// next to it; override with the LUTE_ORACLE environment variable) and offers
// helpers for comparing TypeScript output with it.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Loosely typed on purpose: the oracle exposes about 153 methods, and only the
// ones used by the harness and benchmarks are referenced by name.
export type OracleEngine = Record<string, any>;

export interface OracleLute {
  Version: string;
  New(options?: Record<string, unknown> | null): OracleEngine;
  [key: string]: any;
}

// The extension is .cjs, not .js: ts/package.json has "type": "module", so a .js
// file here would load as ESM, and the GopherJS bundle needs CommonJS `require`.
const DEFAULT_ORACLE_PATH = fileURLToPath(new URL("./lute.ref.min.cjs", import.meta.url));

// Absolute path of the oracle bundle in use: $LUTE_ORACLE when set and
// non-empty, otherwise test/oracle/lute.ref.min.cjs (the patched reference).
export function oraclePath(): string {
  const fromEnv = process.env.LUTE_ORACLE;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_ORACLE_PATH;
}

let cachedLute: OracleLute | undefined;

// Loads the oracle bundle once and returns the Lute global it installs.
export function loadOracle(): OracleLute {
  if (cachedLute !== undefined) {
    return cachedLute;
  }
  const path = oraclePath();
  const require = createRequire(import.meta.url);
  require(path);
  const lute = (globalThis as unknown as { Lute?: OracleLute }).Lute;
  if (lute === undefined) {
    throw new Error(`oracle bundle ${path} did not set globalThis.Lute`);
  }
  cachedLute = lute;
  return lute;
}

// Returns a fresh engine with default options.
export function newOracleEngine(): OracleEngine {
  return loadOracle().New();
}

// Random node IDs look like 20261010153000-abc1234. Replace each distinct ID with
// a stable placeholder (ID#1, ID#2, ...) numbered by first appearance.
const NODE_ID_PATTERN = /(?<![0-9A-Za-z])\d{14}-[0-9a-z]{7}(?![0-9A-Za-z])/g;

export function normalizeIDs(s: string): string {
  const seen = new Map<string, string>();
  return s.replace(NODE_ID_PATTERN, (id) => {
    let placeholder = seen.get(id);
    if (placeholder === undefined) {
      placeholder = `ID#${seen.size + 1}`;
      seen.set(id, placeholder);
    }
    return placeholder;
  });
}

export interface FirstDifference {
  // Index of the first differing UTF-16 code unit.
  index: number;
  // About 40 characters around the index, from each side.
  actualContext: string;
  expectedContext: string;
}

const CONTEXT_BEFORE = 20;
const CONTEXT_AFTER = 20;

export function firstDifference(actual: string, expected: string): FirstDifference | null {
  if (actual === expected) {
    return null;
  }
  const limit = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < limit && actual.charCodeAt(index) === expected.charCodeAt(index)) {
    index++;
  }
  const from = Math.max(0, index - CONTEXT_BEFORE);
  return {
    index,
    actualContext: actual.slice(from, index + CONTEXT_AFTER),
    expectedContext: expected.slice(from, index + CONTEXT_AFTER),
  };
}

export function assertSameOutput(label: string, actual: string, expected: string): void {
  const diff = firstDifference(actual, expected);
  if (diff === null) {
    return;
  }
  throw new Error(
    `${label}: output differs at UTF-16 index ${diff.index}\n` +
      `  actual:   ${JSON.stringify(diff.actualContext)}\n` +
      `  expected: ${JSON.stringify(diff.expectedContext)}`,
  );
}
