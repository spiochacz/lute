import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { loadVectors } from "./testhelpers.ts";

// IsValidCalloutImageSrc calls url.Parse. The TypeScript port of url.Parse
// follows Go 1.21 (the reference build of the JavaScript bundle is Go 1.21.13).
// The vector file holds, for each input, the result of a copy of
// ast.IsValidCalloutImageSrc run with Go 1.21's net/url (go121 column) and
// the result of the real ast.IsValidCalloutImageSrc under Go 1.27 (go127
// column). The two Go versions disagree on the inputs listed below. Any change
// to this list means url.Parse behaviour between Go versions changed and must
// be reviewed.
export const URL_PARSE_GO121_VS_GO127_DIFFERENCES: string[] = [
  // Go 1.21 accepts an IPv6 literal with a version prefix ("v1.fe") and
  // Go 1.27 rejects it, so the callout helper returns true under 1.21 and
  // false under 1.27.
  "https://[v1.fe]/x",
];

interface CalloutSrcCase {
  src: string;
  go121: boolean;
  go127: boolean;
}

const v = loadVectors<{ isValidCalloutImageSrc: CalloutSrcCase[] }>("callout_src_121_vectors.json");

test("IsValidCalloutImageSrc matches Go 1.21 for every vector", () => {
  assert.ok(v.isValidCalloutImageSrc.length >= 300);
  for (const c of v.isValidCalloutImageSrc) {
    assert.equal(ast.IsValidCalloutImageSrc(c.src), c.go121, JSON.stringify(c.src));
  }
});

test("IsValidCalloutImageSrc matches Go 1.27 except for the listed differences", () => {
  for (const c of v.isValidCalloutImageSrc) {
    if (URL_PARSE_GO121_VS_GO127_DIFFERENCES.includes(c.src)) {
      continue;
    }
    assert.equal(ast.IsValidCalloutImageSrc(c.src), c.go127, JSON.stringify(c.src));
  }
});

test("the inputs where Go 1.21 and Go 1.27 differ are exactly the listed set", () => {
  const diff = v.isValidCalloutImageSrc
    .filter((c) => c.go121 !== c.go127)
    .map((c) => c.src);
  assert.deepEqual(diff, URL_PARSE_GO121_VS_GO127_DIFFERENCES);
});
