import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, attempt, newEngines } from "./helpers.ts";
import { OPTION_SETS } from "./option_sets.ts";

// Deliberate departures from upstream, made in the Go sources as oracle patch 0003 (ts/tools/oracle/patches/) and in the port the same way:
// - item 67 (tasks/002-upstream-bugs.md): a paragraph whose only child is a code block (its text began with four spaces) is replaced by
//   that code block in the WYSIWYG and the IR DOM, so the Markdown has no extra blank lines after it.
// - item 68: the text of a link-ref-defs-block ends with a LF, so that the next block does not continue its last line.

interface Case {
  name: string;
  ir: boolean;
  html: string;
  expected: string;
}

const CASES: Case[] = [
  {
    name: "item 67: WYSIWYG indented code in a paragraph before a heading",
    ir: false,
    html: '<p data-block="0">    indented code</p><h1 data-block="0">h</h1>',
    expected: "```\nindented code\n```\n\n# h\n",
  },
  {
    name: "item 67: WYSIWYG indented code in a paragraph before a paragraph",
    ir: false,
    html: '<p data-block="0">    indented code</p><p data-block="0">after</p>',
    expected: "```\nindented code\n```\n\nafter\n",
  },
  {
    name: "item 67: IR indented code in a paragraph before a heading",
    ir: true,
    html: '<p data-block="0">    indented code</p><h1 data-block="0"><span class="vditor-ir__marker vditor-ir__marker--heading" data-type="heading-marker"># </span>h</h1>',
    expected: "```\nindented code\n```\n\n# h\n",
  },
  {
    name: "item 68: WYSIWYG link-ref-defs-block before a paragraph",
    ir: false,
    html: '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div><p data-block="0">para</p>',
    expected: "[r]: http://x\npara\n",
  },
  {
    name: "item 68: WYSIWYG link-ref-defs-block before a heading",
    ir: false,
    html: '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div><h1 data-block="0">h</h1>',
    expected: "[r]: http://x\n# h\n",
  },
  {
    name: "item 68: IR link-ref-defs-block before a paragraph",
    ir: true,
    html: '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div><p data-block="0">para</p>',
    expected: "[r]: http://x\npara\n",
  },
];

const SET = OPTION_SETS.find((s) => s.name === "default");

for (const c of CASES) {
  test(c.name, () => {
    assert.ok(SET !== undefined);
    const engines = newEngines(SET.setters);
    const convert = (e: typeof engines.port | typeof engines.oracle): string =>
      c.ir ? e.VditorIRDOM2Md(c.html) : e.VditorDOM2Md(c.html);
    const port = attempt(() => convert(engines.port));
    const oracle = attempt(() => convert(engines.oracle));
    assertSameOutcome(c.name, port, oracle);
    assert.equal(convert(engines.port), c.expected);
    assert.equal(convert(engines.oracle), c.expected);
  });
}
