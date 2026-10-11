// Port of test/image_lazy_loading_test.go (TestImageLazyLoading); the table is read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestImageLazyLoading", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.ImageLazyLoading = "/images/img-loading.svg";
  for (const [name, from, to] of table("image_lazy_loading", "imageLazyLoadingTests", 1)) {
    assert.equal(luteEngine.MarkdownStr("", from), to, caseMessage(name, from));
  }
});
