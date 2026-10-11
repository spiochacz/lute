import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, markdownBoth, newEngines, readRepoFile } from "./helpers.ts";
import { FULL, sample } from "./full.ts";
import { BIG_FILE_SET_NAMES, COVERED_SETTERS, OPTION_SETS } from "./option_sets.ts";

// Whole-file comparison of the port with the oracle. The big files run under a subset of the option sets.
const SMALL_FILES = [
  "test/case1.md",
  "README.md",
  "README_en_US.md",
  "test/format-case0.md",
  "test/format-case1.md",
  "test/format-case2.md",
  "test/format-case3.md",
  "test/format-case4.md",
  "test/format-case5.md",
  "test/format-case6.md",
  "test/format-case7.md",
];
const BIG_FILES = ["benchmark/commonmark-spec.md", "test/commonmark-spec.md", "test/gfm-spec.md"];

function compareFiles(files: string[], setNames: string[] | null): { compared: number; bothThrew: string[] } {
  let compared = 0;
  const bothThrew: string[] = [];
  const failures: string[] = [];
  for (const [setIndex, set] of OPTION_SETS.entries()) {
    if (setNames !== null && !setNames.includes(set.name)) {
      continue;
    }
    const engines = newEngines(set.setters);
    // Quick run: the sets named in BIG_FILE_SET_NAMES see every file, the others a sample (see ./full.ts).
    for (const file of BIG_FILE_SET_NAMES.includes(set.name) ? files : sample(files, setIndex, 8)) {
      const label = `${file} [${set.name}]`;
      const { port, oracle } = markdownBoth(engines, file, readRepoFile(file));
      try {
        if (assertSameOutcome(label, port, oracle) === "bothThrew") {
          bothThrew.push(label);
        }
      } catch (e) {
        failures.push((e as Error).message);
      }
      compared++;
    }
  }
  assert.deepEqual(failures, []);
  return { compared, bothThrew };
}

test("small files: port equals oracle under every option set", () => {
  const { compared, bothThrew } = compareFiles(SMALL_FILES, null);
  if (FULL) {
    assert.equal(compared, SMALL_FILES.length * OPTION_SETS.length);
  }
  assert.deepEqual(bothThrew, []);
});

test("big files: port equals oracle under a subset of the option sets", () => {
  for (const name of BIG_FILE_SET_NAMES) {
    assert.ok(OPTION_SETS.some((s) => s.name === name), name);
  }
  // Quick run (see ./full.ts): two of the five sets.
  const names = FULL ? BIG_FILE_SET_NAMES : ["default", "Protyle"];
  const { compared, bothThrew } = compareFiles(BIG_FILES, names);
  assert.equal(compared, BIG_FILES.length * names.length);
  assert.deepEqual(bothThrew, []);
});

test("the option sets cover these setters", () => {
  // A change of the list is noticed here.
  assert.ok(COVERED_SETTERS.length >= 70, COVERED_SETTERS.join(" "));
});
