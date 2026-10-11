// Ported from parse/inline_attribute_list_test.go @ 8e7896b6

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeIALPreservingOrder } from "./inline_attribute_list.ts";

test("TestMergeIALPreservingOrder", async (t) => {
  const tests: { name: string; dst: string[][]; src: string[][]; want: string[][] }[] = [
    {
      // Overwrites an existing attribute without changing its position; new attributes are appended in src order, and their values are unescaped first.
      name: "updates_existing_attrs_and_appends_new_attrs",
      dst: [["id", "old"], ["class", "foo&amp;bar"]],
      src: [["id", "new"], ["updated", "20260405"], ["title", "a&amp;b"]],
      want: [["id", "new"], ["class", "foo&bar"], ["updated", "20260405"], ["title", "a&b"]],
    },
    {
      // Corresponds to SpinBlockDOM case 262: the order of the existing block attributes is unchanged, and a new IAL attribute can only be appended at the end.
      name: "appends_new_attr_after_existing_block_attrs",
      dst: [["data-node-id", "20250824233004-3qfd5gf"], ["data-node-index", "1"], ["data-type", "NodeBlockquote"], ["class", "bq"], ["updated", "20250824233509"]],
      src: [["custom-b", "info"]],
      want: [["data-node-id", "20250824233004-3qfd5gf"], ["data-node-index", "1"], ["data-type", "NodeBlockquote"], ["class", "bq"], ["updated", "20250824233509"], ["custom-b", "info"]],
    },
    {
      // Aligned with the old map semantics: duplicate keys are collapsed and the last value wins,
      // but the output order stays stable and no longer drifts randomly.
      name: "collapses_duplicate_attrs_with_stable_order",
      dst: [["id", "old"], ["id", "shadow"], ["class", "foo"]],
      src: [["class", "bar"], ["id", "new"]],
      want: [["id", "new"], ["class", "bar"]],
    },
  ];

  for (const tt of tests) {
    await t.test(tt.name, () => {
      const got = mergeIALPreservingOrder(tt.dst, tt.src);
      assert.deepEqual(got, tt.want);
    });
  }
});
