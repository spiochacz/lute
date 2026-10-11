// Shared helpers of the ported Go tests in this directory (wave 3 files): reading the case tables that
// tools/go-tests/extract-test-tables-wave3.mjs generates from the Go sources, and the ast.Testing switch.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { ast } from "../../src/index.ts";

export type Row = [name: string, from: string, to: string];

// Reads the JSON generated from test/<goFile>_test.go; the Go table variable names are the keys.
export function readCases(goFile: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`./cases/${goFile}_test.json`, import.meta.url), "utf8")) as Record<string, unknown>;
}

// A table of rows (Go's []parseTest) of the given variable; the row count guards against a broken extraction.
export function table(goFile: string, variable: string, expectedRows: number): Row[] {
  const rows = readCases(goFile)[variable] as Row[] | undefined;
  if (rows === undefined || rows.length !== expectedRows) {
    throw new Error(`${goFile}: table ${variable} has ${rows === undefined ? "no" : rows.length} rows, expected ${expectedRows}`);
  }
  return rows;
}

// Go sets `ast.Testing = true` for the rest of the process; here it is restored after each test, because other
// test files share the process pool.
export function withTesting(fn: () => void): void {
  ast.SetTesting(true);
  try {
    fn();
  } finally {
    ast.SetTesting(false);
  }
}

// Go's failure message of the table loops (the expected and actual values are shown by assert).
export function caseMessage(name: string, from: string): string {
  return `test case [${name}] failed, original ${JSON.stringify(from)}`;
}

// A known difference between the JavaScript build of Lute (the reference bundle) and native Go: the port, like the bundle, produces
// `reference`, while Go's expected value (the table row) is kept in the table. The test asserts the reference behaviour.
export interface JsBuildDifference {
  reference: string;
  reason: string;
}

// Go's table loop: asserts every row against Go's expected value, except the rows listed in `differences` (keyed by row name),
// which assert the reference behaviour and that it differs from Go's expected value.
export function assertRows(rows: Row[], run: (name: string, from: string) => string, differences: Record<string, JsBuildDifference> = {}): void {
  for (const [name, from, to] of rows) {
    const actual = run(name, from);
    const difference = differences[name];
    if (difference === undefined) {
      assert.equal(actual, to, caseMessage(name, from));
    } else {
      assert.notEqual(difference.reference, to, `test case [${name}]: a JS build difference must differ from Go's expected value`);
      assert.equal(actual, difference.reference, `test case [${name}] (JS build difference: ${difference.reason}), original ${JSON.stringify(from)}`);
    }
  }
}
