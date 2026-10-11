// Port of test/textbundle_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

interface TextbundleTest {
  name: string;
  original: string; // 原始的 Markdown 文本
  textbundle: string; // TextBundle 过的 Markdown 文本
  originalLinks: string[]; // 原始的链接地址
}

const originalLinksCases: string[][] = [
  ["https://img.hacpai.com/dir1/bar.zip", "https://b3logfile.com/dir2/baz.png"],
];

const textbundleTests: TextbundleTest[] = [
  {
    name: "0",
    original: "[foo](" + originalLinksCases[0][0] + ")\n\n![foo](" + originalLinksCases[0][1] + ")\n",
    textbundle: "[foo](assets/dir1/bar.zip)\n\n![foo](assets/dir2/baz.png)\n",
    originalLinks: originalLinksCases[0],
  },
];

test("TestTextBundle", () => {
  const luteEngine = New();

  for (const t of textbundleTests) {
    const [textbundle, originalLinks] = luteEngine.TextBundleStr(t.name, t.original, ["https://img.hacpai.com", "https://b3logfile.com"]);
    assert.equal(textbundle, t.textbundle, `test case [${t.name}] failed, original markdown text ${JSON.stringify(t.original)}`);
    assert.deepEqual(originalLinks, t.originalLinks, `test case [${t.name}] failed, original markdown text ${JSON.stringify(t.original)}`);
  }
});
