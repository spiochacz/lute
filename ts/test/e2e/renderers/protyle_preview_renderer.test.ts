// ProtylePreviewRenderer (ProtylePreviewStr) against the reference bundle. Only the string variant is compared:
// the bundle has ProtylePreview(tree, ...) too, but it needs a tree object of the oracle.

import { test } from "node:test";
import { corpus, files, finish, specCases } from "./protyle_compare.ts";

test("CommonMark spec cases, ProtylePreviewStr", () => {
  finish(specCases("preview"));
});

test("whole files, ProtylePreviewStr", () => {
  finish(files("preview", ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md", "test/gfm-spec.md", "benchmark/commonmark-spec.md"], ["base", "text mark and html tag", "callout and tabs", "footnotes"]));
});

test("short documents, ProtylePreviewStr, every option variation (half)", () => {
  finish(corpus("preview", 2, 0, null));
});

test("short documents, ProtylePreviewStr, every option variation (other half)", () => {
  finish(corpus("preview", 2, 1, null));
});
