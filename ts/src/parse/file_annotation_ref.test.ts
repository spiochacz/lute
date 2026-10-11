// Ported from parse/file_annotation_ref_test.go @ 8e7896b6

import { test } from "node:test";
import assert from "node:assert/strict";
import { Context } from "./types.ts";
import type { Options } from "./parse.ts";
import "./file_annotation_ref.ts";

test("TestFileAnnotationRefRejectsNestedOpenersWithoutConsumingInput", () => {
  // Go: context := &Context{}; the method does not read the options
  const context = new Context({} as unknown as Options);
  const tokens = new Uint8Array(65536).fill(0x3c /* < */);
  const [passed, remains, id] = context.parseFileAnnotationRefID(tokens);
  if (passed.length !== 0 || id.length !== 0 || remains.length !== tokens.length) {
    assert.fail("invalid annotation consumed input after a nested opener");
  }
});
