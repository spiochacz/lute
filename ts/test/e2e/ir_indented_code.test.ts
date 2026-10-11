import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, attempt, newEngines } from "./helpers.ts";
import { OPTION_SETS } from "./option_sets.ts";

// Deliberate departure from upstream, item 64 (tasks/002-upstream-bugs.md, oracle patch 0002): an indented code block in the IR DOM has no
// fence markers; upstream turned it into a paragraph and left Context.Tip inside it, so every later block nested in that paragraph and the
// Markdown round trip lost the code block and the blank lines. The port and the reference bundle build a code block and restore the tip.

const MARKDOWN = "# a\n\n    indented code\n    line2\n\nparagraph after\n\n## b\n\n- item\n\n```js\nfenced\n```\n\n$$\nx\n$$\n";
const EXPECTED = "# a\n\n```\nindented code\nline2\n```\n\nparagraph after\n\n## b\n\n- item\n\n```js\nfenced\n```\n\n$$\nx\n$$\n";

test("IR round trip keeps an indented code block as a code block (item 64)", () => {
  const set = OPTION_SETS.find((s) => s.name === "default");
  assert.ok(set !== undefined);
  const engines = newEngines(set.setters);
  const dom = engines.oracle.Md2VditorIRDOM(MARKDOWN);
  const port = attempt(() => engines.port.VditorIRDOM2Md(dom));
  const oracle = attempt(() => engines.oracle.VditorIRDOM2Md(dom));
  assertSameOutcome("item 64", port, oracle);
  assert.equal(engines.port.VditorIRDOM2Md(dom), EXPECTED);
});
