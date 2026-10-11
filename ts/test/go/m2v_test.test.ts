// Port of test/m2v_test.go. TestMd2VditorDOM is already ported in test/e2e/root/vditor_wysiwyg_go.test.ts (Go's expected values);
// this file ports TestMd2VditorIRDOM, whose table is read from the Go source.

import { test } from "node:test";
import { New } from "../../src/index.ts";
import { assertRows, table, withTesting } from "./wave3_support.ts";

test("TestMd2VditorIRDOM", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.ToC = true;
  luteEngine.RenderOptions.ToC = true;
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.KramdownBlockIAL = true;
  withTesting(() => {
    assertRows(table("m2v", "md2VditorIRDOMTests", 17), (_name, from) => luteEngine.Md2VditorIRDOM(from));
  });
});
