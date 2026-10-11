import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, attempt, newEngines } from "./helpers.ts";
import { OPTION_SETS } from "./option_sets.ts";

// UPSTREAM-BUG item 30 (tasks/002-upstream-bugs.md): when text follows a table cell's attribute list, Go removes the list from the cell's
// tokens with an in-place append, and the KramdownSpanIAL node that holds the list is corrupted. FormatStr prints that node's tokens, so the
// corrupted bytes show in the Markdown output. The port must print the same bytes as the reference bundle, for cells shorter than 64 bytes
// (where the port's Append does not write in place) and for longer cells. The tree vectors (parse/tables_tree.vectors.test.ts) pin the same
// behaviour on the tree itself; this test pins it on the output.

const long = "x".repeat(70);

const CASES: Array<{ name: string; markdown: string }> = [
  { name: "head cell, IAL then text, short", markdown: '| a {: style="color:red"} b | c |\n|---|---|\n| d | e |' },
  { name: "body cell, IAL then text, short", markdown: '| h |\n|---|\n| a {: style="color:red"} b |' },
  { name: "body cell, IAL then text, over 64 bytes", markdown: `| h |\n|---|\n| ${long} {: style="color:red"} ${long} |` },
  { name: "head cell, IAL then text, over 64 bytes", markdown: `| ${long} {: style="text-align:right"} b |\n|---|\n| d |` },
  { name: "body cell, IAL then text, text after IAL of 3 bytes", markdown: '| h |\n|---|\n| {: style="text-align:right"} abc |' },
];

for (const setName of ["default", "everything on"]) {
  const set = OPTION_SETS.find((s) => s.name === setName);
  assert.ok(set !== undefined, setName);
  for (const c of CASES) {
    test(`FormatStr, ${setName}: ${c.name}`, () => {
      const engines = newEngines(set.setters);
      const port = attempt(() => engines.port.FormatStr("", c.markdown));
      const oracle = attempt(() => engines.oracle.FormatStr("", c.markdown));
      assertSameOutcome(`${setName}: ${c.name}`, port, oracle);
    });
  }
}
