// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The table of the DOM passes (ADJUST_VDITOR_DOM_PASSES, vditor_wysiwyg.ts) is the one list of the passes: adjustVditorDOM runs it and the sandbox
// of the cache takes its analyse and build phases from it. The tests check what the table must keep: its entries name engine methods, adjustVditorDOM
// runs them in its order, and the analyse phase is the prefix of the table that the sandbox runs before the DOM neighbours are linked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import * as util from "../../src/util/index.ts";
import { ADJUST_VDITOR_DOM_PASSES } from "../../src/vditor_wysiwyg.ts";

test("every entry of the table names a method of the engine", () => {
  const lute: Lute = New();
  const proto = lute as unknown as Record<string, unknown>;
  for (const pass of ADJUST_VDITOR_DOM_PASSES) {
    assert.equal(typeof proto[pass.name], "function", pass.name + " is not a method of Lute");
  }
  assert.equal(new Set(ADJUST_VDITOR_DOM_PASSES.map((p) => p.name)).size, ADJUST_VDITOR_DOM_PASSES.length, "a pass is listed twice");
  assert.equal(ADJUST_VDITOR_DOM_PASSES.length, 15);
});

test("the root passes are the analyse passes that take the root, and removeWbr is walked once from the first child", () => {
  const byName = new Map(ADJUST_VDITOR_DOM_PASSES.map((p) => [p.name, p]));
  assert.equal(byName.get("removeEmptyNodes")!.scope, "root");
  assert.equal(byName.get("removeHighlightJSSpans")!.scope, "root");
  assert.equal(byName.get("removeWbr")!.walk, "first");
  for (const pass of ADJUST_VDITOR_DOM_PASSES) {
    assert.equal(pass.scope === "root", pass.walk === "root", pass.name + ": a root pass is walked once with the root");
  }
});

test("the analyse phase is the prefix of the table (three passes), the build phase is the rest", () => {
  const analyse = ADJUST_VDITOR_DOM_PASSES.filter((p) => p.phase === "analyse").map((p) => p.name);
  assert.deepEqual(analyse, ["removeEmptyNodes", "removeHighlightJSSpans", "removeWbr"]);
  assert.deepEqual(ADJUST_VDITOR_DOM_PASSES.slice(0, 3).map((p) => p.phase), ["analyse", "analyse", "analyse"]);
  assert.ok(ADJUST_VDITOR_DOM_PASSES.slice(3).every((p) => p.phase === "build"));
});

test("adjustVditorDOM runs the table: each pass is called, in the order of the table", () => {
  const lute: Lute = New();
  const names = ADJUST_VDITOR_DOM_PASSES.map((p) => p.name);
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
});
