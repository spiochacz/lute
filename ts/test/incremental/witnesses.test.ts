// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Document-level witnesses of the context fields isLast, prev and domNext (section 3 of the 2026-10-11 negative-control analysis, step 1 of
// its section 6 as placed in test/incremental/ by the coordinator). Each witness is a child C that renders differently when one neighbour
// changes: D1 is C alone, D2 is D1 with a neighbour added after or before it. The engine is warmed on D1 and then converts D2 (and the
// reverse order on a fresh engine). The result must equal the normal path, whose output is written out literally here, and both calls
// must be composed (no fallback, so that a fallback cannot hide a broken composition rule).
//
// Each witness fails under its own negative control: isLast (NC1: isLast forced to true), prev (NC2: prev forced to -1) and domNext
// (NC4: domNext forced to -1; NC5: the NextSibling read is not recorded). See negative-control.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

type Mode = "wysiwyg" | "ir";

const H1: Record<Mode, string> = {
  wysiwyg: '<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>',
  // the IR heading as the forward conversion writes it (Md2VditorIRDOM of "# h")
  ir: '<h1 data-block="0" class="vditor-ir__node" id="ir-h" data-marker="#"><span class="vditor-ir__marker vditor-ir__marker--heading" data-type="heading-marker"># </span>h</h1>',
};
// A code-block div whose only content is an ideographic space (U+3000): the engine emits it as a top-level text node, which is a non-block
// node, so it is the previous sibling of the heading after it (see the prev witnesses below).
const TEXT_BLOCK: Record<Mode, string> = {
  wysiwyg: '<div data-block="0" data-type="code-block">　</div>',
  ir: '<div data-block="0" data-type="code-block" class="vditor-ir__node">　</div>',
};
// A fenced code block as the forward conversion writes it (Md2VditorDOM / Md2VditorIRDOM of "```\nx\n```\n"): a root-level block whose
// blank line after it depends on whether it is last (isLast). An indented code block in a paragraph no longer shows this: since
// tasks/002 item 67 the paragraph is replaced by its code block, and the old fixture's blank lines were the bug.
const FENCED: Record<Mode, string> = {
  wysiwyg: '<div class="vditor-wysiwyg__block" data-type="code-block" data-block="0" data-marker="```"><pre class="vditor-wysiwyg__pre" style="display: none"><code>x\n</code></pre><pre class="vditor-wysiwyg__preview" data-render="2"><code>x\n</code></pre></div>',
  ir: '<div data-block="0" data-type="code-block" class="vditor-ir__node"><span data-type="code-block-open-marker">```</span><span class="vditor-ir__marker vditor-ir__marker--info" data-type="code-block-info">​</span><pre class="vditor-ir__marker--pre vditor-ir__marker"><code>x\n</code></pre><pre class="vditor-ir__preview" data-render="2"><code>x\n</code></pre><span data-type="code-block-close-marker">```</span></div>',
};
const BR_PARAGRAPH = '<p data-block="0">a<br>b</p>';
const UL = '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li></ul>';

interface Witness {
  field: "isLast" | "prev" | "domNext";
  mode: Mode;
  d1: string;
  d2: string;
  out1: string; // the normal path of D1, literally
  out2: string; // the normal path of D2, literally
}

const WITNESSES: Witness[] = [
  // isLast: the code block is last alone (one newline) and has a blank line after it when a heading follows
  { field: "isLast", mode: "wysiwyg", d1: FENCED.wysiwyg, d2: FENCED.wysiwyg + H1.wysiwyg, out1: "```\nx\n```\n", out2: "```\nx\n```\n\n# h\n" },
  { field: "isLast", mode: "ir", d1: FENCED.ir, d2: FENCED.ir + H1.ir, out1: "```\nx\n```\n", out2: "```\nx\n```\n\n# h\n" },
  // prev: renderHeading calls newlineBeforeBlock, which writes a newline when node.Previous is not a block node and the output does not end
  // with a LF. The heading's Previous is the AST stub of the previous sibling's last top-level node: here the text node of U+3000 (NodeText is
  // not a block), so the heading gets its newline only when prev is passed (NC2 forces prev to -1 and loses it). A link reference definition
  // does not show this any more: its text ends with a LF since tasks/002 item 68.
  { field: "prev", mode: "wysiwyg", d1: H1.wysiwyg, d2: TEXT_BLOCK.wysiwyg + H1.wysiwyg, out1: "# h\n", out2: "\u3000\n# h\n" },
  // The IR counterpart of this pair gives the same output under NC2 (the IR output has its own blank line before the heading), so there is no
  // IR witness of prev yet; the WYSIWYG witness is the one that NC2 changes.
  // domNext: the br rule of the paragraph reads the next sibling; a list after it changes the output
  { field: "domNext", mode: "wysiwyg", d1: BR_PARAGRAPH, d2: BR_PARAGRAPH + UL, out1: "a\nb\n", out2: "ab\n\n* a\n" },
  { field: "domNext", mode: "ir", d1: BR_PARAGRAPH, d2: BR_PARAGRAPH + UL, out1: "a\nb\n", out2: "ab\n\n* a\n" },
];

function newMode(mode: Mode): Lute {
  const l = New();
  if (mode === "wysiwyg") {
    l.SetVditorWYSIWYG(true);
  } else {
    l.SetVditorIR(true);
  }
  return l;
}

function convert(l: Lute, mode: Mode, html: string): string {
  return mode === "wysiwyg" ? l.VditorDOM2Md(html) : l.VditorIRDOM2Md(html);
}

for (const w of WITNESSES) {
  const name = `${w.field} (${w.mode})`;

  test(`witness ${name}: the normal path gives the literal outputs`, () => {
    const normal = newMode(w.mode);
    assert.equal(convert(normal, w.mode, w.d1), w.out1);
    assert.equal(convert(normal, w.mode, w.d2), w.out2);
  });

  test(`witness ${name}: warm on D1, then D2, equals the normal path and both calls are composed`, () => {
    const normal = newMode(w.mode);
    const engine = newMode(w.mode);
    EnableIncrementalDom2Md(engine, { strict: true, verify: true });
    try {
      assert.equal(convert(engine, w.mode, w.d1), w.out1, "D1 (warm)");
      assert.equal(convert(engine, w.mode, w.d2), w.out2, "D2");
      assert.equal(convert(normal, w.mode, w.d2), w.out2, "normal D2 (reference)");
      const s = IncrementalDom2MdStats(engine)!;
      assert.equal(s.composed, 2, `composed of 2 calls (fallbacks ${JSON.stringify(s.unsupported)})`);
      assert.deepEqual(s.inconsistencies, {});
    } finally {
      DisableIncrementalDom2Md(engine);
    }
  });

  test(`witness ${name}: D2, then D1 on a fresh engine, equals the normal path and both calls are composed`, () => {
    const engine = newMode(w.mode);
    EnableIncrementalDom2Md(engine, { strict: true, verify: true });
    try {
      assert.equal(convert(engine, w.mode, w.d2), w.out2, "D2 (warm)");
      assert.equal(convert(engine, w.mode, w.d1), w.out1, "D1");
      const s = IncrementalDom2MdStats(engine)!;
      assert.equal(s.composed, 2, `composed of 2 calls (fallbacks ${JSON.stringify(s.unsupported)})`);
      assert.deepEqual(s.inconsistencies, {});
    } finally {
      DisableIncrementalDom2Md(engine);
    }
  });
}
