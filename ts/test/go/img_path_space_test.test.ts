// Port of test/img_path_space_test.go (TestImgPathSpace); the table is read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { caseMessage, table } from "./wave3_support.ts";

test("TestImgPathSpace", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.ImgPathAllowSpace = true;
  for (const [name, from, to] of table("img_path_space", "imgPathSpaceTests", 2)) {
    assert.equal(luteEngine.MarkdownStr(name, from), to, caseMessage(name, from));
  }
});
