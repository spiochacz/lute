// Port of test/parse_test.go: TestParse (the parseTests table is read from the Go source; it also defines the parseTest type shared by the other
// Go test files, which the ported files of this directory read as [name, from, to] rows) and TestCase1.
// Go's working directory is test/, so case1.md is read from test/ in the repository root.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { New } from "../../src/index.ts";
import type { JsBuildDifference } from "./wave3_support.ts";
import { assertRows, table } from "./wave3_support.ts";

// The JavaScript build has no full Unicode case folding for link labels (Go: strings.ToLower / unicode folding maps U+1E9E to ss), so the
// reference bundle and the port resolve the label to the last definition. Go expects the first definition (/first).
const JS_BUILD_DIFFERENCES: Record<string, JsBuildDifference> = {
  "fold-ss": { reference: "<p><a href=\"/second\">ss</a></p>\n", reason: "no full Unicode case folding for link labels in the javascript build" },
  "fold-SS": { reference: "<p><a href=\"/second\">SS</a></p>\n", reason: "no full Unicode case folding for link labels in the javascript build" },
};

test("TestParse", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.GFMTaskListItem = false;
  luteEngine.ParseOptions.GFMTable = false;
  luteEngine.ParseOptions.GFMAutoLink = false;
  luteEngine.ParseOptions.GFMStrikethrough = false;
  luteEngine.RenderOptions.SoftBreak2HardBreak = false;
  luteEngine.RenderOptions.CodeSyntaxHighlight = false;
  luteEngine.ParseOptions.HeadingID = false;
  luteEngine.RenderOptions.HeadingID = false;
  luteEngine.RenderOptions.AutoSpace = false;
  luteEngine.RenderOptions.FixTermTypo = false;
  luteEngine.ParseOptions.Emoji = false;
  assertRows(table("parse", "parseTests", 211), (name, from) => luteEngine.MarkdownStr(name, from), JS_BUILD_DIFFERENCES);
});

test("TestCase1", () => {
  const bytes = readFileSync(new URL("../../../test/case1.md", import.meta.url));
  const luteEngine = New();
  // Go only logs the HTML; here it is only checked that rendering succeeds and yields output.
  const html = luteEngine.Markdown("case1.md", new Uint8Array(bytes));
  assert.ok(html.length > 0);
});
