// Port of test/link_dest_encode_test.go (TestLinkDestEncode, TestLinkDestDecode).

import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../../src/index.ts";
import { BytesFromString } from "../../src/runtime/conv.ts";

test("TestLinkDestEncode", () => {
  const dest1 = BytesFromString("http://foo.bar/测试");
  const encoded = html.EncodeDestination(dest1);
  const dest2 = html.DecodeDestination(encoded);
  assert.deepEqual(dest2, dest1, "Link dest encode failed");
});

test("TestLinkDestDecode", () => {
  const dest1 = BytesFromString("C:\\Users\\DL882\\Documents\\SiYuan\\data\\assets\\%E6%B5%8B%E8%AF%95-20210621160821-zxz1j35.pdf");
  const decoded = html.DecodeDestination(dest1);
  assert.deepEqual(decoded, BytesFromString("C:\\Users\\DL882\\Documents\\SiYuan\\data\\assets\\测试-20210621160821-zxz1j35.pdf"), "Link dest encode failed");
});
