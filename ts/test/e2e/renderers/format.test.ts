import { test } from "node:test";
import assert from "node:assert/strict";
import { newEngines, readRepoFile } from "../helpers.ts";
import type { SetterCall } from "../helpers.ts";
import { OPTION_SETS } from "../option_sets.ts";
import { compare } from "./format_helpers.ts";
import { FORMAT_SETS } from "./format_sets.ts";
import { FULL, sample } from "../full.ts";

// FormatRenderer: the port (parse.Parse + NewFormatRenderer(...).Render(), as lute.go Format does) against the reference bundle's FormatStr,
// both configured by the same setter calls.


test("CommonMark spec cases: port equals oracle (auto space on and off)", () => {
  interface SpecCase { section: string; example: number; markdown: string }
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
  assert.equal(cases.length, 652);
  const failures: string[] = [];
  const sets: SetterCall[][] = [[], [["SetAutoSpace", false], ["SetSoftBreak2HardBreak", false]], [["SetKramdownIAL", true], ["SetUnorderedListMarker", "-"]]];
  for (const setters of sets) {
    const engines = newEngines(setters);
    for (const c of cases) {
      compare(engines, `[spec ${c.example}] ${JSON.stringify(setters)}`, `${c.section} ${c.example}`, c.markdown, failures);
    }
  }
  assert.deepEqual(failures, []);
});

test("whole files: port equals oracle under every option set", () => {
  const files = [
    "test/case1.md", "README.md", "README_en_US.md",
    "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md",
    "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md",
    "test/format-case0-formatted.md", "test/format-case1-formatted.md", "test/format-case2-formatted.md", "test/format-case3-formatted.md",
    "test/format-case4-formatted.md", "test/format-case5-formatted.md", "test/format-case6-formatted.md", "test/format-case7-formatted.md",
  ];
  const failures: string[] = [];
  // Quick run: the default sets see every file, the others a sample (see ../full.ts).
  for (const [setIndex, set] of [...OPTION_SETS, ...FORMAT_SETS].entries()) {
    const engines = newEngines(set.setters);
    for (const file of "default" === set.name || "everything on" === set.name || "Protyle format" === set.name ? files : sample(files, setIndex, 8)) {
      compare(engines, `${file} [${set.name}]`, file, readRepoFile(file), failures);
    }
  }
  assert.deepEqual(failures, []);
});

test("big files: port equals oracle under a subset of the option sets", () => {
  const files = ["benchmark/commonmark-spec.md", "test/gfm-spec.md"];
  const allNames = ["default", "kramdown IAL", "Protyle format", "Protyle format with auto space and tabs", "everything on", "auto space off"];
  // Quick run (see ../full.ts): two of the six sets.
  const names = FULL ? allNames : ["default", "Protyle format"];
  const failures: string[] = [];
  for (const set of [...OPTION_SETS, ...FORMAT_SETS]) {
    if (!names.includes(set.name)) {
      continue;
    }
    const engines = newEngines(set.setters);
    for (const file of files) {
      compare(engines, `${file} [${set.name}]`, file, readRepoFile(file), failures);
    }
  }
  assert.deepEqual(failures, []);
});
