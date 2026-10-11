// Port of test/parse_inline_test.go (TestInline); the inlineTests table is read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, New, parse } from "../../src/index.ts";
import { BytesFromString } from "../../src/runtime/conv.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestInline", () => {
  const luteEngine = New();
  for (const [name, from, to] of table("parse_inline", "inlineTests", 4)) {
    const tree = parse.Inline("", BytesFromString(from), luteEngine.ParseOptions);
    assert.equal(tree.Root!.FirstChild!.Type, ast.NodeParagraph, caseMessage(name, from));
    assert.equal(tree.Root!.Text(), to, caseMessage(name, from));
  }
});
