// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Strict and normal mode (section 6, step 11): an injected violation of the read barrier is an inconsistency (strict mode throws it, normal
// mode falls back and counts it); a generated node ID and an exception of the sandbox are unsupported reasons (a counted fallback in both
// modes, never a throw in strict mode). Each patch is restored in a finally block.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "../../../src/ast/index.ts";
import * as html from "../../../src/html/index.ts";
import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats, IncrementalInconsistency } from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";
import { FormatRenderer } from "../../../src/render/types.ts";
import { Lute as LuteClass } from "../../../src/types.ts";
import * as atom from "../../../src/html/atom/index.ts";

const TWO = '<p data-block="0">x</p><p data-block="0">y</p>';

function withPatch(target: object, name: string, wrap: (orig: any) => any, fn: () => void): void {
  const obj = target as Record<string, unknown>;
  const orig = obj[name];
  obj[name] = wrap(orig);
  try {
    fn();
  } finally {
    obj[name] = orig;
  }
}

// The barrier violation: a top-level child reads the Data of its next DOM sibling (section 8.2 item 5b).
test("barrier violation: strict mode throws IncrementalInconsistency, normal mode falls back and counts it", () => {
  withPatch(
    LuteClass.prototype,
    "mergeSameStrong",
    (orig) =>
      function (this: Lute, n: html.Node): void {
        orig.call(this, n);
        if (n.Parent !== null && n.Parent.DataAtom === atom.Body && n.NextSibling !== null) {
          void n.NextSibling.Data;
        }
      },
    () => {
      const strict = New();
      EnableIncrementalDom2Md(strict, { strict: true });
      assert.throws(
        () => strict.VditorDOM2Md(TWO),
        (e: unknown) => e instanceof IncrementalInconsistency && e.reason === "barrier:dom.next.Data",
      );
      DisableIncrementalDom2Md(strict);

      const normal = New();
      const reference = New();
      EnableIncrementalDom2Md(normal, {});
      const want = reference.VditorDOM2Md(TWO);
      const got = normal.VditorDOM2Md(TWO);
      assert.equal(got, want, "normal mode returns the normal path's output");
      const s = IncrementalDom2MdStats(normal)!;
      assert.equal(s.inconsistencies["barrier:dom.next.Data"], 1);
      assert.equal(s.fallbacks, 1);
      assert.equal(s.composed, 0);
      DisableIncrementalDom2Md(normal);
    },
  );
});

// generated-id: the sandbox run prints a node ID (SetTesting(true) makes it fixed); the variant is refused, not thrown.
test("generated-id: a variant whose output contains the fixed ID is an unsupported fallback, in both modes", () => {
  withPatch(
    FormatRenderer.prototype,
    "renderParagraph",
    (orig) =>
      function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
        if (entering) {
          this.WriteString(ast.NewNodeID());
        }
        return orig.call(this, node, entering);
      },
    () => {
      for (const strictMode of [true, false]) {
        const lute = New();
        EnableIncrementalDom2Md(lute, { strict: strictMode });
        lute.VditorDOM2Md('<p data-block="0">x</p>');
        const s = IncrementalDom2MdStats(lute)!;
        assert.equal(s.unsupported["generated-id"], 1, `strict ${strictMode}`);
        assert.deepEqual(s.inconsistencies, {});
        DisableIncrementalDom2Md(lute);
      }
    },
  );
});

// engine-threw: the sandbox run throws an ordinary exception; the normal path throws the same, so both sides throw.
test("engine-threw: the sandbox exception is an unsupported fallback, and the same call throws on both engines", () => {
  withPatch(
    FormatRenderer.prototype,
    "renderParagraph",
    (orig) =>
      function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
        if (entering && node.Parent !== null && node.Parent.Type === ast.NodeDocument && this.Options.AutoSpace === false) {
          throw new Error("injected engine failure");
        }
        return orig.call(this, node, entering);
      },
    () => {
      const a = New();
      const b = New();
      EnableIncrementalDom2Md(a, { strict: true });
      let errA = "";
      let errB = "";
      try {
        a.VditorDOM2Md('<p data-block="0">x</p>');
      } catch (e) {
        errA = String(e);
      }
      try {
        b.VditorDOM2Md('<p data-block="0">x</p>');
      } catch (e) {
        errB = String(e);
      }
      assert.equal(errA, errB, "both sides throw the same");
      assert.notEqual(errA, "");
      const s = IncrementalDom2MdStats(a)!;
      assert.equal(s.unsupported["engine-threw"], 1);
      DisableIncrementalDom2Md(a);
    },
  );
});
