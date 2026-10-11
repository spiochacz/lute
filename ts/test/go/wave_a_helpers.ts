// Shared helpers of the ported Go tests of wave A (test/autolink_test.go ... test/html_text_style_test.go).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Lute } from "../../src/index.ts";
import type { OracleEngine } from "../oracle/oracle.ts";

export type Row = string[];
export type CaseFile = Record<string, (string | string[])[][]>;

// The tables of a Go test file, extracted from the Go source by tools/go-tests/extract-wave-a.mjs.
export function goCases(goFile: string): CaseFile {
  const path = fileURLToPath(new URL(`./cases/${goFile}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as CaseFile;
}

export function rows(file: CaseFile, key: string, expectedCount: number): Row[] {
  const r = file[key] as unknown as Row[] | undefined;
  assert.ok(r !== undefined, `table ${key} missing`);
  assert.equal(r.length, expectedCount, `row count of ${key}`);
  return r;
}

// Known differences between the JavaScript build (the reference bundle) and native Go: the case names whose Go expected value the
// port (like the reference bundle) does not produce. For them the test asserts that the port equals the reference and differs from Go.
export interface JsBuildDifferences {
  names: readonly string[];
  oracle: OracleEngine;
  call: (engine: OracleEngine, name: string, from: string) => string;
}

// The test body shared by most table tests of Go: name, from, to; to == engine.MarkdownStr(name, from).
// Every mismatch is collected, so one run lists all of them; Go stops at the first.
export function markdownTable(engine: Lute, table: Row[], differences?: JsBuildDifferences): number {
  return checkTable(table, (name, from) => engine.MarkdownStr(name, from), differences);
}

export function checkTable(table: Row[], run: (name: string, from: string) => string, differences?: JsBuildDifferences): number {
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const [name, from, to] of table) {
    const got = run(name!, from!);
    const isDifference = differences?.names.includes(name!) ?? false;
    if (isDifference) {
      seen.add(name!);
      const reference = differences!.call(differences!.oracle, name!, from!);
      if (got !== reference) {
        failures.push(`JS_BUILD_DIFFERENCES [${name}]: port ${JSON.stringify(got)} differs from the reference ${JSON.stringify(reference)}`);
      } else if (got === to) {
        failures.push(`JS_BUILD_DIFFERENCES [${name}]: port now equals Go's expected value, remove it from the list`);
      }
    } else if (got !== to) {
      failures.push(`test case [${name}] failed\nexpected\n\t${JSON.stringify(to)}\ngot\n\t${JSON.stringify(got)}\noriginal ${JSON.stringify(from)}`);
    }
  }
  for (const n of differences?.names ?? []) {
    if (!seen.has(n)) failures.push(`JS_BUILD_DIFFERENCES names an unknown case ${n}`);
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  return table.length;
}

export function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
}
