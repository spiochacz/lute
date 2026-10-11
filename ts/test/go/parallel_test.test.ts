// Port of test/parallel_test.go. The whole body of Go's TestParallel is commented out in the Go source (the file contains only
// `package test`), so there is no active test function to port. The commented-out body ran Markdown on 50 engines per input
// concurrently; concurrency is not applicable here. The sequential part (parsing test/commonmark-spec.md and test/case1.md with a fresh
// engine, without assertions) is kept as a smoke test so the file is not empty.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { New } from "../../src/index.ts";

test("TestParallel (commented out in Go; sequential smoke test of its body)", () => {
  const files = ["commonmark-spec.md", "case1.md"].map((f) => new URL(`../../../test/${f}`, import.meta.url));
  for (const file of files) {
    if (!existsSync(file)) {
      continue; // test/commonmark-spec.md does not exist in the repository; Go's commented-out test would have failed on it too
    }
    const luteEngine = New();
    assert.ok(luteEngine.Markdown("", new Uint8Array(readFileSync(file))).length > 0);
  }
});
