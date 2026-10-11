import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, markdownBoth, newEngines } from "./helpers.ts";
import { OPTION_SETS } from "./option_sets.ts";

// Minimal reproducers of differences between the port and the reference bundle that were found (and fixed) while the port was integrated.
// The end-to-end tests found no output difference. The nil-versus-empty byte slice bugs (PORTING.md, "nil slices") do not change the HTML of
// the cases below, but they changed the tree (parse/tree.vectors.test.ts is the test that pins them); the cases stay here so that a change of
// the output on the same inputs is noticed on both implementations.

interface Regression {
  name: string;
  set: string;
  markdown: string;
}

const REGRESSIONS: Regression[] = [
  { name: "git conflict block with empty content: the content node's Tokens is nil", set: "everything on", markdown: "<<<<<<< HEAD\n\n>>>>>>> x" },
  { name: "git conflict block without any line between the markers", set: "everything on", markdown: "<<<<<<<\n>>>>>>>" },
  { name: "block query embed with an empty script: the script node's Tokens is nil", set: "Protyle", markdown: "{{ }}" },
  { name: "block query embed with an empty script, no spaces", set: "everything on", markdown: "{{}}" },
  { name: "empty task list item under Protyle: the paragraph's Tokens is nil", set: "Protyle", markdown: "- [ ]" },
  { name: "empty checked task list item under Protyle with a trailing space", set: "Protyle", markdown: "- [x] \n- [ ] a" },
  { name: "heading ID right after a code span: TrimRight of the code span's nil Tokens", set: "default", markdown: "# `a`{#b}" },
  { name: "heading ID right after a link", set: "default", markdown: "# [a](b){#c}" },
  { name: "table with an empty cell: the cell's Tokens is nil", set: "default", markdown: "|a|b|\n|-|-|\n||c|\n" },
  { name: "html block with trailing blank lines", set: "default", markdown: "<div>\n</div>\n\n" },
  { name: "indented code block of blank lines", set: "default", markdown: "    \n    a\n    \n" },
  { name: "paragraph of spaces in a list item under Protyle", set: "Protyle", markdown: "-   \n  a" },
];

for (const regression of REGRESSIONS) {
  test(`regression: ${regression.name}`, () => {
    const set = OPTION_SETS.find((s) => s.name === regression.set);
    assert.ok(set !== undefined, regression.set);
    const engines = newEngines(set.setters);
    const { port, oracle } = markdownBoth(engines, "", regression.markdown);
    assertSameOutcome(regression.name, port, oracle);
  });
}

test("regression: the reference throws on a GitHub issue URL, so does the port", () => {
  // The reference panics in the GFM auto link parser (slice bounds out of range) on this input; the port reproduces the panic.
  const engines = newEngines([]);
  const { port, oracle } = markdownBoth(engines, "", "https://github.com/issues/1");
  assert.equal(oracle.threw, true);
  assert.equal(port.threw, true);
});
