// Port of test/parse_block_test.go (TestBlock). Go only logs the block counts and the elapsed time; here the counts are logged as
// diagnostics, and the test fails if reading or parsing throws. Go's working directory is test/ (commonmark-spec-kramdown.md).

import { test } from "node:test";
import { readFileSync } from "node:fs";
import { New, parse } from "../../src/index.ts";

test("TestBlock", (t) => {
  const luteEngine = New();
  luteEngine.SetVditorIR(true);
  luteEngine.ParseOptions.Mark = true;
  luteEngine.ParseOptions.BlockRef = true;
  luteEngine.SetKramdownIAL(true);
  luteEngine.ParseOptions.SuperBlock = true;
  luteEngine.SetAutoSpace(false);
  luteEngine.SetSub(true);
  luteEngine.SetSup(true);
  luteEngine.SetGitConflict(true);
  luteEngine.SetFileAnnotationRef(true);

  const data = new Uint8Array(readFileSync(new URL("../../../test/commonmark-spec-kramdown.md", import.meta.url)));

  let tree = parse.Block("", data, luteEngine.ParseOptions);
  t.diagnostic(`blocks [${tree.BlockCount()}], doc blocks [${tree.DocBlockCount()}]`);

  tree = parse.Parse("", data, luteEngine.ParseOptions);
  t.diagnostic(`blocks [${tree.BlockCount()}], doc blocks [${tree.DocBlockCount()}]`);
});
