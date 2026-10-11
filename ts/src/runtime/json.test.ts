import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as json from "./json.ts";

const vectors = JSON.parse(readFileSync(new URL("./testdata/json_quote_vectors.json", import.meta.url), "utf8")) as {
  cases: { input: string; expected: string }[];
};

test("json quote vectors: several hundred strings from Go 1.21 json.Marshal", () => {
  assert.ok(vectors.cases.length >= 300, `only ${vectors.cases.length} cases`);
});

test("QuoteString matches Go 1.21 json.Marshal for every vector", () => {
  for (const c of vectors.cases) {
    assert.equal(json.QuoteString(c.input), c.expected, JSON.stringify(c.input));
  }
});

test("QuoteString: Go 1.21 short forms and escapes", () => {
  assert.equal(json.QuoteString("\b\f"), "\"\\u0008\\u000c\"");
  assert.equal(json.QuoteString("\n\r\t"), "\"\\n\\r\\t\"");
  assert.equal(json.QuoteString("\"\\"), "\"\\\"\\\\\"");
  assert.equal(json.QuoteString("<>&"), "\"\\u003c\\u003e\\u0026\"");
  assert.equal(json.QuoteString("\u2028\u2029"), "\"\\u2028\\u2029\"");
  assert.equal(json.QuoteString("\u0000\u001f\u007f"), "\"\\u0000\\u001f\u007f\"");
  assert.equal(json.QuoteString("\u{1F600}中"), "\"\u{1F600}中\"");
  assert.equal(json.QuoteString("\uD800"), "\"\\ufffd\"");
});
