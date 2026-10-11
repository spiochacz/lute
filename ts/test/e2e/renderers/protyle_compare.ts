// Shared body of the Protyle renderer comparison tests.

import assert from "node:assert/strict";
import { newEngines, readRepoFile } from "../helpers.ts";
import { CORPUS, PROTYLE_BASE, VARIATIONS } from "./protyle_corpus.ts";
import { compareOne, newTally } from "./protyle_helpers.ts";
import type { Kind, Tally } from "./protyle_helpers.ts";
import { FULL } from "../full.ts";

// Variations whose short documents are all compared in the quick run; the other variations run a sample (see ../full.ts).
const CORE_VARIATIONS = FULL ? ["base", "text mark and html tag", "tabs, text mark", "auto space and text mark", "no kramdown", "toc"] : ["base", "text mark and html tag", "tabs, text mark"];

interface SpecCase {
  section: string;
  example: number;
  markdown: string;
}

export function finish(tally: Tally, expectBothThrew: ((s: string) => boolean) | null = null): void {
  assert.deepEqual(tally.failures.slice(0, 5), []);
  if (expectBothThrew !== null) {
    for (const s of tally.bothThrew) {
      assert.ok(expectBothThrew(s), "unexpected common throw: " + s);
    }
  }
}

export function specCases(kind: Kind): Tally {
  const tally = newTally();
  const engines = newEngines(PROTYLE_BASE);
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
  for (const c of cases) {
    compareOne(tally, engines, kind, `spec ${c.example}`, c.markdown);
  }
  return tally;
}

export function files(kind: Kind, list: string[], variationNames: string[]): Tally {
  const tally = newTally();
  // Quick run (see ../full.ts): the first two of the named variations.
  for (const v of VARIATIONS.filter((x) => variationNames.includes(x.name)).slice(0, FULL ? undefined : 2)) {
    const engines = newEngines([...PROTYLE_BASE, ...v.setters]);
    for (const f of list) {
      compareOne(tally, engines, kind, `${f} [${v.name}]`, readRepoFile(f));
    }
  }
  return tally;
}

export function corpus(kind: Kind, stride: number, offset: number, variationNames: string[] | null): Tally {
  const tally = newTally();
  for (const [vIndex, v] of VARIATIONS.entries()) {
    if (variationNames !== null && !variationNames.includes(v.name)) {
      continue;
    }
    const engines = newEngines([...PROTYLE_BASE, ...v.setters]);
    for (let i = offset, n = 0; i < CORPUS.length; i += stride, n++) {
      if (!FULL && !CORE_VARIATIONS.includes(v.name) && (n + vIndex) % 10 !== 0) {
        continue;
      }
      compareOne(tally, engines, kind, `corpus ${i} [${v.name}]`, CORPUS[i]);
    }
  }
  return tally;
}
