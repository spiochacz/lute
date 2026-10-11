// Asserts the pure helpers of the block-level parse files (html_block.ts, list.ts) against real Go output.
// Vectors come from ts/tools/gen-parse-blocks-vectors (go run -tags javascript .).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ast from "../ast/index.ts";
import "./html_block.ts";
import "./list.ts";
import { NewOptions } from "./parse.ts";
import { Context, Tree } from "./types.ts";

type Vec = { args: (string | number | null)[]; ret: unknown; panic: boolean };
const doc = JSON.parse(readFileSync(new URL("./testdata/blocks_vectors.json", import.meta.url), "utf8")) as { functions: Record<string, Vec[]> };

function bytesOf(h: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(h as string, "hex"));
}
function hexOrNull(b: Uint8Array | null): string | null {
  return null === b ? null : Buffer.from(b).toString("hex");
}

test("isOpenTag and isCloseTag match Go", () => {
  const t = new Tree();
  for (const v of doc.functions["isOpenTag"]) {
    assert.equal(t.isOpenTag(bytesOf(v.args[0])), v.ret, "isOpenTag " + v.args[0]);
  }
  for (const v of doc.functions["isCloseTag"]) {
    assert.equal(t.isCloseTag(bytesOf(v.args[0])), v.ret, "isCloseTag " + v.args[0]);
  }
});

test("parseOrderedListMarker matches Go", () => {
  const t = new Tree();
  for (const v of doc.functions["parseOrderedListMarker"]) {
    const [marker, delim] = t.parseOrderedListMarker(bytesOf(v.args[0]));
    assert.deepEqual([hexOrNull(marker), delim], v.ret, "parseOrderedListMarker " + v.args[0]);
  }
});

test("parseHTML matches Go (including the panics)", () => {
  for (const v of doc.functions["parseHTML"]) {
    const t = new Tree();
    t.Context = new Context(NewOptions());
    t.Context.Tip = new ast.Node(v.args[1] as number);
    if (v.panic) {
      assert.throws(() => t.parseHTML(bytesOf(v.args[0])), "parseHTML panic " + v.args[0]);
    } else {
      assert.equal(t.parseHTML(bytesOf(v.args[0])), v.ret, "parseHTML " + v.args[0] + " tip " + v.args[1]);
    }
  }
});
