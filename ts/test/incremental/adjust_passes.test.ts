// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Pass-order conformance (section 8.3): the driver of the sandbox (ADJUST_PASSES) must call the DOM passes in the order of the engine's
// adjustVditorDOM (the first call of each pass, observed on a real run).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import * as util from "../../src/util/index.ts";
import { ADJUST_PASSES } from "../../src/incremental/sandbox.ts";

test("the sandbox driver calls the 15 DOM passes in the order of adjustVditorDOM", () => {
  const lute: Lute = New();
  const names = ADJUST_PASSES.map((p) => p.name);
  const order: string[] = [];
  const proto = lute as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of names) {
    const orig = proto[name];
    originals.set(name, orig);
    proto[name] = function (this: unknown, ...args: unknown[]): unknown {
      if (!order.includes(name)) {
        order.push(name);
      }
      return orig.apply(lute, args);
    };
  }
  try {
    // a list, a table with a list in a cell, and a code block
    const doc =
      '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x<ul><li>y</li></ul></li></ul>' +
      '<table data-block="0"><tbody><tr><td><ul><li>c</li></ul></td></tr></tbody></table>' +
      '<div data-type="code-block" data-block="0"><pre class="vditor-wysiwyg__block-pre"><code>x</code></pre></div>';
    lute.adjustVditorDOM(util.ParseHTML(doc)!);
  } finally {
    for (const name of names) {
      proto[name] = originals.get(name)!;
    }
  }
  assert.deepEqual(order, names);
  assert.equal(ADJUST_PASSES.length, 15);
});
