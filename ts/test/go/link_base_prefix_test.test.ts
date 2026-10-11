// Port of test/link_base_prefix_test.go: TestLinkBase, TestVditorLinkBaseDataImage, TestLinkBasePrefix, TestVditorLinkBaseRoundTrip,
// TestProtyleLinkBaseRoundTrip. The tables are read from the Go source. (The WYSIWYG half of TestVditorLinkBaseDataImage is also in
// test/e2e/root/vditor_wysiwyg_go.test.ts; this file ports the whole function, including the IR half.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { assertRows, table } from "./wave3_support.ts";

test("TestLinkBase", () => {
  const luteEngine = New();
  luteEngine.SetSup(true);
  luteEngine.SetLinkBase("http://domain.com/path/");
  assertRows(table("link_base_prefix", "linkBaseTests", 8), (name, from) => luteEngine.MarkdownStr(name, from));
});

test("TestVditorLinkBaseDataImage", () => {
  const luteEngine = New();
  luteEngine.SetVditorWYSIWYG(true);
  luteEngine.SetLinkBase("http://domain.com/path/");
  const markdown = "![foo](data:image/png;base64,AAAA)";
  const expected = `src="data:image/png;base64,AAAA"`;
  const tests: Record<string, string> = {
    ir: luteEngine.Md2VditorIRDOM(markdown),
    wysiwyg: luteEngine.Md2VditorDOM(markdown),
  };
  for (const [name, dom] of Object.entries(tests)) {
    assert.ok(dom.includes(expected), `test case [${name}] failed\nexpected to contain\n\t${JSON.stringify(expected)}\ngot\n\t${JSON.stringify(dom)}`);
  }
});

test("TestLinkBasePrefix", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.LinkBase = "http://domain.com/path/";
  luteEngine.RenderOptions.LinkPrefix = "prefix:";
  assertRows(table("link_base_prefix", "linkBasePrefixTests", 1), (name, from) => luteEngine.MarkdownStr(name, from));
});

test("TestVditorLinkBaseRoundTrip", async (t) => {
  const tests: { name: string; linkBase: string; linkPrefix: string; markdown: string }[] = [
    { name: "windows-relative-path", linkBase: "/configured/base", linkPrefix: "", markdown: String.raw`![image.png](.\实现设计.assets\image.png)` },
    { name: "relative-link", linkBase: "/configured/base", linkPrefix: "", markdown: "[foo](dir/foo.txt)" },
    { name: "parent-relative-image", linkBase: "/configured/base", linkPrefix: "", markdown: "![foo](../images/foo.png)" },
    { name: "trailing-slash", linkBase: "/configured/base/", linkPrefix: "", markdown: "![foo](./images/foo.png)" },
    { name: "link-prefix", linkBase: "/configured/base", linkPrefix: "prefix:", markdown: "[foo](dir/foo.txt)" },
    { name: "external-link-containing-base", linkBase: "/configured/base", linkPrefix: "", markdown: "[foo](https://example.com/configured/base/foo.txt)" },
  ];
  for (const tc of tests) {
    await t.test(tc.name, () => {
      const luteEngine = New();
      luteEngine.SetVditorWYSIWYG(true);
      luteEngine.SetLinkBase(tc.linkBase);
      luteEngine.SetLinkPrefix(tc.linkPrefix);
      const irDOM = luteEngine.Md2VditorIRDOM(tc.markdown);
      const markdown = luteEngine.VditorIRDOM2Md(irDOM);
      const wysiwygDOM = luteEngine.Md2VditorDOM(markdown);
      const result = luteEngine.VditorDOM2Md(wysiwygDOM);
      assert.equal(result, tc.markdown + "\n", `test case [${tc.name}] failed`);
    });
  }
});

test("TestProtyleLinkBaseRoundTrip", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetLinkBase("/configured/base");
  luteEngine.SetLinkPrefix("prefix:");
  const markdown = "[foo](dir/foo.txt)";
  const blockDOM = luteEngine.Md2BlockDOM(markdown, false);
  const result = luteEngine.BlockDOM2StdMd(blockDOM);
  assert.equal(result, markdown + "\n");
});
