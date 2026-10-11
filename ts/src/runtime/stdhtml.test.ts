import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UnescapeString } from "./stdhtml.ts";

// Vectors come from tools/gen-stdhtml-vectors, run against Go 1.21.13's html.UnescapeString:
// every entity name with and without ';' followed by a letter, digit, '=', space and '&',
// numeric references (decimal and hex, Windows-1252 range, surrogates, overflow) and mixed strings.
interface Vectors {
  names: number;
  unescape: [string, string][];
}
const vectors = JSON.parse(readFileSync(new URL("./testdata/stdhtml_vectors.json", import.meta.url), "utf8")) as Vectors;

test("UnescapeString equals Go's html.UnescapeString on all vectors", () => {
  assert.equal(vectors.names, 2229);
  assert.ok(vectors.unescape.length > 28000);
  const bad: string[] = [];
  for (const [input, want] of vectors.unescape) {
    if (UnescapeString(input) !== want) {
      bad.push(JSON.stringify([input, want, UnescapeString(input)]));
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test("UnescapeString documented examples", () => {
  assert.equal(UnescapeString("&notit;"), "¬it;");
  assert.equal(UnescapeString("&copy"), "©");
  assert.equal(UnescapeString("&NotEqualTilde;"), "≂̸");
  assert.equal(UnescapeString("&#x80;&#150;&#0;&#xD800;"), "€–��");
});
