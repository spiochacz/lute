// Port of test/link_dest_test.go (TestGetLinkDest, TestIsValidLinkDest).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

test("TestGetLinkDest", () => {
  const luteEngine = New();
  const cases: [input: string, expected: string][] = [
    ['www.bing.com/search?q="你好"', "http://www.bing.com/search?q=%22%E4%BD%A0%E5%A5%BD%22"],
    ["www.bing.com/search?q=@Hello", "http://www.bing.com/search?q=@Hello"],
    ['www.bing.com/search?q="Hello"', "http://www.bing.com/search?q=%22Hello%22"],
    ["https://foo.com/bar:baz", "https://foo.com/bar:baz"],
    ["[foo](bar.com)", "bar.com"],
    ["[foo](siyuan://blocks/20220817180757-c57m8qi)", "siyuan://blocks/20220817180757-c57m8qi"],
    ["[foo](https://abc.to/)", "https://abc.to/"],
    ["[foo](https://abc.pm/)", "https://abc.pm/"],
    ["file://D:\\Admin\\Downloads\\隔壁叔叔过年还在玩思源.jpg", "file://D:\\Admin\\Downloads\\隔壁叔叔过年还在玩思源.jpg"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(luteEngine.GetLinkDest(input), expected, `get link dest failed for ${JSON.stringify(input)}`);
  }
});

test("TestIsValidLinkDest", () => {
  const luteEngine = New();
  const cases: [input: string, valid: boolean][] = [
    ["[foo](bar.com)", false],
    ["siyuan://blocks/20220817180757-c57m8qi", true],
    ["https://abc.to/", true],
    ["https://abc.pm/", true],
    ["https://abc.dev", true],
    ["https://www.notion.so/AUR-9b010a17ca2d4996a898a801426b0585", true],
    ["http://127.0.0.1:6806", true],
    ["https://ld246.com", true],
    ["https://ld246", false],
    ["ld246.com", false],
    ["https://www.electronjs.org/docs/api/shell", true],
  ];
  for (const [input, valid] of cases) {
    assert.equal(luteEngine.IsValidLinkDest(input), valid, `check link dest failed for ${JSON.stringify(input)}`);
  }
});
